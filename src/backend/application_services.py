from __future__ import annotations

import time
import logging
import hashlib
import base64
import binascii
import json
import re
import threading
from .session import RuntimeState, SessionRegistry, bound_runtime, coordinated
from .commands import (CapturePreviewRequest, CaptureSaveRequest, FavoriteFolderRequest, FocusMitUpdateRequest, FocusQuickCaptureRequest, NoteBaseDeleteRequest, NoteBaseRenameRequest, NoteCreateRequest, NoteFileDeleteRequest, NoteFileMoveBatchRequest, NoteFileMoveRequest, NoteFileRenameRequest, NoteGroupCreateRequest, NoteGroupDeleteRequest, NoteGroupMoveRequest, NoteGroupRenameRequest, NoteMediaAddRequest, NoteSaveRequest, OneNoteImportPreviewRequest, OneNoteImportRequest, TagCreateRequest, TagDeleteRequest, TagGroupDeleteRequest, TagGroupRenameRequest, TagGroupRequest, TagMatchApplyRequest, TagRenameRequest, TodoToggleRequest, UiSettingsUpdateRequest, VaultCreateRequest, VaultOpenRequest)
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from .config import (
    REVIEW_DASHBOARD_DEFAULT_DAYS,
    REVIEW_DASHBOARD_DAYS_MAX,
    REVIEW_DASHBOARD_DAYS_MIN,
    TAG_GROUP_DEFAULT_COLOR,
    TAG_MATCH_CONTEXT_RADIUS,
)
from .nicknotes_backend.graph_index import GraphIndex, build_graph_index, update_graph_index_for_file
from .nicknotes_backend.graph_storage import read_graph_index, read_graph_state, write_graph_index, write_graph_state
from .nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from .nicknotes_backend.models import ParsedTask, TagSuggestion

from .use_cases import (
    GetFocusDashboardUseCase,
    MoveNoteUseCase,
    OpenVaultUseCase,
    PreviewOneNoteImportUseCase,
    RenameNoteUseCase,
    SaveNoteContentUseCase,
    StartOneNoteImportUseCase,
)
from .errors import (
    ConflictDomainError,
    DomainError,
    InfrastructureDomainError,
    NotFoundDomainError,
    ValidationDomainError,
)
from .nicknotes_backend.local_data import notebase_data_path
from .nicknotes_backend.source_journal import active_journal, pending_recovery
from .nicknotes_backend.file_io import atomic_write_text
from .nicknotes_backend.trash import move_to_trash

"""Application layer entry points for NickNotes backend API controllers."""

logger = logging.getLogger(__name__)

class BackendApiService:
    """Transport-agnostic delegating layer for API handlers."""

    def __init__(self, runtime: Any | None = None, capabilities: dict[str, Any] | None = None) -> None:
        self._runtime = runtime if runtime is not None else RuntimeState()
        self._capabilities = capabilities or {}
        self.sessions = SessionRegistry(self)

    @property
    def state(self) -> RuntimeState:
        # Agent calls bind the session of their own NoteBase; everything else uses the app's.
        return bound_runtime.get() or self._runtime

    @coordinated
    def require_loaded(self) -> tuple[Any, Any]:
        runtime = self.state
        if not runtime.vault or not runtime.indexer:
            raise DomainError(
                "No NoteBase loaded",
                status_code=400,
                error_code="request.validation",
                operation="require_loaded",
            )
        return runtime.vault, runtime.indexer

    def _same_path(self, left: Path | None, right: Path | None) -> bool:
        if left is None or right is None:
            return False
        try:
            return left.resolve() == right.resolve()
        except OSError:
            return str(left).lower() == str(right).lower()

    def _current_vault_path(self) -> Path | None:
        vault = getattr(self.state, "vault", None)
        if not vault:
            return None
        try:
            return Path(vault.vault_path).resolve()
        except OSError:
            return Path(vault.vault_path)

    def _require_note_base_directory(self, target: Path, *, operation: str) -> Path:
        try:
            resolved = target.expanduser().resolve()
        except OSError as exc:
            raise ValidationDomainError(
                f"Invalid NoteBase path: {target}",
                operation=operation,
                vault_id=str(target),
                internal_message=str(exc),
            ) from exc
        if not resolved.exists() or not resolved.is_dir():
            raise ValidationDomainError(
                f"NoteBase path not found: {resolved}",
                operation=operation,
                vault_id=str(resolved),
            )
        if not (resolved / ".system" / "config.json").exists():
            raise ValidationDomainError(
                "Target folder is not a NickNotes NoteBase.",
                operation=operation,
                vault_id=str(resolved),
            )
        return resolved

    @coordinated
    def counts(self, indexer: Any) -> dict[str, int]:
        cur = indexer.conn.cursor()
        cur.execute("SELECT COUNT(*) AS cnt FROM notes;")
        notes = int(cur.fetchone()["cnt"])
        cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status <> 'done';")
        open_tasks = int(cur.fetchone()["cnt"])
        cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'done';")
        done_tasks = int(cur.fetchone()["cnt"])
        return {
            "notes": notes,
            "openTasks": open_tasks,
            "doneTasks": done_tasks,
        }

    @coordinated
    def graph_index_needs_rebuild(self, index: GraphIndex) -> bool:
        return any(item.type == "graphIndexReadFailed" for item in index.diagnostics)

    @coordinated
    def graph_index_status(self, vault: Any, index: GraphIndex | None = None) -> dict[str, Any]:
        runtime = self.state
        loaded = index if index is not None else read_graph_index(vault.graph_index_path)
        read_failed = self.graph_index_needs_rebuild(loaded)
        return {
            "available": vault.graph_index_path.exists() and not read_failed,
            "updated_at": loaded.updated_at or None,
            "node_count": len(loaded.nodes),
            "edge_count": len(loaded.edges),
            "diagnostic_count": len(loaded.diagnostics),
            "is_updating": runtime.graph_status.is_updating,
            "last_error": runtime.graph_status.last_error,
            "watcher_enabled": runtime.graph_status.watcher_enabled,
            "last_external_update": runtime.graph_status.last_external_update,
        }

    def _known_tags_for_capture(self, vault: Any, indexer: Any) -> list[dict[str, Any]]:
        by_key: dict[str, dict[str, str]] = {}

        def add_tag(category: str, slug: str, display_name: str) -> None:
            clean_category = str(category or "").strip().lower()
            clean_slug = str(slug or "").strip().lower()
            clean_display = str(display_name or "").strip() or clean_slug
            if not clean_category or not clean_slug:
                return
            key = f"{clean_category}:{clean_slug}"
            if key not in by_key:
                by_key[key] = {
                    "category": clean_category,
                    "slug": clean_slug,
                    "display_name": clean_display,
                }
                return
            if clean_display:
                by_key[key]["display_name"] = clean_display

        for row in indexer.get_all_tags():
            add_tag(
                category=str(row.get("category", "")),
                slug=str(row.get("slug", "")),
                display_name=str(row.get("display_name", "")),
            )

        for group in vault.read_tag_groups():
            group_id = str(group.get("id", "")).strip()
            tags = group.get("tags", [])
            if not isinstance(tags, list):
                continue
            for tag in tags:
                if not isinstance(tag, dict):
                    continue
                add_tag(
                    category=group_id,
                    slug=str(tag.get("id", "")).strip(),
                    display_name=str(tag.get("displayName", "")).strip() or str(tag.get("id", "")).strip(),
                )

        return sorted(by_key.values(), key=lambda item: (item["category"], item["display_name"], item["slug"]))

    @coordinated
    def compute_capture(self, text: str, vault: Any, indexer: Any) -> list[TagSuggestion]:
        clean_text = text.strip()
        if not clean_text:
            return []

        known_tags = self._known_tags_for_capture(vault, indexer)
        parsed = self.state.parser.parse(clean_text, known_tags)
        merged = parsed.merged_suggestions()


        return merged

    @staticmethod
    def tag_payload(item: TagSuggestion) -> dict[str, Any]:
        return {
            "key": item.key,
            "category": item.category,
            "slug": item.slug,
            "displayName": item.display_name,
            "confidence": round(item.confidence, 4),
            "source": item.source,
            "autoApply": item.auto_apply,
        }

    @staticmethod
    def _tag_match_aliases(group: dict[str, Any], tag: dict[str, Any]) -> list[str]:
        aliases: list[str] = []
        for value in (
            str(tag.get("displayName", "")).strip(),
            str(tag.get("id", "")).strip().replace("-", " "),
            str(tag.get("id", "")).strip(),
        ):
            clean = " ".join(value.split())
            if len(clean) < 2:
                continue
            if clean.lower() in {alias.lower() for alias in aliases}:
                continue
            aliases.append(clean)
        return aliases

    @staticmethod
    def _tag_match_excluded_ranges(markdown: str) -> list[tuple[int, int]]:
        ranges = [(match.start(), match.end()) for match in re.finditer(r"\{tag:[^}\n]+\}", markdown)]
        if markdown.startswith("---"):
            end = markdown.find("\n---", 3)
            if end >= 0:
                ranges.append((0, min(len(markdown), end + 4)))
        for match in re.finditer(r"(^|\n)```.*?(?:\n```|$)", markdown, flags=re.DOTALL):
            ranges.append((match.start(), match.end()))
        return sorted(ranges)

    @staticmethod
    def _tag_match_intersects(ranges: list[tuple[int, int]], start: int, end: int) -> bool:
        return any(start < range_end and end > range_start for range_start, range_end in ranges)

    @staticmethod
    def _tag_match_context(markdown: str, start: int, end: int, radius: int = TAG_MATCH_CONTEXT_RADIUS) -> dict[str, Any]:
        before_start = max(0, start - radius)
        after_end = min(len(markdown), end + radius)
        line_start = markdown.rfind("\n", 0, start) + 1
        line_no = markdown.count("\n", 0, start) + 1
        return {
            "before": markdown[before_start:start],
            "match": markdown[start:end],
            "after": markdown[end:after_end],
            "line": line_no,
            "lineOffset": start - line_start,
        }

    @coordinated
    def scan_tag_matches(self, vault: Any) -> list[dict[str, Any]]:
        tag_rows: list[dict[str, Any]] = []
        for group in vault.read_tag_groups():
            group_id = str(group.get("id", "")).strip()
            if not group_id:
                continue
            for tag in group.get("tags", []):
                if not isinstance(tag, dict):
                    continue
                tag_id = str(tag.get("id", "")).strip()
                if not tag_id:
                    continue
                for alias in self._tag_match_aliases(group, tag):
                    tag_rows.append(
                        {
                            "groupId": group_id,
                            "groupDisplayName": str(group.get("displayName", "")).strip() or group_id,
                            "groupColor": str(group.get("color", "")).strip() or TAG_GROUP_DEFAULT_COLOR,
                            "tagId": tag_id,
                            "tagDisplayName": str(tag.get("displayName", "")).strip() or tag_id,
                            "alias": alias,
                            "pattern": re.compile(rf"(?<![\w/:-]){re.escape(alias)}(?![\w/:-])", re.IGNORECASE),
                        }
                    )

        matches: list[dict[str, Any]] = []
        for note_file in sorted(vault._iter_markdown_files_for_tag_updates(), key=lambda item: item.as_posix()):  # noqa: SLF001
            try:
                markdown = note_file.read_text(encoding="utf-8")
            except OSError:
                continue
            excluded_ranges = self._tag_match_excluded_ranges(markdown)
            relative_path = note_file.resolve().relative_to(vault.vault_path.resolve()).as_posix()
            for row in tag_rows:
                inline_ref = f"{{tag:{row['groupId']}/{row['tagId']}}}"
                for match in row["pattern"].finditer(markdown):
                    start, end = match.span()
                    if self._tag_match_intersects(excluded_ranges, start, end):
                        continue
                    context = self._tag_match_context(markdown, start, end)
                    match_id = f"{relative_path}:{start}:{end}:{row['groupId']}:{row['tagId']}"
                    matches.append(
                        {
                            "id": match_id,
                            "path": str(note_file),
                            "relativePath": relative_path,
                            "start": start,
                            "end": end,
                            "line": context["line"],
                            "lineOffset": context["lineOffset"],
                            "matchedText": context["match"],
                            "alias": row["alias"],
                            "replacement": inline_ref,
                            "groupId": row["groupId"],
                            "groupDisplayName": row["groupDisplayName"],
                            "groupColor": row["groupColor"],
                            "tagId": row["tagId"],
                            "tagDisplayName": row["tagDisplayName"],
                            "before": context["before"],
                            "after": context["after"],
                        }
                    )
        return matches

    @coordinated(mutation=True)
    def apply_tag_matches(self, vault: Any, raw_matches: list[dict[str, Any]]) -> tuple[int, list[Path]]:
        by_path: dict[Path, list[dict[str, Any]]] = {}
        for item in raw_matches:
            path = str(item.get("path", "")).strip()
            replacement = str(item.get("replacement", "")).strip()
            matched_text = str(item.get("matchedText", ""))
            try:
                start = int(item.get("start"))
                end = int(item.get("end"))
            except (TypeError, ValueError):
                continue
            if not path or not replacement or end <= start:
                continue
            try:
                note_file = vault._resolve_note_file(path)  # noqa: SLF001
            except ValueError:
                continue
            by_path.setdefault(note_file, []).append(
                {
                    "start": start,
                    "end": end,
                    "matchedText": matched_text,
                    "replacement": replacement,
                }
            )

        applied = 0
        touched: list[Path] = []
        for note_file, items in by_path.items():
            try:
                markdown = note_file.read_text(encoding="utf-8")
            except OSError:
                continue
            next_markdown = markdown
            changed = False
            occupied: list[tuple[int, int]] = []
            for item in sorted(items, key=lambda entry: int(entry["start"]), reverse=True):
                start = int(item["start"])
                end = int(item["end"])
                replacement = str(item["replacement"])
                matched_text = str(item["matchedText"])
                if start < 0 or end > len(next_markdown) or self._tag_match_intersects(occupied, start, end):
                    continue
                if next_markdown[start:end] != matched_text:
                    continue
                next_markdown = f"{next_markdown[:start]}{replacement}{next_markdown[end:]}"
                occupied.append((start, start + len(replacement)))
                applied += 1
                changed = True
            if changed:
                atomic_write_text(note_file, next_markdown)
                touched.append(note_file)
        return applied, touched

    @coordinated
    def rebuild_graph_projection(self, vault: Any) -> dict[str, Any]:
        runtime = self.state
        with runtime.projection_lock:
            runtime.graph_status.is_updating = True
            runtime.graph_status.last_error = None
            try:
                index = build_graph_index(vault_path=vault.vault_path, tag_groups=vault.read_tag_groups())
                write_graph_index(vault.graph_index_path, index)
                return self.graph_index_status(vault, index)
            except Exception as exc:
                runtime.graph_status.last_error = str(exc)
                logger.exception("Graph projection rebuild failed.")
                return self.graph_index_status(vault)
            finally:
                runtime.graph_status.is_updating = False

    @coordinated
    def update_graph_after_note_save(
        self,
        *,
        vault: Any,
        saved_path: Path,
        previous_path: Path,
        tag_groups: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        runtime = self.state
        with runtime.projection_lock:
            runtime.graph_status.is_updating = True
            runtime.graph_status.last_error = None
            try:
                groups = tag_groups if tag_groups is not None else vault.read_tag_groups()
                if not vault.graph_index_path.exists():
                    index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
                else:
                    stored = read_graph_index(vault.graph_index_path)
                    if self.graph_index_needs_rebuild(stored):
                        index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
                    else:
                        index = update_graph_index_for_file(
                            vault_path=vault.vault_path,
                            tag_groups=groups,
                            index=stored,
                            file_path=saved_path,
                            previous_path=previous_path if previous_path.resolve() != saved_path.resolve() else None,
                        )
                        if index is stored:
                            return self.graph_index_status(vault, index)
                write_graph_index(vault.graph_index_path, index)
                return self.graph_index_status(vault, index)
            except Exception as exc:
                runtime.graph_status.last_error = str(exc)
                logger.exception("Incremental graph update failed.")
                return self.graph_index_status(vault)
            finally:
                runtime.graph_status.is_updating = False

    @coordinated
    def update_graph_after_note_move(self, *, vault: Any, previous_path: Path, moved_path: Path, rewritten: list[str]) -> dict[str, Any]:
        """Update the graph for one renamed or moved note and the notes whose links were rewritten."""
        runtime = self.state
        with runtime.projection_lock:
            stored = read_graph_index(vault.graph_index_path)
            # Each touched file re-resolves every link once; beyond a few files a full build is cheaper.
            if not vault.graph_index_path.exists() or self.graph_index_needs_rebuild(stored) or len(rewritten) > 8:
                return self.rebuild_graph_projection(vault)
            runtime.graph_status.is_updating = True
            runtime.graph_status.last_error = None
            try:
                groups = vault.read_tag_groups()
                index = update_graph_index_for_file(vault_path=vault.vault_path, tag_groups=groups, index=stored, file_path=moved_path, previous_path=previous_path)
                for raw in rewritten:
                    touched = Path(raw) if Path(raw).is_absolute() else vault.vault_path / raw
                    if touched.resolve() != moved_path.resolve():
                        index = update_graph_index_for_file(vault_path=vault.vault_path, tag_groups=groups, index=index, file_path=touched)
                if index is not stored:
                    write_graph_index(vault.graph_index_path, index)
                return self.graph_index_status(vault, index)
            except Exception as exc:
                runtime.graph_status.last_error = str(exc)
                logger.exception("Incremental graph update after move failed.")
                return self.rebuild_graph_projection(vault)
            finally:
                runtime.graph_status.is_updating = False

    def _resolve_note_request_path(self, vault: Any, raw_path: str, allow_missing: bool = False) -> Path:
        vault_root = vault.vault_path.resolve()
        candidate = Path(raw_path).expanduser()
        if candidate.is_absolute():
            file_path = candidate.resolve()
        else:
            file_path = (vault_root / raw_path.replace("\\", "/").strip().strip("/")).resolve()

        try:
            file_path.relative_to(vault_root)
        except ValueError as exc:
            raise ValidationDomainError(
                "Can only operate on files inside the loaded NoteBase",
                operation="resolve_note_request_path",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

        if file_path.exists() and not file_path.is_file():
            raise ValidationDomainError(
                f"Not a file: {file_path}",
                operation="resolve_note_request_path",
                vault_id=str(vault.vault_path),
            )

        if not allow_missing and not file_path.exists():
            raise NotFoundDomainError(
                f"File not found: {file_path}",
                operation="resolve_note_request_path",
                vault_id=str(vault.vault_path),
            )

        relative = file_path.relative_to(vault_root)
        if any(part.startswith(".") for part in relative.parts):
            raise ValidationDomainError("Internal files are not accessible as notes.")
        if file_path.suffix.lower() not in {".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".log"}:
            raise ValidationDomainError("Unsupported document type.")
        if file_path.exists() and file_path.stat().st_size > 5 * 1024 * 1024:
            raise ValidationDomainError("Document is too large (maximum 5 MB).")
        return file_path

    def health(self) -> dict[str, Any]:
        return {"ok": True, "vaultLoaded": self.state.vault is not None, "capabilities": self._capabilities}

    @coordinated
    def get_state(self) -> dict[str, Any]:
        runtime = self.state
        runtime.client_seen = time.monotonic()
        if not runtime.vault or not runtime.indexer:
            return {"vaultLoaded": False}
        return {
            "vaultLoaded": True,
            "vaultPath": str(runtime.vault.vault_path),
            "noteBasePath": str(runtime.vault.vault_path),
            "sessionId": runtime.generation,
            "changeVersion": runtime.change_version,
            "lastChange": runtime.last_change,
            "pendingRecovery": pending_recovery(runtime.vault),
            "counts": self.counts(runtime.indexer),
        }

    @coordinated
    def open_vault(self, req: VaultOpenRequest) -> Any:
        return self._open_vault_impl(req)

    @coordinated
    def _open_vault_impl(self, req: Any, progress_callback: Any | None = None) -> dict[str, Any]:
        return OpenVaultUseCase().execute(self, req, progress_callback=progress_callback)

    @coordinated
    def start_notebase_open(self, req: VaultOpenRequest) -> Any:
        vault_path = Path(req.path).expanduser().resolve()
        if not vault_path.exists():
            raise ValidationDomainError(
                f"NoteBase path not found: {vault_path}",
                operation="start_notebase_open",
                vault_id=str(vault_path),
            )
        runtime = self.state
        with runtime.load.lock:
            if runtime.load.status.active:
                raise ConflictDomainError(
                    "A NoteBase is already being loaded.",
                    operation="start_notebase_open",
                    vault_id=str(vault_path),
                )
        runtime.load.reset("NoteBase wird vorbereitet ...")
        thread = threading.Thread(
            target=self._open_notebase_background,
            args=(SimpleNamespace(path=str(vault_path)),),
            name="nicknotes-notebase-open",
            daemon=True,
        )
        thread.start()
        return {"started": True, "path": str(vault_path)}

    def _open_notebase_background(self, req: Any) -> None:
        def update_progress(phase: str, processed: int, total: int, current_path: str | None) -> None:
            self.state.load.update(
                phase=phase,
                processed=processed,
                total=total,
                current_path=current_path,
            )

        try:
            result = self._open_vault_impl(req, progress_callback=update_progress)
            self.state.load.update(
                phase="NoteBase ist bereit.",
                done=True,
                error=None,
                result=result,
            )
        except DomainError as exc:
            self.state.load.update(phase="Laden fehlgeschlagen.", done=True, error=str(exc.public_message), result=None)
        except (OSError, ValueError, RuntimeError) as exc:
            logger.exception("Could not open NoteBase in background.")
            self.state.load.update(phase="Laden fehlgeschlagen.", done=True, error=str(exc), result=None)

    def get_notebase_open_status(self) -> dict[str, Any]:
        return self.state.load.snapshot()

    @coordinated
    def create_vault(self, req: VaultCreateRequest) -> dict[str, Any]:
        parent = Path(req.parent_path).expanduser().resolve()
        if not parent.exists() or not parent.is_dir():
            raise ValidationDomainError(
                f"Parent path not found: {parent}",
                operation="create_vault",
                vault_id=str(parent),
            )

        name = str(req.name).strip()
        if not name:
            raise ValidationDomainError(
                "NoteBase name cannot be empty",
                operation="create_vault",
                vault_id=str(parent),
            )

        if name in {".", ".."} or any(c in name for c in '<>:"/\\|?*') or name.rstrip('. ') != name:
            raise ValidationDomainError("Invalid NoteBase name.")
        if name.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *[f'COM{i}' for i in range(1, 10)], *[f'LPT{i}' for i in range(1, 10)]}:
            raise ValidationDomainError("Reserved NoteBase name.")
        vault_path = parent / name
        try:
            vault_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise InfrastructureDomainError(
                "Could not create NoteBase folder.",
                operation="create_vault",
                vault_id=str(vault_path),
                internal_message=str(exc),
            ) from exc
        return self.open_vault(SimpleNamespace(path=str(vault_path)))

    @coordinated(mutation=True)
    def reindex_vault(self) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            with self.state.projection_lock:
                indexed = indexer.reindex_vault(vault.vault_path)
                vault.rebuild_task_status_links(indexer)
                tag_groups = vault.sync_tag_groups_with_index(indexer)
                graph_status = self.rebuild_graph_projection(vault)
            return {
                "indexed": indexed,
                "counts": self.counts(indexer),
                "tagGroups": tag_groups,
                "graphStatus": graph_status,
            }
        except (OSError, ValueError, RuntimeError) as exc:
            logger.exception("NoteBase reindex failed")
            raise InfrastructureDomainError(
                "Could not reindex NoteBase.",
                operation="reindex_vault",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    @coordinated
    def preview_onenote_import(self, req: OneNoteImportPreviewRequest) -> dict[str, Any]:
        return PreviewOneNoteImportUseCase().execute(self, req)

    @coordinated(mutation=True)
    def start_onenote_import(self, req: OneNoteImportRequest) -> dict[str, Any]:
        return StartOneNoteImportUseCase().execute(self, req)

    def get_onenote_import_status(self) -> dict[str, Any]:
        return self.state.imports.snapshot()

    @coordinated(mutation=True, lifecycle=True)
    def rename_notebase(self, req: NoteBaseRenameRequest) -> dict[str, Any]:
        raw_path = str(getattr(req, "path", "") or "").strip()
        if raw_path:
            old_path = self._require_note_base_directory(Path(raw_path), operation="rename_notebase")
            indexer = getattr(self.state, "indexer", None)
        else:
            vault, indexer = self.require_loaded()
            old_path = vault.vault_path.resolve()
        new_name = str(req.new_name).strip()
        if not new_name:
            raise ValidationDomainError(
                "New NoteBase name cannot be empty",
                operation="rename_notebase",
                vault_id=str(old_path),
            )
        if any(token in new_name for token in ("/", "\\")):
            raise ValidationDomainError(
                "New NoteBase name must not contain path separators",
                operation="rename_notebase",
                vault_id=str(old_path),
            )
        if new_name in {".", ".."}:
            raise ValidationDomainError(
                "Invalid NoteBase name",
                operation="rename_notebase",
                vault_id=str(old_path),
            )

        new_path = old_path.parent / new_name
        if new_path == old_path:
            return {
                "vaultPath": str(old_path),
                "noteBasePath": str(old_path),
                "counts": self.counts(indexer),
            }
        if new_path.exists():
            raise ConflictDomainError(
                f"Target path already exists: {new_path}",
                operation="rename_notebase",
                vault_id=str(old_path),
            )

        is_current = self._same_path(old_path, self._current_vault_path())
        try:
            if is_current:
                self.state.dispose_session()
            old_path.rename(new_path)
            # Keep the device-local index instead of rebuilding it under the new path.
            old_local, new_local = notebase_data_path(old_path), notebase_data_path(new_path)
            if old_local.is_dir() and not new_local.exists():
                old_local.rename(new_local)
        except OSError as exc:
            raise InfrastructureDomainError(
                "Could not rename NoteBase.",
                operation="rename_notebase",
                vault_id=str(old_path),
                internal_message=str(exc),
            ) from exc

        if is_current:
            return self.open_vault(SimpleNamespace(path=str(new_path)))
        return {
            "vaultPath": str(new_path),
            "noteBasePath": str(new_path),
            "counts": self.counts(indexer) if indexer else {},
        }

    @coordinated(mutation=True, lifecycle=True)
    def delete_notebase(self, req: NoteBaseDeleteRequest) -> dict[str, Any]:
        raw_path = str(getattr(req, "path", "") or "").strip()
        if raw_path:
            target = self._require_note_base_directory(Path(raw_path), operation="delete_notebase")
        else:
            vault, _indexer = self.require_loaded()
            target = vault.vault_path.resolve()
        # Removal needs the identity NickNotes itself wrote; a folder that merely
        # contains a similarly named file is not enough.
        try:
            identity = json.loads((target / ".system" / "config.json").read_text(encoding="utf-8")).get("vault_id")
        except (OSError, ValueError, AttributeError):
            identity = None
        if not isinstance(identity, str) or not identity.strip():
            raise ValidationDomainError(
                "Dieser Ordner ist keine von NickNotes angelegte NoteBase und wird nicht gelöscht. "
                "Öffne ihn zuerst in NickNotes oder entferne ihn im Windows-Explorer.",
                operation="delete_notebase",
                vault_id=str(target),
            )
        if not req.confirm_delete:
            raise ValidationDomainError(
                "confirmDelete must be true to delete a NoteBase",
                operation="delete_notebase",
                vault_id=str(target),
            )

        is_current = self._same_path(target, self._current_vault_path())
        try:
            if is_current:
                self.state.dispose_session()
            # Recoverable by design: the folder goes to the Recycle Bin, never straight to deletion.
            move_to_trash(target)
        except OSError as exc:
            # A 409 keeps the reason visible; 5xx messages are replaced by a generic text.
            raise ConflictDomainError(
                f"Die NoteBase wurde nicht gelöscht: {exc} Du kannst den Ordner im Windows-Explorer entfernen.",
                operation="delete_notebase",
                vault_id=str(target),
                internal_message=str(exc),
            ) from exc
        return {
            "deleted": True,
            "deletedPath": str(target),
            "vaultLoaded": bool(getattr(self.state, "vault", None) and getattr(self.state, "indexer", None)),
        }

    @coordinated
    def preview_capture(self, req: CapturePreviewRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        merged = self.compute_capture(req.text, vault, indexer)
        auto_count = sum(1 for item in merged if item.auto_apply or item.source == "explicit")
        return {
            "suggestions": [self.tag_payload(item) for item in merged],
            "stats": {
                "tags": len(merged),
                "auto": auto_count,
            },
        }

    @coordinated(mutation=True)
    def save_capture(self, req: CaptureSaveRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        text = str(req.text).strip()
        if not text:
            raise ValidationDomainError(
                "Capture text is empty",
                operation="save_capture",
                vault_id=str(vault.vault_path),
            )
        merged = self.compute_capture(text, vault, indexer)
        selected_keys = set(req.selected_tag_keys)
        selected_tags = [tag for tag in merged if tag.key in selected_keys]
        result = vault.save_capture(text=text, selected_tags=selected_tags, indexer=indexer)
        return {
            "saved": True,
            "noteId": result["note_id"],
            "date": result["date"],
            "notePath": str(result["note_path"]),
            "tasks": result["tasks"],
            "counts": self.counts(indexer),
        }

    @coordinated
    def get_focus_mit(self, date: str | None = None) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        day_iso = date
        state = vault.get_daily_mit(day_iso=day_iso)
        return {
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "mitIds": state["mit_ids"],
        }

    @coordinated(mutation=True)
    def save_focus_mit(self, req: FocusMitUpdateRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        state = vault.set_daily_mit(day_iso=req.date, mit_ids=req.mit_ids, indexer=indexer)
        return {
            "saved": True,
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "mitIds": state["mit_ids"],
            "counts": self.counts(indexer),
        }

    @coordinated(mutation=True)
    def quick_capture_focus_todo(self, req: FocusQuickCaptureRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            result = vault.add_quick_todo_to_daily(text=req.text, indexer=indexer, day_iso=req.date)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="quick_capture_focus_todo",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "saved": True,
            "date": result["date"],
            "notePath": str(result["note_path"]),
            "todoText": result["todo_text"],
            "counts": self.counts(indexer),
        }

    @coordinated(mutation=True)
    def open_or_create_daily(self, date: str | None = None) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        day_iso = date
        state = vault.ensure_daily_note(day_iso=day_iso, indexer=indexer)
        return {
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "title": state["title"],
            "created": bool(state["created"]),
            "counts": self.counts(indexer),
        }

    @coordinated
    def get_focus_dashboard(self, date: str | None = None) -> dict[str, Any]:
        return GetFocusDashboardUseCase().execute(self, date_param=date)

    @coordinated
    def list_tasks(self, include_done: bool = False) -> dict[str, Any]:
        _vault, indexer = self.require_loaded()
        return {"items": indexer.list_tasks(include_done=include_done)}

    @coordinated
    def list_todos(self) -> dict[str, Any]:
        _vault, indexer = self.require_loaded()
        return {"items": indexer.list_todos()}

    @coordinated(mutation=True)
    def toggle_todo(self, todo_id: str, req: TodoToggleRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            return vault.toggle_todo(todo_id=todo_id, indexer=indexer, checked=req.checked)
        except ValueError as exc:
            raise NotFoundDomainError(
                str(exc),
                operation="toggle_todo",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    @coordinated(mutation=True)
    def promote_todo(self, todo_id: str = '') -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            return vault.promote_todo_to_task(todo_id=todo_id, indexer=indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="promote_todo",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    @coordinated(mutation=True)
    def mark_task_done(self, task_id: str = '') -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        rows = [row for row in indexer.list_tasks(include_done=True) if row["id"] == task_id]
        if not rows:
            raise NotFoundDomainError(
                "Task not found",
                operation="mark_task_done",
                vault_id=str(vault.vault_path),
            )

        row = rows[0]
        path = row.get("path")
        if not path:
            raise ValidationDomainError(
                "Task file path missing",
                operation="mark_task_done",
                vault_id=str(vault.vault_path),
            )

        src = Path(path)
        if not src.exists():
            raise NotFoundDomainError(
                f"Task file not found: {src}",
                operation="mark_task_done",
                vault_id=str(vault.vault_path),
            )

        meta, body = parse_markdown(src)
        meta["status"] = "done"
        now_iso = datetime.now().isoformat(timespec="seconds")
        meta["updated_at"] = now_iso
        meta["completed_at"] = now_iso
        done_path = src
        if src.parent.name.lower() == "open":
            done_dir = src.parent.parent / "done"
            done_dir.mkdir(parents=True, exist_ok=True)
            done_path = done_dir / src.name
            suffix = 2
            while done_path.exists() and done_path != src:
                done_path = done_dir / f"{src.stem}_{suffix}{src.suffix}"
                suffix += 1
        if src != done_path:
            # Back up the original before it disappears; the new file is recorded by its write.
            if journal := active_journal.get():
                journal.record(src)
        atomic_write_text(done_path, dump_markdown(meta, body))
        if src != done_path and src.exists():
            src.unlink()

        blocked_by_raw = meta.get("blocked_by_ids")
        if isinstance(blocked_by_raw, list):
            iterable = [str(item) for item in blocked_by_raw]
        elif isinstance(blocked_by_raw, str):
            iterable = blocked_by_raw.split(",")
        else:
            iterable = []
        blocked_by_ids: list[str] = []
        seen_blockers: set[str] = set()
        for item in iterable:
            clean = item.strip()
            if not clean:
                continue
            lowered = clean.lower()
            if lowered in seen_blockers:
                continue
            seen_blockers.add(lowered)
            blocked_by_ids.append(clean)

        parsed = ParsedTask(
            title=str(meta.get("title", row["title"])),
            due_date=str(meta.get("due_date", "")).strip() or row.get("due_date"),
            priority=str(meta.get("priority", row.get("priority", "M"))).upper()[:1] or "M",
            status="done",
            project_tag=str(meta.get("project_tag", "")).strip() or row.get("project_tag"),
            tags=[],
            estimate_minutes=row.get("estimate_minutes"),
            completed_at=str(meta.get("completed_at", "")).strip() or None,
            blocked_by_ids=blocked_by_ids,
            waiting_for=str(meta.get("waiting_for", "")).strip() or None,
            follow_up_date=str(meta.get("follow_up_date", "")).strip() or None,
            blocked_reason=str(meta.get("blocked_reason", "")).strip() or None,
            next_action_hint=str(meta.get("next_action_hint", "")).strip() or None,
        )
        indexer.add_or_update_task(
            task_id=str(task_id),
            note_id=str(meta.get("note_id", "")).strip() or None,
            path=str(done_path),
            parsed=parsed,
            created_at=str(meta.get("created_at", meta["updated_at"])),
            updated_at=str(meta["updated_at"]),
        )
        vault.sync_task_status_link(
            task_id=str(task_id),
            title=parsed.title,
            status="done",
            task_path=str(done_path),
            indexer=indexer,
        )
        return {"done": True, "taskId": task_id, "taskPath": str(done_path)}

    @coordinated
    def search_notes(self, query: str = '', offset: int = 0, limit: int = 100, tag: str | None = None, note_type: str | None = None) -> dict[str, Any]:
        _vault, indexer = self.require_loaded()
        limit, offset = max(1, min(limit, 200)), max(0, min(offset, 100000))
        items = indexer.search_notes(query, limit=limit+1, offset=offset, tag=tag, note_type=note_type)
        return {"items": items[:limit], "hasMore": len(items)>limit, "offset": offset, "limit": limit}

    @coordinated
    def explorer_files(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        items: list[dict[str, Any]] = []
        root = vault.vault_path.resolve()
        text_extensions = {
            ".md",
            ".txt",
            ".json",
            ".yaml",
            ".yml",
            ".toml",
            ".ini",
            ".cfg",
            ".csv",
            ".log",
            ".xml",
            ".html",
            ".css",
            ".js",
            ".ts",
            ".tsx",
            ".jsx",
            ".py",
            ".sh",
            ".ps1",
            ".bat",
        }

        for file_path in root.rglob("*"):
            try:
                if not file_path.is_file():
                    continue
                relative = file_path.resolve().relative_to(root).as_posix()
            except (OSError, ValueError):
                continue
            top = relative.split("/", 1)[0]
            if top in {".system", ".media"}:
                continue

            extension = file_path.suffix.lower()
            if extension and extension not in text_extensions:
                continue

            try:
                stat = file_path.stat()
            except OSError:
                continue
            note_type = "markdown" if extension == ".md" else "text"
            items.append(
                {
                    "id": f"explorer:{relative}",
                    "title": file_path.stem,
                    "note_type": note_type,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                    "path": str(file_path),
                }
            )

        items.sort(key=lambda row: (row["updated_at"], row["path"]), reverse=True)
        return {"items": items}

    @coordinated
    def read_note_content(self, path: str = '') -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        raw_path = path
        file_path = self._resolve_note_request_path(vault=vault, raw_path=str(raw_path))
        content = file_path.read_bytes()
        return {"path": str(file_path), "content": content.decode('utf-8'), "revision": hashlib.sha256(content).hexdigest()}

    @coordinated(mutation=True)
    def save_note_content(self, req: NoteSaveRequest) -> Any:
        return SaveNoteContentUseCase().execute(self, req)

    @coordinated(mutation=True)
    def add_note_media_asset(self, req: NoteMediaAddRequest) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        try:
            payload = base64.b64decode(req.data_base64.encode("utf-8"), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValidationDomainError(
                f"Ungültige Bilddaten: {exc}",
                operation="add_note_media_asset",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

        try:
            result = vault.add_note_media_asset(
                note_path=req.path,
                filename=req.file_name or "image",
                content_type=req.content_type or "",
                data=payload,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="add_note_media_asset",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "mediaPath": result["media_path"],
            "markdownPath": result["markdown_path"],
            "fileName": result["file_name"],
        }

    @coordinated
    def get_note_media_content(self, path: str = '', source: str = '') -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        note_path = path
        try:
            asset_path, mime_type = vault.resolve_note_media_asset(note_path=note_path, source=source)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="get_note_media_content",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"path": asset_path, "mediaType": mime_type, "fileName": asset_path.name}

    @coordinated
    def get_review_dashboard(self, days: int = REVIEW_DASHBOARD_DEFAULT_DAYS, day: str | None = None) -> dict[str, Any]:
        _vault, indexer = self.require_loaded()
        day_iso = GetFocusDashboardUseCase._normalize_iso_day_param(day)
        try:
            end_day = datetime.fromisoformat(day_iso).date()
        except ValueError:
            end_day = date.today()
        safe_days = max(REVIEW_DASHBOARD_DAYS_MIN, min(int(days), REVIEW_DASHBOARD_DAYS_MAX))
        return indexer.review_dashboard(end_day=end_day, window_days=safe_days)

    @coordinated
    def get_ui_settings(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return {"settings": vault.read_ui_settings()}

    @coordinated(mutation=True, invalidate=False)
    def update_ui_settings(self, req: UiSettingsUpdateRequest) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        settings = vault.update_ui_settings(app_settings=req.app, explorer_settings=req.explorer)
        return {"settings": settings}

    @coordinated
    def get_tag_groups(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return {"groups": vault.read_tag_groups()}

    @coordinated
    def get_graph_index(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return {"index": read_graph_index(vault.graph_index_path).to_dict()}

    @coordinated
    def get_graph_index_status(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return self.graph_index_status(vault)

    @coordinated
    def rebuild_graph_index(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        with self.state.projection_lock:
            self.state.graph_status.is_updating = True
            self.state.graph_status.last_error = None
            try:
                index = build_graph_index(vault_path=vault.vault_path, tag_groups=vault.read_tag_groups())
                write_graph_index(vault.graph_index_path, index)
                return {"index": index.to_dict(), "status": self.graph_index_status(vault, index)}
            except Exception as exc:
                self.state.graph_status.last_error = str(exc)
                logger.exception("Graph index rebuild failed.")
                raise
            finally:
                self.state.graph_status.is_updating = False

    @coordinated
    def get_graph_state(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return {"state": read_graph_state(vault.graph_state_path)}

    @coordinated(mutation=True, invalidate=False)
    def update_graph_state(self, state_payload: dict[str, Any] | None = None) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        state_payload = state_payload or {}
        return {"state": write_graph_state(vault.graph_state_path, state_payload)}

    @coordinated
    def get_tag_overview(self, groupId: str = '', tagId: str = '') -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        group_id = groupId
        tag_id = tagId
        try:
            result = vault.resolve_tag_overview_note(group_id=group_id, tag_id=tag_id, indexer=indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="get_tag_overview",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "path": str(result["path"]),
            "title": str(result["title"]),
        }

    @coordinated(mutation=True)
    def add_tag_group(self, req: TagGroupRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        groups = vault.add_tag_group(req.group_id, req.display_name, req.color, indexer)
        return {"groups": groups}

    @coordinated(mutation=True)
    def add_tag(self, req: TagCreateRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        groups = vault.add_tag_to_group(req.group_id, req.tag_id, req.display_name, indexer)
        return {"groups": groups, "graphStatus": self.rebuild_graph_projection(vault)}

    @coordinated(mutation=True)
    def rename_tag_group(self, req: TagGroupRenameRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            groups, touched = vault.rename_tag_group(
                group_id=req.group_id,
                new_group_id=req.new_group_id,
                new_display_name=req.new_display_name,
                new_color=req.new_color,
                apply_to_notes=req.apply_to_notes,
                indexer=indexer,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="rename_tag_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"groups": groups, "notesUpdated": touched, "counts": self.counts(indexer), "graphStatus": self.rebuild_graph_projection(vault)}

    @coordinated(mutation=True)
    def delete_tag_group(self, req: TagGroupDeleteRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            groups, touched = vault.delete_tag_group(
                group_id=req.group_id,
                remove_from_notes=req.remove_from_notes,
                indexer=indexer,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="delete_tag_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"groups": groups, "notesUpdated": touched, "counts": self.counts(indexer), "graphStatus": self.rebuild_graph_projection(vault)}

    @coordinated(mutation=True)
    def rename_tag(self, req: TagRenameRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            groups, touched = vault.rename_tag(
                group_id=req.group_id,
                tag_id=req.tag_id,
                new_tag_id=req.new_tag_id,
                new_display_name=req.new_display_name,
                apply_to_notes=req.apply_to_notes,
                indexer=indexer,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="rename_tag",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"groups": groups, "notesUpdated": touched, "counts": self.counts(indexer), "graphStatus": self.rebuild_graph_projection(vault)}

    @coordinated(mutation=True)
    def delete_tag(self, req: TagDeleteRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            groups, touched = vault.delete_tag(
                group_id=req.group_id,
                tag_id=req.tag_id,
                remove_from_notes=req.remove_from_notes,
                indexer=indexer,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="delete_tag",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"groups": groups, "notesUpdated": touched, "counts": self.counts(indexer), "graphStatus": self.rebuild_graph_projection(vault)}

    @coordinated
    def scan_tag_match_candidates(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        matches = self.scan_tag_matches(vault)
        return {
            "items": matches,
            "total": len(matches),
        }

    @coordinated(mutation=True)
    def apply_tag_match_candidates(self, req: TagMatchApplyRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        applied, touched_paths = self.apply_tag_matches(vault, req.matches)
        if touched_paths:
            for path in touched_paths:
                indexer.reindex_markdown_file(vault.vault_path, path)
            tag_groups = vault.sync_tag_groups_with_index(indexer)
        else:
            tag_groups = vault.read_tag_groups()
        return {
            "applied": applied,
            "notesUpdated": len(touched_paths),
            "paths": [str(path) for path in touched_paths],
            "counts": self.counts(indexer),
            "tagGroups": tag_groups,
            "graphStatus": self.rebuild_graph_projection(vault),
        }

    @coordinated
    def get_note_groups(self) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        return {"groups": vault.list_note_groups()}

    @coordinated(mutation=True)
    def add_note_group(self, req: NoteGroupCreateRequest) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        try:
            created = vault.create_note_group(req.group_name, req.parent_key)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="add_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"group": created, "groups": vault.list_note_groups()}

    @coordinated(mutation=True)
    def rename_note_group(self, req: NoteGroupRenameRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            renamed = vault.rename_note_group(req.group_key, req.new_name, indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="rename_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "group": renamed,
            "groups": vault.list_note_groups(),
            "counts": self.counts(indexer),
            "graphStatus": self.rebuild_graph_projection(vault),
            "linkRewrite": vault.consume_last_link_rewrite_result(),
        }

    @coordinated(mutation=True)
    def delete_note_group(self, req: NoteGroupDeleteRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            vault.delete_note_group(req.group_key, indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="delete_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "deleted": True,
            "groups": vault.list_note_groups(),
            "counts": self.counts(indexer),
            "graphStatus": self.rebuild_graph_projection(vault),
            "linkRewrite": vault.consume_last_link_rewrite_result(),
        }

    @coordinated(mutation=True)
    def move_note_group(self, req: NoteGroupMoveRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            moved = vault.move_note_group(req.group_key, req.target_parent_key, indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="move_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "group": moved,
            "groups": vault.list_note_groups(),
            "counts": self.counts(indexer),
            "graphStatus": self.rebuild_graph_projection(vault),
            "linkRewrite": vault.consume_last_link_rewrite_result(),
        }

    @coordinated(mutation=True, invalidate=False)
    def favorite_note_group(self, req: FavoriteFolderRequest) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        try:
            favorites = vault.add_favorite_folder(req.group_key)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="favorite_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"favorites": favorites, "groups": vault.list_note_groups()}

    @coordinated(mutation=True, invalidate=False)
    def unfavorite_note_group(self, req: FavoriteFolderRequest) -> dict[str, Any]:
        vault, _indexer = self.require_loaded()
        try:
            favorites = vault.remove_favorite_folder(req.group_key)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="unfavorite_note_group",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"favorites": favorites, "groups": vault.list_note_groups()}

    @coordinated(mutation=True)
    def add_note(self, req: NoteCreateRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            created = vault.create_note_in_group(
                group_key=req.group_key,
                title=req.title,
                indexer=indexer,
                note_type=req.note_type,
                status=req.status,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="add_note",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "noteId": created["note_id"],
            "notePath": str(created["note_path"]),
            "title": str(created.get("title", "")),
            "noteType": req.note_type,
            "groups": vault.list_note_groups(),
            "counts": self.counts(indexer),
            "graphStatus": self.rebuild_graph_projection(vault),
        }

    @coordinated(mutation=True)
    def rename_note(self, req: NoteFileRenameRequest) -> dict[str, Any]:
        return RenameNoteUseCase().execute(self, req)

    @coordinated(mutation=True)
    def delete_note(self, req: NoteFileDeleteRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        self._resolve_note_request_path(vault=vault, raw_path=req.path)
        with self.state.projection_lock:
            vault.delete_note_file(req.path, indexer)
            return {
                "deleted": True,
                "graphStatus": self.rebuild_graph_projection(vault),
                "counts": self.counts(indexer),
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            }

    @coordinated(mutation=True)
    def move_note(self, req: NoteFileMoveRequest) -> dict[str, Any]:
        return MoveNoteUseCase().execute(self, req)

    @coordinated(mutation=True)
    def move_notes_batch(self, req: NoteFileMoveBatchRequest) -> dict[str, Any]:
        vault, indexer = self.require_loaded()
        try:
            moved_paths = vault.move_note_files(req.paths, req.target_group_key, indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="move_notes_batch",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {
            "movedPaths": moved_paths,
            "counts": self.counts(indexer),
            "graphStatus": self.rebuild_graph_projection(vault),
            "linkRewrite": vault.consume_last_link_rewrite_result(),
        }

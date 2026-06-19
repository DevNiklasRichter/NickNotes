from __future__ import annotations

import logging
import os
import base64
import binascii
import json
import re
import shutil
import subprocess
import sys
import threading
from importlib import import_module
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

from .config import (
    REVIEW_DASHBOARD_DEFAULT_DAYS,
    REVIEW_DASHBOARD_DEFAULT_TOP_NOTES,
    REVIEW_DASHBOARD_DAYS_MAX,
    REVIEW_DASHBOARD_DAYS_MIN,
    REVIEW_DASHBOARD_TOP_NOTES_MAX,
    REVIEW_DASHBOARD_TOP_NOTES_MIN,
    TAG_GROUP_DEFAULT_COLOR,
    TAG_MATCH_CONTEXT_RADIUS,
)
from .nicknotes_backend.graph_index import GraphIndex, build_graph_index, update_graph_index_for_file
from .nicknotes_backend.graph_storage import read_graph_index, read_graph_state, write_graph_index, write_graph_state
from .nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from .nicknotes_backend.models import ParsedTask, TagSuggestion
from .nicknotes_backend.assistant_chat import AssistantChatService
from .nicknotes_backend.assistant_changesets import AssistantChangeSetService, AssistantOrganizationService, content_hash
from .nicknotes_backend.assistant_embeddings import build_assistant_embedding_status
from .nicknotes_backend.assistant_retrieval_eval import build_assistant_retrieval_evaluation_status
from .nicknotes_backend.assistant_security import (
    AssistantSecurityError,
    normalize_assistant_config,
    normalize_assistant_note_path,
    normalize_assistant_secret_ref,
)
from .nicknotes_backend.assistant_settings import SUPPORTED_ASSISTANT_PROVIDERS, build_assistant_settings_response
from .nicknotes_backend.llm_providers import (
    LlmChatRequest,
    LlmMessage,
    LlmProviderConfig,
    LlmProviderError,
    LlmTranscriptionRequest,
    canonical_provider_id,
    create_llm_provider,
    redact_secrets,
)
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
from .operation_context import get_operation_context

"""Application layer entry points for NickNotes backend API controllers."""

logger = logging.getLogger(__name__)

ASSISTANT_MAX_AUDIO_BYTES = 25 * 1024 * 1024
ASSISTANT_AUDIO_EXTENSIONS = {".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".ogg", ".wav", ".webm"}


def _assistant_stream_event(event_type: str, payload: dict[str, Any]) -> str:
    return json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n"


def _provider_capabilities_to_dict(value: Any) -> dict[str, bool]:
    return {
        "chat": bool(getattr(value, "chat", False)),
        "streaming": bool(getattr(value, "streaming", False)),
        "toolCalls": bool(getattr(value, "tool_calls", False)),
        "transcription": bool(getattr(value, "transcription", False)),
        "embeddings": bool(getattr(value, "embeddings", False)),
    }


def _sanitize_provider_probe_error(exc: Exception) -> str:
    redacted = redact_secrets(str(exc)).strip()
    lower = redacted.lower()
    sensitive_markers = (
        "authorization:",
        "bearer ",
        "api-key",
        "x-api-key",
        "du bist ein nicknotes provider-diagnosetest",
        "antworte exakt mit: nicknotes ok",
    )
    if any(marker in lower for marker in sensitive_markers):
        return "Provider-Test fehlgeschlagen; sensible Details wurden entfernt."
    return redacted[:500] or "Provider-Test fehlgeschlagen."


def _assistant_media_placeholder(stage_id: str) -> str:
    return f"nicknotes-assistant-media://{stage_id}"


def _validate_assistant_audio_payload(*, filename: str, content_type: str, data: bytes) -> tuple[str, str]:
    payload = bytes(data)
    if not payload:
        raise ValueError("Die Audiodatei ist leer.")
    if len(payload) > ASSISTANT_MAX_AUDIO_BYTES:
        raise ValueError("Audiodatei ist zu gross (maximal 25 MB).")
    clean_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    suffix = Path(filename or "").suffix.lower()
    if clean_content_type and not clean_content_type.startswith("audio/") and clean_content_type not in {"video/mp4", "video/webm"}:
        raise ValueError("Nur Audiodateien koennen transkribiert werden.")
    if suffix and suffix not in ASSISTANT_AUDIO_EXTENSIONS:
        raise ValueError("Dieses Audioformat wird nicht unterstuetzt.")
    safe_name = Path(filename or "").name or "assistant-audio.webm"
    if Path(safe_name).suffix.lower() not in ASSISTANT_AUDIO_EXTENSIONS:
        safe_name = f"{Path(safe_name).stem or 'assistant-audio'}.webm"
    return safe_name, clean_content_type or "audio/webm"


class BackendApiService:
    """Transport-agnostic delegating layer for API handlers."""

    def __init__(self, runtime: Any | None = None, capabilities: dict[str, Any] | None = None) -> None:
        self._api_module: Any | None = None
        self._runtime = runtime
        self._capabilities = capabilities or {}

    def configure(self, *, runtime: Any | None = None, capabilities: dict[str, Any] | None = None) -> None:
        if runtime is not None:
            self._runtime = runtime
        if capabilities is not None:
            self._capabilities = capabilities

    def _api(self) -> Any:
        if self._api_module is None:
            self._api_module = import_module(".api", __package__)
        return self._api_module

    @property
    def state(self) -> Any:
        if self._runtime is not None:
            return self._runtime
        return self._api().state

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
        config_markers = (
            resolved / ".system" / "config.json",
            resolved / "system" / "config.json",
            resolved / "99_system" / "config.json",
        )
        if not any(marker.exists() for marker in config_markers):
            raise ValidationDomainError(
                "Target folder is not a NickNotes NoteBase.",
                operation=operation,
                vault_id=str(resolved),
            )
        return resolved

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

    def graph_index_needs_rebuild(self, index: GraphIndex) -> bool:
        return any(item.type == "graphIndexReadFailed" for item in index.diagnostics)

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

    @staticmethod
    def _merge_suggestions(base: list[TagSuggestion], extra: list[TagSuggestion]) -> list[TagSuggestion]:
        by_key = {item.key: item for item in base}
        for item in extra:
            current = by_key.get(item.key)
            if not current or item.confidence > current.confidence:
                by_key[item.key] = item
        return sorted(by_key.values(), key=lambda item: (-item.confidence, item.key))

    def compute_capture(self, text: str, vault: Any, indexer: Any) -> list[TagSuggestion]:
        clean_text = text.strip()
        if not clean_text:
            return []

        known_tags = self._known_tags_for_capture(vault, indexer)
        parsed = self.state.parser.parse(clean_text, known_tags)
        merged = parsed.merged_suggestions()

        if self.state.openai and self.state.openai.cfg.enabled:
            ai_suggestions = self.state.openai.suggest_tags(clean_text, known_tags)
            merged = self._merge_suggestions(merged, ai_suggestions)

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
                note_file.write_text(next_markdown, encoding="utf-8")
                touched.append(note_file)
        return applied, touched

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
                    index = read_graph_index(vault.graph_index_path)
                    if self.graph_index_needs_rebuild(index):
                        index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
                    else:
                        index = update_graph_index_for_file(
                            vault_path=vault.vault_path,
                            tag_groups=groups,
                            index=index,
                            file_path=saved_path,
                            previous_path=previous_path if previous_path.resolve() != saved_path.resolve() else None,
                        )
                write_graph_index(vault.graph_index_path, index)
                return self.graph_index_status(vault, index)
            except Exception as exc:
                runtime.graph_status.last_error = str(exc)
                logger.exception("Incremental graph update failed.")
                return self.graph_index_status(vault)
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

        return file_path

    def _run_mutation_pipeline(
        self,
        operation: str,
        request: Any,
        *,
        steps: list[tuple[str, Callable[[dict[str, Any]], Any], Callable[[dict[str, Any], Any], None] | None]],
        build_response: Callable[[dict[str, Any]], dict[str, Any]],
        lock_projection: bool = False,
    ) -> dict[str, Any]:
        context_meta = get_operation_context()
        context: dict[str, Any] = {"request": request}
        recovery_log: dict[str, Any] = {
            "operation": operation,
            "operationId": context_meta.operation_id,
            "vaultId": context_meta.vault_id,
            "status": "running",
            "steps": [],
        }

        completed_steps: list[tuple[str, Callable[[dict[str, Any], Any], None] | None, Any]] = []

        try:
            def run_steps() -> None:
                for step_name, execute_step, rollback_step in steps:
                    step_entry: dict[str, Any] = {"name": step_name, "status": "running"}
                    recovery_log["steps"].append(step_entry)
                    try:
                        step_result = execute_step(context)
                        context[step_name] = step_result
                        step_entry["status"] = "completed"
                        completed_steps.append((step_name, rollback_step, step_result))
                    except DomainError as exc:
                        step_entry["status"] = "failed"
                        step_entry["error"] = exc.public_message
                        step_entry["errorCode"] = exc.error_code
                        recovery_log["status"] = "failed"
                        recovery_log["errorCode"] = exc.error_code
                        raise
                    except Exception as exc:
                        step_entry["status"] = "failed"
                        mapped_error = InfrastructureDomainError(
                            "Operation failed unexpectedly.",
                            operation=operation,
                            vault_id=context_meta.vault_id,
                            internal_message=str(exc),
                        )
                        step_entry["error"] = mapped_error.public_message
                        step_entry["errorCode"] = mapped_error.error_code
                        recovery_log["status"] = "failed"
                        logger.exception("Operation step failed: %s", step_name)
                        rollback_errors: list[str] = []
                        for completed_name, rollback, step_output in reversed(completed_steps):
                            if rollback is None:
                                continue
                            try:
                                rollback(context, step_output)
                                context[f"{completed_name}:rollback"] = "done"
                            except Exception as rollback_exc:  # pragma: no cover - best-effort recovery
                                rollback_errors.append(f"{completed_name}: {rollback_exc}")
                        if rollback_errors:
                            recovery_log["rollbackErrors"] = rollback_errors
                            recovery_log["rollbackStatus"] = "failed"
                        else:
                            recovery_log["rollbackStatus"] = "attempted"
                        raise mapped_error

            if lock_projection:
                with self.state.projection_lock:
                    run_steps()
                    recovery_log["status"] = "completed"
                    response = build_response(context)
            else:
                run_steps()
                recovery_log["status"] = "completed"
                response = build_response(context)
            response["operationLog"] = recovery_log
            return response
        except DomainError:
            context["recovery"] = recovery_log
            raise

    def health(self, *args: Any, **kwargs: Any) -> Any:
        return {"ok": True, "vaultLoaded": self.state.vault is not None, "capabilities": self._capabilities}

    def get_state(self, *args: Any, **kwargs: Any) -> Any:
        runtime = self.state
        if not runtime.vault or not runtime.indexer:
            return {"vaultLoaded": False}
        return {
            "vaultLoaded": True,
            "vaultPath": str(runtime.vault.vault_path),
            "noteBasePath": str(runtime.vault.vault_path),
            "counts": self.counts(runtime.indexer),
        }

    def open_vault(self, req: Any) -> Any:
        return self._open_vault_impl(req)

    def _open_vault_impl(self, req: Any, progress_callback: Any | None = None) -> dict[str, Any]:
        return OpenVaultUseCase().execute(self, req, progress_callback=progress_callback)

    def start_notebase_open(self, req: Any) -> Any:
        vault_path = Path(req.path).expanduser().resolve()
        if not vault_path.exists():
            raise ValidationDomainError(
                f"NoteBase path not found: {vault_path}",
                operation="start_notebase_open",
                vault_id=str(vault_path),
            )
        runtime = self.state
        with runtime.load_lock:
            if runtime.load_status.active:
                raise ConflictDomainError(
                    "A NoteBase is already being loaded.",
                    operation="start_notebase_open",
                    vault_id=str(vault_path),
                )
        runtime.reset_load_status("NoteBase wird vorbereitet ...")
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
            self.state.update_load_status(
                phase=phase,
                processed=processed,
                total=total,
                current_path=current_path,
            )

        try:
            result = self._open_vault_impl(req, progress_callback=update_progress)
            self.state.update_load_status(
                phase="NoteBase ist bereit.",
                done=True,
                error=None,
                result=result,
            )
        except DomainError as exc:
            self.state.update_load_status(phase="Laden fehlgeschlagen.", done=True, error=str(exc.public_message), result=None)
        except Exception as exc:
            logger.exception("Could not open NoteBase in background.")
            self.state.update_load_status(phase="Laden fehlgeschlagen.", done=True, error=str(exc), result=None)

    def get_notebase_open_status(self, *args: Any, **kwargs: Any) -> Any:
        return self.state.get_load_status()

    def create_vault(self, *args: Any, **kwargs: Any) -> Any:
        req = args[0] if args else kwargs.get("req")
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

    def reindex_vault(self, *args: Any, **kwargs: Any) -> Any:
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
        except Exception as exc:
            logger.exception("NoteBase reindex failed")
            raise InfrastructureDomainError(
                "Could not reindex NoteBase.",
                operation="reindex_vault",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def open_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self.open_vault(*args, **kwargs)

    def create_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self.create_vault(*args, **kwargs)

    def reindex_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self.reindex_vault(*args, **kwargs)

    def preview_onenote_import(self, *args: Any, **kwargs: Any) -> Any:
        return PreviewOneNoteImportUseCase().execute(self, *args, **kwargs)

    def start_onenote_import(self, *args: Any, **kwargs: Any) -> Any:
        return StartOneNoteImportUseCase().execute(self, *args, **kwargs)

    def get_onenote_import_status(self, *args: Any, **kwargs: Any) -> Any:
        return self.state.get_import_status()

    def rename_notebase(self, *args: Any, **kwargs: Any) -> Any:
        req = args[0] if args else kwargs.get("req")
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

    def delete_notebase(self, *args: Any, **kwargs: Any) -> Any:
        req = args[0] if args else kwargs.get("req")
        raw_path = str(getattr(req, "path", "") or "").strip()
        if raw_path:
            target = self._require_note_base_directory(Path(raw_path), operation="delete_notebase")
        else:
            vault, _indexer = self.require_loaded()
            target = vault.vault_path.resolve()
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
            shutil.rmtree(target)
        except OSError as exc:
            raise InfrastructureDomainError(
                "Could not delete NoteBase.",
                operation="delete_notebase",
                vault_id=str(target),
                internal_message=str(exc),
            ) from exc
        return {
            "deleted": True,
            "deletedPath": str(target),
            "vaultLoaded": bool(getattr(self.state, "vault", None) and getattr(self.state, "indexer", None)),
        }

    def preview_capture(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        merged = self.compute_capture(req.text, vault, indexer)
        auto_count = sum(1 for item in merged if item.auto_apply or item.source == "explicit")
        return {
            "suggestions": [self.tag_payload(item) for item in merged],
            "stats": {
                "tags": len(merged),
                "auto": auto_count,
            },
        }

    def save_capture(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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
            "counts": self.counts(indexer),
        }

    def get_focus_mit(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        day_iso = args[0] if args else kwargs.get("date")
        state = vault.get_daily_mit(day_iso=day_iso)
        return {
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "mitIds": state["mit_ids"],
        }

    def save_focus_mit(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        state = vault.set_daily_mit(day_iso=req.date, mit_ids=req.mit_ids, indexer=indexer)
        return {
            "saved": True,
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "mitIds": state["mit_ids"],
            "counts": self.counts(indexer),
        }

    def quick_capture_focus_todo(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def open_or_create_daily(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        day_iso = args[0] if args else kwargs.get("date")
        state = vault.ensure_daily_note(day_iso=day_iso, indexer=indexer)
        return {
            "date": state["date"],
            "notePath": str(state["note_path"]),
            "title": state["title"],
            "created": bool(state["created"]),
            "counts": self.counts(indexer),
        }

    def get_focus_dashboard(self, *args: Any, **kwargs: Any) -> Any:
        return GetFocusDashboardUseCase().execute(self, *args, **kwargs)

    def list_tasks(self, *args: Any, **kwargs: Any) -> Any:
        _vault, indexer = self.require_loaded()
        include_done = bool(args[0]) if args else bool(kwargs.get("include_done", False))
        return {"items": indexer.list_tasks(include_done=include_done)}

    def list_todos(self, *args: Any, **kwargs: Any) -> Any:
        _vault, indexer = self.require_loaded()
        return {"items": indexer.list_todos()}

    def toggle_todo(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        todo_id = str(args[0]) if args else str(kwargs.get("todo_id", ""))
        req = args[1] if len(args) > 1 else kwargs.get("req")
        try:
            return vault.toggle_todo(todo_id=todo_id, indexer=indexer, checked=req.checked)
        except ValueError as exc:
            raise NotFoundDomainError(
                str(exc),
                operation="toggle_todo",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def promote_todo(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        todo_id = str(args[0]) if args else str(kwargs.get("todo_id", ""))
        try:
            return vault.promote_todo_to_task(todo_id=todo_id, indexer=indexer)
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="promote_todo",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def mark_task_done(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        task_id = str(args[0]) if args else str(kwargs.get("task_id", ""))
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
        done_path.write_text(dump_markdown(meta, body), encoding="utf-8")
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
        return {"done": True, "taskId": task_id}

    def search_notes(self, *args: Any, **kwargs: Any) -> Any:
        _vault, indexer = self.require_loaded()
        query = str(args[0]) if args else str(kwargs.get("query", ""))
        return {"items": indexer.search_notes(query)}

    def _assistant_chat_context(self, req: Any) -> tuple[Any, Any, str, dict[str, Any], int]:
        vault, indexer = self.require_loaded()
        message = str(getattr(req, "message", "") or "").strip()
        if not message:
            raise ValidationDomainError(
                "Assistant message must not be empty.",
                operation="assistant_chat",
                vault_id=str(vault.vault_path),
            )

        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_chat",
                vault_id=str(vault.vault_path),
            )

        configured_max_sources = int(assistant_config.get("max_context_notes") or 8)
        requested_max_sources = getattr(req, "max_sources", None)
        if requested_max_sources is None:
            max_sources = configured_max_sources
        else:
            try:
                max_sources = int(requested_max_sources)
            except (TypeError, ValueError):
                max_sources = configured_max_sources
            max_sources = max(1, min(configured_max_sources, max_sources))

        return vault, indexer, message, assistant_config, max_sources

    def assistant_chat(self, req: Any) -> Any:
        vault, indexer, message, assistant_config, max_sources = self._assistant_chat_context(req)
        return AssistantChatService(vault=vault, indexer=indexer).answer(
            question=message,
            assistant_config=assistant_config,
            max_sources=max_sources,
            max_context_chars=int(assistant_config.get("max_context_chars") or 24_000),
        )

    def assistant_chat_stream(self, req: Any) -> Any:
        yield _assistant_stream_event("status", {"message": "Suche in der NoteBase ..."})
        try:
            vault, indexer, message, assistant_config, max_sources = self._assistant_chat_context(req)
            service = AssistantChatService(vault=vault, indexer=indexer)
            for event in service.stream_answer(
                question=message,
                assistant_config=assistant_config,
                max_sources=max_sources,
                max_context_chars=int(assistant_config.get("max_context_chars") or 24_000),
            ):
                event_type = str(event.get("type") or "delta")
                payload = {key: value for key, value in event.items() if key != "type"}
                yield _assistant_stream_event(event_type, payload)
        except DomainError as exc:
            yield _assistant_stream_event("error", {"message": exc.public_message, "code": exc.error_code})
            return
        except Exception:
            logger.exception("Assistant stream failed")
            yield _assistant_stream_event("error", {"message": "Assistant-Anfrage fehlgeschlagen."})
            return

    def assistant_voice_status(self) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))

        assistant_enabled = bool(assistant_config.get("enabled"))
        external_allowed = bool(assistant_config.get("allow_external_note_content"))
        provider_id = canonical_provider_id(str(assistant_config.get("provider") or ""))
        model = str(assistant_config.get("model") or "").strip()
        provider_configured = False
        provider_transcription_available = False

        if not assistant_enabled:
            reason = "assistant_disabled"
        elif not external_allowed:
            reason = "external_content_not_allowed"
        else:
            reason = "provider_not_configured"
            provider_config = LlmProviderConfig(
                enabled=True,
                provider=provider_id,
                model=model,
                api_key_ref=str(assistant_config.get("api_key_ref") or ""),
                base_url=str(assistant_config.get("base_url") or "").strip() or None,
            )
            try:
                provider = create_llm_provider(provider_config)
                provider_configured = provider.is_configured()
                if provider_configured and provider.capabilities.transcription:
                    provider_transcription_available = True
                    reason = "available"
                elif provider_configured:
                    reason = "capability_unavailable"
            except LlmProviderError:
                reason = "provider_unavailable"

        return {
            "assistantEnabled": assistant_enabled,
            "externalContentAllowed": external_allowed,
            "provider": provider_id,
            "model": model,
            "providerConfigured": provider_configured,
            "providerTranscriptionAvailable": provider_transcription_available,
            "providerTranscriptionReason": reason,
            "privacyMode": "browser",
        }

    def assistant_transcribe_audio(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
            )
        if not assistant_config.get("allow_external_note_content"):
            raise ValidationDomainError(
                "Assistant external content transfer is disabled for this NoteBase.",
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
            )

        provider_id = canonical_provider_id(str(assistant_config.get("provider") or ""))
        provider_config = LlmProviderConfig(
            enabled=True,
            provider=provider_id,
            model=str(assistant_config.get("model") or "gpt-4o-mini"),
            api_key_ref=str(assistant_config.get("api_key_ref") or ""),
            base_url=str(assistant_config.get("base_url") or "").strip() or None,
            extra=dict(assistant_config),
            timeout_seconds=30.0,
        )
        try:
            provider = create_llm_provider(provider_config)
        except LlmProviderError as exc:
            raise ValidationDomainError(
                "Assistant transcription provider is not available.",
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
                internal_message=_sanitize_provider_probe_error(exc),
            ) from exc
        if not provider.is_configured():
            raise ValidationDomainError(
                "Assistant transcription provider is not configured.",
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
            )
        if not provider.capabilities.transcription:
            raise ValidationDomainError(
                "Assistant provider does not support transcription.",
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
                details={"provider": provider_id},
            )

        try:
            payload = base64.b64decode(str(getattr(req, "data_base64", "") or "").encode("utf-8"), validate=True)
            file_name, content_type = _validate_assistant_audio_payload(
                filename=str(getattr(req, "file_name", "") or "assistant-audio.webm"),
                content_type=str(getattr(req, "content_type", "") or ""),
                data=payload,
            )
        except (ValueError, binascii.Error) as exc:
            raise ValidationDomainError(
                str(exc),
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

        try:
            transcription = provider.transcribe(
                LlmTranscriptionRequest(
                    audio=payload,
                    filename=file_name,
                    content_type=content_type,
                    language=str(getattr(req, "language", "") or "").strip(),
                )
            )
        except (LlmProviderError, OSError, TimeoutError, ValueError) as exc:
            raise InfrastructureDomainError(
                "Assistant transcription failed.",
                status_code=502,
                operation="assistant_transcribe_audio",
                vault_id=str(vault.vault_path),
                internal_message=_sanitize_provider_probe_error(exc),
            ) from exc

        return {
            "text": transcription.text,
            "provider": provider_id,
            "model": str(
                assistant_config.get("transcription_model")
                or assistant_config.get("transcriptionModel")
                or "gpt-4o-mini-transcribe"
            ),
            "usedProvider": True,
            "privacyMode": "provider",
        }

    def assistant_media_stage(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_media_stage",
                vault_id=str(vault.vault_path),
            )
        if not assistant_config.get("allow_write_actions"):
            raise ValidationDomainError(
                "Assistant write actions are disabled for this NoteBase.",
                operation="assistant_media_stage",
                vault_id=str(vault.vault_path),
            )
        try:
            payload = base64.b64decode(str(getattr(req, "data_base64", "") or "").encode("utf-8"), validate=True)
            return vault.stage_assistant_media_asset(
                filename=str(getattr(req, "file_name", "") or "image"),
                content_type=str(getattr(req, "content_type", "") or ""),
                data=payload,
            )
        except (ValueError, binascii.Error) as exc:
            raise ValidationDomainError(
                str(exc),
                operation="assistant_media_stage",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def assistant_embedding_status(self) -> Any:
        vault, indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        return build_assistant_embedding_status(
            indexer=indexer,
            counts=self.counts(indexer),
            graph_status=self.graph_index_status(vault),
            assistant_config=assistant_config,
        )

    def assistant_retrieval_evaluation(self) -> Any:
        vault, indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        return build_assistant_retrieval_evaluation_status(
            vault=vault,
            indexer=indexer,
            graph_status=self.graph_index_status(vault),
            assistant_config=assistant_config,
        )

    def assistant_settings(self) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        return build_assistant_settings_response(normalize_assistant_config(vault_config.get("assistant")))

    def update_assistant_settings(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        provider = canonical_provider_id(str(getattr(req, "provider", assistant_config.get("provider")) or ""))
        if provider not in SUPPORTED_ASSISTANT_PROVIDERS:
            raise ValidationDomainError(
                "Assistant provider adapter is not available.",
                operation="assistant_settings_update",
                vault_id=str(vault.vault_path),
                details={"provider": provider},
            )

        try:
            api_key_ref = normalize_assistant_secret_ref(
                getattr(req, "api_key_ref", assistant_config.get("api_key_ref")),
                strict=True,
            )
        except AssistantSecurityError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="assistant_settings_update",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

        base_url = str(getattr(req, "base_url", assistant_config.get("base_url", "")) or "").strip()
        if base_url and not re.match(r"^https?://[^\s]+$", base_url, flags=re.IGNORECASE):
            raise ValidationDomainError(
                "Assistant provider endpoint must be an HTTP or HTTPS URL.",
                operation="assistant_settings_update",
                vault_id=str(vault.vault_path),
            )

        next_config = {
            **assistant_config,
            "enabled": bool(getattr(req, "enabled", assistant_config.get("enabled"))),
            "provider": provider,
            "model": str(getattr(req, "model", assistant_config.get("model")) or "").strip(),
            "api_key_ref": api_key_ref,
            "base_url": base_url,
            "allow_external_note_content": bool(
                getattr(req, "allow_external_note_content", assistant_config.get("allow_external_note_content"))
            ),
            "allow_write_actions": bool(getattr(req, "allow_write_actions", assistant_config.get("allow_write_actions"))),
            "max_context_notes": getattr(req, "max_context_notes", assistant_config.get("max_context_notes")),
            "max_context_chars": getattr(req, "max_context_chars", assistant_config.get("max_context_chars")),
        }
        vault_config["assistant"] = normalize_assistant_config(next_config)
        vault.write_config(vault_config)
        return build_assistant_settings_response(vault_config["assistant"])

    def assistant_provider_probe(self) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        provider_id = canonical_provider_id(str(assistant_config.get("provider") or "openai"))
        model = str(assistant_config.get("model") or "").strip()
        provider_config = LlmProviderConfig(
            enabled=True,
            provider=provider_id,
            model=model,
            api_key_ref=str(assistant_config.get("api_key_ref") or ""),
            base_url=str(assistant_config.get("base_url") or "").strip() or None,
            timeout_seconds=10.0,
            extra=dict(assistant_config),
        )
        base_response = {
            "provider": provider_id,
            "model": model,
            "usedProvider": False,
            "noteContentSent": False,
            "diagnosticOnly": True,
            "capabilities": _provider_capabilities_to_dict(None),
            "error": "",
        }

        try:
            provider = create_llm_provider(provider_config)
        except LlmProviderError as exc:
            return {
                **base_response,
                "ok": False,
                "status": "unsupported_provider",
                "message": "Provider-Adapter ist nicht verfuegbar.",
                "error": redact_secrets(str(exc)),
            }

        capabilities = _provider_capabilities_to_dict(provider.capabilities)
        if not provider.is_configured():
            return {
                **base_response,
                "capabilities": capabilities,
                "ok": False,
                "status": "secret_missing",
                "message": "Provider-Key fehlt oder ist im Backend-Prozess nicht verfuegbar.",
            }

        try:
            provider.chat(
                LlmChatRequest(
                    messages=[
                        LlmMessage(
                            role="system",
                            content=(
                                "Du bist ein NickNotes Provider-Diagnosetest. "
                                "Es werden keine NoteBase-Inhalte bereitgestellt. Antworte kurz."
                            ),
                        ),
                        LlmMessage(role="user", content="Antworte exakt mit: NickNotes OK"),
                    ],
                    response_format="text",
                )
            )
        except Exception as exc:
            return {
                **base_response,
                "capabilities": capabilities,
                "ok": False,
                "status": "provider_error",
                "message": "Provider-Test fehlgeschlagen.",
                "error": _sanitize_provider_probe_error(exc),
            }

        return {
            **base_response,
            "capabilities": capabilities,
            "ok": True,
            "status": "ready",
            "message": "Provider-Test erfolgreich.",
            "usedProvider": True,
        }

    def assistant_changeset_preview(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        instruction = str(getattr(req, "instruction", "") or "").strip()
        if not instruction:
            raise ValidationDomainError(
                "Assistant change instruction must not be empty.",
                operation="assistant_changeset_preview",
                vault_id=str(vault.vault_path),
            )

        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_changeset_preview",
                vault_id=str(vault.vault_path),
            )
        if not assistant_config.get("allow_write_actions"):
            raise ValidationDomainError(
                "Assistant write actions are disabled for this NoteBase.",
                operation="assistant_changeset_preview",
                vault_id=str(vault.vault_path),
            )

        raw_path = str(getattr(req, "path", "") or "").strip()
        try:
            return AssistantChangeSetService(vault=vault).preview(
                raw_path=raw_path,
                instruction=instruction,
                assistant_config=assistant_config,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="assistant_changeset_preview",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def assistant_organize_preview(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        instruction = str(getattr(req, "instruction", "") or "").strip()
        actions = getattr(req, "actions", None)
        raw_actions = actions if isinstance(actions, list) else []
        if not raw_actions:
            action: dict[str, Any] = {
                "actionType": str(getattr(req, "action_type", "") or "").strip(),
                "title": str(getattr(req, "title", "") or "").strip(),
                "body": str(getattr(req, "body", "") or "").strip(),
                "sourcePath": str(getattr(req, "source_path", "") or "").strip(),
                "targetGroupKey": str(getattr(req, "target_group_key", "") or "").strip(),
                "attachments": getattr(req, "attachments", []) if isinstance(getattr(req, "attachments", []), list) else [],
            }
            raw_actions = [action]
        if not instruction and not any(str(action.get("title") or action.get("body") or "").strip() for action in raw_actions if isinstance(action, dict)):
            raise ValidationDomainError(
                "Assistant organization instruction must not be empty.",
                operation="assistant_organize_preview",
                vault_id=str(vault.vault_path),
            )

        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_organize_preview",
                vault_id=str(vault.vault_path),
            )
        if not assistant_config.get("allow_write_actions"):
            raise ValidationDomainError(
                "Assistant write actions are disabled for this NoteBase.",
                operation="assistant_organize_preview",
                vault_id=str(vault.vault_path),
            )
        try:
            return AssistantOrganizationService(vault=vault).preview(
                instruction=instruction,
                raw_actions=[action for action in raw_actions if isinstance(action, dict)],
                assistant_config=assistant_config,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="assistant_organize_preview",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

    def assistant_changeset_apply(self, req: Any) -> Any:
        vault, _indexer = self.require_loaded()
        vault_config = vault.read_config()
        assistant_config = normalize_assistant_config(vault_config.get("assistant"))
        if not assistant_config.get("enabled"):
            raise ValidationDomainError(
                "Assistant is disabled for this NoteBase.",
                operation="assistant_changeset_apply",
                vault_id=str(vault.vault_path),
            )
        if not assistant_config.get("allow_write_actions"):
            raise ValidationDomainError(
                "Assistant write actions are disabled for this NoteBase.",
                operation="assistant_changeset_apply",
                vault_id=str(vault.vault_path),
            )

        confirmed = bool(getattr(req, "confirmed", False))
        if not confirmed:
            raise ValidationDomainError(
                "Assistant ChangeSet must be confirmed before apply.",
                operation="assistant_changeset_apply",
                vault_id=str(vault.vault_path),
            )

        change_set = getattr(req, "change_set", None)
        if not isinstance(change_set, dict):
            raise ValidationDomainError(
                "Assistant ChangeSet payload is invalid.",
                operation="assistant_changeset_apply",
                vault_id=str(vault.vault_path),
            )
        operations = change_set.get("operations")
        if not isinstance(operations, list) or not operations:
            raise ValidationDomainError(
                "Assistant ChangeSet contains no operations.",
                operation="assistant_changeset_apply",
                vault_id=str(vault.vault_path),
            )

        content_action_types = {"replace_note_content", "add_note_tags", "add_related_links", "add_wikilinks"}
        prepared: list[dict[str, Any]] = []
        for item in operations:
            if not isinstance(item, dict):
                raise ValidationDomainError(
                    "Assistant ChangeSet operation is invalid.",
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                )
            action_type = str(item.get("actionType") or "").strip()
            if action_type not in {*content_action_types, "create_note", "create_task", "move_note"}:
                raise ValidationDomainError(
                    f"Unsupported Assistant ChangeSet action: {action_type}",
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                )
            if action_type in {"create_note", "create_task"}:
                after_content = str(item.get("afterContent") or "")
                after_hash = str(item.get("afterHash") or "").strip()
                if not after_hash or content_hash(after_content) != after_hash:
                    raise ValidationDomainError(
                        "Assistant ChangeSet content hash does not match its payload.",
                        operation="assistant_changeset_apply",
                        vault_id=str(vault.vault_path),
                        details={"path": str(item.get("path") or "")},
                    )
                target_group_key = str(item.get("targetGroupKey") or "").strip()
                try:
                    target_group = vault._resolve_group_path(target_group_key)  # noqa: SLF001
                    if vault._is_creation_locked_path(target_group):  # noqa: SLF001
                        raise ValueError("Assistant cannot create notes in this folder.")
                except ValueError as exc:
                    raise ValidationDomainError(
                        str(exc),
                        operation="assistant_changeset_apply",
                        vault_id=str(vault.vault_path),
                        internal_message=str(exc),
                    ) from exc
                title = str(item.get("title") or "").strip() or ("Neue Aufgabe" if action_type == "create_task" else "Neue Notiz")
                prepared.append(
                    {
                        "operationId": str(item.get("id") or ""),
                        "actionType": action_type,
                        "targetGroupKey": target_group_key,
                        "title": title,
                        "content": after_content,
                        "mediaAttachments": self._assistant_media_attachments_from_operation(item),
                    }
                )
                continue
            try:
                relative_path = normalize_assistant_note_path(str(item.get("path") or ""))
            except ValueError as exc:
                raise ValidationDomainError(
                    str(exc),
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                    internal_message=str(exc),
                ) from exc
            file_path = self._resolve_note_request_path(vault=vault, raw_path=relative_path)
            current_content = file_path.read_text(encoding="utf-8")
            current_hash = content_hash(current_content)
            before_hash = str(item.get("beforeHash") or "").strip()
            if current_hash != before_hash:
                raise ConflictDomainError(
                    "Die Notiz wurde seit Erstellung des Assistant-Vorschlags geaendert.",
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                    details={
                        "path": relative_path,
                        "expectedHash": before_hash,
                        "currentHash": current_hash,
                    },
                )
            if action_type == "move_note":
                target_group_key = str(item.get("targetGroupKey") or "").strip()
                if not target_group_key and "targetGroupKey" not in item:
                    raise ValidationDomainError(
                        "Assistant move operation needs a target group.",
                        operation="assistant_changeset_apply",
                        vault_id=str(vault.vault_path),
                        details={"path": relative_path},
                    )
                try:
                    target_group = vault._resolve_group_path(target_group_key)  # noqa: SLF001
                    if vault._is_tag_path(target_group) or vault._is_system_path(target_group):  # noqa: SLF001
                        raise ValueError("Assistant cannot move notes into this folder.")
                except ValueError as exc:
                    raise ValidationDomainError(
                        str(exc),
                        operation="assistant_changeset_apply",
                        vault_id=str(vault.vault_path),
                        internal_message=str(exc),
                    ) from exc
                prepared.append(
                    {
                        "operationId": str(item.get("id") or ""),
                        "actionType": action_type,
                        "path": relative_path,
                        "absolutePath": str(file_path),
                        "targetGroupKey": target_group_key,
                    }
                )
                continue
            after_content = str(item.get("afterContent") or "")
            after_hash = str(item.get("afterHash") or "").strip()
            if not after_hash or content_hash(after_content) != after_hash:
                raise ValidationDomainError(
                    "Assistant ChangeSet content hash does not match its payload.",
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                    details={"path": relative_path},
                )
            prepared.append(
                {
                    "operationId": str(item.get("id") or ""),
                    "actionType": action_type,
                    "path": relative_path,
                    "absolutePath": str(file_path),
                    "content": after_content,
                }
            )

        applied_paths: list[str] = []
        path_mappings: list[dict[str, str]] = []
        operation_results: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        latest_result: dict[str, Any] = {}
        for item in prepared:
            try:
                if item["actionType"] in content_action_types:
                    latest_result = self.save_note_content(SimpleNamespace(path=item["path"], content=item["content"]))
                    previous_path = str(item["absolutePath"])
                    next_path = str(latest_result.get("path") or item["path"])
                    applied_paths.extend([previous_path, next_path])
                    if previous_path.replace("\\", "/").lower() != next_path.replace("\\", "/").lower():
                        path_mappings.append({"fromPath": previous_path, "toPath": next_path})
                    operation_results.append(
                        {
                            "id": item["operationId"],
                            "actionType": item["actionType"],
                            "status": "applied",
                            "path": next_path,
                        }
                    )
                elif item["actionType"] in {"create_note", "create_task"}:
                    created = vault.create_note_in_group(
                        group_key=item["targetGroupKey"],
                        title=item["title"],
                        indexer=self.require_loaded()[1],
                        note_type="task" if item["actionType"] == "create_task" else "note",
                        status="open",
                    )
                    created_path = str(created["note_path"])
                    content = self._materialize_assistant_media_attachments(
                        vault=vault,
                        note_path=created_path,
                        content=item["content"],
                        attachments=item.get("mediaAttachments") or [],
                    )
                    latest_result = self.save_note_content(SimpleNamespace(path=created_path, content=content))
                    next_path = str(latest_result.get("path") or created_path)
                    applied_paths.extend([created_path, next_path])
                    if created_path.replace("\\", "/").lower() != next_path.replace("\\", "/").lower():
                        path_mappings.append({"fromPath": created_path, "toPath": next_path})
                    operation_results.append(
                        {
                            "id": item["operationId"],
                            "actionType": item["actionType"],
                            "status": "applied",
                            "path": next_path,
                        }
                    )
                elif item["actionType"] == "move_note":
                    latest_result = self.move_note(SimpleNamespace(path=item["path"], target_group_key=item["targetGroupKey"]))
                    next_path = str(latest_result.get("movedPath") or item["path"])
                    previous_path = str(item["absolutePath"])
                    applied_paths.extend([previous_path, next_path])
                    if previous_path.replace("\\", "/").lower() != next_path.replace("\\", "/").lower():
                        path_mappings.append({"fromPath": previous_path, "toPath": next_path})
                    operation_results.append(
                        {
                            "id": item["operationId"],
                            "actionType": item["actionType"],
                            "status": "applied",
                            "fromPath": previous_path,
                            "path": next_path,
                        }
                    )
            except DomainError as exc:
                error = {
                    "id": item["operationId"],
                    "actionType": item["actionType"],
                    "status": "failed",
                    "error": exc.public_message,
                    "errorCode": exc.error_code,
                }
                errors.append(error)
                operation_results.append(error)

        return {
            "applied": any(result.get("status") == "applied" for result in operation_results),
            "partial": bool(errors) and any(result.get("status") == "applied" for result in operation_results),
            "changeSetId": str(change_set.get("id") or ""),
            "paths": list(dict.fromkeys(applied_paths)),
            "pathMappings": path_mappings,
            "operationResults": operation_results,
            "errors": errors,
            "counts": latest_result.get("counts", self.counts(self.require_loaded()[1])),
            "graphStatus": latest_result.get("graphStatus", {}),
            "linkRewrite": latest_result.get("linkRewrite", {}),
        }

    def _assistant_media_attachments_from_operation(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        details = item.get("details")
        if not isinstance(details, dict):
            return []
        attachments = details.get("mediaAttachments")
        if not isinstance(attachments, list):
            return []
        clean: list[dict[str, Any]] = []
        seen: set[str] = set()
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            stage_id = str(attachment.get("id") or "").strip()
            if not stage_id or stage_id in seen:
                continue
            seen.add(stage_id)
            clean.append(
                {
                    "id": stage_id,
                    "fileName": str(attachment.get("fileName") or "image"),
                    "contentType": str(attachment.get("contentType") or ""),
                    "placeholder": str(attachment.get("placeholder") or _assistant_media_placeholder(stage_id)),
                }
            )
        return clean

    def _materialize_assistant_media_attachments(
        self,
        *,
        vault: Any,
        note_path: str,
        content: str,
        attachments: list[dict[str, Any]],
    ) -> str:
        next_content = str(content or "")
        for attachment in attachments:
            stage_id = str(attachment.get("id") or "").strip()
            placeholder = str(attachment.get("placeholder") or _assistant_media_placeholder(stage_id))
            if not stage_id or placeholder not in next_content:
                continue
            try:
                staged = vault.read_staged_assistant_media_asset(stage_id)
                media_result = vault.add_note_media_asset(
                    note_path=note_path,
                    filename=str(staged.get("fileName") or attachment.get("fileName") or "image"),
                    content_type=str(staged.get("contentType") or attachment.get("contentType") or ""),
                    data=staged["data"],
                )
            except ValueError as exc:
                raise ValidationDomainError(
                    str(exc),
                    operation="assistant_changeset_apply",
                    vault_id=str(vault.vault_path),
                    internal_message=str(exc),
                ) from exc
            next_content = next_content.replace(placeholder, str(media_result["markdown_path"]))
            vault.remove_staged_assistant_media_asset(stage_id)
        return next_content

    def explorer_files(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        items: list[dict[str, Any]] = []
        root = vault.vault_path.resolve()
        hide_legacy_daily = (root / "daily").is_dir()
        hide_legacy_tags = (root / "tags").is_dir()
        hide_legacy_tasks = (root / "tasks").is_dir()
        hide_dot_system = (root / ".system").is_dir()
        hide_legacy_system = (root / "system").is_dir()
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
            if top in {".system", "system", "99_system", "02_entities", ".media"}:
                continue
            if hide_legacy_daily and top == "01_daily":
                continue
            if hide_legacy_tags and top == "02_tags":
                continue
            if hide_legacy_tasks and top == "03_tasks":
                continue
            if hide_dot_system and top == "system":
                continue
            if hide_legacy_system and top == "99_system":
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

    def read_note_content(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        raw_path = args[0] if args else kwargs.get("path", "")
        file_path = self._resolve_note_request_path(vault=vault, raw_path=str(raw_path))
        return {"path": str(file_path), "content": file_path.read_text(encoding="utf-8")}

    def save_note_content(self, req: Any) -> Any:
        return SaveNoteContentUseCase().execute(self, req)

    def add_note_media_asset(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        try:
            payload = base64.b64decode(req.data_base64.encode("utf-8"), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValidationDomainError(
                f"Ungueltige Bilddaten: {exc}",
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

    def get_note_media_content(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        note_path = str(args[0]) if args else str(kwargs.get("path", ""))
        source = str(args[1]) if len(args) > 1 else str(kwargs.get("source", ""))
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

    def open_note_file(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        raw_path = str(getattr(req, "path", ""))
        file_path = self._resolve_note_request_path(vault=vault, raw_path=raw_path)

        try:
            if sys.platform.startswith("win"):
                os.startfile(str(file_path))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.run(["open", str(file_path)], check=False)
            else:
                subprocess.run(["xdg-open", str(file_path)], check=False)
        except OSError as exc:
            raise InfrastructureDomainError(
                "Could not open file.",
                operation="open_note_file",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc

        return {"opened": True, "path": str(file_path)}

    def get_review(self, *args: Any, **kwargs: Any) -> Any:
        _vault, indexer = self.require_loaded()
        today = date.today()
        return {
            "daily": indexer.daily_summary(today),
            "weekly": indexer.weekly_summary(today),
        }

    def get_review_dashboard(self, *args: Any, **kwargs: Any) -> Any:
        _vault, indexer = self.require_loaded()
        days = args[0] if args else kwargs.get("days", REVIEW_DASHBOARD_DEFAULT_DAYS)
        day = args[1] if len(args) > 1 else kwargs.get("day")
        top = args[2] if len(args) > 2 else kwargs.get("top", REVIEW_DASHBOARD_DEFAULT_TOP_NOTES)
        day_iso = GetFocusDashboardUseCase._normalize_iso_day_param(day)
        try:
            end_day = datetime.fromisoformat(day_iso).date()
        except ValueError:
            end_day = date.today()
        safe_days = max(REVIEW_DASHBOARD_DAYS_MIN, min(int(days), REVIEW_DASHBOARD_DAYS_MAX))
        safe_top = max(REVIEW_DASHBOARD_TOP_NOTES_MIN, min(int(top), REVIEW_DASHBOARD_TOP_NOTES_MAX))
        return indexer.review_dashboard(end_day=end_day, window_days=safe_days, top_notes_limit=safe_top)

    def get_ui_settings(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return {"settings": vault.read_ui_settings()}

    def update_ui_settings(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        settings = vault.update_ui_settings(app_settings=req.app, explorer_settings=req.explorer)
        return {"settings": settings}

    def get_tag_groups(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return {"groups": vault.read_tag_groups()}

    def get_graph_index(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return {"index": read_graph_index(vault.graph_index_path).to_dict()}

    def get_graph_index_status(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return self.graph_index_status(vault)

    def rebuild_graph_index(self, *args: Any, **kwargs: Any) -> Any:
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

    def get_graph_state(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return {"state": read_graph_state(vault.graph_state_path)}

    def update_graph_state(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        state_payload = args[0] if args else kwargs.get("state_payload", {})
        return {"state": write_graph_state(vault.graph_state_path, state_payload)}

    def get_tag_overview(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        group_id = str(args[0]) if args else str(kwargs.get("groupId", ""))
        tag_id = str(args[1]) if len(args) > 1 else str(kwargs.get("tagId", ""))
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

    def add_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        groups = vault.add_tag_group(req.group_id, req.display_name, req.color, indexer)
        return {"groups": groups}

    def add_tag(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        groups = vault.add_tag_to_group(req.group_id, req.tag_id, req.display_name, indexer)
        return {"groups": groups, "graphStatus": self.rebuild_graph_projection(vault)}

    def rename_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def delete_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def rename_tag(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def move_tag(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
        try:
            groups, touched = vault.move_tag(
                from_group=req.from_group,
                tag_name=req.tag_id,
                to_group=req.to_group,
                apply_to_notes=req.apply_to_notes,
                indexer=indexer,
            )
        except ValueError as exc:
            raise ValidationDomainError(
                str(exc),
                operation="move_tag",
                vault_id=str(vault.vault_path),
                internal_message=str(exc),
            ) from exc
        return {"groups": groups, "notesUpdated": touched, "counts": self.counts(indexer), "graphStatus": self.rebuild_graph_projection(vault)}

    def delete_tag(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def scan_tag_match_candidates(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        matches = self.scan_tag_matches(vault)
        return {
            "items": matches,
            "total": len(matches),
        }

    def apply_tag_match_candidates(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def get_note_groups(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        return {"groups": vault.list_note_groups()}

    def add_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def rename_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def delete_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def move_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def favorite_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def unfavorite_note_group(self, *args: Any, **kwargs: Any) -> Any:
        vault, _indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def add_note(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    def rename_note(self, *args: Any, **kwargs: Any) -> Any:
        return RenameNoteUseCase().execute(self, *args, **kwargs)

    def delete_note(self, *args: Any, **kwargs: Any) -> Any:
        req = args[0]
        vault, indexer = self.require_loaded()
        note_path = self._resolve_note_request_path(vault=vault, raw_path=req.path)
        pre_state = {
            "path": str(note_path),
            "content": note_path.read_text(encoding="utf-8"),
        }

        def _execute_delete(context: dict[str, Any]) -> str:
            vault.delete_note_file(req.path, indexer)
            return pre_state["path"]

        def _rollback_delete(context: dict[str, Any], step_output: str) -> None:
            note_path = Path(step_output)
            note_path.parent.mkdir(parents=True, exist_ok=True)
            note_path.write_text(pre_state["content"], encoding="utf-8")
            indexer.reindex_markdown_file(vault.vault_path, note_path)

        def _update_graph(context: dict[str, Any]) -> dict[str, Any]:
            return self.rebuild_graph_projection(vault)

        return self._run_mutation_pipeline(
            "delete-note",
            req,
            steps=[
                ("delete-note-file", _execute_delete, _rollback_delete),
                ("update-graph", _update_graph, None),
            ],
            build_response=lambda context: {
                "deleted": True,
                "counts": self.counts(indexer),
                "graphStatus": context["update-graph"],
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            },
            lock_projection=True,
        )

    def move_note(self, *args: Any, **kwargs: Any) -> Any:
        return MoveNoteUseCase().execute(self, *args, **kwargs)

    def move_notes_batch(self, *args: Any, **kwargs: Any) -> Any:
        vault, indexer = self.require_loaded()
        req = args[0] if args else kwargs.get("req")
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

    # Generic fallback keeps compatibility if route names are added without regenerating this file.
    def __getattr__(self, name: str) -> Any:
        impl_name = f"{name}_impl"
        target = getattr(self._api(), impl_name, None)
        if target is None or not callable(target):
            raise AttributeError(f"Backend API service has no implementation for {name!r}.")

        def _delegate(*args: Any, **kwargs: Any) -> Any:
            return target(*args, **kwargs)

        return _delegate

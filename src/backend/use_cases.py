from __future__ import annotations

import logging
import hashlib
import sqlite3
import traceback
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .config import FOCUS_DASHBOARD_NOTES_SEARCH_LIMIT
from .nicknotes_backend.dates import calendar_day
from .nicknotes_backend.markdown_io import parse_markdown_text, MarkdownFormatError
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.onenote_importer import (
    OneNoteImportError,
    OneNoteLocalImporter,
)
from .nicknotes_backend.projection_registry import quarantine_projection_file
from .nicknotes_backend.vault import VaultManager
from .errors import ConflictDomainError, InfrastructureDomainError, ValidationDomainError

if TYPE_CHECKING:
    from .application_services import BackendApiService

logger = logging.getLogger(__name__)


class OpenVaultUseCase:
    """Open a NoteBase and initialize runtime/session state."""

    @staticmethod
    def _is_lock_error(exc: Exception) -> bool:
        message = str(exc).lower()
        return any(token in message for token in ("database is locked", "database is busy", "locked", "busy"))

    def _open_indexer(self, vault: VaultManager) -> VaultIndexer:
        try:
            return VaultIndexer(vault.db_path)
        except sqlite3.DatabaseError as exc:
            if self._is_lock_error(exc):
                raise
            quarantine = quarantine_projection_file(vault.db_path, projection="index-db")
            if quarantine is not None:
                logger.warning("Corrupt index database recovered: %s -> %s", vault.db_path, quarantine)
                return VaultIndexer(vault.db_path)
            raise

    def execute(self, service: "BackendApiService", req: Any, *, progress_callback: Any | None = None) -> dict[str, Any]:
        vault_path = Path(req.path).expanduser().resolve()
        if not vault_path.exists():
            raise ValidationDomainError(f"NoteBase path not found: {vault_path}", operation="open_vault", vault_id=str(vault_path))

        service.state.dispose_session()
        indexer = None
        try:
            vault = VaultManager(vault_path)
            from .nicknotes_backend.source_journal import pending_recovery
            if pending_recovery(vault):
                vault.validate_roots()
                indexer = self._open_indexer(vault)
                service.state.start_session(vault=vault, indexer=indexer)
                return {'vaultPath':str(vault_path),'noteBasePath':str(vault_path),'indexed':{},'mode':'core','tagGroups':vault.read_tag_groups(),'counts':service.counts(indexer),'graphStatus':service.graph_index_status(vault),'recoveryRequired':True}
            vault.ensure_structure()
            indexer = self._open_indexer(vault)

            if progress_callback:
                progress_callback("Index wird vorbereitet ...", 0, 0, None)
            from .nicknotes_backend.graph_watcher import graph_watcher_snapshot
            baseline = graph_watcher_snapshot(vault_path)
            indexed = indexer.reconcile_vault(vault_path, progress_callback=progress_callback)
            if progress_callback:
                progress_callback(
                    "Aufgabenstatus wird aktualisiert ...",
                    indexed.get("notes", 0) + indexed.get("tasks", 0),
                    indexed.get("notes", 0) + indexed.get("tasks", 0),
                    None,
                )
            try:
                vault.bootstrap_task_status_links(indexer)
            except OSError:
                # Task-Link bootstrap is best-effort and should not block opening the NoteBase.
                pass
            if progress_callback:
                progress_callback(
                    "Tags werden synchronisiert ...",
                    indexed.get("notes", 0) + indexed.get("tasks", 0),
                    indexed.get("notes", 0) + indexed.get("tasks", 0),
                    None,
                )
            tag_groups = vault.sync_tag_groups_with_index(indexer)
            from .nicknotes_backend.graph_index import _stable_json_hash
            from .nicknotes_backend.graph_storage import read_graph_index
            existing_graph = read_graph_index(vault.graph_index_path)
            if indexed['changed'] or indexed['deleted'] or service.graph_index_needs_rebuild(existing_graph) or existing_graph.source.get('tag_groups_hash') != _stable_json_hash(tag_groups):
                graph_status = service.rebuild_graph_projection(vault)
            else:
                graph_status = service.graph_index_status(vault, existing_graph)
            (vault.system_path/'projection-dirty.json').unlink(missing_ok=True)
            try:
                service.state.start_session(vault=vault, indexer=indexer)
                service.state.start_graph_watcher(baseline)
            except Exception as exc:
                service.state.graph_status.last_error = f"Graph watcher could not be started: {exc}"
                logger.exception("Graph watcher could not be started.")
        except sqlite3.DatabaseError as exc:
            if indexer:
                indexer.close()
            service.state.dispose_session()
            detail = f"Could not open NoteBase index database: {exc}"
            if self._is_lock_error(exc):
                detail = f"Could not open NoteBase because its index database is locked: {vault_path}"
                raise ConflictDomainError(
                    detail,
                    operation="open_vault",
                    vault_id=str(vault_path),
                    internal_message=str(exc),
                ) from exc
            raise InfrastructureDomainError(
                "Could not open NoteBase.",
                operation="open_vault",
                vault_id=str(vault_path),
                internal_message=str(exc),
            ) from exc
        except ValueError as exc:
            if indexer:
                indexer.close()
            service.state.dispose_session()
            raise ValidationDomainError(str(exc), operation='open_vault', vault_id=str(vault_path)) from exc
        except Exception as exc:
            if indexer:
                indexer.close()
            service.state.dispose_session()
            logger.exception("Could not open NoteBase.")
            raise InfrastructureDomainError(
                "Could not open NoteBase.",
                operation="open_vault",
                vault_id=str(vault_path),
                internal_message=str(exc),
            ) from exc

        return {
            "vaultPath": str(vault_path),
            "noteBasePath": str(vault_path),
            "indexed": indexed,
            "mode": "core",
            "tagGroups": tag_groups,
            "counts": service.counts(indexer),
            "graphStatus": graph_status,
        }


class GetFocusDashboardUseCase:
    """Build focus dashboard payload and aggregate metrics from canonical index data."""

    def execute(self, service: "BackendApiService", date_param: str | None = None) -> dict[str, Any]:
        vault, indexer = service.require_loaded()
        day_iso = self._normalize_iso_day_param(date_param)
        payload = self._build_focus_dashboard_payload(vault=vault, indexer=indexer, day_iso=day_iso)
        payload["counts"] = service.counts(indexer)
        return payload

    @staticmethod
    def _normalize_iso_day_param(raw: str | None) -> str:
        clean = (raw or "").strip()
        if len(clean) >= 10:
            candidate = clean[:10]
            try:
                datetime.fromisoformat(candidate)
                return candidate
            except ValueError:
                pass
        return date.today().isoformat()

    @staticmethod
    def _to_iso_day(value: Any) -> str:
        return calendar_day(value)

    @staticmethod
    def _to_blocked_by_ids(raw: Any) -> list[str]:
        if isinstance(raw, list):
            values = [str(item).strip() for item in raw]
        elif isinstance(raw, str):
            values = [item.strip() for item in raw.split(",")]
        else:
            values = []
        seen: set[str] = set()
        normalized: list[str] = []
        for value in values:
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(value)
        return normalized

    @staticmethod
    def _to_estimate_minutes(raw: Any) -> int | None:
        if raw is None:
            return None
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError):
            return None
        if value <= 0:
            return None
        return value

    @staticmethod
    def _is_task_blocked(task: dict[str, Any], status_by_id: dict[str, str]) -> bool:
        status = str(task.get("status", "")).strip().lower().replace("-", "_")
        if status == "done":
            return False

        waiting_for = str(task.get("waiting_for", "")).strip()
        if waiting_for:
            return True

        blocked_by_ids = GetFocusDashboardUseCase._to_blocked_by_ids(task.get("blocked_by_ids"))
        for blocker_id in blocked_by_ids:
            blocker_status = status_by_id.get(blocker_id.lower())
            if not blocker_status:
                return True
            normalized_blocker_status = blocker_status.strip().lower().replace("-", "_")
            if normalized_blocker_status != "done":
                return True
        return False

    @staticmethod
    def _compute_done_today_counts(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> tuple[int, int]:
        done_tasks = 0
        for task in tasks:
            status = str(task.get("status", "")).strip().lower().replace("-", "_")
            if status != "done":
                continue
            completed_day = GetFocusDashboardUseCase._to_iso_day(task.get("completed_at"))
            if completed_day == day_iso:
                done_tasks += 1

        done_todos = 0
        for todo in todos:
            if not bool(todo.get("checked")):
                continue
            completed_day = GetFocusDashboardUseCase._to_iso_day(todo.get("completed_at"))
            if completed_day == day_iso:
                done_todos += 1

        return done_tasks, done_todos

    @staticmethod
    def _compute_focus_stats(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> dict[str, int]:
        status_by_id = {str(task.get("id", "")).strip().lower(): str(task.get("status", "")) for task in tasks if task.get("id")}
        overdue_count = 0
        blocked_count = 0
        waiting_count = 0
        open_tasks_without_estimate_count = 0
        waiting_without_follow_up_count = 0
        unknown_blocker_task_count = 0
        unknown_blocker_reference_count = 0

        for task in tasks:
            status = str(task.get("status", "")).strip().lower().replace("-", "_")
            if status == "done":
                continue
            if GetFocusDashboardUseCase._to_estimate_minutes(task.get("estimate_minutes")) is None:
                open_tasks_without_estimate_count += 1
            due_date = str(task.get("due_date", "")).strip()
            if len(due_date) >= 10:
                due_iso = due_date[:10]
                if due_iso < day_iso:
                    overdue_count += 1
            waiting_for = str(task.get("waiting_for", "")).strip()
            follow_up_day = GetFocusDashboardUseCase._to_iso_day(task.get("follow_up_date"))
            if waiting_for:
                waiting_count += 1
                if not follow_up_day:
                    waiting_without_follow_up_count += 1
            blocked_by_ids = GetFocusDashboardUseCase._to_blocked_by_ids(task.get("blocked_by_ids"))
            unknown_refs_for_task = 0
            for blocker_id in blocked_by_ids:
                if blocker_id.lower() not in status_by_id:
                    unknown_refs_for_task += 1
            if unknown_refs_for_task > 0:
                unknown_blocker_task_count += 1
                unknown_blocker_reference_count += unknown_refs_for_task
            if GetFocusDashboardUseCase._is_task_blocked(task, status_by_id):
                blocked_count += 1

        done_today_tasks, done_today_todos = GetFocusDashboardUseCase._compute_done_today_counts(tasks=tasks, todos=todos, day_iso=day_iso)

        return {
            "overdueCount": overdue_count,
            "blockedCount": blocked_count,
            "waitingCount": waiting_count,
            "doneToday": done_today_tasks + done_today_todos,
            "doneTodayTasks": done_today_tasks,
            "doneTodayTodos": done_today_todos,
            "openTasksWithoutEstimateCount": open_tasks_without_estimate_count,
            "waitingWithoutFollowUpCount": waiting_without_follow_up_count,
            "unknownBlockerTaskCount": unknown_blocker_task_count,
            "unknownBlockerReferenceCount": unknown_blocker_reference_count,
        }

    @staticmethod
    def _build_focus_dashboard_payload(vault: VaultManager, indexer: VaultIndexer, day_iso: str) -> dict[str, Any]:
        tasks = indexer.list_tasks(include_done=True)
        todos = indexer.list_todos()
        notes = indexer.search_notes(query="", limit=FOCUS_DASHBOARD_NOTES_SEARCH_LIMIT)
        mit_state = vault.get_daily_mit(day_iso=day_iso)
        return {
            "date": day_iso,
            "tasks": tasks,
            "todos": todos,
            "notes": notes,
            "mitIds": mit_state.get("mit_ids", []),
            "mitNotePath": str(mit_state.get("note_path", "")),
            "stats": GetFocusDashboardUseCase._compute_focus_stats(tasks=tasks, todos=todos, day_iso=day_iso),
        }


class SaveNoteContentUseCase:
    """Save a note with consistent index and graph updates."""

    def execute(self, service: "BackendApiService", req: Any) -> dict[str, Any]:
        vault, indexer = service.require_loaded()
        normalized_path = service._resolve_note_request_path(vault=vault, raw_path=req.path, allow_missing=True)
        actual = hashlib.sha256(normalized_path.read_bytes()).hexdigest() if normalized_path.exists() else None
        if actual != req.expected_revision:
            raise ConflictDomainError('Die Notiz wurde zwischenzeitlich geaendert. Bitte neu laden; dein Entwurf bleibt erhalten.')
        try:
            if len(req.content.encode('utf-8'))>5*1024*1024:
                raise MarkdownFormatError('Eine Notiz darf maximal 5 MB gross sein.')
            incoming, _ = parse_markdown_text(req.content)
            existing, _ = parse_markdown_text(normalized_path.read_text(encoding='utf-8'))
            for identity in ('id','node_id'):
                if existing.get(identity) and incoming.get(identity) != existing[identity]:
                    raise MarkdownFormatError('Die stabile Notiz-ID darf beim Speichern nicht geaendert oder entfernt werden.')
            if incoming.get('due_date'):
                date.fromisoformat(str(incoming['due_date']))
            if 'status' in incoming and str(incoming['status']).lower().replace('-','_').replace(' ','_') not in {'new_topic','open','in_progress','on_hold','done'}:
                raise MarkdownFormatError('Unbekannter Task-Status.')
            if 'priority' in incoming and str(incoming['priority']).lower() not in {'l','m','h','low','medium','high'}:
                raise MarkdownFormatError('Unbekannte Prioritaet.')
        except (MarkdownFormatError,ValueError) as exc:
            raise ValidationDomainError(str(exc)) from exc
        # A failure below leaves through the source journal of the coordinated
        # operation, which restores the files and marks the projections for repair.
        with service.state.projection_lock:
            result = vault.save_note_document(req.path, req.content, indexer)
            tag_groups = vault.sync_tag_groups_with_index(indexer) if result.get("tag_rebuild_required") else None
            graph_status = service.update_graph_after_note_save(
                vault=vault,
                saved_path=Path(result["path"]),
                previous_path=normalized_path,
                tag_groups=tag_groups,
            )
            stored = service._resolve_note_request_path(vault=vault, raw_path=result["path"]).read_bytes()
            return {
                "saved": True,
                "path": str(result["path"]),
                "revision": hashlib.sha256(stored).hexdigest(),
                "content": stored.decode('utf-8'),
                "title": str(result["title"]),
                "counts": service.counts(indexer),
                "tagGroups": tag_groups,
                "tagGroupsRebuilt": tag_groups is not None,
                "graphStatus": graph_status,
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            }


class RenameNoteUseCase:
    """Rename one note file and update derived projections."""

    def execute(self, service: "BackendApiService", req: Any) -> dict[str, Any]:
        vault, indexer = service.require_loaded()
        service._resolve_note_request_path(vault=vault, raw_path=req.path)
        with service.state.projection_lock:
            renamed_path = vault.rename_note_file(req.path, req.new_name, indexer)
            return {
                "renamedPath": str(renamed_path),
                "graphStatus": service.rebuild_graph_projection(vault),
                "counts": service.counts(indexer),
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            }


class MoveNoteUseCase:
    """Move one note file and refresh graph projection."""

    def execute(self, service: "BackendApiService", req: Any) -> dict[str, Any]:
        vault, indexer = service.require_loaded()
        service._resolve_note_request_path(vault=vault, raw_path=req.path)
        with service.state.projection_lock:
            moved_path = vault.move_note_file(req.path, req.target_group_key, indexer)
            return {
                "movedPath": str(moved_path),
                "graphStatus": service.rebuild_graph_projection(vault),
                "counts": service.counts(indexer),
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            }


class PreviewOneNoteImportUseCase:
    """Preview OneNote import result for selected source files."""

    def execute(self, service: "BackendApiService", req: Any) -> dict[str, Any]:
        vault, _indexer = service.require_loaded()
        try:
            return OneNoteLocalImporter(vault).preview(req.source_paths)
        except OneNoteImportError as exc:
            raise ValidationDomainError(
                exc.message,
                operation="preview_onenote_import",
                vault_id=str(vault.vault_path),
                internal_message=exc.message,
                error_code=exc.code,
                details=exc.payload(),
            ) from exc


class StartOneNoteImportUseCase:
    """Run OneNote import pipeline and refresh derived projections."""

    def execute(self, service: "BackendApiService", req: Any) -> dict[str, Any]:
        vault, indexer = service.require_loaded()
        service.state.reset_import_status("Import wird vorbereitet ...")

        def update_progress(phase: str, processed: int, total: int, current_path: str | None) -> None:
            service.state.update_import_status(phase=phase, processed=processed, total=total, current_path=current_path)

        try:
            logger.info("Starting OneNote import for %s source(s): %s", len(req.source_paths), req.source_paths)
            result = OneNoteLocalImporter(vault, progress_callback=update_progress).import_sources(
                req.source_paths,
                req.target_folder,
            )
        except OneNoteImportError as exc:
            payload = exc.payload()
            service.state.update_import_status(
                phase="Import fehlgeschlagen.",
                done=True,
                error=exc.message,
                error_code=exc.code,
                error_details=payload,
            )
            if exc.is_validation:
                raise ValidationDomainError(
                    exc.message,
                    operation="start_onenote_import",
                    vault_id=str(vault.vault_path),
                    internal_message=exc.message,
                    error_code=exc.code,
                    details=payload,
                ) from exc

            raise InfrastructureDomainError(
                "Unerwarteter Fehler beim OneNote-Import.",
                operation="start_onenote_import",
                vault_id=str(vault.vault_path),
                internal_message=exc.message,
                error_code=exc.code,
                details=payload,
            ) from exc
        except Exception as exc:
            logger.exception("OneNote import failed unexpectedly")
            try:
                error_log = Path.cwd() / ".tmp" / "onenote-import-error.log"
                error_log.parent.mkdir(parents=True, exist_ok=True)
                error_log.write_text(traceback.format_exc(), encoding="utf-8")
            except OSError:
                pass
            detail = f"Unerwarteter Fehler beim OneNote-Import: {exc}"
            service.state.update_import_status(
                phase="Import fehlgeschlagen.",
                done=True,
                error=detail,
                error_code="onenote.import.unexpected",
                error_details={"exception": str(exc)},
            )
            raise InfrastructureDomainError(
                "Unerwarteter Fehler beim OneNote-Import.",
                operation="start_onenote_import",
                vault_id=str(vault.vault_path),
                internal_message=detail,
                error_code="onenote.import.unexpected",
                details={"exception": str(exc)},
            ) from exc

        service.state.update_import_status(
            phase="NoteBase wird aktualisiert ...",
            processed=result.get("importedPages", 0),
            total=max(result.get("importedPages", 0), 1),
            current_path="",
        )
        indexed = indexer.reindex_vault(vault.vault_path)
        try:
            vault.rebuild_task_status_links(indexer)
        except OSError:
            pass
        tag_groups = vault.sync_tag_groups_with_index(indexer)
        graph_status = service.rebuild_graph_projection(vault)
        response = {
            "import": result,
            "indexed": indexed,
            "counts": service.counts(indexer),
            "tagGroups": tag_groups,
            "groups": vault.list_note_groups(),
            "graphStatus": graph_status,
        }
        service.state.update_import_status(
            phase="Import abgeschlossen.",
            processed=result.get("importedPages", 0),
            total=max(result.get("importedPages", 0), 1),
            done=True,
            result=response,
        )
        return response

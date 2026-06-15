from __future__ import annotations

import logging
import threading
from importlib import import_module
from pathlib import Path
from typing import Any, Callable

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
    ValidationDomainError,
)
from .operation_context import get_operation_context

"""Application layer entry points for NickNotes backend API controllers."""

logger = logging.getLogger(__name__)


class BackendApiService:
    """Transport-agnostic delegating layer for API handlers."""

    def __init__(self) -> None:
        self._api_module: Any | None = None

    def _api(self) -> Any:
        if self._api_module is None:
            self._api_module = import_module(".api", __package__)
        return self._api_module

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
            raise ValidationDomainError(
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
        api = self._api()
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
                with api.state.projection_lock:
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
        return self._api().health_impl(*args, **kwargs)

    def get_state(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_state_impl(*args, **kwargs)

    def open_vault(self, req: Any) -> Any:
        return self._open_vault_impl(req)

    def _open_vault_impl(self, req: Any, progress_callback: Any | None = None) -> dict[str, Any]:
        return OpenVaultUseCase().execute(self, req, progress_callback=progress_callback)

    def start_notebase_open(self, req: Any) -> Any:
        api = self._api()
        vault_path = Path(req.path).expanduser().resolve()
        if not vault_path.exists():
            raise ValidationDomainError(
                f"NoteBase path not found: {vault_path}",
                operation="start_notebase_open",
                vault_id=str(vault_path),
            )
        with api.state.load_lock:
            if api.state.load_status.active:
                raise ConflictDomainError(
                    "A NoteBase is already being loaded.",
                    operation="start_notebase_open",
                    vault_id=str(vault_path),
                )
        api.state.reset_load_status("NoteBase wird vorbereitet ...")
        thread = threading.Thread(
            target=self._open_notebase_background,
            args=(api.VaultOpenRequest(path=str(vault_path)),),
            name="nicknotes-notebase-open",
            daemon=True,
        )
        thread.start()
        return {"started": True, "path": str(vault_path)}

    def _open_notebase_background(self, req: Any) -> None:
        api = self._api()

        def update_progress(phase: str, processed: int, total: int, current_path: str | None) -> None:
            api.state.update_load_status(
                phase=phase,
                processed=processed,
                total=total,
                current_path=current_path,
            )

        try:
            result = self._open_vault_impl(req, progress_callback=update_progress)
            api.state.update_load_status(
                phase="NoteBase ist bereit.",
                done=True,
                error=None,
                result=result,
            )
        except DomainError as exc:
            api.state.update_load_status(phase="Laden fehlgeschlagen.", done=True, error=str(exc.public_message), result=None)
        except Exception as exc:
            logger.exception("Could not open NoteBase in background.")
            api.state.update_load_status(phase="Laden fehlgeschlagen.", done=True, error=str(exc), result=None)

    def get_notebase_open_status(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().state.get_load_status()

    def create_vault(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().create_vault_impl(*args, **kwargs)

    def reindex_vault(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().reindex_vault_impl(*args, **kwargs)

    def open_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().open_notebase_impl(*args, **kwargs)

    def create_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().create_notebase_impl(*args, **kwargs)

    def reindex_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().reindex_notebase_impl(*args, **kwargs)

    def preview_onenote_import(self, *args: Any, **kwargs: Any) -> Any:
        return PreviewOneNoteImportUseCase().execute(self, *args, **kwargs)

    def start_onenote_import(self, *args: Any, **kwargs: Any) -> Any:
        return StartOneNoteImportUseCase().execute(self, *args, **kwargs)

    def get_onenote_import_status(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_onenote_import_status_impl(*args, **kwargs)

    def rename_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().rename_notebase_impl(*args, **kwargs)

    def delete_notebase(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().delete_notebase_impl(*args, **kwargs)

    def preview_capture(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().preview_capture_impl(*args, **kwargs)

    def save_capture(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().save_capture_impl(*args, **kwargs)

    def get_focus_mit(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_focus_mit_impl(*args, **kwargs)

    def save_focus_mit(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().save_focus_mit_impl(*args, **kwargs)

    def quick_capture_focus_todo(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().quick_capture_focus_todo_impl(*args, **kwargs)

    def open_or_create_daily(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().open_or_create_daily_impl(*args, **kwargs)

    def get_focus_dashboard(self, *args: Any, **kwargs: Any) -> Any:
        return GetFocusDashboardUseCase().execute(self, *args, **kwargs)

    def list_tasks(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().list_tasks_impl(*args, **kwargs)

    def list_todos(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().list_todos_impl(*args, **kwargs)

    def toggle_todo(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().toggle_todo_impl(*args, **kwargs)

    def promote_todo(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().promote_todo_impl(*args, **kwargs)

    def mark_task_done(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().mark_task_done_impl(*args, **kwargs)

    def search_notes(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().search_notes_impl(*args, **kwargs)

    def explorer_files(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().explorer_files_impl(*args, **kwargs)

    def read_note_content(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().read_note_content_impl(*args, **kwargs)

    def save_note_content(self, req: Any) -> Any:
        return SaveNoteContentUseCase().execute(self, req)

    def add_note_media_asset(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().add_note_media_asset_impl(*args, **kwargs)

    def get_note_media_content(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_note_media_content_impl(*args, **kwargs)

    def open_note_file(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().open_note_file_impl(*args, **kwargs)

    def get_review(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_review_impl(*args, **kwargs)

    def get_review_dashboard(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_review_dashboard_impl(*args, **kwargs)

    def get_ui_settings(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_ui_settings_impl(*args, **kwargs)

    def update_ui_settings(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().update_ui_settings_impl(*args, **kwargs)

    def get_tag_groups(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_tag_groups_impl(*args, **kwargs)

    def get_graph_index(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_graph_index_impl(*args, **kwargs)

    def get_graph_index_status(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_graph_index_status_impl(*args, **kwargs)

    def rebuild_graph_index(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().rebuild_graph_index_impl(*args, **kwargs)

    def get_graph_state(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_graph_state_impl(*args, **kwargs)

    def update_graph_state(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().update_graph_state_impl(*args, **kwargs)

    def get_tag_overview(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_tag_overview_impl(*args, **kwargs)

    def add_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().add_tag_group_impl(*args, **kwargs)

    def add_tag(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().add_tag_impl(*args, **kwargs)

    def rename_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().rename_tag_group_impl(*args, **kwargs)

    def delete_tag_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().delete_tag_group_impl(*args, **kwargs)

    def rename_tag(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().rename_tag_impl(*args, **kwargs)

    def move_tag(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().move_tag_impl(*args, **kwargs)

    def delete_tag(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().delete_tag_impl(*args, **kwargs)

    def scan_tag_match_candidates(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().scan_tag_match_candidates_impl(*args, **kwargs)

    def apply_tag_match_candidates(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().apply_tag_match_candidates_impl(*args, **kwargs)

    def get_note_groups(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().get_note_groups_impl(*args, **kwargs)

    def add_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().add_note_group_impl(*args, **kwargs)

    def rename_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().rename_note_group_impl(*args, **kwargs)

    def delete_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().delete_note_group_impl(*args, **kwargs)

    def move_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().move_note_group_impl(*args, **kwargs)

    def favorite_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().favorite_note_group_impl(*args, **kwargs)

    def unfavorite_note_group(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().unfavorite_note_group_impl(*args, **kwargs)

    def add_note(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().add_note_impl(*args, **kwargs)

    def rename_note(self, *args: Any, **kwargs: Any) -> Any:
        return RenameNoteUseCase().execute(self, *args, **kwargs)

    def delete_note(self, *args: Any, **kwargs: Any) -> Any:
        api = self._api()
        req = args[0]
        vault, indexer = api._require_loaded()
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
            return api._rebuild_graph_projection(vault)

        return self._run_mutation_pipeline(
            "delete-note",
            req,
            steps=[
                ("delete-note-file", _execute_delete, _rollback_delete),
                ("update-graph", _update_graph, None),
            ],
            build_response=lambda context: {
                "deleted": True,
                "counts": api._counts(indexer),
                "graphStatus": context["update-graph"],
                "linkRewrite": vault.consume_last_link_rewrite_result(),
            },
            lock_projection=True,
        )

    def move_note(self, *args: Any, **kwargs: Any) -> Any:
        return MoveNoteUseCase().execute(self, *args, **kwargs)

    def move_notes_batch(self, *args: Any, **kwargs: Any) -> Any:
        return self._api().move_notes_batch_impl(*args, **kwargs)

    def migrate_note_templates(self, *args: Any, **kwargs: Any) -> Any:
        return self._migrate_note_templates_impl(*args, **kwargs)

    def _migrate_note_templates_impl(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        api = self._api()
        vault, indexer = api._require_loaded()
        result = vault.migrate_note_templates(indexer)
        tag_groups = vault.sync_tag_groups_with_index(indexer)
        return {
            "updated": int(result.get("updated", 0)),
            "paths": result.get("paths", []),
            "counts": api._counts(indexer),
            "tagGroups": tag_groups,
            "graphStatus": api._rebuild_graph_projection(vault),
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

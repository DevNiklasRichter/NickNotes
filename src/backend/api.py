from __future__ import annotations

import base64
import binascii
import logging
import os
import re
import shutil
import subprocess
import sys
import uuid
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .contracts import (
    API_CONTRACT_VERSION,
    BackendStateResponse,
    CapturePreviewResponse,
    DailyOpenResponse,
    FocusDashboardAggregateResponse,
    FocusMitResponse,
    FocusMitSaveResponse,
    GraphIndexRebuildResponse,
    GraphIndexResponse,
    GraphIndexStatusResponse,
    GraphStateResponse,
    NoteAddResponse,
    NoteBaseOpenStartResponse,
    NoteContentResponse,
    NoteSaveResponse,
    NoteFavoritesResponse,
    NoteGroupAddResponse,
    NoteGroupDeleteResponse,
    NoteGroupMoveResponse,
    NoteGroupRenameResponse,
    NoteGroupsResponse,
    NoteMutationResponse,
    NoteMediaResponse,
    OneNoteImportPreviewResponse,
    OneNoteImportResponse,
    OneNoteImportStatusResponse,
    OpenNoteResponse,
    OperationStatusResponse,
    QuickCaptureFocusTodoResponse,
    ReindexResponse,
    ReviewDashboardResponse,
    ReviewResponse,
    SaveCaptureResponse,
    SearchResponse,
    TagGroupsResponse,
    TagMatchCandidatesResponse,
    TagOverviewResponse,
    TaskDoneResponse,
    TaskListResponse,
    TodoListResponse,
    TodoPromoteResponse,
    TodoToggleResponse,
    UiSettingsResponse,
    VaultDeleteResponse,
    VaultOpenResponse,
)
from .config import (
    DEFAULT_CORS_ORIGINS,
    FOCUS_DASHBOARD_NOTES_SEARCH_LIMIT,
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
from .nicknotes_backend.graph_watcher import graph_watcher_snapshot
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from .nicknotes_backend.models import ParsedTask, TagSuggestion
from .application_services import BackendApiService
from .use_cases import GetFocusDashboardUseCase
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.vault import VaultManager
from .security import LocalApiSecurity
from .errors import DomainError
from .operation_context import clear_operation_context, get_operation_context, set_operation_context


logger = logging.getLogger(__name__)

BACKEND_CAPABILITIES = {
    "linkRewrite": "markdown-source-of-truth-v2",
    "contractVersion": API_CONTRACT_VERSION,
}


def _normalize_allowed_origins(raw_origins: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for origin in raw_origins:
        normalized_origin = origin.strip()
        if not normalized_origin:
            continue
        if normalized_origin == "*":
            logger.warning("Ignoring wildcard CORS origin ('*') from env for security reasons.")
            continue
        if normalized_origin not in seen:
            normalized.append(normalized_origin)
            seen.add(normalized_origin)
    if not normalized:
        return DEFAULT_CORS_ORIGINS.copy()
    return normalized


def _build_allowed_cors_origins() -> list[str]:
    raw_origins = os.getenv("NICKNOTES_ALLOWED_ORIGINS", "").strip()
    if raw_origins:
        return _normalize_allowed_origins(raw_origins.split(","))
    return DEFAULT_CORS_ORIGINS.copy()


def _build_cors_origin_regex() -> str | None:
    raw_regex = os.getenv("NICKNOTES_ALLOWED_ORIGIN_REGEX", "").strip()
    return raw_regex or None


from .session import RuntimeState, expected_session

state = RuntimeState()
backend_api_service = BackendApiService(runtime=state, capabilities=BACKEND_CAPABILITIES)

from contextlib import asynccontextmanager
from .mcp_grants import GrantStore
from .mcp_server import create_mcp, MCPAuthorization

grant_store = GrantStore()

class MCPGateway:
    def __init__(self):
        self.app = None

    async def __call__(self, scope, receive, send):
        if self.app is None:
            return await JSONResponse({'error':'Server is starting.'},status_code=503)(scope,receive,send)
        await self.app(scope, receive, send)

mcp_gateway = MCPGateway()

@asynccontextmanager
async def lifespan(app):
    # Each application lifespan owns a fresh SDK manager (also supports test restarts).
    server = create_mcp(backend_api_service, grant_store)
    mcp_gateway.app = MCPAuthorization(server.streamable_http_app(), grant_store)
    async with server.session_manager.run():
        try:
            yield
        finally:
            state.dispose_session()

app = FastAPI(title="NickNotes Backend", version="2.1.0-rc.3", lifespan=lifespan)
app.mount('/mcp', mcp_gateway)
app.add_middleware(LocalApiSecurity)
allowed_origins = _build_allowed_cors_origins()
allowed_origin_regex = _build_cors_origin_regex()
logger.info(
    "CORS configured",
    extra={
        "allow_origins": allowed_origins,
        "allow_origin_regex": allowed_origin_regex,
    },
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=allowed_origin_regex,
    expose_headers=['X-NoteBase-Session', 'X-Operation-Id'],
)


def _active_vault_id() -> str | None:
    if state.vault and state.vault.vault_path:
        return str(state.vault.vault_path)
    return None


def _timestamp_utc() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _build_error_payload(
    status_code: int,
    code: str,
    message: str,
    *,
    vault_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ctx = get_operation_context()
    return {
        "ok": False,
        "status": status_code,
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "operationId": ctx.operation_id,
            "vaultId": vault_id or ctx.vault_id,
            "traceId": ctx.trace_id,
        },
        "timestamp": _timestamp_utc(),
    }


def _http_error_code(status_code: int) -> str:
    if status_code in (400, 422):
        return "request.validation"
    if status_code == 404:
        return "resource.notFound"
    if status_code == 409:
        return "request.conflict"
    if status_code >= 500:
        return "service.unexpected"
    return "request.failed"


def _public_error_message(message: str, status_code: int) -> str:
    if status_code >= 500:
        return "Ein unerwarteter Fehler ist aufgetreten."
    return message


def _request_log_payload(request: Request, *, status_code: int | None = None, error_code: str | None = None) -> dict[str, Any]:
    ctx = get_operation_context()
    return {
        "operationId": ctx.operation_id,
        "traceId": ctx.trace_id,
        "vaultId": ctx.vault_id,
        "method": request.method,
        "path": request.url.path,
        "statusCode": status_code,
        "errorCode": error_code,
        "client": request.client.host if request.client else None,
    }


@app.middleware("http")
async def request_observability_middleware(request: Request, call_next):
    session_token = expected_session.set(request.headers.get('X-NoteBase-Session'))
    operation_id = request.headers.get("X-Operation-Id") or str(uuid.uuid4())
    trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())
    tokens = set_operation_context(
        operation_id=operation_id,
        trace_id=trace_id,
        vault_id=_active_vault_id(),
    )
    started_at = time.perf_counter()
    logger.debug("Request start", extra=_request_log_payload(request))
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.debug(
            "Request finished",
            extra=_request_log_payload(request, status_code=response.status_code, error_code="request.completed"),
        )
        response.headers["X-Operation-Id"] = operation_id
        response.headers["X-Trace-Id"] = trace_id
        response.headers["X-Request-Duration-Ms"] = str(duration_ms)
        response.headers['X-NoteBase-Session'] = state.generation
        return response
    finally:
        expected_session.reset(session_token)
        clear_operation_context(tokens)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    ctx = get_operation_context()
    payload = _build_error_payload(
        exc.status_code,
        exc.error_code,
        _public_error_message(exc.public_message, exc.status_code),
        vault_id=exc.vault_id or ctx.vault_id,
        details=exc.details,
    )
    if exc.status_code >= 500:
        logger.error(
            "Domain error",
            extra=_request_log_payload(request, status_code=exc.status_code, error_code=exc.error_code),
        )
        logger.exception("Domain error details: %s", exc.internal_message or exc.public_message)
    else:
        logger.warning(
            "Domain error",
            extra=_request_log_payload(request, status_code=exc.status_code, error_code=exc.error_code),
        )
    return JSONResponse(status_code=exc.status_code, content=payload)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    del exc
    payload = _build_error_payload(
        422,
        "request.validation",
        "Ungültige Anfrageparameter.",
    )
    logger.warning("Request validation failed", extra=_request_log_payload(request, status_code=422, error_code="request.validation"))
    return JSONResponse(status_code=422, content=payload)


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    status_code = int(exc.status_code)
    code = _http_error_code(status_code)
    message = _public_error_message(str(exc.detail), status_code)
    payload = _build_error_payload(status_code, code, message)
    logger.warning(
        "HTTP error",
        extra=_request_log_payload(request, status_code=status_code, error_code=code),
    )
    return JSONResponse(status_code=status_code, content=payload)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", extra=_request_log_payload(request), exc_info=exc)
    payload = _build_error_payload(500, "service.unexpected", "Ein unerwarteter Fehler ist aufgetreten.")
    return JSONResponse(status_code=500, content=payload)



from .commands import (
    VaultOpenRequest,
    VaultCreateRequest,
    NoteBaseRenameRequest,
    NoteBaseDeleteRequest,
    CapturePreviewRequest,
    CaptureSaveRequest,
    FocusMitUpdateRequest,
    FocusQuickCaptureRequest,
    NoteOpenRequest,
    NoteSaveRequest,
    NoteMediaAddRequest,
    TagGroupRequest,
    TagCreateRequest,
    TagRenameRequest,
    TagGroupRenameRequest,
    TagGroupDeleteRequest,
    TagMoveRequest,
    TagDeleteRequest,
    TagMatchApplyRequest,
    NoteGroupCreateRequest,
    NoteCreateRequest,
    NoteGroupRenameRequest,
    NoteGroupDeleteRequest,
    NoteGroupMoveRequest,
    NoteFileRenameRequest,
    NoteFileDeleteRequest,
    NoteFileMoveRequest,
    NoteFileMoveBatchRequest,
    FavoriteFolderRequest,
    UiSettingsUpdateRequest,
    OneNoteImportPreviewRequest,
    OneNoteImportRequest,
    TodoToggleRequest
)

@app.get("/health", response_model=BackendStateResponse)
def health()-> dict[str, Any]:
    return backend_api_service.health()




@app.get("/state", response_model=BackendStateResponse)
def get_state()-> dict[str, Any]:
    return backend_api_service.get_state()




@app.post("/vault/open", response_model=VaultOpenResponse)
def open_vault(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_vault(req)



@app.post("/notebase/open/start", response_model=NoteBaseOpenStartResponse)
def start_notebase_open(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.start_notebase_open(req)






@app.get("/notebase/open/status", response_model=OperationStatusResponse)
def get_notebase_open_status()-> dict[str, Any]:
    return backend_api_service.get_notebase_open_status()




@app.post("/vault/create", response_model=VaultOpenResponse)
def create_vault(req: VaultCreateRequest)-> dict[str, Any]:
    return backend_api_service.create_vault(req)




@app.post("/vault/reindex", response_model=ReindexResponse)
def reindex_vault()-> dict[str, Any]:
    return backend_api_service.reindex_vault()




@app.post("/notebase/open", response_model=VaultOpenResponse)
def open_notebase(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_notebase(req)




@app.post("/notebase/create", response_model=VaultOpenResponse)
def create_notebase(req: VaultCreateRequest)-> dict[str, Any]:
    return backend_api_service.create_notebase(req)




@app.post("/notebase/reindex", response_model=ReindexResponse)
def reindex_notebase()-> dict[str, Any]:
    return backend_api_service.reindex_notebase()




@app.post("/imports/onenote/preview", response_model=OneNoteImportPreviewResponse)
def preview_onenote_import(req: OneNoteImportPreviewRequest)-> dict[str, Any]:
    return backend_api_service.preview_onenote_import(req)




@app.post("/imports/onenote/start", response_model=OneNoteImportResponse)
def start_onenote_import(req: OneNoteImportRequest)-> dict[str, Any]:
    return backend_api_service.start_onenote_import(req)




@app.get("/imports/onenote/status", response_model=OneNoteImportStatusResponse)
def get_onenote_import_status()-> dict[str, Any]:
    return backend_api_service.get_onenote_import_status()




@app.post("/notebase/rename", response_model=VaultOpenResponse)
def rename_notebase(req: NoteBaseRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_notebase(req)




@app.post("/notebase/delete", response_model=VaultDeleteResponse)
def delete_notebase(req: NoteBaseDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_notebase(req)




@app.post("/capture/preview", response_model=CapturePreviewResponse)
def preview_capture(req: CapturePreviewRequest)-> dict[str, Any]:
    return backend_api_service.preview_capture(req)




@app.post("/capture/save", response_model=SaveCaptureResponse)
def save_capture(req: CaptureSaveRequest)-> dict[str, Any]:
    return backend_api_service.save_capture(req)




@app.get("/focus/mit", response_model=FocusMitResponse)
def get_focus_mit(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.get_focus_mit(date)




@app.post("/focus/mit", response_model=FocusMitSaveResponse)
def save_focus_mit(req: FocusMitUpdateRequest)-> dict[str, Any]:
    return backend_api_service.save_focus_mit(req)




@app.post("/focus/quick-capture", response_model=QuickCaptureFocusTodoResponse)
def quick_capture_focus_todo(req: FocusQuickCaptureRequest)-> dict[str, Any]:
    return backend_api_service.quick_capture_focus_todo(req)




@app.post("/daily/open-today", response_model=DailyOpenResponse)
def open_or_create_daily(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.open_or_create_daily(date)




@app.get("/focus/dashboard", response_model=FocusDashboardAggregateResponse)
def get_focus_dashboard(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.get_focus_dashboard(date)




@app.get("/tasks", response_model=TaskListResponse)
def list_tasks(include_done: bool = False)-> dict[str, Any]:
    return backend_api_service.list_tasks(include_done)




@app.get("/todos", response_model=TodoListResponse)
def list_todos()-> dict[str, Any]:
    return backend_api_service.list_todos()




@app.post("/todos/{todo_id}/toggle", response_model=TodoToggleResponse)
def toggle_todo(todo_id: str, req: TodoToggleRequest)-> dict[str, Any]:
    return backend_api_service.toggle_todo(todo_id, req)




@app.post("/todos/{todo_id}/promote", response_model=TodoPromoteResponse)
def promote_todo(todo_id: str)-> dict[str, Any]:
    return backend_api_service.promote_todo(todo_id)




@app.post("/tasks/{task_id}/done", response_model=TaskDoneResponse)
def mark_task_done(task_id: str)-> dict[str, Any]:
    return backend_api_service.mark_task_done(task_id)




@app.get("/search", response_model=SearchResponse)
def search_notes(query: str = "", offset: int = 0, limit: int = 100, tag: str | None = None, note_type: str | None = None)-> dict[str, Any]:
    return backend_api_service.search_notes(query, offset=offset, limit=limit, tag=tag, note_type=note_type)





















































@app.get("/explorer/files", response_model=SearchResponse)
def explorer_files()-> dict[str, Any]:
    return backend_api_service.explorer_files()




@app.get("/notes/content", response_model=NoteContentResponse)
def read_note_content(path: str)-> dict[str, Any]:
    return backend_api_service.read_note_content(path)




@app.post("/notes/save", response_model=NoteSaveResponse)
def save_note_content(req: NoteSaveRequest)-> dict[str, Any]:
    return backend_api_service.save_note_content(req)




@app.post("/notes/media/add", response_model=NoteMediaResponse)
def add_note_media_asset(req: NoteMediaAddRequest)-> dict[str, Any]:
    return backend_api_service.add_note_media_asset(req)




@app.get("/notes/media/content")
def get_note_media_content(path: str, source: str)-> FileResponse:
    asset = backend_api_service.get_note_media_content(path, source)
    return FileResponse(path=asset["path"], media_type=asset["mediaType"], filename=asset["fileName"])




@app.post("/notes/open", response_model=OpenNoteResponse)
def open_note_file(req: NoteOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_note_file(req)




@app.get("/review", response_model=ReviewResponse)
def get_review()-> dict[str, Any]:
    return backend_api_service.get_review()




@app.get("/review/dashboard", response_model=ReviewDashboardResponse)
def get_review_dashboard(days: int = REVIEW_DASHBOARD_DEFAULT_DAYS, day: str | None = None, top: int = REVIEW_DASHBOARD_DEFAULT_TOP_NOTES)-> dict[str, Any]:
    return backend_api_service.get_review_dashboard(days, day, top)




@app.get("/ui-settings", response_model=UiSettingsResponse)
def get_ui_settings()-> dict[str, Any]:
    return backend_api_service.get_ui_settings()




@app.post("/ui-settings", response_model=UiSettingsResponse)
def update_ui_settings(req: UiSettingsUpdateRequest)-> dict[str, Any]:
    return backend_api_service.update_ui_settings(req)




@app.get("/tag-groups", response_model=TagGroupsResponse)
def get_tag_groups()-> dict[str, Any]:
    return backend_api_service.get_tag_groups()




@app.get("/graph-index", response_model=GraphIndexResponse)
def get_graph_index()-> dict[str, Any]:
    return backend_api_service.get_graph_index()




@app.get("/graph-index/status", response_model=GraphIndexStatusResponse)
def get_graph_index_status()-> dict[str, Any]:
    return backend_api_service.get_graph_index_status()




@app.post("/graph-index/rebuild", response_model=GraphIndexRebuildResponse)
def rebuild_graph_index()-> dict[str, Any]:
    return backend_api_service.rebuild_graph_index()




def _rebuild_graph_projection(vault: VaultManager) -> dict[str, Any]:
    return backend_api_service.rebuild_graph_projection(vault)


def _update_graph_after_note_save(
    *,
    vault: VaultManager,
    saved_path: Path,
    previous_path: Path,
    tag_groups: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    return backend_api_service.update_graph_after_note_save(
        vault=vault,
        saved_path=saved_path,
        previous_path=previous_path,
        tag_groups=tag_groups,
    )


def _graph_index_needs_rebuild(index: GraphIndex) -> bool:
    return backend_api_service.graph_index_needs_rebuild(index)


def _graph_index_status(vault: VaultManager, index: GraphIndex | None = None) -> dict[str, Any]:
    return backend_api_service.graph_index_status(vault, index)


@app.get("/graph-state", response_model=GraphStateResponse)
def get_graph_state()-> dict[str, Any]:
    return backend_api_service.get_graph_state()




@app.put("/graph-state", response_model=GraphStateResponse)
def update_graph_state(state_payload: dict[str, Any] = Body(default_factory=dict))-> dict[str, Any]:
    return backend_api_service.update_graph_state(state_payload)




@app.get("/tags/overview", response_model=TagOverviewResponse)
def get_tag_overview(groupId: str, tagId: str)-> dict[str, Any]:
    return backend_api_service.get_tag_overview(groupId, tagId)




@app.post("/tag-groups/add-group", response_model=TagGroupsResponse)
def add_tag_group(req: TagGroupRequest)-> dict[str, Any]:
    return backend_api_service.add_tag_group(req)




@app.post("/tag-groups/add-tag", response_model=TagGroupsResponse)
def add_tag(req: TagCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_tag(req)




@app.post("/tag-groups/rename-group", response_model=TagGroupsResponse)
def rename_tag_group(req: TagGroupRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_tag_group(req)




@app.post("/tag-groups/delete-group", response_model=TagGroupsResponse)
def delete_tag_group(req: TagGroupDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_tag_group(req)




@app.post("/tag-groups/rename-tag", response_model=TagGroupsResponse)
def rename_tag(req: TagRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_tag(req)




@app.post("/tag-groups/move-tag", response_model=TagGroupsResponse)
def move_tag(req: TagMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_tag(req)




@app.post("/tag-groups/delete-tag", response_model=TagGroupsResponse)
def delete_tag(req: TagDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_tag(req)




@app.get("/tag-groups/match-candidates", response_model=TagMatchCandidatesResponse)
def scan_tag_match_candidates()-> dict[str, Any]:
    return backend_api_service.scan_tag_match_candidates()




@app.post("/tag-groups/apply-matches", response_model=TagGroupsResponse)
def apply_tag_match_candidates(req: TagMatchApplyRequest)-> dict[str, Any]:
    return backend_api_service.apply_tag_match_candidates(req)




@app.get("/note-groups", response_model=NoteGroupsResponse)
def get_note_groups()-> dict[str, Any]:
    return backend_api_service.get_note_groups()




@app.post("/note-groups/add-group", response_model=NoteGroupAddResponse)
def add_note_group(req: NoteGroupCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_note_group(req)




@app.post("/note-groups/rename", response_model=NoteGroupRenameResponse)
def rename_note_group(req: NoteGroupRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_note_group(req)




@app.post("/note-groups/delete", response_model=NoteGroupDeleteResponse)
def delete_note_group(req: NoteGroupDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_note_group(req)




@app.post("/note-groups/move", response_model=NoteGroupMoveResponse)
def move_note_group(req: NoteGroupMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_note_group(req)




@app.post("/note-groups/favorite", response_model=NoteFavoritesResponse)
def favorite_note_group(req: FavoriteFolderRequest)-> dict[str, Any]:
    return backend_api_service.favorite_note_group(req)




@app.post("/note-groups/unfavorite", response_model=NoteFavoritesResponse)
def unfavorite_note_group(req: FavoriteFolderRequest)-> dict[str, Any]:
    return backend_api_service.unfavorite_note_group(req)




@app.post("/note-groups/add-note", response_model=NoteAddResponse)
def add_note(req: NoteCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_note(req)




@app.post("/notes/rename", response_model=NoteMutationResponse)
def rename_note(req: NoteFileRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_note(req)




@app.post("/notes/delete", response_model=NoteMutationResponse)
def delete_note(req: NoteFileDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_note(req)




@app.post("/notes/move", response_model=NoteMutationResponse)
def move_note(req: NoteFileMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_note(req)




@app.post("/notes/move-batch", response_model=NoteMutationResponse)
def move_notes_batch(req: NoteFileMoveBatchRequest)-> dict[str, Any]:
    return backend_api_service.move_notes_batch(req)






def _require_loaded() -> tuple[VaultManager, VaultIndexer]:
    if not state.vault or not state.indexer:
        raise DomainError(
            "No NoteBase loaded",
            status_code=400,
            error_code="request.validation",
            operation="require_loaded",
        )
    return state.vault, state.indexer


























def _normalize_iso_day_param(raw: str | None) -> str:
    return GetFocusDashboardUseCase._normalize_iso_day_param(raw)


def _to_iso_day(value: Any) -> str:
    return GetFocusDashboardUseCase._to_iso_day(value)


def _compute_done_today_counts(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> tuple[int, int]:
    return GetFocusDashboardUseCase._compute_done_today_counts(tasks=tasks, todos=todos, day_iso=day_iso)


def _to_blocked_by_ids(raw: Any) -> list[str]:
    return GetFocusDashboardUseCase._to_blocked_by_ids(raw)


def _to_estimate_minutes(raw: Any) -> int | None:
    return GetFocusDashboardUseCase._to_estimate_minutes(raw)


def _is_task_blocked(task: dict[str, Any], status_by_id: dict[str, str]) -> bool:
    return GetFocusDashboardUseCase._is_task_blocked(task=task, status_by_id=status_by_id)


def _compute_focus_stats(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> dict[str, int]:
    return GetFocusDashboardUseCase._compute_focus_stats(tasks=tasks, todos=todos, day_iso=day_iso)


def _build_focus_dashboard_payload(vault: VaultManager, indexer: VaultIndexer, day_iso: str) -> dict[str, Any]:
    return GetFocusDashboardUseCase._build_focus_dashboard_payload(vault=vault, indexer=indexer, day_iso=day_iso)




class AgentGrantRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    write: bool = False

@app.get('/agents')
def list_agent_grants():
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        identity = vault.read_config()['vault_id']
        return {'items': [item for item in grant_store.list() if item['vaultId'] == identity]}

@app.post('/agents')
def create_agent_grant(req: AgentGrantRequest):
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        return grant_store.create(req.name, vault, req.write)

@app.delete('/agents/{identity}')
def revoke_agent_grant(identity: str):
    grant_store.revoke(identity)
    return {'revoked': True}

@app.get('/graph/related')
def graph_related(path: str, limit: int = 50):
    from .nicknotes_backend.graph_index import related_files
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        resolved = backend_api_service._resolve_note_request_path(vault, path)
        index = read_graph_index(vault.graph_index_path)
        entry = index.files.get(resolved.relative_to(vault.vault_path).as_posix())
        return related_files(index, entry.id, limit) if entry else {'items': [], 'truncated': False}


@app.get('/notes/catalog', response_model=SearchResponse)
def note_catalog(offset: int = 0, limit: int = 100, tag: str | None = None, note_type: str | None = None):
    return backend_api_service.search_notes('', offset=offset, limit=limit, tag=tag, note_type=note_type)


@app.get('/recovery')
def recovery_status():
    from .nicknotes_backend.recovery import list_recovery
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        return {'items':list_recovery(vault)}

class RecoveryRequest(BaseModel):
    action: str

@app.post('/recovery/{identity}')
def recovery_resolve(identity: str, req: RecoveryRequest):
    from .nicknotes_backend.recovery import resolve_recovery
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        try:
            result=resolve_recovery(vault,identity,req.action)
        except (ValueError,OSError) as exc:
            from .errors import ValidationDomainError
            raise ValidationDomainError('Wiederherstellung konnte nicht abgeschlossen werden. Die Sicherheitskopien bleiben erhalten.') from exc
        from .nicknotes_backend.source_journal import pending_recovery
        if not pending_recovery(vault):
            backend_api_service.reindex_vault()
            state.start_graph_watcher()
        state.change_version += 1
        return result

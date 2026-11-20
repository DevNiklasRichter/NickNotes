from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .contracts import (
    API_CONTRACT_VERSION,
    BackendStateResponse,
    CapturePreviewResponse,
    DailyOpenResponse,
    FocusDashboardAggregateResponse,
    FocusMitResponse,
    FocusMitSaveResponse,
    FocusSessionLogResponse,
    FocusThoughtResponse,
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
    OperationStatusResponse,
    QuickCaptureFocusTodoResponse,
    ReindexResponse,
    ReviewDashboardResponse,
    SaveCaptureResponse,
    SearchResponse,
    TagGroupsResponse,
    TagMatchCandidatesResponse,
    TagOverviewResponse,
    TaskDoneResponse,
    TaskFollowUpResponse,
    TaskListResponse,
    TodoListResponse,
    TodoPromoteResponse,
    TodoToggleResponse,
    UiSettingsResponse,
    VaultDeleteResponse,
    VaultOpenResponse,
)
from .application_services import BackendApiService
from .commands import (
    CapturePreviewRequest,
    CaptureSaveRequest,
    FavoriteFolderRequest,
    FocusMitUpdateRequest,
    FocusQuickCaptureRequest,
    FocusSessionLogRequest,
    FocusThoughtRequest,
    NoteBaseDeleteRequest,
    NoteBaseRenameRequest,
    NoteCreateRequest,
    NoteFileDeleteRequest,
    NoteFileMoveBatchRequest,
    NoteFileMoveRequest,
    NoteFileRenameRequest,
    NoteGroupCreateRequest,
    NoteGroupDeleteRequest,
    NoteGroupMoveRequest,
    NoteGroupRenameRequest,
    NoteMediaAddRequest,
    NoteSaveRequest,
    OneNoteImportPreviewRequest,
    OneNoteImportRequest,
    TagCreateRequest,
    TagDeleteRequest,
    TagGroupDeleteRequest,
    TagGroupRenameRequest,
    TagGroupRequest,
    TagMatchApplyRequest,
    TagRenameRequest,
    TaskFollowUpRequest,
    TodoToggleRequest,
    UiSettingsUpdateRequest,
    VaultCreateRequest,
    VaultOpenRequest,
)
from .config import DEFAULT_CORS_ORIGINS, REVIEW_DASHBOARD_DEFAULT_DAYS
from .errors import DomainError, ValidationDomainError
from .mcp_grants import GrantStore
from .mcp_server import MCPAuthorization, create_mcp
from .nicknotes_backend.graph_index import related_files
from .nicknotes_backend.graph_queries import note_context
from .nicknotes_backend.graph_storage import read_graph_index
from .nicknotes_backend.recovery import list_recovery, resolve_recovery
from .nicknotes_backend.source_journal import pending_recovery
from .operation_context import clear_operation_context, get_operation_context, set_operation_context
from .security import LocalApiSecurity
from .service_control import control as service_control
from .session import RuntimeState, expected_session


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


state = RuntimeState()
backend_api_service = BackendApiService(runtime=state, capabilities=BACKEND_CAPABILITIES)


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
            backend_api_service.sessions.close_idle(float('inf'))
            state.dispose_session()

app = FastAPI(title="NickNotes Backend", version="2.1.0-rc.7", lifespan=lifespan)
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
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


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


@app.get("/health", response_model=BackendStateResponse)
def health() -> dict[str, Any]:
    return backend_api_service.health()


@app.get("/state", response_model=BackendStateResponse)
def get_state() -> dict[str, Any]:
    return backend_api_service.get_state()


@app.post("/notebase/open/start", response_model=NoteBaseOpenStartResponse)
def start_notebase_open(req: VaultOpenRequest) -> dict[str, Any]:
    return backend_api_service.start_notebase_open(req)


@app.get("/notebase/open/status", response_model=OperationStatusResponse)
def get_notebase_open_status() -> dict[str, Any]:
    return backend_api_service.get_notebase_open_status()


@app.post("/notebase/open", response_model=VaultOpenResponse)
def open_notebase(req: VaultOpenRequest) -> dict[str, Any]:
    return backend_api_service.open_vault(req)


@app.post("/notebase/create", response_model=VaultOpenResponse)
def create_notebase(req: VaultCreateRequest) -> dict[str, Any]:
    return backend_api_service.create_vault(req)


@app.post("/notebase/reindex", response_model=ReindexResponse)
def reindex_notebase() -> dict[str, Any]:
    return backend_api_service.reindex_vault()


@app.post("/imports/onenote/preview", response_model=OneNoteImportPreviewResponse)
def preview_onenote_import(req: OneNoteImportPreviewRequest) -> dict[str, Any]:
    return backend_api_service.preview_onenote_import(req)


@app.post("/imports/onenote/start", response_model=OneNoteImportResponse)
def start_onenote_import(req: OneNoteImportRequest) -> dict[str, Any]:
    return backend_api_service.start_onenote_import(req)


@app.get("/imports/onenote/status", response_model=OneNoteImportStatusResponse)
def get_onenote_import_status() -> dict[str, Any]:
    return backend_api_service.get_onenote_import_status()


@app.post("/notebase/rename", response_model=VaultOpenResponse)
def rename_notebase(req: NoteBaseRenameRequest) -> dict[str, Any]:
    return backend_api_service.rename_notebase(req)


@app.post("/notebase/delete", response_model=VaultDeleteResponse)
def delete_notebase(req: NoteBaseDeleteRequest) -> dict[str, Any]:
    return backend_api_service.delete_notebase(req)


@app.post("/capture/preview", response_model=CapturePreviewResponse)
def preview_capture(req: CapturePreviewRequest) -> dict[str, Any]:
    return backend_api_service.preview_capture(req)


@app.post("/capture/save", response_model=SaveCaptureResponse)
def save_capture(req: CaptureSaveRequest) -> dict[str, Any]:
    return backend_api_service.save_capture(req)


@app.get("/focus/mit", response_model=FocusMitResponse)
def get_focus_mit(date: str | None = None) -> dict[str, Any]:
    return backend_api_service.get_focus_mit(date)


@app.post("/focus/mit", response_model=FocusMitSaveResponse)
def save_focus_mit(req: FocusMitUpdateRequest) -> dict[str, Any]:
    return backend_api_service.save_focus_mit(req)


@app.post("/focus/quick-capture", response_model=QuickCaptureFocusTodoResponse)
def quick_capture_focus_todo(req: FocusQuickCaptureRequest) -> dict[str, Any]:
    return backend_api_service.quick_capture_focus_todo(req)


@app.post("/focus/sessions", response_model=FocusSessionLogResponse)
def log_focus_session(req: FocusSessionLogRequest) -> dict[str, Any]:
    return backend_api_service.log_focus_session(req)


@app.post("/focus/thoughts", response_model=FocusThoughtResponse)
def save_focus_thought(req: FocusThoughtRequest) -> dict[str, Any]:
    return backend_api_service.save_focus_thought(req)


@app.post("/daily/open-today", response_model=DailyOpenResponse)
def open_or_create_daily(date: str | None = None) -> dict[str, Any]:
    return backend_api_service.open_or_create_daily(date)


@app.get("/focus/dashboard", response_model=FocusDashboardAggregateResponse)
def get_focus_dashboard(date: str | None = None) -> dict[str, Any]:
    return backend_api_service.get_focus_dashboard(date)


@app.get("/tasks", response_model=TaskListResponse)
def list_tasks(include_done: bool = False) -> dict[str, Any]:
    return backend_api_service.list_tasks(include_done)


@app.get("/todos", response_model=TodoListResponse)
def list_todos() -> dict[str, Any]:
    return backend_api_service.list_todos()


@app.post("/todos/{todo_id}/toggle", response_model=TodoToggleResponse)
def toggle_todo(todo_id: str, req: TodoToggleRequest) -> dict[str, Any]:
    return backend_api_service.toggle_todo(todo_id, req)


@app.post("/todos/{todo_id}/promote", response_model=TodoPromoteResponse)
def promote_todo(todo_id: str) -> dict[str, Any]:
    return backend_api_service.promote_todo(todo_id)


@app.post("/tasks/{task_id}/follow-up", response_model=TaskFollowUpResponse)
def set_task_follow_up(task_id: str, req: TaskFollowUpRequest) -> dict[str, Any]:
    return backend_api_service.set_task_follow_up(task_id, req)


@app.post("/tasks/{task_id}/done", response_model=TaskDoneResponse)
def mark_task_done(task_id: str) -> dict[str, Any]:
    return backend_api_service.mark_task_done(task_id)


@app.get("/search", response_model=SearchResponse)
def search_notes(query: str = "", offset: int = 0, limit: int = 100, tag: str | None = None, note_type: str | None = None) -> dict[str, Any]:
    return backend_api_service.search_notes(query, offset=offset, limit=limit, tag=tag, note_type=note_type)


@app.get("/explorer/files", response_model=SearchResponse)
def explorer_files() -> dict[str, Any]:
    return backend_api_service.explorer_files()


@app.get("/notes/content", response_model=NoteContentResponse)
def read_note_content(path: str) -> dict[str, Any]:
    return backend_api_service.read_note_content(path)


@app.post("/notes/save", response_model=NoteSaveResponse)
def save_note_content(req: NoteSaveRequest) -> dict[str, Any]:
    return backend_api_service.save_note_content(req)


@app.post("/notes/media/add", response_model=NoteMediaResponse)
def add_note_media_asset(req: NoteMediaAddRequest) -> dict[str, Any]:
    return backend_api_service.add_note_media_asset(req)


@app.get("/notes/media/content")
def get_note_media_content(path: str, source: str) -> FileResponse:
    asset = backend_api_service.get_note_media_content(path, source)
    return FileResponse(path=asset["path"], media_type=asset["mediaType"], filename=asset["fileName"])


@app.get("/review/dashboard", response_model=ReviewDashboardResponse)
def get_review_dashboard(days: int = REVIEW_DASHBOARD_DEFAULT_DAYS, day: str | None = None) -> dict[str, Any]:
    return backend_api_service.get_review_dashboard(days, day)


@app.get("/ui-settings", response_model=UiSettingsResponse)
def get_ui_settings() -> dict[str, Any]:
    return backend_api_service.get_ui_settings()


@app.post("/ui-settings", response_model=UiSettingsResponse)
def update_ui_settings(req: UiSettingsUpdateRequest) -> dict[str, Any]:
    return backend_api_service.update_ui_settings(req)


@app.get("/tag-groups", response_model=TagGroupsResponse)
def get_tag_groups() -> dict[str, Any]:
    return backend_api_service.get_tag_groups()


@app.get("/graph-index", response_model=GraphIndexResponse)
def get_graph_index() -> dict[str, Any]:
    return backend_api_service.get_graph_index()


@app.get("/graph-index/status", response_model=GraphIndexStatusResponse)
def get_graph_index_status() -> dict[str, Any]:
    return backend_api_service.get_graph_index_status()


@app.post("/graph-index/rebuild", response_model=GraphIndexRebuildResponse)
def rebuild_graph_index() -> dict[str, Any]:
    return backend_api_service.rebuild_graph_index()


@app.get("/graph-state", response_model=GraphStateResponse)
def get_graph_state() -> dict[str, Any]:
    return backend_api_service.get_graph_state()


@app.put("/graph-state", response_model=GraphStateResponse)
def update_graph_state(state_payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return backend_api_service.update_graph_state(state_payload)


@app.get("/tags/overview", response_model=TagOverviewResponse)
def get_tag_overview(groupId: str, tagId: str) -> dict[str, Any]:
    return backend_api_service.get_tag_overview(groupId, tagId)


@app.post("/tag-groups/add-group", response_model=TagGroupsResponse)
def add_tag_group(req: TagGroupRequest) -> dict[str, Any]:
    return backend_api_service.add_tag_group(req)


@app.post("/tag-groups/add-tag", response_model=TagGroupsResponse)
def add_tag(req: TagCreateRequest) -> dict[str, Any]:
    return backend_api_service.add_tag(req)


@app.post("/tag-groups/rename-group", response_model=TagGroupsResponse)
def rename_tag_group(req: TagGroupRenameRequest) -> dict[str, Any]:
    return backend_api_service.rename_tag_group(req)


@app.post("/tag-groups/delete-group", response_model=TagGroupsResponse)
def delete_tag_group(req: TagGroupDeleteRequest) -> dict[str, Any]:
    return backend_api_service.delete_tag_group(req)


@app.post("/tag-groups/rename-tag", response_model=TagGroupsResponse)
def rename_tag(req: TagRenameRequest) -> dict[str, Any]:
    return backend_api_service.rename_tag(req)


@app.post("/tag-groups/delete-tag", response_model=TagGroupsResponse)
def delete_tag(req: TagDeleteRequest) -> dict[str, Any]:
    return backend_api_service.delete_tag(req)


@app.get("/tag-groups/match-candidates", response_model=TagMatchCandidatesResponse)
def scan_tag_match_candidates() -> dict[str, Any]:
    return backend_api_service.scan_tag_match_candidates()


@app.post("/tag-groups/apply-matches", response_model=TagGroupsResponse)
def apply_tag_match_candidates(req: TagMatchApplyRequest) -> dict[str, Any]:
    return backend_api_service.apply_tag_match_candidates(req)


@app.get("/note-groups", response_model=NoteGroupsResponse)
def get_note_groups() -> dict[str, Any]:
    return backend_api_service.get_note_groups()


@app.post("/note-groups/add-group", response_model=NoteGroupAddResponse)
def add_note_group(req: NoteGroupCreateRequest) -> dict[str, Any]:
    return backend_api_service.add_note_group(req)


@app.post("/note-groups/rename", response_model=NoteGroupRenameResponse)
def rename_note_group(req: NoteGroupRenameRequest) -> dict[str, Any]:
    return backend_api_service.rename_note_group(req)


@app.post("/note-groups/delete", response_model=NoteGroupDeleteResponse)
def delete_note_group(req: NoteGroupDeleteRequest) -> dict[str, Any]:
    return backend_api_service.delete_note_group(req)


@app.post("/note-groups/move", response_model=NoteGroupMoveResponse)
def move_note_group(req: NoteGroupMoveRequest) -> dict[str, Any]:
    return backend_api_service.move_note_group(req)


@app.post("/note-groups/favorite", response_model=NoteFavoritesResponse)
def favorite_note_group(req: FavoriteFolderRequest) -> dict[str, Any]:
    return backend_api_service.favorite_note_group(req)


@app.post("/note-groups/unfavorite", response_model=NoteFavoritesResponse)
def unfavorite_note_group(req: FavoriteFolderRequest) -> dict[str, Any]:
    return backend_api_service.unfavorite_note_group(req)


@app.post("/note-groups/add-note", response_model=NoteAddResponse)
def add_note(req: NoteCreateRequest) -> dict[str, Any]:
    return backend_api_service.add_note(req)


@app.post("/notes/rename", response_model=NoteMutationResponse)
def rename_note(req: NoteFileRenameRequest) -> dict[str, Any]:
    return backend_api_service.rename_note(req)


@app.post("/notes/delete", response_model=NoteMutationResponse)
def delete_note(req: NoteFileDeleteRequest) -> dict[str, Any]:
    return backend_api_service.delete_note(req)


@app.post("/notes/move", response_model=NoteMutationResponse)
def move_note(req: NoteFileMoveRequest) -> dict[str, Any]:
    return backend_api_service.move_note(req)


@app.post("/notes/move-batch", response_model=NoteMutationResponse)
def move_notes_batch(req: NoteFileMoveBatchRequest) -> dict[str, Any]:
    return backend_api_service.move_notes_batch(req)


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


class ServiceOwnerRequest(BaseModel):
    pid: int | None = Field(default=None, ge=1)

@app.get('/service')
def service_info():
    return {'version': service_control.version, 'pid': os.getpid(), 'ownerPid': service_control.owner_pid}

@app.post('/service/owner')
def set_service_owner(req: ServiceOwnerRequest):
    # With an owner the service ends with the app; without one it stays reachable for agents.
    service_control.owner_pid = req.pid
    return {'ownerPid': service_control.owner_pid}

@app.post('/service/shutdown')
def shutdown_service():
    service_control.shutdown()
    return {'stopping': True}

@app.get('/graph/related')
def graph_related(path: str, limit: int = 50):
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        resolved = backend_api_service._resolve_note_request_path(vault, path)
        index = read_graph_index(vault.graph_index_path)
        entry = index.files.get(resolved.relative_to(vault.vault_path).as_posix())
        return related_files(index, entry.id, limit) if entry else {'items': [], 'truncated': False}


@app.get('/graph/context')
def graph_context(path: str, limit: int = 50):
    """Links and backlinks of one note (the same neighbourhood agents read over MCP)."""
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        resolved = backend_api_service._resolve_note_request_path(vault, path)
        index = read_graph_index(vault.graph_index_path)
        context = note_context(index, resolved.relative_to(vault.vault_path).as_posix(), depth=1, limit=limit)
        return {'links': context['links'], 'backlinks': context['backlinks']}


@app.get('/recovery')
def recovery_status():
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        return {'items':list_recovery(vault)}

class RecoveryRequest(BaseModel):
    action: str

@app.post('/recovery/{identity}')
def recovery_resolve(identity: str, req: RecoveryRequest):
    with state.operation_lock:
        vault, _ = backend_api_service.require_loaded()
        try:
            result=resolve_recovery(vault,identity,req.action)
        except (ValueError,OSError) as exc:
            raise ValidationDomainError('Wiederherstellung konnte nicht abgeschlossen werden. Die Sicherheitskopien bleiben erhalten.') from exc
        if not pending_recovery(vault):
            backend_api_service.reindex_vault()
            state.start_graph_watcher()
        state.change_version += 1
        return result

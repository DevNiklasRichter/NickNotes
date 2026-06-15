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
    GraphIndexRebuildResponse,
    GraphIndexResponse,
    GraphIndexStatusResponse,
    GraphStateResponse,
    NoteAddResponse,
    NoteBaseOpenStartResponse,
    NoteContentResponse,
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
    TemplateMigrationResponse,
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
from .nicknotes_backend.ai_client import OpenAISuggester
from .application_services import BackendApiService
from .use_cases import GetFocusDashboardUseCase
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.vault import VaultManager
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


@dataclass
class GraphRuntimeStatus:
    is_updating: bool = False
    last_error: str | None = None
    watcher_enabled: bool = False
    last_external_update: str | None = None


@dataclass
class NoteBaseLoadStatus:
    active: bool = False
    done: bool = False
    error: str | None = None
    error_code: str | None = None
    error_details: dict[str, Any] | None = None
    phase: str = ""
    processed: int = 0
    total: int = 0
    current_path: str | None = None
    result: dict[str, Any] | None = None
    started_at: float = 0.0
    finished_at: float | None = None


@dataclass
class RuntimeState:
    pass


@dataclass
class VaultSession:
    vault: VaultManager | None = None
    indexer: VaultIndexer | None = None
    parser: CaptureParser = field(default_factory=CaptureParser)
    openai: OpenAISuggester | None = None
    projection_lock: threading.RLock = field(default_factory=threading.RLock)
    graph_status: GraphRuntimeStatus = field(default_factory=GraphRuntimeStatus)
    watcher_stop: threading.Event | None = None
    watcher_thread: threading.Thread | None = None
    load_status: NoteBaseLoadStatus = field(default_factory=NoteBaseLoadStatus)
    load_lock: threading.Lock = field(default_factory=threading.Lock)
    import_status: NoteBaseLoadStatus = field(default_factory=NoteBaseLoadStatus)
    import_lock: threading.Lock = field(default_factory=threading.Lock)

    def dispose(self) -> None:
        self.stop_graph_watcher()
        if self.indexer:
            self.indexer.close()
            self.indexer = None
        self.vault = None
        self.openai = None
        with self.load_lock:
            self.load_status = NoteBaseLoadStatus()
        with self.import_lock:
            self.import_status = NoteBaseLoadStatus()
        self.graph_status = GraphRuntimeStatus()

    def start_graph_watcher(self, runtime: "RuntimeState") -> None:
        if not self.vault or not self.indexer or self.watcher_thread:
            return
        stop_event = threading.Event()
        self.watcher_stop = stop_event
        self.graph_status.watcher_enabled = True
        self.watcher_thread = threading.Thread(
            target=_graph_watcher_loop,
            args=(runtime, self.vault, self.indexer, stop_event),
            name="nicknotes-graph-watcher",
            daemon=True,
        )
        self.watcher_thread.start()

    def stop_graph_watcher(self) -> None:
        if self.watcher_stop:
            self.watcher_stop.set()
        if self.watcher_thread and self.watcher_thread.is_alive():
            self.watcher_thread.join(timeout=2)
        self.watcher_stop = None
        self.watcher_thread = None
        self.graph_status.watcher_enabled = False

    def reset_load_status(self, phase: str) -> None:
        with self.load_lock:
            self.load_status = NoteBaseLoadStatus(active=True, phase=phase, started_at=time.time())

    def update_load_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        with self.load_lock:
            status = self.load_status
            if phase is not None:
                status.phase = phase
            if processed is not None:
                status.processed = processed
            if total is not None:
                status.total = total
            if current_path is not None:
                status.current_path = current_path
            if error is not None:
                status.error = error
            if error_code is not None:
                status.error_code = error_code
            if error_details is not None:
                status.error_details = error_details
            if result is not None:
                status.result = result
            if done is not None:
                status.done = done
                status.active = not done
                if done:
                    status.finished_at = time.time()

    def get_load_status(self) -> dict[str, Any]:
        with self.load_lock:
            status = self.load_status
            return {
                "active": status.active,
                "done": status.done,
                "error": status.error,
                "errorCode": status.error_code,
                "errorDetails": status.error_details,
                "phase": status.phase,
                "processed": status.processed,
                "total": status.total,
                "currentPath": status.current_path,
                "result": status.result,
                "startedAt": status.started_at,
                "finishedAt": status.finished_at,
            }

    def reset_import_status(self, phase: str) -> None:
        with self.import_lock:
            self.import_status = NoteBaseLoadStatus(active=True, phase=phase, started_at=time.time())

    def update_import_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        with self.import_lock:
            status = self.import_status
            if phase is not None:
                status.phase = phase
            if processed is not None:
                status.processed = processed
            if total is not None:
                status.total = total
            if current_path is not None:
                status.current_path = current_path
            if error is not None:
                status.error = error
            if error_code is not None:
                status.error_code = error_code
            if error_details is not None:
                status.error_details = error_details
            if result is not None:
                status.result = result
            if done is not None:
                status.done = done
                status.active = not done
                if done:
                    status.finished_at = time.time()

    def get_import_status(self) -> dict[str, Any]:
        with self.import_lock:
            status = self.import_status
            return {
                "active": status.active,
                "done": status.done,
                "error": status.error,
                "errorCode": status.error_code,
                "errorDetails": status.error_details,
                "phase": status.phase,
                "processed": status.processed,
                "total": status.total,
                "currentPath": status.current_path,
                "result": status.result,
                "startedAt": status.started_at,
                "finishedAt": status.finished_at,
            }


@dataclass
class RuntimeState:
    _session: VaultSession = field(default_factory=VaultSession)
    session_lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def vault(self) -> VaultManager | None:
        return self._session.vault

    @vault.setter
    def vault(self, value: VaultManager | None) -> None:
        self._session.vault = value

    @property
    def indexer(self) -> VaultIndexer | None:
        return self._session.indexer

    @indexer.setter
    def indexer(self, value: VaultIndexer | None) -> None:
        self._session.indexer = value

    @property
    def parser(self) -> CaptureParser:
        return self._session.parser

    @parser.setter
    def parser(self, value: CaptureParser) -> None:
        self._session.parser = value

    @property
    def openai(self) -> OpenAISuggester | None:
        return self._session.openai

    @openai.setter
    def openai(self, value: OpenAISuggester | None) -> None:
        self._session.openai = value

    @property
    def graph_status(self) -> GraphRuntimeStatus:
        return self._session.graph_status

    @graph_status.setter
    def graph_status(self, value: GraphRuntimeStatus) -> None:
        self._session.graph_status = value

    @property
    def projection_lock(self) -> threading.RLock:
        return self._session.projection_lock

    @property
    def watcher_stop(self) -> threading.Event | None:
        return self._session.watcher_stop

    @watcher_stop.setter
    def watcher_stop(self, value: threading.Event | None) -> None:
        self._session.watcher_stop = value

    @property
    def watcher_thread(self) -> threading.Thread | None:
        return self._session.watcher_thread

    @watcher_thread.setter
    def watcher_thread(self, value: threading.Thread | None) -> None:
        self._session.watcher_thread = value

    @property
    def load_status(self) -> NoteBaseLoadStatus:
        return self._session.load_status

    @load_status.setter
    def load_status(self, value: NoteBaseLoadStatus) -> None:
        self._session.load_status = value

    @property
    def load_lock(self) -> threading.Lock:
        return self._session.load_lock

    @property
    def import_status(self) -> NoteBaseLoadStatus:
        return self._session.import_status

    @import_status.setter
    def import_status(self, value: NoteBaseLoadStatus) -> None:
        self._session.import_status = value

    @property
    def import_lock(self) -> threading.Lock:
        return self._session.import_lock

    @property
    def session(self) -> VaultSession:
        return self._session

    def start_session(
        self,
        *,
        vault: VaultManager | None,
        indexer: VaultIndexer | None,
        openai: OpenAISuggester | None = None,
        parser: CaptureParser | None = None,
    ) -> None:
        with self.session_lock:
            self._session.dispose()
            self._session.vault = vault
            self._session.indexer = indexer
            self._session.openai = openai
            if parser is not None:
                self._session.parser = parser

    def stop_session(self) -> None:
        with self.session_lock:
            self._session.stop_graph_watcher()
            if self._session.indexer:
                self._session.indexer.close()

    def dispose_session(self) -> None:
        with self.session_lock:
            self._session.dispose()

    def close(self) -> None:
        with self.session_lock:
            self._session.dispose()

    def start_graph_watcher(self) -> None:
        with self.session_lock:
            self._session.start_graph_watcher(self)

    def stop_graph_watcher(self) -> None:
        with self.session_lock:
            self._session.stop_graph_watcher()

    def reset_load_status(self, phase: str) -> None:
        self._session.reset_load_status(phase)

    def update_load_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._session.update_load_status(
            phase=phase,
            processed=processed,
            total=total,
            current_path=current_path,
            done=done,
            error=error,
            error_code=error_code,
            error_details=error_details,
            result=result,
        )

    def get_load_status(self) -> dict[str, Any]:
        return self._session.get_load_status()

    def reset_import_status(self, phase: str) -> None:
        self._session.reset_import_status(phase)

    def update_import_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._session.update_import_status(
            phase=phase,
            processed=processed,
            total=total,
            current_path=current_path,
            done=done,
            error=error,
            error_code=error_code,
            error_details=error_details,
            result=result,
        )

    def get_import_status(self) -> dict[str, Any]:
        return self._session.get_import_status()


state = RuntimeState()
backend_api_service = BackendApiService()

app = FastAPI(title="NickNotes Backend", version="2.0.0")
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
    operation_id = request.headers.get("X-Operation-Id") or str(uuid.uuid4())
    trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())
    tokens = set_operation_context(
        operation_id=operation_id,
        trace_id=trace_id,
        vault_id=_active_vault_id(),
    )
    started_at = time.perf_counter()
    logger.info("Request start", extra=_request_log_payload(request))
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.info(
            "Request finished",
            extra=_request_log_payload(request, status_code=response.status_code, error_code="request.completed"),
        )
        response.headers["X-Operation-Id"] = operation_id
        response.headers["X-Trace-Id"] = trace_id
        response.headers["X-Request-Duration-Ms"] = str(duration_ms)
        return response
    finally:
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



class VaultOpenRequest(BaseModel):
    path: str


class VaultCreateRequest(BaseModel):
    parent_path: str = Field(alias="parentPath")
    name: str


class NoteBaseRenameRequest(BaseModel):
    new_name: str = Field(alias="newName")


class NoteBaseDeleteRequest(BaseModel):
    confirm_delete: bool = Field(default=False, alias="confirmDelete")


class CapturePreviewRequest(BaseModel):
    text: str


class CaptureSaveRequest(BaseModel):
    text: str
    selected_tag_keys: list[str] = Field(default_factory=list, alias="selectedTagKeys")


class FocusMitUpdateRequest(BaseModel):
    date: str | None = None
    mit_ids: list[str] = Field(default_factory=list, alias="mitIds")


class FocusQuickCaptureRequest(BaseModel):
    text: str
    date: str | None = None


class NoteOpenRequest(BaseModel):
    path: str


class NoteSaveRequest(BaseModel):
    path: str
    content: str


class NoteMediaAddRequest(BaseModel):
    path: str
    file_name: str = Field(alias="fileName")
    content_type: str = Field(default="", alias="contentType")
    data_base64: str = Field(alias="dataBase64")


class TagGroupRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    display_name: str = Field(default="", alias="displayName")
    color: str = Field(default="#4f8cff")


class TagCreateRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    display_name: str = Field(default="", alias="displayName")


class TagRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    new_tag_id: str = Field(alias="newTagId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    new_group_id: str = Field(alias="newGroupId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    new_color: str = Field(default="#4f8cff", alias="newColor")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class TagMoveRequest(BaseModel):
    from_group: str = Field(alias="fromGroup")
    tag_id: str = Field(alias="tagId")
    to_group: str = Field(alias="toGroup")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class TagMatchApplyRequest(BaseModel):
    matches: list[dict[str, Any]] = Field(default_factory=list)


class NoteGroupCreateRequest(BaseModel):
    group_name: str = Field(alias="groupName")
    parent_key: str = Field(default="", alias="parentKey")


class NoteCreateRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    title: str = ""
    note_type: str = Field(default="note", alias="noteType")
    status: str = "open"


class NoteGroupRenameRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    new_name: str = Field(alias="newName")


class NoteGroupDeleteRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class NoteGroupMoveRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    target_parent_key: str = Field(alias="targetParentKey")


class NoteFileRenameRequest(BaseModel):
    path: str
    new_name: str = Field(alias="newName")


class NoteFileDeleteRequest(BaseModel):
    path: str


class NoteFileMoveRequest(BaseModel):
    path: str
    target_group_key: str = Field(alias="targetGroupKey")


class NoteFileMoveBatchRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)
    target_group_key: str = Field(alias="targetGroupKey")


class FavoriteFolderRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class UiSettingsUpdateRequest(BaseModel):
    app: dict[str, Any] | None = None
    explorer: dict[str, Any] | None = None


class OneNoteImportPreviewRequest(BaseModel):
    source_paths: list[str] = Field(default_factory=list, alias="sourcePaths")


class OneNoteImportRequest(BaseModel):
    source_paths: list[str] = Field(default_factory=list, alias="sourcePaths")
    target_folder: str = Field(default="", alias="targetFolder")


class TodoToggleRequest(BaseModel):
    checked: bool | None = None


@app.get("/health", response_model=BackendStateResponse)
def health()-> dict[str, Any]:
    return backend_api_service.health()

def health_impl()-> dict[str, Any]:
    return {"ok": True, "vaultLoaded": state.vault is not None, "capabilities": BACKEND_CAPABILITIES}



@app.get("/state", response_model=BackendStateResponse)
def get_state()-> dict[str, Any]:
    return backend_api_service.get_state()

def get_state_impl()-> dict[str, Any]:
    if not state.vault or not state.indexer:
        return {"vaultLoaded": False}
    return {
        "vaultLoaded": True,
        "vaultPath": str(state.vault.vault_path),
        "noteBasePath": str(state.vault.vault_path),
        "counts": _counts(state.indexer),
    }



@app.post("/vault/open", response_model=VaultOpenResponse)
def open_vault(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_vault(req)

def open_vault_impl(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_vault(req)


@app.post("/notebase/open/start", response_model=NoteBaseOpenStartResponse)
def start_notebase_open(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.start_notebase_open(req)

def start_notebase_open_impl(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.start_notebase_open(req)





@app.get("/notebase/open/status", response_model=OperationStatusResponse)
def get_notebase_open_status()-> dict[str, Any]:
    return backend_api_service.get_notebase_open_status()

def get_notebase_open_status_impl()-> dict[str, Any]:
    return backend_api_service.get_notebase_open_status()



@app.post("/vault/create", response_model=VaultOpenResponse)
def create_vault(req: VaultCreateRequest)-> dict[str, Any]:
    return backend_api_service.create_vault(req)

def create_vault_impl(req: VaultCreateRequest)-> dict[str, Any]:
    parent = Path(req.parent_path).expanduser().resolve()
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Parent path not found: {parent}")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="NoteBase name cannot be empty")

    vault_path = parent / name
    vault_path.mkdir(parents=True, exist_ok=True)
    return open_vault(VaultOpenRequest(path=str(vault_path)))



@app.post("/vault/reindex", response_model=ReindexResponse)
def reindex_vault()-> dict[str, Any]:
    return backend_api_service.reindex_vault()

def reindex_vault_impl()-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        with state.projection_lock:
            indexed = indexer.reindex_vault(vault.vault_path)
            vault.rebuild_task_status_links(indexer)
            tag_groups = vault.sync_tag_groups_with_index(indexer)
            graph_status = _rebuild_graph_projection(vault)
        return {"indexed": indexed, "counts": _counts(indexer), "tagGroups": tag_groups, "graphStatus": graph_status}
    except Exception as exc:
        logger.exception("NoteBase reindex failed")
        raise HTTPException(status_code=500, detail=f"Unerwarteter Fehler beim Reindex: {exc}") from exc



@app.post("/notebase/open", response_model=VaultOpenResponse)
def open_notebase(req: VaultOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_notebase(req)

def open_notebase_impl(req: VaultOpenRequest)-> dict[str, Any]:
    return open_vault(req)



@app.post("/notebase/create", response_model=VaultOpenResponse)
def create_notebase(req: VaultCreateRequest)-> dict[str, Any]:
    return backend_api_service.create_notebase(req)

def create_notebase_impl(req: VaultCreateRequest)-> dict[str, Any]:
    return create_vault(req)



@app.post("/notebase/reindex", response_model=ReindexResponse)
def reindex_notebase()-> dict[str, Any]:
    return backend_api_service.reindex_notebase()

def reindex_notebase_impl()-> dict[str, Any]:
    return reindex_vault()



@app.post("/imports/onenote/preview", response_model=OneNoteImportPreviewResponse)
def preview_onenote_import(req: OneNoteImportPreviewRequest)-> dict[str, Any]:
    return backend_api_service.preview_onenote_import(req)

def preview_onenote_import_impl(req: OneNoteImportPreviewRequest)-> dict[str, Any]:
    return backend_api_service.preview_onenote_import(req)



@app.post("/imports/onenote/start", response_model=OneNoteImportResponse)
def start_onenote_import(req: OneNoteImportRequest)-> dict[str, Any]:
    return backend_api_service.start_onenote_import(req)

def start_onenote_import_impl(req: OneNoteImportRequest)-> dict[str, Any]:
    return backend_api_service.start_onenote_import(req)



@app.get("/imports/onenote/status", response_model=OneNoteImportStatusResponse)
def get_onenote_import_status()-> dict[str, Any]:
    return backend_api_service.get_onenote_import_status()

def get_onenote_import_status_impl()-> dict[str, Any]:
    return state.get_import_status()



@app.post("/notebase/rename", response_model=VaultOpenResponse)
def rename_notebase(req: NoteBaseRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_notebase(req)

def rename_notebase_impl(req: NoteBaseRenameRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    old_path = vault.vault_path.resolve()
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="New NoteBase name cannot be empty")
    if any(token in new_name for token in ("/", "\\")):
        raise HTTPException(status_code=400, detail="New NoteBase name must not contain path separators")
    if new_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid NoteBase name")

    new_path = old_path.parent / new_name
    if new_path == old_path:
        return {
            "vaultPath": str(old_path),
            "noteBasePath": str(old_path),
            "counts": _counts(state.indexer) if state.indexer else {"notes": 0, "openTasks": 0, "doneTasks": 0},
        }
    if new_path.exists():
        raise HTTPException(status_code=400, detail=f"Target path already exists: {new_path}")

    try:
        state.dispose_session()
        old_path.rename(new_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not rename NoteBase: {exc}") from exc

    return open_vault(VaultOpenRequest(path=str(new_path)))



@app.post("/notebase/delete", response_model=VaultDeleteResponse)
def delete_notebase(req: NoteBaseDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_notebase(req)

def delete_notebase_impl(req: NoteBaseDeleteRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    if not req.confirm_delete:
        raise HTTPException(status_code=400, detail="confirmDelete must be true to delete a NoteBase")

    target = vault.vault_path.resolve()
    try:
        state.dispose_session()
        shutil.rmtree(target)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete NoteBase: {exc}") from exc

    return {"deleted": True, "deletedPath": str(target), "vaultLoaded": False}



@app.post("/capture/preview", response_model=CapturePreviewResponse)
def preview_capture(req: CapturePreviewRequest)-> dict[str, Any]:
    return backend_api_service.preview_capture(req)

def preview_capture_impl(req: CapturePreviewRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    merged = _compute_capture(req.text, vault, indexer)
    auto_count = sum(1 for item in merged if item.auto_apply or item.source == "explicit")
    return {
        "suggestions": [_tag_payload(item) for item in merged],
        "stats": {
            "tags": len(merged),
            "auto": auto_count,
        },
    }



@app.post("/capture/save", response_model=SaveCaptureResponse)
def save_capture(req: CaptureSaveRequest)-> dict[str, Any]:
    return backend_api_service.save_capture(req)

def save_capture_impl(req: CaptureSaveRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Capture text is empty")

    merged = _compute_capture(text, vault, indexer)
    selected_keys = set(req.selected_tag_keys)
    selected_tags = [tag for tag in merged if tag.key in selected_keys]

    result = vault.save_capture(
        text=text,
        selected_tags=selected_tags,
        indexer=indexer,
    )

    return {
        "saved": True,
        "noteId": result["note_id"],
        "date": result["date"],
        "notePath": str(result["note_path"]),
        "counts": _counts(indexer),
    }



@app.get("/focus/mit", response_model=FocusMitResponse)
def get_focus_mit(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.get_focus_mit(date)

def get_focus_mit_impl(date: str | None = None)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    state = vault.get_daily_mit(day_iso=date)
    return {
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "mitIds": state["mit_ids"],
    }



@app.post("/focus/mit", response_model=FocusMitSaveResponse)
def save_focus_mit(req: FocusMitUpdateRequest)-> dict[str, Any]:
    return backend_api_service.save_focus_mit(req)

def save_focus_mit_impl(req: FocusMitUpdateRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    state = vault.set_daily_mit(day_iso=req.date, mit_ids=req.mit_ids, indexer=indexer)
    return {
        "saved": True,
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "mitIds": state["mit_ids"],
        "counts": _counts(indexer),
    }



@app.post("/focus/quick-capture", response_model=QuickCaptureFocusTodoResponse)
def quick_capture_focus_todo(req: FocusQuickCaptureRequest)-> dict[str, Any]:
    return backend_api_service.quick_capture_focus_todo(req)

def quick_capture_focus_todo_impl(req: FocusQuickCaptureRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.add_quick_todo_to_daily(text=req.text, indexer=indexer, day_iso=req.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "saved": True,
        "date": result["date"],
        "notePath": str(result["note_path"]),
        "todoText": result["todo_text"],
        "counts": _counts(indexer),
    }



@app.post("/daily/open-today", response_model=DailyOpenResponse)
def open_or_create_daily(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.open_or_create_daily(date)

def open_or_create_daily_impl(date: str | None = None)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    state = vault.ensure_daily_note(day_iso=date, indexer=indexer)
    return {
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "title": state["title"],
        "created": bool(state["created"]),
        "counts": _counts(indexer),
    }



@app.get("/focus/dashboard", response_model=FocusDashboardAggregateResponse)
def get_focus_dashboard(date: str | None = None)-> dict[str, Any]:
    return backend_api_service.get_focus_dashboard(date)

def get_focus_dashboard_impl(date: str | None = None)-> dict[str, Any]:
    return GetFocusDashboardUseCase().execute(backend_api_service, date_param=date)



@app.get("/tasks", response_model=TaskListResponse)
def list_tasks(include_done: bool = False)-> dict[str, Any]:
    return backend_api_service.list_tasks(include_done)

def list_tasks_impl(include_done: bool = False)-> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.list_tasks(include_done=include_done)}



@app.get("/todos", response_model=TodoListResponse)
def list_todos()-> dict[str, Any]:
    return backend_api_service.list_todos()

def list_todos_impl()-> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.list_todos()}



@app.post("/todos/{todo_id}/toggle", response_model=TodoToggleResponse)
def toggle_todo(todo_id: str, req: TodoToggleRequest)-> dict[str, Any]:
    return backend_api_service.toggle_todo(todo_id, req)

def toggle_todo_impl(todo_id: str, req: TodoToggleRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.toggle_todo(todo_id=todo_id, indexer=indexer, checked=req.checked)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result



@app.post("/todos/{todo_id}/promote", response_model=TodoPromoteResponse)
def promote_todo(todo_id: str)-> dict[str, Any]:
    return backend_api_service.promote_todo(todo_id)

def promote_todo_impl(todo_id: str)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.promote_todo_to_task(todo_id=todo_id, indexer=indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result



@app.post("/tasks/{task_id}/done", response_model=TaskDoneResponse)
def mark_task_done(task_id: str)-> dict[str, Any]:
    return backend_api_service.mark_task_done(task_id)

def mark_task_done_impl(task_id: str)-> dict[str, Any]:
    vault, indexer = _require_loaded()

    rows = [r for r in indexer.list_tasks(include_done=True) if r["id"] == task_id]
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")

    row = rows[0]
    path = row.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Task file path missing")

    src = Path(path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Task file not found: {src}")

    meta, body = parse_markdown(src)
    meta["status"] = "done"
    now_iso = datetime.now().isoformat(timespec="seconds")
    meta["updated_at"] = now_iso
    # `completed_at` is the canonical completion timestamp for task done metrics.
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
    blocked_by_ids: list[str] = []
    if isinstance(blocked_by_raw, list):
        iterable = [str(item) for item in blocked_by_raw]
    elif isinstance(blocked_by_raw, str):
        iterable = blocked_by_raw.split(",")
    else:
        iterable = []
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



@app.get("/search", response_model=SearchResponse)
def search_notes(query: str = "")-> dict[str, Any]:
    return backend_api_service.search_notes(query)

def search_notes_impl(query: str = "")-> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.search_notes(query)}



@app.get("/explorer/files", response_model=SearchResponse)
def explorer_files()-> dict[str, Any]:
    return backend_api_service.explorer_files()

def explorer_files_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
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



@app.get("/notes/content", response_model=NoteContentResponse)
def read_note_content(path: str)-> dict[str, Any]:
    return backend_api_service.read_note_content(path)

def read_note_content_impl(path: str)-> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    return {"path": str(file_path), "content": file_path.read_text(encoding="utf-8")}



@app.post("/notes/save", response_model=NoteAddResponse)
def save_note_content(req: NoteSaveRequest)-> dict[str, Any]:
    return backend_api_service.save_note_content(req)

def save_note_content_impl(req: NoteSaveRequest)-> dict[str, Any]:
    return backend_api_service.save_note_content(req)



@app.post("/notes/media/add", response_model=NoteMediaResponse)
def add_note_media_asset(req: NoteMediaAddRequest)-> dict[str, Any]:
    return backend_api_service.add_note_media_asset(req)

def add_note_media_asset_impl(req: NoteMediaAddRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        payload = base64.b64decode(req.data_base64.encode("utf-8"), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail=f"Ungueltige Bilddaten: {exc}") from exc

    try:
        result = vault.add_note_media_asset(
            note_path=req.path,
            filename=req.file_name or "image",
            content_type=req.content_type or "",
            data=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "mediaPath": result["media_path"],
        "markdownPath": result["markdown_path"],
        "fileName": result["file_name"],
    }



@app.get("/notes/media/content")
def get_note_media_content(path: str, source: str)-> FileResponse:
    return backend_api_service.get_note_media_content(path, source)

def get_note_media_content_impl(path: str, source: str)-> FileResponse:
    vault, _indexer = _require_loaded()
    try:
        asset_path, mime_type = vault.resolve_note_media_asset(note_path=path, source=source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(path=asset_path, media_type=mime_type, filename=asset_path.name)



@app.post("/notes/open", response_model=OpenNoteResponse)
def open_note_file(req: NoteOpenRequest)-> dict[str, Any]:
    return backend_api_service.open_note_file(req)

def open_note_file_impl(req: NoteOpenRequest)-> dict[str, Any]:
    file_path = Path(req.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        if sys.platform.startswith("win"):
            os.startfile(str(file_path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", str(file_path)], check=False)
        else:
            subprocess.run(["xdg-open", str(file_path)], check=False)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not open file: {exc}") from exc

    return {"opened": True, "path": str(file_path)}



@app.get("/review", response_model=ReviewResponse)
def get_review()-> dict[str, Any]:
    return backend_api_service.get_review()

def get_review_impl()-> dict[str, Any]:
    _vault, indexer = _require_loaded()
    today = date.today()
    return {
        "daily": indexer.daily_summary(today),
        "weekly": indexer.weekly_summary(today),
    }



@app.get("/review/dashboard", response_model=ReviewDashboardResponse)
def get_review_dashboard(days: int = REVIEW_DASHBOARD_DEFAULT_DAYS, day: str | None = None, top: int = REVIEW_DASHBOARD_DEFAULT_TOP_NOTES)-> dict[str, Any]:
    return backend_api_service.get_review_dashboard(days, day, top)

def get_review_dashboard_impl(
    days: int = REVIEW_DASHBOARD_DEFAULT_DAYS,
    day: str | None = None,
    top: int = REVIEW_DASHBOARD_DEFAULT_TOP_NOTES,
) -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    day_iso = _normalize_iso_day_param(day)
    try:
        end_day = datetime.fromisoformat(day_iso).date()
    except ValueError:
        end_day = date.today()

    safe_days = max(REVIEW_DASHBOARD_DAYS_MIN, min(int(days), REVIEW_DASHBOARD_DAYS_MAX))
    safe_top = max(REVIEW_DASHBOARD_TOP_NOTES_MIN, min(int(top), REVIEW_DASHBOARD_TOP_NOTES_MAX))
    return indexer.review_dashboard(end_day=end_day, window_days=safe_days, top_notes_limit=safe_top)



@app.get("/ui-settings", response_model=UiSettingsResponse)
def get_ui_settings()-> dict[str, Any]:
    return backend_api_service.get_ui_settings()

def get_ui_settings_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"settings": vault.read_ui_settings()}



@app.post("/ui-settings", response_model=UiSettingsResponse)
def update_ui_settings(req: UiSettingsUpdateRequest)-> dict[str, Any]:
    return backend_api_service.update_ui_settings(req)

def update_ui_settings_impl(req: UiSettingsUpdateRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    settings = vault.update_ui_settings(app_settings=req.app, explorer_settings=req.explorer)
    return {"settings": settings}



@app.get("/tag-groups", response_model=TagGroupsResponse)
def get_tag_groups()-> dict[str, Any]:
    return backend_api_service.get_tag_groups()

def get_tag_groups_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"groups": vault.read_tag_groups()}



@app.get("/graph-index", response_model=GraphIndexResponse)
def get_graph_index()-> dict[str, Any]:
    return backend_api_service.get_graph_index()

def get_graph_index_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"index": read_graph_index(vault.graph_index_path).to_dict()}



@app.get("/graph-index/status", response_model=GraphIndexStatusResponse)
def get_graph_index_status()-> dict[str, Any]:
    return backend_api_service.get_graph_index_status()

def get_graph_index_status_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return _graph_index_status(vault)



@app.post("/graph-index/rebuild", response_model=GraphIndexRebuildResponse)
def rebuild_graph_index()-> dict[str, Any]:
    return backend_api_service.rebuild_graph_index()

def rebuild_graph_index_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    with state.projection_lock:
        state.graph_status.is_updating = True
        state.graph_status.last_error = None
        try:
            index = build_graph_index(vault_path=vault.vault_path, tag_groups=vault.read_tag_groups())
            write_graph_index(vault.graph_index_path, index)
            return {"index": index.to_dict(), "status": _graph_index_status(vault, index)}
        except Exception as exc:
            state.graph_status.last_error = str(exc)
            logger.exception("Graph index rebuild failed.")
            raise
        finally:
            state.graph_status.is_updating = False



def _rebuild_graph_projection(vault: VaultManager) -> dict[str, Any]:
    with state.projection_lock:
        state.graph_status.is_updating = True
        state.graph_status.last_error = None
        try:
            index = build_graph_index(vault_path=vault.vault_path, tag_groups=vault.read_tag_groups())
            write_graph_index(vault.graph_index_path, index)
            return _graph_index_status(vault, index)
        except Exception as exc:
            state.graph_status.last_error = str(exc)
            logger.exception("Graph projection rebuild failed.")
            return _graph_index_status(vault)
        finally:
            state.graph_status.is_updating = False


def _update_graph_after_note_save(
    *,
    vault: VaultManager,
    saved_path: Path,
    previous_path: Path,
    tag_groups: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    with state.projection_lock:
        state.graph_status.is_updating = True
        state.graph_status.last_error = None
        try:
            groups = tag_groups if tag_groups is not None else vault.read_tag_groups()
            if not vault.graph_index_path.exists():
                index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
            else:
                index = read_graph_index(vault.graph_index_path)
                if _graph_index_needs_rebuild(index):
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
            return _graph_index_status(vault, index)
        except Exception as exc:
            state.graph_status.last_error = str(exc)
            logger.exception("Incremental graph update failed.")
            return _graph_index_status(vault)
        finally:
            state.graph_status.is_updating = False


def _graph_index_needs_rebuild(index: GraphIndex) -> bool:
    return any(item.type == "graphIndexReadFailed" for item in index.diagnostics)


def _graph_index_status(vault: VaultManager, index: GraphIndex | None = None) -> dict[str, Any]:
    loaded = index if index is not None else read_graph_index(vault.graph_index_path)
    read_failed = _graph_index_needs_rebuild(loaded)
    return {
        "available": vault.graph_index_path.exists() and not read_failed,
        "updated_at": loaded.updated_at or None,
        "node_count": len(loaded.nodes),
        "edge_count": len(loaded.edges),
        "diagnostic_count": len(loaded.diagnostics),
        "is_updating": state.graph_status.is_updating,
        "last_error": state.graph_status.last_error,
        "watcher_enabled": state.graph_status.watcher_enabled,
        "last_external_update": state.graph_status.last_external_update,
    }


def _graph_watcher_loop(runtime: RuntimeState, vault: VaultManager, indexer: VaultIndexer, stop_event: threading.Event) -> None:
    snapshot = graph_watcher_snapshot(vault.vault_path)
    pending: dict[Path, float] = {}
    while not stop_event.wait(2.0):
        try:
            current = graph_watcher_snapshot(vault.vault_path)
            changed_paths = {path for path, stamp in current.items() if snapshot.get(path) != stamp}
            deleted_paths = set(snapshot) - set(current)
            now = time.monotonic()
            for path in changed_paths | deleted_paths:
                # Coordinate with mutating note operations to avoid interleaving graph/index updates.
                pending[path] = now
            ready = [path for path, first_seen in pending.items() if now - first_seen >= 1.2]
            if not ready:
                snapshot = current
                continue
            for path in sorted(ready, key=lambda item: item.as_posix().lower()):
                pending.pop(path, None)
                with runtime.projection_lock:
                    if path.exists():
                        indexer.reindex_markdown_file(vault.vault_path, path)
                    else:
                        indexer.remove_projection_for_path(str(path))
                    _update_graph_after_note_save(vault=vault, saved_path=path, previous_path=path, tag_groups=None)
                    runtime.graph_status.last_external_update = datetime.now().isoformat(timespec="seconds")
            snapshot = current
        except Exception as exc:
            runtime.graph_status.last_error = str(exc)
            logger.exception("Graph watcher update failed.")


@app.get("/graph-state", response_model=GraphStateResponse)
def get_graph_state()-> dict[str, Any]:
    return backend_api_service.get_graph_state()

def get_graph_state_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"state": read_graph_state(vault.graph_state_path)}



@app.put("/graph-state", response_model=GraphStateResponse)
def update_graph_state(state_payload: dict[str, Any] = Body(default_factory=dict))-> dict[str, Any]:
    return backend_api_service.update_graph_state(state_payload)

def update_graph_state_impl(state_payload: dict[str, Any] = Body(default_factory=dict))-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"state": write_graph_state(vault.graph_state_path, state_payload)}



@app.get("/tags/overview", response_model=TagOverviewResponse)
def get_tag_overview(groupId: str, tagId: str)-> dict[str, Any]:
    return backend_api_service.get_tag_overview(groupId, tagId)

def get_tag_overview_impl(groupId: str, tagId: str)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.resolve_tag_overview_note(group_id=groupId, tag_id=tagId, indexer=indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "path": str(result["path"]),
        "title": str(result["title"]),
    }



@app.post("/tag-groups/add-group", response_model=TagGroupsResponse)
def add_tag_group(req: TagGroupRequest)-> dict[str, Any]:
    return backend_api_service.add_tag_group(req)

def add_tag_group_impl(req: TagGroupRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    groups = vault.add_tag_group(req.group_id, req.display_name, req.color, indexer)
    return {"groups": groups}



@app.post("/tag-groups/add-tag", response_model=TagGroupsResponse)
def add_tag(req: TagCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_tag(req)

def add_tag_impl(req: TagCreateRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    groups = vault.add_tag_to_group(req.group_id, req.tag_id, req.display_name, indexer)
    return {"groups": groups, "graphStatus": _rebuild_graph_projection(vault)}



@app.post("/tag-groups/rename-group", response_model=TagGroupsResponse)
def rename_tag_group(req: TagGroupRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_tag_group(req)

def rename_tag_group_impl(req: TagGroupRenameRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer), "graphStatus": _rebuild_graph_projection(vault)}



@app.post("/tag-groups/delete-group", response_model=TagGroupsResponse)
def delete_tag_group(req: TagGroupDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_tag_group(req)

def delete_tag_group_impl(req: TagGroupDeleteRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.delete_tag_group(
            group_id=req.group_id,
            remove_from_notes=req.remove_from_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer), "graphStatus": _rebuild_graph_projection(vault)}



@app.post("/tag-groups/rename-tag", response_model=TagGroupsResponse)
def rename_tag(req: TagRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_tag(req)

def rename_tag_impl(req: TagRenameRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer), "graphStatus": _rebuild_graph_projection(vault)}



@app.post("/tag-groups/move-tag", response_model=TagGroupsResponse)
def move_tag(req: TagMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_tag(req)

def move_tag_impl(req: TagMoveRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.move_tag(
            from_group=req.from_group,
            tag_name=req.tag_id,
            to_group=req.to_group,
            apply_to_notes=req.apply_to_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer), "graphStatus": _rebuild_graph_projection(vault)}



@app.post("/tag-groups/delete-tag", response_model=TagGroupsResponse)
def delete_tag(req: TagDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_tag(req)

def delete_tag_impl(req: TagDeleteRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.delete_tag(
            group_id=req.group_id,
            tag_id=req.tag_id,
            remove_from_notes=req.remove_from_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer), "graphStatus": _rebuild_graph_projection(vault)}



@app.get("/tag-groups/match-candidates", response_model=TagMatchCandidatesResponse)
def scan_tag_match_candidates()-> dict[str, Any]:
    return backend_api_service.scan_tag_match_candidates()

def scan_tag_match_candidates_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    matches = _scan_tag_match_candidates(vault)
    return {
        "items": matches,
        "total": len(matches),
    }



@app.post("/tag-groups/apply-matches", response_model=TagGroupsResponse)
def apply_tag_match_candidates(req: TagMatchApplyRequest)-> dict[str, Any]:
    return backend_api_service.apply_tag_match_candidates(req)

def apply_tag_match_candidates_impl(req: TagMatchApplyRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    applied, touched_paths = _apply_tag_match_candidates(vault, req.matches)
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
        "counts": _counts(indexer),
        "tagGroups": tag_groups,
        "graphStatus": _rebuild_graph_projection(vault),
    }



@app.get("/note-groups", response_model=NoteGroupsResponse)
def get_note_groups()-> dict[str, Any]:
    return backend_api_service.get_note_groups()

def get_note_groups_impl()-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"groups": vault.list_note_groups()}



@app.post("/note-groups/add-group", response_model=NoteGroupAddResponse)
def add_note_group(req: NoteGroupCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_note_group(req)

def add_note_group_impl(req: NoteGroupCreateRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        created = vault.create_note_group(req.group_name, req.parent_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"group": created, "groups": vault.list_note_groups()}



@app.post("/note-groups/rename", response_model=NoteGroupRenameResponse)
def rename_note_group(req: NoteGroupRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_note_group(req)

def rename_note_group_impl(req: NoteGroupRenameRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        renamed = vault.rename_note_group(req.group_key, req.new_name, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "group": renamed,
        "groups": vault.list_note_groups(),
        "counts": _counts(indexer),
        "graphStatus": _rebuild_graph_projection(vault),
        "linkRewrite": vault.consume_last_link_rewrite_result(),
    }



@app.post("/note-groups/delete", response_model=NoteGroupDeleteResponse)
def delete_note_group(req: NoteGroupDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_note_group(req)

def delete_note_group_impl(req: NoteGroupDeleteRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        vault.delete_note_group(req.group_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "deleted": True,
        "groups": vault.list_note_groups(),
        "counts": _counts(indexer),
        "graphStatus": _rebuild_graph_projection(vault),
        "linkRewrite": vault.consume_last_link_rewrite_result(),
    }



@app.post("/note-groups/move", response_model=NoteGroupMoveResponse)
def move_note_group(req: NoteGroupMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_note_group(req)

def move_note_group_impl(req: NoteGroupMoveRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        moved = vault.move_note_group(req.group_key, req.target_parent_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "group": moved,
        "groups": vault.list_note_groups(),
        "counts": _counts(indexer),
        "graphStatus": _rebuild_graph_projection(vault),
        "linkRewrite": vault.consume_last_link_rewrite_result(),
    }



@app.post("/note-groups/favorite", response_model=NoteFavoritesResponse)
def favorite_note_group(req: FavoriteFolderRequest)-> dict[str, Any]:
    return backend_api_service.favorite_note_group(req)

def favorite_note_group_impl(req: FavoriteFolderRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        favorites = vault.add_favorite_folder(req.group_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"favorites": favorites, "groups": vault.list_note_groups()}



@app.post("/note-groups/unfavorite", response_model=NoteFavoritesResponse)
def unfavorite_note_group(req: FavoriteFolderRequest)-> dict[str, Any]:
    return backend_api_service.unfavorite_note_group(req)

def unfavorite_note_group_impl(req: FavoriteFolderRequest)-> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        favorites = vault.remove_favorite_folder(req.group_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"favorites": favorites, "groups": vault.list_note_groups()}



@app.post("/note-groups/add-note", response_model=NoteAddResponse)
def add_note(req: NoteCreateRequest)-> dict[str, Any]:
    return backend_api_service.add_note(req)

def add_note_impl(req: NoteCreateRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        created = vault.create_note_in_group(
            group_key=req.group_key,
            title=req.title,
            indexer=indexer,
            note_type=req.note_type,
            status=req.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "noteId": created["note_id"],
        "notePath": str(created["note_path"]),
        "title": str(created.get("title", "")),
        "noteType": req.note_type,
        "groups": vault.list_note_groups(),
        "counts": _counts(indexer),
        "graphStatus": _rebuild_graph_projection(vault),
    }



@app.post("/notes/rename", response_model=NoteMutationResponse)
def rename_note(req: NoteFileRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_note(req)

def rename_note_impl(req: NoteFileRenameRequest)-> dict[str, Any]:
    return backend_api_service.rename_note(req)



@app.post("/notes/delete", response_model=NoteMutationResponse)
def delete_note(req: NoteFileDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_note(req)

def delete_note_impl(req: NoteFileDeleteRequest)-> dict[str, Any]:
    return backend_api_service.delete_note(req)



@app.post("/notes/move", response_model=NoteMutationResponse)
def move_note(req: NoteFileMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_note(req)

def move_note_impl(req: NoteFileMoveRequest)-> dict[str, Any]:
    return backend_api_service.move_note(req)



@app.post("/notes/move-batch", response_model=NoteMutationResponse)
def move_notes_batch(req: NoteFileMoveBatchRequest)-> dict[str, Any]:
    return backend_api_service.move_notes_batch(req)

def move_notes_batch_impl(req: NoteFileMoveBatchRequest)-> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        moved_paths = vault.move_note_files(req.paths, req.target_group_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "movedPaths": moved_paths,
        "counts": _counts(indexer),
        "graphStatus": _rebuild_graph_projection(vault),
        "linkRewrite": vault.consume_last_link_rewrite_result(),
    }



@app.post("/notes/migrate-templates", response_model=TemplateMigrationResponse)
def migrate_note_templates()-> dict[str, Any]:
    return backend_api_service.migrate_note_templates()

def migrate_note_templates_impl()-> dict[str, Any]:
    return backend_api_service.migrate_note_templates()



@app.on_event("shutdown")
def on_shutdown() -> None:
    state.dispose_session()


def _require_loaded() -> tuple[VaultManager, VaultIndexer]:
    if not state.vault or not state.indexer:
        raise DomainError(
            "No NoteBase loaded",
            status_code=400,
            error_code="request.validation",
            operation="require_loaded",
        )
    return state.vault, state.indexer


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


def _tag_match_excluded_ranges(markdown: str) -> list[tuple[int, int]]:
    ranges = [(match.start(), match.end()) for match in re.finditer(r"\{tag:[^}\n]+\}", markdown)]
    if markdown.startswith("---"):
        end = markdown.find("\n---", 3)
        if end >= 0:
            ranges.append((0, min(len(markdown), end + 4)))
    for match in re.finditer(r"(^|\n)```.*?(?:\n```|$)", markdown, flags=re.DOTALL):
        ranges.append((match.start(), match.end()))
    return sorted(ranges)


def _tag_match_intersects(ranges: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start < range_end and end > range_start for range_start, range_end in ranges)


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


def _scan_tag_match_candidates(vault: VaultManager) -> list[dict[str, Any]]:
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
            for alias in _tag_match_aliases(group, tag):
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
        excluded_ranges = _tag_match_excluded_ranges(markdown)
        relative_path = note_file.resolve().relative_to(vault.vault_path.resolve()).as_posix()
        for row in tag_rows:
            inline_ref = f"{{tag:{row['groupId']}/{row['tagId']}}}"
            for match in row["pattern"].finditer(markdown):
                start, end = match.span()
                if _tag_match_intersects(excluded_ranges, start, end):
                    continue
                context = _tag_match_context(markdown, start, end)
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


def _apply_tag_match_candidates(vault: VaultManager, raw_matches: list[dict[str, Any]]) -> tuple[int, list[Path]]:
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
            if start < 0 or end > len(next_markdown) or _tag_match_intersects(occupied, start, end):
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


def _compute_capture(text: str, vault: VaultManager, indexer: VaultIndexer) -> list[TagSuggestion]:
    clean_text = text.strip()
    if not clean_text:
        return []

    known_tags = _known_tags_for_capture(vault, indexer)
    parsed = state.parser.parse(clean_text, known_tags)
    merged = parsed.merged_suggestions()

    if state.openai and state.openai.cfg.enabled:
        ai_suggestions = state.openai.suggest_tags(clean_text, known_tags)
        merged = _merge_suggestions(merged, ai_suggestions)

    return merged


def _known_tags_for_capture(vault: VaultManager, indexer: VaultIndexer) -> list[dict[str, Any]]:
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


def _merge_suggestions(base: list[TagSuggestion], extra: list[TagSuggestion]) -> list[TagSuggestion]:
    by_key = {item.key: item for item in base}
    for item in extra:
        current = by_key.get(item.key)
        if not current or item.confidence > current.confidence:
            by_key[item.key] = item
    return sorted(by_key.values(), key=lambda item: (-item.confidence, item.key))


def _tag_payload(item: TagSuggestion) -> dict[str, Any]:
    return {
        "key": item.key,
        "category": item.category,
        "slug": item.slug,
        "displayName": item.display_name,
        "confidence": round(item.confidence, 4),
        "source": item.source,
        "autoApply": item.auto_apply,
    }


def _task_payload(item: ParsedTask) -> dict[str, Any]:
    return {
        "title": item.title,
        "dueDate": item.due_date,
        "priority": item.priority,
        "status": item.status,
        "projectTag": item.project_tag,
        "tags": item.tags,
        "estimateMinutes": item.estimate_minutes,
        "completedAt": item.completed_at,
        "blockedByIds": item.blocked_by_ids,
        "waitingFor": item.waiting_for,
        "followUpDate": item.follow_up_date,
        "blockedReason": item.blocked_reason,
        "nextActionHint": item.next_action_hint,
    }


def _counts(indexer: VaultIndexer) -> dict[str, int]:
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



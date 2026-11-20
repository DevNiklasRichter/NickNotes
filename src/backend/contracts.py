from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from .nicknotes_backend.graph_index import GraphIndex as GraphIndexPayload


API_CONTRACT_VERSION = "2.0.0"

# Contract policy:
# Backend response models intentionally allow additional fields for forward-compatible
# local desktop updates. The stable top-level fields for critical responses are locked
# by src/backend/tests/test_contract_sync.py against the TypeScript contract file.
CONTRACT_EXTRA_POLICY = "allow_forward_compatible_extra_fields"

CONTRACT_SYNC_MODEL_MAP: dict[str, str] = {
    "VaultCounts": "VaultCounts",
    "HealthResponse": "HealthResponse",
    "BackendStateResponse": "BackendStateResponse",
    "BackendChangeEvent": "BackendChangeEvent",
    "VaultOpenResponse": "VaultOpenResponse",
    "ReindexResponse": "ReindexResponse",
    "NoteBaseOpenStartResponse": "NoteBaseOpenStartResponse",
    "OperationStatusResponse": "OperationStatusResponse",
    "VaultDeleteResponse": "VaultDeleteResponse",
    "SearchRowResponse": "SearchRow",
    "SearchResponse": "SearchResponse",
    "FocusMitResponse": "FocusMitResponse",
    "SuggestionResponse": "SuggestionResponse",
    "CapturePreviewResponse": "CapturePreviewResponse",
    "ParsedTaskResponse": "ParsedTaskResponse",
    "SaveCaptureResponse": "SaveCaptureResponse",
    "FocusMitSaveResponse": "FocusMitSaveResponse",
    "QuickCaptureFocusTodoResponse": "QuickCaptureFocusTodoResponse",
    "DailyOpenResponse": "DailyOpenResponse",
    "TaskRowResponse": "TaskRow",
    "TaskListResponse": "TaskListResponse",
    "TodoRowResponse": "TodoRow",
    "TodoListResponse": "TodoListResponse",
    "TodoToggleResponse": "TodoToggleResponse",
    "TodoPromoteResponse": "TodoPromoteResponse",
    "TaskDoneResponse": "TaskDoneResponse",
    "TaskFollowUpResponse": "TaskFollowUpResponse",
    "FocusDashboardAggregateResponse": "FocusDashboardAggregateResponse",
    "GraphIndexResponse": "GraphIndexResponse",
    "GraphIndexStatusResponse": "GraphIndexStatusResponse",
    "GraphIndexRebuildResponse": "GraphIndexRebuildResponse",
    "GraphStateResponse": "GraphStateResponse",
    "NoteContentResponse": "NoteContentResponse",
    "NoteSaveResponse": "NoteSaveResponse",
    "NoteMediaResponse": "NoteMediaResponse",
    "ReviewDashboardResponse": "ReviewDashboardResponse",
    "UiSettingsResponse": "UiSettingsResponse",
    "TagGroupsResponse": "TagGroupsResponse",
    "NoteGroupsResponse": "NoteGroupsResponse",
    "TagOverviewResponse": "TagOverviewResponse",
    "TagMatchCandidateResponse": "TagMatchCandidate",
    "TagMatchCandidatesResponse": "TagMatchCandidatesResponse",
    "GroupMutationResponse": "GroupMutationResponse",
    "NoteGroupAddResponse": "NoteGroupAddResponse",
    "NoteGroupRenameResponse": "NoteGroupRenameResponse",
    "NoteGroupDeleteResponse": "NoteGroupDeleteResponse",
    "NoteGroupMoveResponse": "NoteGroupMoveResponse",
    "NoteFavoritesResponse": "NoteFavoritesResponse",
    "NoteMutationResponse": "NoteMutationResponse",
    "OneNoteImportPreviewResponse": "OneNoteImportPreviewResponse",
    "OneNoteImportResponse": "OneNoteImportResponse",
    "OneNoteImportStatusResponse": "OneNoteImportStatusResponse",
    "NoteAddResponse": "NoteAddResponse",
    "ErrorPayload": "ErrorPayload",
    "ErrorResponse": "ErrorResponse",
}


class _ContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class VaultCounts(_ContractModel):
    notes: int = 0
    openTasks: int = 0
    doneTasks: int = 0


class HealthResponse(_ContractModel):
    ok: bool = True
    vaultLoaded: bool = False
    capabilities: dict[str, str] = Field(default_factory=dict)


class BackendChangeEvent(_ContractModel):
    version: int = 0
    operation: str = ""
    paths: list[str] = Field(default_factory=list)
    truncated: bool = False


class BackendStateResponse(_ContractModel):
    vaultLoaded: bool = False
    vaultPath: str | None = None
    noteBasePath: str | None = None
    counts: VaultCounts | None = None
    sessionId: str = ""
    changeVersion: int = 0
    pendingRecovery: list[str] = Field(default_factory=list)
    lastChange: BackendChangeEvent = Field(default_factory=BackendChangeEvent)


class VaultOpenResponse(_ContractModel):
    vaultPath: str = ""
    noteBasePath: str = ""
    indexed: dict[str, Any] = Field(default_factory=dict)
    mode: str = ""
    tagGroups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)


class ReindexResponse(_ContractModel):
    indexed: dict[str, Any] = Field(default_factory=dict)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    tagGroups: list[dict[str, Any]] = Field(default_factory=list)
    graphStatus: dict[str, Any] = Field(default_factory=dict)


class NoteBaseOpenStartResponse(_ContractModel):
    started: bool = True
    path: str = ""


class OperationStatusResponse(_ContractModel):
    active: bool = False
    done: bool = False
    error: str | None = None
    errorCode: str | None = None
    errorDetails: dict[str, Any] | None = None
    phase: str = ""
    processed: int = 0
    total: int = 0
    currentPath: str | None = None
    result: dict[str, Any] | None = None
    startedAt: float = 0.0
    finishedAt: float | None = None


class VaultDeleteResponse(_ContractModel):
    deleted: bool = False
    deletedPath: str = ""
    vaultLoaded: bool = False


class SearchRowResponse(_ContractModel):
    id: str = ""
    title: str = ""
    note_type: str = "note"
    updated_at: str = ""
    path: str = ""


class SearchResponse(_ContractModel):
    items: list[SearchRowResponse] = Field(default_factory=list)






























class FocusMitResponse(_ContractModel):
    date: str = ""
    notePath: str = ""
    mitIds: list[str] = Field(default_factory=list)


class SuggestionResponse(_ContractModel):
    key: str = ""
    category: str = ""
    slug: str = ""
    displayName: str = ""
    confidence: float = 0.0
    source: str = ""
    autoApply: bool = False


class CapturePreviewResponse(_ContractModel):
    suggestions: list[SuggestionResponse] = Field(default_factory=list)
    stats: dict[str, int] = Field(default_factory=dict)


class ParsedTaskResponse(_ContractModel):
    title: str = ""
    dueDate: str | None = None
    priority: str = ""
    status: str = ""
    projectTag: str | None = None
    tags: list[str] = Field(default_factory=list)
    estimateMinutes: int | None = None
    completedAt: str | None = None
    blockedByIds: list[str] = Field(default_factory=list)
    waitingFor: str | None = None
    followUpDate: str | None = None
    blockedReason: str | None = None
    nextActionHint: str | None = None


class CapturedTask(_ContractModel):
    taskId: str
    taskPath: str
    dueDate: str


class SaveCaptureResponse(_ContractModel):
    saved: bool = True
    noteId: str = ""
    date: str = ""
    notePath: str = ""
    tasks: list[CapturedTask] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)


class FocusMitSaveResponse(_ContractModel):
    saved: bool = True
    date: str = ""
    notePath: str = ""
    mitIds: list[str] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)


class QuickCaptureFocusTodoResponse(_ContractModel):
    saved: bool = True
    date: str = ""
    notePath: str = ""
    todoText: str = ""
    counts: VaultCounts = Field(default_factory=VaultCounts)


class FocusThoughtResponse(_ContractModel):
    saved: bool = True
    target: str = "daily"
    notePath: str = ""
    counts: VaultCounts = Field(default_factory=VaultCounts)


class FocusSessionLogResponse(_ContractModel):
    saved: bool = True
    date: str = ""
    notePath: str = ""
    line: str = ""
    counts: VaultCounts = Field(default_factory=VaultCounts)


class DailyOpenResponse(_ContractModel):
    date: str = ""
    notePath: str = ""
    title: str = ""
    created: bool = False
    counts: VaultCounts = Field(default_factory=VaultCounts)


class TaskRowResponse(_ContractModel):
    id: str = ""
    title: str = ""
    status: str = ""
    priority: str = ""
    due_date: str | None = None
    project_tag: str | None = None
    estimate_minutes: int | None = None
    completed_at: str | None = None
    blocked_by_ids: list[str] = Field(default_factory=list)
    waiting_for: str | None = None
    follow_up_date: str | None = None
    blocked_reason: str | None = None
    next_action_hint: str | None = None
    tags: list[str] = Field(default_factory=list)
    related: list[str] = Field(default_factory=list)
    updated_at: str = ""
    path: str | None = None


class TaskListResponse(_ContractModel):
    items: list[TaskRowResponse] = Field(default_factory=list)


class TodoRowResponse(_ContractModel):
    id: str = ""
    note_id: str = ""
    note_title: str = ""
    note_path: str = ""
    line_no: int = 0
    block_ref: str | None = None
    checked: bool = False
    raw_text: str = ""
    explicit_tags: list[str] = Field(default_factory=list)
    inherited_tags: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    promoted: bool = False
    promoted_task_id: str | None = None
    created_at: str | None = None
    completed_at: str | None = None
    updated_at: str = ""


class TodoListResponse(_ContractModel):
    items: list[TodoRowResponse] = Field(default_factory=list)


class TodoToggleResponse(_ContractModel):
    todo: dict[str, Any] | None = None
    notePath: str | None = None


class TodoPromoteResponse(_ContractModel):
    todo: dict[str, Any] | None = None
    taskId: str | None = None
    taskPath: str | None = None
    created: bool = False


class TaskDoneResponse(_ContractModel):
    done: bool = True
    taskId: str = ""
    taskPath: str = ""


class TaskFollowUpResponse(_ContractModel):
    taskId: str = ""
    taskPath: str = ""
    followUpDate: str | None = None
    counts: VaultCounts = Field(default_factory=VaultCounts)


class FocusDashboardAggregateResponse(_ContractModel):
    date: str = ""
    tasks: list[TaskRowResponse] = Field(default_factory=list)
    todos: list[TodoRowResponse] = Field(default_factory=list)
    notes: list[SearchRowResponse] = Field(default_factory=list)
    mitIds: list[str] = Field(default_factory=list)
    mitNotePath: str = ""
    focusMinutes: int = 0
    counts: VaultCounts = Field(default_factory=VaultCounts)


class GraphIndexResponse(_ContractModel):
    index: GraphIndexPayload = Field(default_factory=GraphIndexPayload.empty)


class GraphIndexStatusResponse(_ContractModel):
    available: bool = False
    updated_at: str | None = None
    node_count: int = 0
    edge_count: int = 0
    diagnostic_count: int = 0
    is_updating: bool = False
    last_error: str | None = None
    watcher_enabled: bool = False
    last_external_update: str | None = None


class GraphIndexRebuildResponse(_ContractModel):
    index: GraphIndexPayload = Field(default_factory=GraphIndexPayload.empty)
    status: GraphIndexStatusResponse = Field(default_factory=GraphIndexStatusResponse)


class GraphStateResponse(_ContractModel):
    state: dict[str, Any] = Field(default_factory=dict)


class NoteContentResponse(_ContractModel):
    path: str = ""
    content: str = ""
    revision: str = ""


class LinkRewriteResponse(_ContractModel):
    updated: int = 0
    paths: list[str] = Field(default_factory=list)


class NoteSaveResponse(_ContractModel):
    saved: bool = True
    path: str
    title: str
    content: str
    revision: str
    counts: VaultCounts
    tagGroups: list[dict[str, Any]] | None = None
    tagGroupsRebuilt: bool = False
    graphStatus: GraphIndexStatusResponse = Field(default_factory=GraphIndexStatusResponse)
    linkRewrite: LinkRewriteResponse = Field(default_factory=LinkRewriteResponse)


class NoteMediaResponse(_ContractModel):
    mediaPath: str = ""
    markdownPath: str = ""
    fileName: str = ""


class ReviewDashboardResponse(_ContractModel):
    period: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, int] = Field(default_factory=dict)
    series: list[dict[str, Any]] = Field(default_factory=list)
    attention: dict[str, dict[str, Any]] = Field(default_factory=dict)
    completed_total: int = 0
    completed_items: list[dict[str, Any]] = Field(default_factory=list)
    stale_todo_days: int = 30


class UiSettingsResponse(_ContractModel):
    settings: dict[str, Any] = Field(default_factory=dict)


class TagGroupsResponse(_ContractModel):
    groups: list[dict[str, Any]] = Field(default_factory=list)


class NoteGroupsResponse(_ContractModel):
    groups: list[dict[str, Any]] = Field(default_factory=list)


class TagOverviewResponse(_ContractModel):
    path: str = ""
    title: str = ""


class TagMatchCandidateResponse(_ContractModel):
    id: str = ""
    path: str = ""
    relativePath: str = ""
    start: int = 0
    end: int = 0
    line: int = 1
    lineOffset: int = 0
    matchedText: str = ""
    alias: str = ""
    replacement: str = ""
    groupId: str = ""
    groupDisplayName: str = ""
    groupColor: str = ""
    tagId: str = ""
    tagDisplayName: str = ""
    before: str = ""
    after: str = ""


class TagMatchCandidatesResponse(_ContractModel):
    items: list[TagMatchCandidateResponse] = Field(default_factory=list)
    total: int = 0


class GroupMutationResponse(_ContractModel):
    groups: list[dict[str, Any]] = Field(default_factory=list)
    notesUpdated: int = 0
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    linkRewrite: dict[str, Any] = Field(default_factory=dict)


class NoteGroupAddResponse(_ContractModel):
    group: dict[str, Any] = Field(default_factory=dict)
    groups: list[dict[str, Any]] = Field(default_factory=list)


class NoteGroupRenameResponse(_ContractModel):
    group: dict[str, Any] = Field(default_factory=dict)
    groups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    linkRewrite: dict[str, Any] = Field(default_factory=dict)


class NoteGroupDeleteResponse(_ContractModel):
    deleted: bool = False
    groups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    linkRewrite: dict[str, Any] = Field(default_factory=dict)


class NoteGroupMoveResponse(_ContractModel):
    group: dict[str, Any] = Field(default_factory=dict)
    groups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    linkRewrite: dict[str, Any] = Field(default_factory=dict)


class NoteFavoritesResponse(_ContractModel):
    favorites: list[str] = Field(default_factory=list)
    groups: list[dict[str, Any]] = Field(default_factory=list)


class NoteMutationResponse(_ContractModel):
    noteId: str = ""
    notePath: str = ""
    title: str = ""
    noteType: str = ""
    groups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    linkRewrite: dict[str, Any] = Field(default_factory=dict)
    renamedPath: str = ""
    movedPath: str = ""
    movedPaths: list[str] = Field(default_factory=list)
    deleted: bool = False
    deletedPath: str = ""


class OneNoteImportPreviewResponse(_ContractModel):
    notebooks: int = 0
    sections: int = 0
    pages: int = 0
    mediaCandidates: int = 0
    unsupportedFiles: int = 0
    warnings: list[str] = Field(default_factory=list)
    pagesPreview: list[dict[str, Any]] = Field(default_factory=list)


class OneNoteImportResponse(_ContractModel):
    counts: VaultCounts = Field(default_factory=VaultCounts)
    tagGroups: list[dict[str, Any]] = Field(default_factory=list)
    groups: list[dict[str, Any]] = Field(default_factory=list)
    graphStatus: dict[str, Any] = Field(default_factory=dict)
    import_data: dict[str, Any] = Field(default_factory=dict, alias="import")
    indexed: dict[str, Any] = Field(default_factory=dict)


class OneNoteImportStatusResponse(OperationStatusResponse):
    pass


class NoteAddResponse(_ContractModel):
    noteId: str = ""
    notePath: str = ""
    title: str = ""
    noteType: str = ""
    groups: list[dict[str, Any]] = Field(default_factory=list)
    counts: VaultCounts = Field(default_factory=VaultCounts)
    graphStatus: dict[str, Any] = Field(default_factory=dict)


class ErrorPayload(_ContractModel):
    code: str = "service.unexpected"
    message: str = "Ein unerwarteter Fehler ist aufgetreten."
    details: dict[str, Any] | None = None
    operationId: str | None = None
    vaultId: str | None = None
    traceId: str | None = None


class ErrorResponse(_ContractModel):
    ok: bool = False
    status: int = 500
    error: ErrorPayload = Field(default_factory=ErrorPayload)
    timestamp: str = ""

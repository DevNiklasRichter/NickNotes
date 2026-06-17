export const API_CONTRACT_VERSION = '1.0.0' as const

// Keep this list aligned with CONTRACT_SYNC_MODEL_MAP in src/backend/contracts.py.
// A Python contract-sync test compares the stable top-level fields for these
// response shapes. Record<string, any> fields remain intentional extension points.
export const CONTRACT_SYNC_TYPES = [
  'VaultCounts',
  'HealthResponse',
  'BackendStateResponse',
  'VaultOpenResponse',
  'ReindexResponse',
  'NoteBaseOpenStartResponse',
  'OperationStatusResponse',
  'VaultDeleteResponse',
  'SearchRow',
  'SearchResponse',
  'FocusMitResponse',
  'SuggestionResponse',
  'CapturePreviewResponse',
  'ParsedTaskResponse',
  'SaveCaptureResponse',
  'FocusMitSaveResponse',
  'QuickCaptureFocusTodoResponse',
  'DailyOpenResponse',
  'TaskRow',
  'TaskListResponse',
  'TodoRow',
  'TodoListResponse',
  'TodoToggleResponse',
  'TodoPromoteResponse',
  'TaskDoneResponse',
  'FocusDashboardAggregateStats',
  'FocusDashboardAggregateResponse',
  'GraphIndexResponse',
  'GraphIndexStatusResponse',
  'GraphIndexRebuildResponse',
  'GraphStateResponse',
  'NoteContentResponse',
  'NoteMediaResponse',
  'OpenNoteResponse',
  'ReviewResponse',
  'ReviewDashboardResponse',
  'UiSettingsResponse',
  'TagGroupsResponse',
  'NoteGroupsResponse',
  'TagOverviewResponse',
  'TagMatchCandidate',
  'TagMatchCandidatesResponse',
  'GroupMutationResponse',
  'NoteGroupAddResponse',
  'NoteGroupRenameResponse',
  'NoteGroupDeleteResponse',
  'NoteGroupMoveResponse',
  'NoteFavoritesResponse',
  'NoteMutationResponse',
  'OneNoteImportPreviewResponse',
  'OneNoteImportResponse',
  'OneNoteImportStatusResponse',
  'NoteAddResponse',
  'TemplateMigrationResponse',
  'ErrorPayload',
  'ErrorResponse',
] as const

export type VaultCounts = {
  notes: number
  openTasks: number
  doneTasks: number
}

export type HealthResponse = {
  ok: boolean
  vaultLoaded: boolean
  capabilities: Record<string, string>
}

export type BackendStateResponse = {
  vaultLoaded: boolean
  vaultPath?: string
  noteBasePath?: string
  counts?: VaultCounts
}
export type BackendState = BackendStateResponse

export type VaultOpenResponse = {
  vaultPath: string
  noteBasePath: string
  indexed: Record<string, any>
  mode: string
  tagGroups: Array<Record<string, any>>
  counts: VaultCounts
  graphStatus: Record<string, any>
}

export type ReindexResponse = {
  indexed: Record<string, any>
  counts: VaultCounts
  tagGroups: Array<Record<string, any>>
  graphStatus: Record<string, any>
}

export type NoteBaseOpenStartResponse = {
  started: boolean
  path: string
}

export type OperationStatusResponse = {
  active: boolean
  done: boolean
  error: string | null
  errorCode?: string | null
  errorDetails?: Record<string, any> | null
  phase: string
  processed: number
  total: number
  currentPath: string | null
  result?: Record<string, any> | null
  startedAt: number
  finishedAt: number | null
}

export type VaultDeleteResponse = {
  deleted: boolean
  deletedPath: string
  vaultLoaded: boolean
}

export type NoteContentResponse = {
  path: string
  content: string
}

export type OpenNoteResponse = {
  opened: boolean
  path: string
}

export type SuggestionResponse = {
  key: string
  category: string
  slug: string
  displayName: string
  confidence: number
  source: string
  autoApply: boolean
}

export type Suggestion = SuggestionResponse

export type ParsedTaskResponse = {
  title: string
  dueDate: string | null
  priority: string
  status: string
  projectTag: string | null
  tags: string[]
  estimateMinutes: number | null
  completedAt: string | null
  blockedByIds: string[]
  waitingFor: string | null
  followUpDate: string | null
  blockedReason: string | null
  nextActionHint: string | null
}

export type CapturePreviewResponse = {
  suggestions: SuggestionResponse[]
  stats: Record<string, number>
}

export type SaveCaptureResponse = {
  saved: boolean
  noteId: string
  date: string
  notePath: string
  counts: VaultCounts
}

export type FocusMitResponse = {
  date: string
  notePath: string
  mitIds: string[]
}

export type FocusMitSaveResponse = {
  saved: boolean
  date: string
  notePath: string
  mitIds: string[]
  counts: VaultCounts
}

export type QuickCaptureFocusTodoResponse = {
  saved: boolean
  date: string
  notePath: string
  todoText: string
  counts: VaultCounts
}

export type DailyOpenResponse = {
  date: string
  notePath: string
  title: string
  created: boolean
  counts: VaultCounts
}

export type FocusDashboardAggregateStats = {
  overdueCount: number
  blockedCount: number
  waitingCount: number
  doneToday: number
  doneTodayTasks: number
  doneTodayTodos: number
  openTasksWithoutEstimateCount: number
  waitingWithoutFollowUpCount: number
  unknownBlockerTaskCount: number
  unknownBlockerReferenceCount: number
}

export type FocusDashboardAggregateResponse = {
  date: string
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  mitIds: string[]
  mitNotePath: string
  stats: FocusDashboardAggregateStats
  counts: VaultCounts
}

export type GraphIndexResponse = {
  index: Record<string, any>
}

export type GraphIndexStatusResponse = {
  available: boolean
  updated_at: string | null
  node_count: number
  edge_count: number
  diagnostic_count: number
  is_updating: boolean
  last_error: string | null
  watcher_enabled: boolean
  last_external_update: string | null
}
export type GraphIndexStatus = GraphIndexStatusResponse

export type GraphIndexRebuildResponse = {
  index: Record<string, any>
  status: GraphIndexStatusResponse
}

export type GraphStateResponse = {
  state: Record<string, any>
}

export type SearchRow = {
  id: string
  title: string
  note_type: string
  updated_at: string
  path: string
}

export type SearchResponse = {
  items: SearchRow[]
}

export type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_tag: string | null
  estimate_minutes: number | null
  completed_at: string | null
  blocked_by_ids: string[]
  waiting_for: string | null
  follow_up_date: string | null
  blocked_reason: string | null
  next_action_hint: string | null
  tags: string[]
  related: string[]
  updated_at: string
  path: string | null
}

export type TaskListResponse = {
  items: TaskRow[]
}

export type TodoRow = {
  id: string
  note_id: string
  note_title: string
  note_path: string
  line_no: number
  block_ref: string | null
  checked: boolean
  raw_text: string
  explicit_tags: string[]
  inherited_tags: string[]
  links: string[]
  promoted: boolean
  promoted_task_id: string | null
  created_at: string | null
  completed_at: string | null
  updated_at: string
}

export type TodoListResponse = {
  items: TodoRow[]
}

export type TodoToggleResponse = {
  todo: Record<string, any> | null
  notePath: string | null
}

export type TodoPromoteResponse = {
  todo: Record<string, any> | null
  taskId: string | null
  taskPath: string | null
  created: boolean
}

export type TaskDoneResponse = {
  done: boolean
  taskId: string
}

export type NoteMediaResponse = {
  mediaPath: string
  markdownPath: string
  fileName: string
}

export type ReviewResponse = {
  daily: Record<string, any>
  weekly: Record<string, any>
}

export type ReviewDashboardResponse = {
  period: Record<string, any>
  kpis: Record<string, any>
  risk: Record<string, any>
  series: Array<Record<string, any>>
  top_notes: Array<Record<string, any>>
  top_tasks: Array<Record<string, any>>
  completed_items: Array<Record<string, any>>
}

export type UiSettingsResponse = {
  settings: Record<string, any>
}

export type TagGroupsResponse = {
  groups: Record<string, any>[]
}

export type TagOverviewResponse = {
  path: string
  title: string
}

export type TagMatchCandidate = {
  id: string
  path: string
  relativePath: string
  start: number
  end: number
  line: number
  lineOffset: number
  matchedText: string
  alias: string
  replacement: string
  groupId: string
  groupDisplayName: string
  groupColor: string
  tagId: string
  tagDisplayName: string
  before: string
  after: string
}

export type TagMatchCandidatesResponse = {
  items: TagMatchCandidate[]
  total: number
}

export type GroupMutationResponse = {
  groups: Record<string, any>[]
  notesUpdated: number
  counts: VaultCounts
  graphStatus: Record<string, any>
  linkRewrite: Record<string, any>
}

export type NoteGroupsResponse = {
  groups: Record<string, any>[]
}

export type NoteGroupAddResponse = {
  group: Record<string, any>
  groups: Record<string, any>[]
}

export type NoteGroupRenameResponse = {
  group: Record<string, any>
  groups: Record<string, any>[]
  counts: VaultCounts
  graphStatus: Record<string, any>
  linkRewrite: Record<string, any>
}

export type NoteGroupDeleteResponse = {
  deleted: boolean
  groups: Record<string, any>[]
  counts: VaultCounts
  graphStatus: Record<string, any>
  linkRewrite: Record<string, any>
}

export type NoteGroupMoveResponse = {
  group: Record<string, any>
  groups: Record<string, any>[]
  counts: VaultCounts
  graphStatus: Record<string, any>
  linkRewrite: Record<string, any>
}

export type NoteFavoritesResponse = {
  favorites: string[]
  groups: Record<string, any>[]
}

export type NoteAddResponse = {
  noteId: string
  notePath: string
  title: string
  noteType: string
  groups: Record<string, any>[]
  counts: VaultCounts
  graphStatus: Record<string, any>
}

export type NoteMutationResponse = {
  noteId: string
  notePath: string
  title: string
  noteType: string
  groups: Record<string, any>[]
  counts: VaultCounts
  graphStatus: Record<string, any>
  linkRewrite: Record<string, any>
  renamedPath: string
  movedPath: string
  movedPaths: string[]
  deleted: boolean
  deletedPath: string
}

export type TemplateMigrationResponse = {
  updated: number
  paths: string[]
  counts: VaultCounts
  tagGroups: Record<string, any>[]
  graphStatus: Record<string, any>
}

export type OneNoteImportPreviewResponse = {
  notebooks: number
  sections: number
  pages: number
  mediaCandidates: number
  unsupportedFiles: number
  warnings: string[]
  pagesPreview: Array<Record<string, any>>
}

export type OneNoteImportResponse = {
  counts: VaultCounts
  tagGroups: Record<string, any>[]
  groups: Record<string, any>[]
  graphStatus: Record<string, any>
  import: Record<string, any>
  indexed: Record<string, any>
}

export type OneNoteImportStatusResponse = OperationStatusResponse

export type ErrorPayload = {
  code: string
  message: string
  details: Record<string, any> | null
  operationId: string | null
  vaultId: string | null
  traceId: string | null
}

export type ErrorResponse = {
  ok: boolean
  status: number
  error: ErrorPayload
  timestamp: string
}

import type { ParsedNoteDocument, TaskPriority, TaskStatus } from '../editor/noteDocument'
import type { ExplorerOptions, ExplorerViewState } from '../explorer/types'
import { normalizeTagGroups, normalizeTagId, type TagGroupDefinition } from '../tags/tagTypes'


export type VaultCounts = {
  notes: number
  openTasks: number
  doneTasks: number
}

export type Suggestion = {
  key: string
  category: string
  slug: string
  displayName: string
  confidence: number
  source: string
  autoApply: boolean
}

export type ParsedTask = {
  title: string
  dueDate: string | null
  priority: string
  status: string
  projectTag: string | null
  tags: string[]
  estimateMinutes?: number | null
  blockedByIds?: string[]
  waitingFor?: string | null
  followUpDate?: string | null
  blockedReason?: string | null
  nextActionHint?: string | null
}

export type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_tag: string | null
  estimate_minutes?: number | null
  blocked_by_ids?: string[]
  waiting_for?: string | null
  follow_up_date?: string | null
  blocked_reason?: string | null
  next_action_hint?: string | null
  tags?: string[]
  related?: string[]
  updated_at: string
  path: string | null
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
  updated_at: string
}

export type TodoGroupingMode = 'note' | 'tag' | 'tag_group' | 'updated_at'

export type TodoStatusFilterValue = 'open' | 'done'
export type TodoPromotionFilterValue = 'promoted' | 'unpromoted'

export type TodoDashboardFilters = {
  query: string
  statuses: TodoStatusFilterValue[]
  tags: string[]
  tagGroups: string[]
  promotions: TodoPromotionFilterValue[]
  grouping: TodoGroupingMode
}

export type TaskDueBucket = 'overdue' | 'tomorrow' | 'this_week' | 'later' | 'none'
export type TaskDashboardGroupingMode = 'status' | 'priority' | 'due_date'
export type TaskDashboardLayoutMode = 'board' | 'list'
export type TaskListSortField = 'default' | 'priority' | 'due_date'
export type TaskListSortDirection = 'asc' | 'desc'

export type TaskDashboardFilters = {
  query: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  dueBuckets: TaskDueBucket[]
  tagGroups: string[]
  tags: string[]
  related: string[]
  grouping: TaskDashboardGroupingMode
  layout: TaskDashboardLayoutMode
  listSortBy: TaskListSortField
  listSortDirection: TaskListSortDirection
}

export type FocusDashboardSection = 'tasks' | 'todos' | 'notes'
export type FocusDashboardScope = 'overdue' | 'today' | 'tomorrow' | 'week' | 'next7' | 'all'

export type FocusDashboardFilters = {
  query: string
  sections: FocusDashboardSection[]
  scope: FocusDashboardScope
  maxItems: number
}

export type SearchRow = {
  id: string
  title: string
  note_type: string
  updated_at: string
  path: string
}

export type MediaUploadResponse = {
  mediaPath: string
  markdownPath: string
  fileName: string
}

export type ReviewDaily = {
  date: string
  new_notes: number
  open_tasks: number
  done_today: number
}

export type ReviewWeekly = {
  from: string
  to: string
  notes_total: number
  tasks_open: number
  tasks_done: number
}

export type BackendState = {
  vaultLoaded: boolean
  vaultPath?: string
  noteBasePath?: string
  counts?: VaultCounts
}

export type ThemeMode = 'light' | 'dark'
export type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review'
export type NoteTabKind = 'note' | 'settings' | 'todo_dashboard' | 'task_dashboard' | 'focus_dashboard'

export type NoteTab = {
  id: string
  kind: NoteTabKind
  path: string
  title: string
  content: string
  loading: boolean
  dirty: boolean
  noteType?: 'note' | 'task'
  parsedDocument?: ParsedNoteDocument
}

export type EditorTabContextMenuState = {
  x: number
  y: number
  tabId: string
} | null

export const LAST_NOTEBASE_STORAGE_KEY = 'nicknotes-last-notebase-path'
export const SETTINGS_TAB_PATH = '__nicknotes_settings__'
export const TODO_DASHBOARD_TAB_PATH = '__nicknotes_todo_dashboard__'
export const TASK_DASHBOARD_TAB_PATH = '__nicknotes_task_dashboard__'
export const FOCUS_DASHBOARD_TAB_PATH = '__nicknotes_focus_dashboard__'

export const DEFAULT_TODO_DASHBOARD_FILTERS: TodoDashboardFilters = {
  query: '',
  statuses: ['open'],
  tags: [],
  tagGroups: [],
  promotions: ['promoted', 'unpromoted'],
  grouping: 'tag',
}

export const DEFAULT_TASK_DASHBOARD_FILTERS: TaskDashboardFilters = {
  query: '',
  statuses: [],
  priorities: [],
  dueBuckets: [],
  tagGroups: [],
  tags: [],
  related: [],
  grouping: 'status',
  layout: 'board',
  listSortBy: 'default',
  listSortDirection: 'desc',
}

export const DEFAULT_FOCUS_DASHBOARD_FILTERS: FocusDashboardFilters = {
  query: '',
  sections: [],
  scope: 'today',
  maxItems: 12,
}

export type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

export const DEFAULT_STATUS_BAR_PREFS: StatusBarPrefs = {
  showNoteBaseName: true,
  showOpenTasks: true,
  showDueToday: false,
  showTotalNotes: false,
  showStateMessage: true,
}

export const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
  showHiddenFiles: false,
  showFileExtensions: true,
  sortMode: 'manual',
  sortDirection: 'asc',
  foldersFirst: true,
  showIcons: true,
  compactMode: true,
}

export const DEFAULT_EXPLORER_VIEW_STATE: ExplorerViewState = {
  expandedNodes: {},
  selectedNodeId: null,
  filterQuery: '',
  folderOrder: {},
  iconOverrides: { folders: {}, files: {} },
}

export const TAG_COLOR_PRESETS = [
  '#4f8cff',
  '#2fba7a',
  '#ff8a4f',
  '#d26cf5',
  '#ff5a6f',
  '#6c7dff',
  '#f0a202',
  '#2ec4b6',
  '#94a3b8',
  '#f43f5e',
]

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'new_topic', label: 'New Topic' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'done', label: 'Done' },
]
export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  new_topic: '#4f8cff',
  open: '#cf5d5d',
  in_progress: '#d3a33a',
  on_hold: '#8a8da1',
  done: '#43a36f',
}
export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#59a477',
  medium: '#cea73d',
  high: '#cf5d5d',
}
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new_topic: 'New Topic',
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Done',
}
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export type UiSettingsPayload = {
  updated_at?: string
  app?: Record<string, unknown>
  explorer?: Record<string, unknown>
}
export type NoteGroup = {
  key: string
  label: string
  path: string
  favorite: boolean
  canCreateNotes: boolean
  canCreateGroups?: boolean
  canDelete?: boolean
}

export function normalizeWikiLookup(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase()
}

export function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export async function apiRequest<T>(baseUrl: string, endpoint: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || `HTTP ${response.status}`)
  }

  return (await response.json()) as T
}

export function toGermanTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

export function getPathTail(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

export function toNoteDisplayName(path: string): string {
  return getFileName(path).replace(/\.md$/i, '')
}

export function normalizeFilePathKey(path: string): string {
  return path.replace(/\\/g, '/').trim().toLowerCase()
}

export function normalizeNoteTypeValue(raw: unknown): 'note' | 'task' {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'task'
    ? 'task'
    : 'note'
}

export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeTagCandidate(raw: string): string {
  const cleanRaw = normalizeLabel(raw).replace(/^\{tag:/i, '').replace(/\}$/g, '').replace(/^#+/, '')
  if (!cleanRaw) {
    return ''
  }
  const delimiter = cleanRaw.includes(':') ? ':' : cleanRaw.includes('/') ? '/' : ''
  if (delimiter) {
    const [groupRaw, tagRaw] = cleanRaw.split(delimiter, 2)
    const group = normalizeTagId(groupRaw)
    const tag = normalizeTagId(tagRaw)
    if (!group || !tag) {
      return ''
    }
    return `${group}:${tag}`
  }
  const topic = normalizeTagId(cleanRaw)
  return topic ? `topic:${topic}` : ''
}

export function normalizeRelatedCandidate(raw: string): string {
  let clean = normalizeLabel(raw)
  if (!clean) {
    return ''
  }
  if (clean.startsWith('[[') && clean.endsWith(']]')) {
    clean = clean.slice(2, -2).trim()
  }
  if (clean.includes('|')) {
    clean = clean.split('|', 1)[0]?.trim() || ''
  }
  if (clean.includes('#')) {
    clean = clean.split('#', 1)[0]?.trim() || ''
  }
  clean = clean.replace(/\\/g, '/').replace(/\.md$/i, '')
  return clean
}

export function deriveImageAltText(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  const label = normalizeLabel(base.replace(/[_-]+/g, ' '))
  return label || 'Image'
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const marker = 'base64,'
      const markerIndex = result.indexOf(marker)
      if (markerIndex < 0) {
        reject(new Error('Ungueltiges Bildformat.'))
        return
      }
      resolve(result.slice(markerIndex + marker.length))
    }
    reader.readAsDataURL(file)
  })
}

export function normalizeTaskStatusValue(raw: string): TaskStatus {
  const clean = raw.trim().toLowerCase().replace(/[- ]+/g, '_') as TaskStatus
  return TASK_STATUS_OPTIONS.some((entry) => entry.value === clean) ? clean : 'open'
}

export function taskStatusLabel(raw: string): string {
  return TASK_STATUS_LABELS[normalizeTaskStatusValue(raw)]
}

export function taskStatusClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-badge status-${normalized}`
}

export function taskStatusDotClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-dot status-${normalized}`
}

export function taskStatusOptionLabel(value: TaskStatus): string {
  return TASK_STATUS_LABELS[value]
}

export function normalizeTaskPriorityValue(raw: string): TaskPriority {
  const clean = raw.trim().toLowerCase()
  if (clean === 'h') {
    return 'high'
  }
  if (clean === 'l') {
    return 'low'
  }
  if (clean === 'm') {
    return 'medium'
  }
  return TASK_PRIORITY_OPTIONS.some((entry) => entry.value === (clean as TaskPriority)) ? (clean as TaskPriority) : 'medium'
}

export function taskPriorityLabel(raw: string): string {
  return TASK_PRIORITY_LABELS[normalizeTaskPriorityValue(raw)]
}

export function taskPriorityDotClassName(raw: string): string {
  return `priority-dot priority-${normalizeTaskPriorityValue(raw)}`
}

export function taskPriorityOptionLabel(value: TaskPriority): string {
  return TASK_PRIORITY_LABELS[value]
}

export function isPermanentPinnedRootGroupKey(groupKey: string): boolean {
  const clean = groupKey.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
  if (!clean || clean.includes('/')) {
    return false
  }
  const token = clean.toLowerCase().replace(/^\d+_/, '')
  return token === 'daily' || token === 'tags' || token === 'tasks'
}

export function toStorageTagGroups(value: unknown): TagGroupDefinition[] {
  return normalizeTagGroups(value)
}

export function getStoredLastNoteBasePath(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return normalizeLabel(window.localStorage.getItem(LAST_NOTEBASE_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

export function storeLastNoteBasePath(path: string): void {
  if (typeof window === 'undefined') {
    return
  }
  const cleanPath = normalizeLabel(path)
  if (!cleanPath) {
    return
  }
  try {
    window.localStorage.setItem(LAST_NOTEBASE_STORAGE_KEY, cleanPath)
  } catch {
    // Best effort.
  }
}

export function clearStoredLastNoteBasePath(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.removeItem(LAST_NOTEBASE_STORAGE_KEY)
  } catch {
    // Best effort.
  }
}

export function areStatusBarPrefsEqual(left: StatusBarPrefs, right: StatusBarPrefs): boolean {
  return (
    left.showNoteBaseName === right.showNoteBaseName &&
    left.showOpenTasks === right.showOpenTasks &&
    left.showDueToday === right.showDueToday &&
    left.showTotalNotes === right.showTotalNotes &&
    left.showStateMessage === right.showStateMessage
  )
}

export function areExplorerOptionsEqual(left: ExplorerOptions, right: ExplorerOptions): boolean {
  return (
    left.showHiddenFiles === right.showHiddenFiles &&
    left.showFileExtensions === right.showFileExtensions &&
    left.sortMode === right.sortMode &&
    left.sortDirection === right.sortDirection &&
    left.foldersFirst === right.foldersFirst &&
    left.showIcons === right.showIcons &&
    left.compactMode === right.compactMode
  )
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function toThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === 'light' || value === 'dark' ? value : fallback
}

export function toStatusBarPrefsFromSettings(value: unknown): StatusBarPrefs {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_STATUS_BAR_PREFS }
  }
  const source = value as Partial<StatusBarPrefs>
  return {
    showNoteBaseName: source.showNoteBaseName ?? DEFAULT_STATUS_BAR_PREFS.showNoteBaseName,
    showOpenTasks: source.showOpenTasks ?? DEFAULT_STATUS_BAR_PREFS.showOpenTasks,
    showDueToday: source.showDueToday ?? DEFAULT_STATUS_BAR_PREFS.showDueToday,
    showTotalNotes: source.showTotalNotes ?? DEFAULT_STATUS_BAR_PREFS.showTotalNotes,
    showStateMessage: source.showStateMessage ?? DEFAULT_STATUS_BAR_PREFS.showStateMessage,
  }
}

export function toExplorerOptionsFromSettings(value: unknown): ExplorerOptions {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EXPLORER_OPTIONS }
  }
  const source = value as Partial<ExplorerOptions>
  return {
    showHiddenFiles: source.showHiddenFiles ?? DEFAULT_EXPLORER_OPTIONS.showHiddenFiles,
    showFileExtensions: source.showFileExtensions ?? DEFAULT_EXPLORER_OPTIONS.showFileExtensions,
    sortMode:
      source.sortMode === 'manual' ||
      source.sortMode === 'modified' ||
      source.sortMode === 'noteCount' ||
      source.sortMode === 'name'
        ? source.sortMode
        : DEFAULT_EXPLORER_OPTIONS.sortMode,
    sortDirection: source.sortDirection === 'desc' || source.sortDirection === 'asc' ? source.sortDirection : DEFAULT_EXPLORER_OPTIONS.sortDirection,
    foldersFirst: source.foldersFirst ?? DEFAULT_EXPLORER_OPTIONS.foldersFirst,
    showIcons: source.showIcons ?? DEFAULT_EXPLORER_OPTIONS.showIcons,
    compactMode: source.compactMode ?? DEFAULT_EXPLORER_OPTIONS.compactMode,
  }
}

export function toExpandedTagGroups(value: unknown): Record<string, boolean> {
  const fallback = {
    daily: true,
    tags: true,
    other: true,
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const source = value as Record<string, unknown>
  const next: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(source)) {
    if (!key) {
      continue
    }
    next[key] = Boolean(raw)
  }
  return { ...fallback, ...next }
}

export function toExplorerViewStateFromSettings(value: unknown): ExplorerViewState {
  const fallback: ExplorerViewState = { ...DEFAULT_EXPLORER_VIEW_STATE }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const source = value as Record<string, unknown>
  const expandedNodes =
    source.expandedNodes && typeof source.expandedNodes === 'object' && !Array.isArray(source.expandedNodes)
      ? (source.expandedNodes as Record<string, boolean>)
      : {}
  const folderOrder =
    source.folderOrder && typeof source.folderOrder === 'object' && !Array.isArray(source.folderOrder)
      ? (source.folderOrder as Record<string, string[]>)
      : {}
  const iconOverridesRaw =
    source.iconOverrides && typeof source.iconOverrides === 'object' && !Array.isArray(source.iconOverrides)
      ? (source.iconOverrides as Record<string, unknown>)
      : {}

  const iconFolders =
    iconOverridesRaw.folders && typeof iconOverridesRaw.folders === 'object' && !Array.isArray(iconOverridesRaw.folders)
      ? (iconOverridesRaw.folders as Record<string, string>)
      : {}
  const iconFiles =
    iconOverridesRaw.files && typeof iconOverridesRaw.files === 'object' && !Array.isArray(iconOverridesRaw.files)
      ? (iconOverridesRaw.files as Record<string, string>)
      : {}

  return {
    expandedNodes,
    selectedNodeId: typeof source.selectedNodeId === 'string' ? source.selectedNodeId : null,
    // Do not restore persisted explorer search text across restarts.
    filterQuery: '',
    folderOrder,
    iconOverrides: {
      folders: iconFolders,
      files: iconFiles,
    },
  }
}

function areBooleanRecordEqual(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function areStringRecordEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function areOrderRecordEqual(left: Record<string, string[]>, right: Record<string, string[]>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of leftKeys) {
    const leftItems = left[key] ?? []
    const rightItems = right[key] ?? []
    if (leftItems.length !== rightItems.length) {
      return false
    }
    for (let index = 0; index < leftItems.length; index += 1) {
      if (leftItems[index] !== rightItems[index]) {
        return false
      }
    }
  }
  return true
}

export function areExplorerViewStatesEqual(left: ExplorerViewState, right: ExplorerViewState): boolean {
  return (
    left.selectedNodeId === right.selectedNodeId &&
    left.filterQuery === right.filterQuery &&
    areBooleanRecordEqual(left.expandedNodes, right.expandedNodes) &&
    areOrderRecordEqual(left.folderOrder, right.folderOrder) &&
    areStringRecordEqual(left.iconOverrides.folders, right.iconOverrides.folders) &&
    areStringRecordEqual(left.iconOverrides.files, right.iconOverrides.files)
  )
}

export function toLocalIsoDate(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

export function getRelativeVaultPath(path: string, noteBasePath: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedBase = noteBasePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedBase) {
    return normalizedPath
  }

  if (normalizedPath.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedBase.length + 1)
  }
  return normalizedPath
}


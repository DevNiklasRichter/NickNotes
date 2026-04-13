import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react'
import { CodeMirrorMarkdownEditor } from './editor/CodeMirrorMarkdownEditor'
import type { MarkdownEditorApi } from './editor/CodeMirrorMarkdownEditor'
import {
  parseNoteDocument,
  serializeNoteDocument,
  type ParsedNoteDocument,
  type TaskPriority,
  type TaskStatus,
} from './editor/noteDocument'
import { ExplorerSidebar } from './explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from './explorer/TagSidebarV2'
import { LucideNamedIcon } from './icons/lucideCatalog'
import type { ExplorerOptions, ExplorerViewState } from './explorer/types'
import {
  normalizeTagColor,
  normalizeTagGroups,
  normalizeTagId,
  type TagGroupDefinition,
} from './tags/tagTypes'
import './App.css'

type VaultCounts = {
  notes: number
  openTasks: number
  doneTasks: number
}

type Suggestion = {
  key: string
  category: string
  slug: string
  displayName: string
  confidence: number
  source: string
  autoApply: boolean
}

type ParsedTask = {
  title: string
  dueDate: string | null
  priority: string
  status: string
  projectTag: string | null
  tags: string[]
}

type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_tag: string | null
  updated_at: string
  path: string | null
}

type SearchRow = {
  id: string
  title: string
  note_type: string
  updated_at: string
  path: string
}

type MediaUploadResponse = {
  mediaPath: string
  markdownPath: string
  fileName: string
}

type ReviewDaily = {
  date: string
  new_notes: number
  open_tasks: number
  done_today: number
}

type ReviewWeekly = {
  from: string
  to: string
  notes_total: number
  tasks_open: number
  tasks_done: number
}

type BackendState = {
  vaultLoaded: boolean
  vaultPath?: string
  noteBasePath?: string
  counts?: VaultCounts
}

type ThemeMode = 'light' | 'dark'
type SidebarView = 'vault' | 'notes' | 'tags' | 'tasks' | 'review'
type NoteTabKind = 'note' | 'settings'

type NoteTab = {
  kind: NoteTabKind
  path: string
  title: string
  content: string
  loading: boolean
  dirty: boolean
}

type EditorTabContextMenuState = {
  x: number
  y: number
  path: string
} | null

type TagActionDialogTone = 'default' | 'primary' | 'danger'
type TagActionDialogAction = {
  id: string
  label: string
  tone?: TagActionDialogTone
}
type TagGroupFormValues = {
  id: string
  displayName: string
  color: string
}
type TagFormValues = {
  id: string
  displayName: string
}
type TagActionDialogResult = {
  actionId: string
  value: string
  groupValues?: TagGroupFormValues
  tagValues?: TagFormValues
}
type TagActionDialogState = {
  kind: 'input' | 'choice' | 'group-form' | 'tag-form' | 'color-form'
  title: string
  message?: string
  placeholder?: string
  value: string
  groupValues?: TagGroupFormValues
  tagValues?: TagFormValues
  actions: TagActionDialogAction[]
  resolve: (result: TagActionDialogResult) => void
} | null

const LAST_NOTEBASE_STORAGE_KEY = 'nicknotes-last-notebase-path'
const SETTINGS_TAB_PATH = '__nicknotes_settings__'

type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

const DEFAULT_STATUS_BAR_PREFS: StatusBarPrefs = {
  showNoteBaseName: true,
  showOpenTasks: true,
  showDueToday: false,
  showTotalNotes: false,
  showStateMessage: true,
}

const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
  showHiddenFiles: false,
  showFileExtensions: true,
  sortMode: 'manual',
  sortDirection: 'asc',
  foldersFirst: true,
  showIcons: true,
  compactMode: true,
}

const TAG_COLOR_PRESETS = [
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

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'new_topic', label: 'New Topic' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'done', label: 'Done' },
]
const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new_topic: 'New Topic',
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Done',
}
const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

type UiSettingsPayload = {
  updated_at?: string
  app?: Record<string, unknown>
  explorer?: Record<string, unknown>
}
type NoteGroup = {
  key: string
  label: string
  path: string
  favorite: boolean
  canCreateNotes: boolean
  canCreateGroups?: boolean
  canDelete?: boolean
}

function normalizeWikiLookup(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase()
}

function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

async function apiRequest<T>(baseUrl: string, endpoint: string, init?: RequestInit): Promise<T> {
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

function toGermanTimestamp(value: string): string {
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

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function getPathTail(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function toNoteDisplayName(path: string): string {
  return getFileName(path).replace(/\.md$/i, '')
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeTagCandidate(raw: string): string {
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

function normalizeRelatedCandidate(raw: string): string {
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

function deriveImageAltText(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  const label = normalizeLabel(base.replace(/[_-]+/g, ' '))
  return label || 'Image'
}

function readFileAsBase64(file: File): Promise<string> {
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

function normalizeTaskStatusValue(raw: string): TaskStatus {
  const clean = raw.trim().toLowerCase().replace(/[- ]+/g, '_') as TaskStatus
  return TASK_STATUS_OPTIONS.some((entry) => entry.value === clean) ? clean : 'open'
}

function taskStatusLabel(raw: string): string {
  return TASK_STATUS_LABELS[normalizeTaskStatusValue(raw)]
}

function taskStatusClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-badge status-${normalized}`
}

function taskStatusDotClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-dot status-${normalized}`
}

function taskStatusOptionLabel(value: TaskStatus): string {
  return TASK_STATUS_LABELS[value]
}

function normalizeTaskPriorityValue(raw: string): TaskPriority {
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

function taskPriorityLabel(raw: string): string {
  return TASK_PRIORITY_LABELS[normalizeTaskPriorityValue(raw)]
}

function taskPriorityDotClassName(raw: string): string {
  return `priority-dot priority-${normalizeTaskPriorityValue(raw)}`
}

function taskPriorityOptionLabel(value: TaskPriority): string {
  return TASK_PRIORITY_LABELS[value]
}

function isPermanentPinnedRootGroupKey(groupKey: string): boolean {
  const clean = groupKey.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
  if (!clean || clean.includes('/')) {
    return false
  }
  const token = clean.toLowerCase().replace(/^\d+_/, '')
  return token === 'daily' || token === 'tags' || token === 'tasks'
}

function toStorageTagGroups(value: unknown): TagGroupDefinition[] {
  return normalizeTagGroups(value)
}

function getStoredLastNoteBasePath(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return normalizeLabel(window.localStorage.getItem(LAST_NOTEBASE_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

function storeLastNoteBasePath(path: string): void {
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

function clearStoredLastNoteBasePath(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.removeItem(LAST_NOTEBASE_STORAGE_KEY)
  } catch {
    // Best effort.
  }
}

function areStatusBarPrefsEqual(left: StatusBarPrefs, right: StatusBarPrefs): boolean {
  return (
    left.showNoteBaseName === right.showNoteBaseName &&
    left.showOpenTasks === right.showOpenTasks &&
    left.showDueToday === right.showDueToday &&
    left.showTotalNotes === right.showTotalNotes &&
    left.showStateMessage === right.showStateMessage
  )
}

function areExplorerOptionsEqual(left: ExplorerOptions, right: ExplorerOptions): boolean {
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

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}

function toThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === 'light' || value === 'dark' ? value : fallback
}

function toStatusBarPrefsFromSettings(value: unknown): StatusBarPrefs {
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

function toExplorerOptionsFromSettings(value: unknown): ExplorerOptions {
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

function toExpandedTagGroups(value: unknown): Record<string, boolean> {
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

function toExplorerViewStateFromSettings(value: unknown): ExplorerViewState {
  const fallback: ExplorerViewState = {
    expandedNodes: {},
    selectedNodeId: null,
    filterQuery: '',
    folderOrder: {},
    iconOverrides: { folders: {}, files: {} },
  }
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
    filterQuery: typeof source.filterQuery === 'string' ? source.filterQuery : '',
    folderOrder,
    iconOverrides: {
      folders: iconFolders,
      files: iconFiles,
    },
  }
}

function toLocalIsoDate(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

function getRelativeVaultPath(path: string, noteBasePath: string): string {
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

function App() {
  const autoOpenTriedRef = useRef(false)
  const explorerRecoveryRef = useRef(false)
  const uiSettingsReadyRef = useRef(false)
  const explorerViewSaveTimerRef = useRef<number | null>(null)
  const appLayoutSaveTimerRef = useRef<number | null>(null)
  const workspaceGridRef = useRef<HTMLDivElement | null>(null)
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8765')
  const [theme, setTheme] = useState<ThemeMode>(getPreferredTheme)

  const [vaultPath, setVaultPath] = useState(getStoredLastNoteBasePath)
  const [vaultLoaded, setVaultLoaded] = useState(false)
  const [counts, setCounts] = useState<VaultCounts>({ notes: 0, openTasks: 0, doneTasks: 0 })

  const [captureText, setCaptureText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([])
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([])

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [searchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  const [allNotes, setAllNotes] = useState<SearchRow[]>([])
  const [explorerFiles, setExplorerFiles] = useState<SearchRow[]>([])
  const [explorerFilterQuery, setExplorerFilterQuery] = useState('')
  const [explorerContentMatchPathKeys, setExplorerContentMatchPathKeys] = useState<Set<string>>(new Set())

  const [daily, setDaily] = useState<ReviewDaily | null>(null)
  const [weekly, setWeekly] = useState<ReviewWeekly | null>(null)

  const [sidebarView, setSidebarView] = useState<SidebarView>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [displayName, setDisplayName] = useState('Max')
  const [statusBarPrefs, setStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS })
  const [explorerOptions, setExplorerOptions] = useState<ExplorerOptions>({ ...DEFAULT_EXPLORER_OPTIONS })
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(getPreferredTheme)
  const [savedDisplayName, setSavedDisplayName] = useState('Max')
  const [savedSidebarOpen, setSavedSidebarOpen] = useState(true)
  const [savedStatusBarPrefs, setSavedStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS })
  const [savedExplorerOptions, setSavedExplorerOptions] = useState<ExplorerOptions>({ ...DEFAULT_EXPLORER_OPTIONS })
  const [explorerWidth, setExplorerWidth] = useState(300)
  const [editorPanelOpen, setEditorPanelOpen] = useState(true)
  const [capturePanelOpen, setCapturePanelOpen] = useState(true)
  const [capturePinned, setCapturePinned] = useState(true)
  const [captureInlineHeight, setCaptureInlineHeight] = useState(220)
  const [captureResizing, setCaptureResizing] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    daily: true,
    tags: true,
    other: true,
  })
  const [explorerViewSeed, setExplorerViewSeed] = useState<ExplorerViewState | null>(null)
  const [explorerViewSeedId, setExplorerViewSeedId] = useState(0)
  const [explorerRevealPath, setExplorerRevealPath] = useState('')
  const [explorerRevealRequestId, setExplorerRevealRequestId] = useState(0)
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupDefinition[]>([])
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([])
  const [viewerDropActive, setViewerDropActive] = useState(false)

  const [openTabs, setOpenTabs] = useState<NoteTab[]>([])
  const [activeNotePath, setActiveNotePath] = useState('')
  const [splitView, setSplitView] = useState(false)
  const [splitPanePaths, setSplitPanePaths] = useState<string[]>([])
  const [draggingTabPath, setDraggingTabPath] = useState('')
  const [splitDropActive, setSplitDropActive] = useState(false)
  const [tabContextMenu, setTabContextMenu] = useState<EditorTabContextMenuState>(null)
  const [tagActionDialog, setTagActionDialog] = useState<TagActionDialogState>(null)
  const tagActionDialogRef = useRef<TagActionDialogState>(null)
  const [propertyTagInputOpenByPath, setPropertyTagInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyTagDraftByPath, setPropertyTagDraftByPath] = useState<Record<string, string>>({})
  const [propertyRelatedInputOpenByPath, setPropertyRelatedInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyRelatedDraftByPath, setPropertyRelatedDraftByPath] = useState<Record<string, string>>({})
  const activeEditorRef = useRef<MarkdownEditorApi | null>(null)
  const secondaryEditorRef = useRef<MarkdownEditorApi | null>(null)

  const [message, setMessage] = useState('Backend wird vorbereitet ...')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!captureResizing) {
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const host = workspaceGridRef.current
      if (!host) {
        return
      }
      const rect = host.getBoundingClientRect()
      const nextHeight = Math.round(rect.bottom - event.clientY)
      const bounded = Math.max(120, Math.min(rect.height - 180, nextHeight))
      setCaptureInlineHeight(bounded)
    }

    const onPointerUp = () => {
      setCaptureResizing(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [captureResizing])

  useEffect(() => {
    tagActionDialogRef.current = tagActionDialog
  }, [tagActionDialog])

  useEffect(() => {
    document.title = ''
  }, [])

  useEffect(() => {
    let active = true

    const init = async () => {
      try {
        if (window.nicknotes?.getBackendUrl) {
          const url = await window.nicknotes.getBackendUrl()
          if (active && url) {
            setBackendUrl(url)
          }
        }
      } catch {
        // Fallback to default URL.
      }
    }

    void init()

    return () => {
      active = false
    }
  }, [])

  useEffect(
    () => () => {
      if (explorerViewSaveTimerRef.current) {
        window.clearTimeout(explorerViewSaveTimerRef.current)
      }
      if (appLayoutSaveTimerRef.current) {
        window.clearTimeout(appLayoutSaveTimerRef.current)
      }
    },
    []
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (window.nicknotes?.setWindowTheme) {
      void window.nicknotes.setWindowTheme(theme).catch(() => {
        // Best effort bridge for desktop titlebar.
      })
    }
  }, [theme])

  useEffect(() => {
    if (!vaultLoaded || !uiSettingsReadyRef.current) {
      return
    }
    if (appLayoutSaveTimerRef.current) {
      window.clearTimeout(appLayoutSaveTimerRef.current)
    }
    appLayoutSaveTimerRef.current = window.setTimeout(() => {
      void saveUiSettingsPatch({ app: buildLayoutUiSettings() }).catch(() => {
        // Best effort.
      })
    }, 250)
    return () => {
      if (appLayoutSaveTimerRef.current) {
        window.clearTimeout(appLayoutSaveTimerRef.current)
        appLayoutSaveTimerRef.current = null
      }
    }
  }, [backendUrl, capturePanelOpen, capturePinned, editorPanelOpen, expandedFolders, explorerWidth, vaultLoaded])

  const settingsDirty = useMemo(
    () =>
      theme !== savedTheme ||
      displayName !== savedDisplayName ||
      sidebarOpen !== savedSidebarOpen ||
      !areStatusBarPrefsEqual(statusBarPrefs, savedStatusBarPrefs) ||
      !areExplorerOptionsEqual(explorerOptions, savedExplorerOptions),
    [
      displayName,
      explorerOptions,
      savedDisplayName,
      savedExplorerOptions,
      savedSidebarOpen,
      savedStatusBarPrefs,
      savedTheme,
      sidebarOpen,
      statusBarPrefs,
      theme,
    ]
  )

  const refreshTasks = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
    setTasks(response.items)
  }

  const refreshExplorerFiles = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(backendUrl, '/explorer/files')
      setExplorerFiles(response.items)
    } catch {
      // Fallback: Explorer can still render indexed rows.
    }
  }

  const runSearch = async (query: string, force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const cleanQuery = query.trim()
    try {
      const response = await apiRequest<{ items: SearchRow[] }>(
        backendUrl,
        `/search?query=${encodeURIComponent(query)}`
      )
      setSearchResults(response.items)
      if (!cleanQuery) {
        setAllNotes(response.items)
        return
      }

      void apiRequest<{ items: SearchRow[] }>(backendUrl, '/search?query=')
        .then((allResponse) => {
          setAllNotes(allResponse.items)
        })
        .catch(() => {
          // Best effort refresh for wikilinks.
        })
    } catch (caught) {
      setError(String(caught))
      if (!cleanQuery) {
        setSearchResults([])
        setAllNotes([])
      }
    } finally {
      if (!cleanQuery) {
        await refreshExplorerFiles(force)
      }
    }
  }

  useEffect(() => {
    if (!vaultLoaded) {
      setExplorerContentMatchPathKeys(new Set())
      return
    }

    const query = explorerFilterQuery.trim()
    if (!query) {
      setExplorerContentMatchPathKeys(new Set())
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void apiRequest<{ items: SearchRow[] }>(backendUrl, `/search?query=${encodeURIComponent(query)}`)
        .then((response) => {
          if (cancelled) {
            return
          }
          const next = new Set(
            response.items.map((row) => row.path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase())
          )
          setExplorerContentMatchPathKeys(next)
        })
        .catch(() => {
          if (!cancelled) {
            setExplorerContentMatchPathKeys(new Set())
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [backendUrl, explorerFilterQuery, vaultLoaded])

  const refreshAllNotes = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(backendUrl, '/search?query=')
      setAllNotes(response.items)
    } catch (caught) {
      setError(String(caught))
      setAllNotes([])
    }
  }

  const refreshReview = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ daily: ReviewDaily; weekly: ReviewWeekly }>(backendUrl, '/review')
    setDaily(response.daily)
    setWeekly(response.weekly)
  }

  const refreshTagGroups = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ groups: unknown }>(backendUrl, '/tag-groups')
    setCustomTagGroups(toStorageTagGroups(response.groups))
  }

  const refreshNoteGroups = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, '/note-groups')
      setNoteGroups(response.groups)
    } catch (caught) {
      setError(String(caught))
      setNoteGroups([])
    }
  }

  const refreshExplorerSidebarData = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    await Promise.allSettled([refreshNoteGroups(force), refreshAllNotes(force), refreshExplorerFiles(force)])
  }

  const refreshWorkspaceData = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    await Promise.allSettled([
      refreshTasks(force),
      runSearch(searchQuery, force),
      refreshReview(force),
      refreshTagGroups(force),
      refreshExplorerSidebarData(force),
    ])
  }

  const saveUiSettingsPatch = async (patch: { app?: Record<string, unknown>; explorer?: ExplorerViewState }) => {
    await apiRequest<{ settings: UiSettingsPayload }>(backendUrl, '/ui-settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    })
  }

  const buildFullAppUiSettings = (): Record<string, unknown> => ({
    theme,
    displayName,
    sidebarOpen,
    statusBarPrefs,
    explorerOptions,
    explorerWidth,
    editorPanelOpen,
    capturePanelOpen,
    capturePinned,
    tagExpandedGroups: expandedFolders,
  })

  const buildLayoutUiSettings = (): Record<string, unknown> => ({
    explorerWidth,
    editorPanelOpen,
    capturePanelOpen,
    capturePinned,
    tagExpandedGroups: expandedFolders,
  })

  const applyUiSettings = (settings: UiSettingsPayload) => {
    const appSettings = settings.app ?? {}

    const nextTheme = toThemeMode(appSettings.theme, getPreferredTheme())
    const nextDisplayName = normalizeLabel(typeof appSettings.displayName === 'string' ? appSettings.displayName : '') || 'Max'
    const nextSidebarOpen = toBoolean(appSettings.sidebarOpen, true)
    const nextStatusBarPrefs = toStatusBarPrefsFromSettings(appSettings.statusBarPrefs)
    const nextExplorerOptions = toExplorerOptionsFromSettings(appSettings.explorerOptions)
    const nextExplorerWidth = toBoundedNumber(appSettings.explorerWidth, 300, 220, 520)
    const nextEditorPanelOpen = toBoolean(appSettings.editorPanelOpen, true)
    const nextCapturePanelOpen = toBoolean(appSettings.capturePanelOpen, true)
    const nextCapturePinned = toBoolean(appSettings.capturePinned, true)
    const nextExpandedGroups = toExpandedTagGroups(appSettings.tagExpandedGroups)

    setTheme(nextTheme)
    setDisplayName(nextDisplayName)
    setSidebarOpen(nextSidebarOpen)
    setStatusBarPrefs(nextStatusBarPrefs)
    setExplorerOptions(nextExplorerOptions)
    setSavedTheme(nextTheme)
    setSavedDisplayName(nextDisplayName)
    setSavedSidebarOpen(nextSidebarOpen)
    setSavedStatusBarPrefs(nextStatusBarPrefs)
    setSavedExplorerOptions(nextExplorerOptions)
    setExplorerWidth(nextExplorerWidth)
    setEditorPanelOpen(nextEditorPanelOpen)
    setCapturePanelOpen(nextCapturePanelOpen)
    setCapturePinned(nextCapturePinned)
    setExpandedFolders(nextExpandedGroups)

    const nextExplorerViewState = toExplorerViewStateFromSettings(settings.explorer)
    setExplorerViewSeed(nextExplorerViewState)
    setExplorerViewSeedId((prev) => prev + 1)
    uiSettingsReadyRef.current = true
  }

  const loadUiSettings = async () => {
    try {
      const response = await apiRequest<{ settings: UiSettingsPayload }>(backendUrl, '/ui-settings')
      applyUiSettings(response.settings ?? {})
    } catch {
      uiSettingsReadyRef.current = true
    }
  }

  const openVaultAtPath = async (rawPath: string, successMessage: string): Promise<boolean> => {
    const path = normalizeLabel(rawPath)
    if (!path) {
      throw new Error('Bitte zuerst einen NoteBase-Pfad angeben.')
    }

    const response = await apiRequest<{
      counts: VaultCounts
      noteBasePath?: string
      tagGroups?: unknown
    }>(backendUrl, '/notebase/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
    const loadedPath = response.noteBasePath ?? path
    uiSettingsReadyRef.current = false
    setVaultPath(loadedPath)
    setVaultLoaded(true)
    setCounts(response.counts)
    if (response.tagGroups) {
      setCustomTagGroups(toStorageTagGroups(response.tagGroups))
    }
    storeLastNoteBasePath(loadedPath)
    setMessage(successMessage)
    setError('')

    await loadUiSettings()
    await refreshWorkspaceData(true)
    return true
  }

  const loadState = async () => {
    try {
      const state = await apiRequest<BackendState>(backendUrl, '/state')
      if (!state.vaultLoaded) {
        uiSettingsReadyRef.current = false
        setVaultLoaded(false)
        setExplorerViewSeed(null)
        setExplorerViewSeedId((prev) => prev + 1)
        const rememberedPath = getStoredLastNoteBasePath()
        if (rememberedPath && !autoOpenTriedRef.current) {
          autoOpenTriedRef.current = true
          setVaultPath(rememberedPath)
          try {
            await openVaultAtPath(rememberedPath, 'Letzte NoteBase automatisch geladen.')
            return
          } catch (autoOpenError) {
            setError(String(autoOpenError))
          }
        }
        setMessage('Keine NoteBase geladen.')
        return
      }

      setVaultLoaded(true)
      const loadedPath = state.noteBasePath ?? state.vaultPath ?? ''
      setVaultPath(loadedPath)
      storeLastNoteBasePath(loadedPath)
      uiSettingsReadyRef.current = false
      if (state.counts) {
        setCounts(state.counts)
      }
      setMessage('NoteBase geladen.')
      setError('')

      await loadUiSettings()
      await refreshWorkspaceData(true)
    } catch (caught) {
      setError(`Backend nicht erreichbar: ${String(caught)}`)
    }
  }

  useEffect(() => {
    void loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl])

  useEffect(() => {
    if (!vaultLoaded) {
      setAllNotes([])
      setExplorerFiles([])
      setTabContextMenu(null)
    }
  }, [vaultLoaded])

  useEffect(() => {
    if (!tabContextMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.editor-tab-context-menu')) {
        return
      }
      setTabContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [tabContextMenu])

  useEffect(() => {
    if (!vaultLoaded) {
      return
    }

    if (!captureText.trim()) {
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      return
    }

    const timeout = window.setTimeout(() => {
      void previewCapture(captureText)
    }, 260)

    return () => {
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureText, vaultLoaded])

  useEffect(() => {
    if (openTabs.length === 0) {
      setActiveNotePath('')
      setSplitPanePaths([])
      setSplitView(false)
      return
    }

    if (!openTabs.some((tab) => tab.path === activeNotePath)) {
      setActiveNotePath(openTabs[openTabs.length - 1].path)
    }

    const openNotePathSet = new Set(openTabs.filter((tab) => tab.kind === 'note').map((tab) => tab.path))
    setSplitPanePaths((prev) => {
      const seen = new Set<string>()
      const next: string[] = []
      for (const path of prev) {
        if (!path || path === activeNotePath || !openNotePathSet.has(path) || seen.has(path)) {
          continue
        }
        seen.add(path)
        next.push(path)
      }
      return next.length === prev.length && next.every((path, index) => path === prev[index]) ? prev : next
    })

    if (openTabs.filter((tab) => tab.kind === 'note').length < 2 && splitView) {
      setSplitView(false)
      setSplitPanePaths([])
    }
  }, [activeNotePath, openTabs, splitView])

  useEffect(() => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== SETTINGS_TAB_PATH || tab.dirty === settingsDirty) {
          return tab
        }
        return { ...tab, dirty: settingsDirty }
      })
    )
  }, [settingsDirty])

  const chosenTags = useMemo(() => new Set(selectedTagKeys), [selectedTagKeys])

  const sortedNotes = useMemo(() => {
    return [...searchResults].sort((left, right) => {
      const leftTime = new Date(left.updated_at).getTime()
      const rightTime = new Date(right.updated_at).getTime()
      return rightTime - leftTime
    })
  }, [searchResults])

  const linkIndexRows = useMemo(() => {
    const source = allNotes.length > 0 ? allNotes : sortedNotes
    const deduped = new Map<string, SearchRow>()
    for (const row of source) {
      deduped.set(row.path, row)
    }
    return Array.from(deduped.values())
  }, [allNotes, sortedNotes])

  const explorerRows = useMemo(() => {
    const deduped = new Map<string, SearchRow>()
    for (const row of linkIndexRows) {
      deduped.set(row.path, row)
    }
    for (const row of explorerFiles) {
      if (!deduped.has(row.path)) {
        deduped.set(row.path, row)
      }
    }
    return Array.from(deduped.values())
  }, [explorerFiles, linkIndexRows])

  useEffect(() => {
    if (!vaultLoaded) {
      explorerRecoveryRef.current = false
      return
    }
    if (noteGroups.length > 0 || explorerRows.length > 0) {
      explorerRecoveryRef.current = false
      return
    }
    if (explorerRecoveryRef.current) {
      return
    }

    explorerRecoveryRef.current = true
    void (async () => {
      try {
        await apiRequest(backendUrl, '/notebase/reindex', { method: 'POST' })
      } catch {
        // Best effort reindex.
      }
      await refreshExplorerSidebarData(true)
      explorerRecoveryRef.current = false
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, vaultLoaded, noteGroups.length, explorerRows.length])

  const wikiTitleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of linkIndexRows) {
      const key = normalizeWikiLookup(toNoteDisplayName(row.path))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [linkIndexRows])

  const noteGroupsByKey = useMemo(() => {
    const byKey = new Map<string, NoteGroup>()
    for (const group of noteGroups) {
      byKey.set(group.key, group)
    }
    return byKey
  }, [noteGroups])

  const mergedTagGroups = useMemo(() => toStorageTagGroups({ tagGroups: customTagGroups }), [customTagGroups])
  const propertyTagOptions = useMemo(() => {
    const items: string[] = []
    for (const group of mergedTagGroups) {
      for (const tag of group.tags) {
        items.push(`${group.id}:${tag.id}`)
      }
    }
    return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }))
  }, [mergedTagGroups])
  const tagVisualByKey = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>()
    for (const group of mergedTagGroups) {
      const color = normalizeTagColor(group.color || '')
      for (const tag of group.tags) {
        map.set(`${group.id}:${tag.id}`.toLowerCase(), {
          label: tag.displayName || tag.id,
          color,
        })
      }
    }
    return map
  }, [mergedTagGroups])
  const mergedTagGroupsById = useMemo(() => {
    const map = new Map<string, TagGroupDefinition>()
    for (const group of mergedTagGroups) {
      map.set(group.id.toLowerCase(), group)
    }
    return map
  }, [mergedTagGroups])

  const activeTab = openTabs.find((tab) => tab.path === activeNotePath) ?? openTabs[0] ?? null
  const openNoteTabs = openTabs.filter((tab) => tab.kind === 'note')
  const dirtyFilePaths = useMemo(
    () => new Set(openNoteTabs.filter((tab) => tab.dirty).map((tab) => tab.path)),
    [openNoteTabs]
  )
  const splitPaneTabs = useMemo(() => {
    if (!splitView || activeTab?.kind !== 'note') {
      return [] as NoteTab[]
    }
    const byPath = new Map(openNoteTabs.map((tab) => [tab.path, tab]))
    const seen = new Set<string>()
    const next: NoteTab[] = []
    for (const path of splitPanePaths) {
      if (!path || path === activeTab.path || seen.has(path)) {
        continue
      }
      const tab = byPath.get(path)
      if (!tab) {
        continue
      }
      seen.add(path)
      next.push(tab)
    }
    return next
  }, [activeTab, openNoteTabs, splitPanePaths, splitView])
  const activeNoteDocument = useMemo(
    () =>
      activeTab && activeTab.kind === 'note'
        ? parseNoteDocument(activeTab.content, activeTab.title || toNoteDisplayName(activeTab.path))
        : null,
    [activeTab]
  )

  useEffect(() => {
    if (!splitView || activeTab?.kind !== 'note' || splitPanePaths.length > 0) {
      return
    }
    const candidate = openNoteTabs.find((tab) => tab.path !== activeTab.path)
    if (!candidate) {
      return
    }
    setSplitPanePaths([candidate.path])
  }, [activeTab, openNoteTabs, splitPanePaths.length, splitView])

  const noteBaseName = useMemo(() => (vaultPath ? getPathTail(vaultPath) : 'Keine NoteBase'), [vaultPath])
  const settingsTabOpen = openTabs.some((tab) => tab.path === SETTINGS_TAB_PATH)
  const tabContextTarget = tabContextMenu ? openTabs.find((tab) => tab.path === tabContextMenu.path) ?? null : null
  const dueTodayCount = useMemo(() => {
    const today = toLocalIsoDate()
    return tasks.filter((task) => task.status !== 'done' && task.due_date === today).length
  }, [tasks])

  const toWikiTargetForRow = (row: SearchRow): string => {
    const noteName = toNoteDisplayName(row.path)
    const duplicateCount = wikiTitleCounts.get(normalizeWikiLookup(noteName)) ?? 0
    if (duplicateCount <= 1) {
      return noteName
    }
    return getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '')
  }
  const propertyRelatedOptions = useMemo(() => {
    const values = new Set<string>()
    for (const row of linkIndexRows) {
      const target = normalizeRelatedCandidate(toWikiTargetForRow(row))
      if (target) {
        values.add(target)
      }
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }))
  }, [linkIndexRows, toWikiTargetForRow])

  const pickDirectory = async (): Promise<string | null> => {
    if (!window.nicknotes?.selectDirectory) {
      return window.prompt('Bitte absoluten Pfad eingeben:') || null
    }
    return window.nicknotes.selectDirectory()
  }

  const createVault = async () => {
    try {
      setError('')
      const parentPath = await pickDirectory()
      if (!parentPath) {
        return
      }

      const preferredName = window.prompt('Wie sollen wir dich nennen?', displayName)?.trim()
      const effectiveName = normalizeLabel(preferredName || '') || displayName
      if (preferredName) {
        setDisplayName(effectiveName)
      }

      const name = window.prompt('Name der neuen NoteBase:', `${effectiveName}NoteBase`)?.trim()
      if (!name) {
        return
      }

      const response = await apiRequest<{
        vaultPath: string
        noteBasePath?: string
        counts: VaultCounts
        tagGroups?: unknown
      }>(
        backendUrl,
        '/notebase/create',
        {
          method: 'POST',
          body: JSON.stringify({ parentPath, name }),
        }
      )

      setVaultPath(response.noteBasePath ?? response.vaultPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      uiSettingsReadyRef.current = false
      storeLastNoteBasePath(response.noteBasePath ?? response.vaultPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`Neue NoteBase erstellt: ${response.noteBasePath ?? response.vaultPath}`)
      await loadUiSettings()
      await refreshWorkspaceData(true)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const pickAndOpenVault = async () => {
    try {
      setError('')
      const path = await pickDirectory()
      if (!path) {
        return
      }
      setVaultPath(path)
      await openVaultAtPath(path, 'NoteBase automatisch geladen.')
    } catch (caught) {
      setError(String(caught))
    }
  }

  const saveSettings = async (): Promise<boolean> => {
    try {
      if (vaultLoaded) {
        await saveUiSettingsPatch({
          app: buildFullAppUiSettings(),
        })
      }
      setSavedTheme(theme)
      setSavedDisplayName(displayName)
      setSavedSidebarOpen(sidebarOpen)
      setSavedStatusBarPrefs({ ...statusBarPrefs })
      setSavedExplorerOptions({ ...explorerOptions })
      setMessage('Einstellungen gespeichert.')
      setError('')
      return true
    } catch (caught) {
      setError(String(caught))
      return false
    }
  }

  const discardSettings = () => {
    setTheme(savedTheme)
    setDisplayName(savedDisplayName)
    setSidebarOpen(savedSidebarOpen)
    setStatusBarPrefs({ ...savedStatusBarPrefs })
    setExplorerOptions({ ...savedExplorerOptions })
    setMessage('Nicht gespeicherte Einstellungen verworfen.')
  }

  const openSettingsTab = () => {
    const existing = openTabs.find((tab) => tab.path === SETTINGS_TAB_PATH)
    if (existing) {
      setEditorPanelOpen(true)
      setActiveNotePath(SETTINGS_TAB_PATH)
      return
    }

    setOpenTabs((prev) => [
      ...prev,
      {
        kind: 'settings',
        path: SETTINGS_TAB_PATH,
        title: 'Einstellungen',
        content: '',
        loading: false,
        dirty: settingsDirty,
      },
    ])
    setEditorPanelOpen(true)
    setActiveNotePath(SETTINGS_TAB_PATH)
  }

  const saveNoteTab = async (path: string): Promise<boolean> => {
    const targetTab = openTabs.find((tab) => tab.path === path)
    if (!targetTab || targetTab.kind !== 'note' || targetTab.loading || !targetTab.dirty) {
      return true
    }
    const liveContent = (() => {
      if (activeTab?.kind === 'note' && activeTab.path === path && activeEditorRef.current) {
        const liveBody = activeEditorRef.current.getMarkdown()
        const parsed = parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path))
        return serializeNoteDocument({ ...parsed, body: liveBody })
      }
      return targetTab.content
    })()

    try {
      setError('')
      const response = await apiRequest<{ counts: VaultCounts; path: string; title?: string; tagGroups?: unknown }>(
        backendUrl,
        '/notes/save',
        {
          method: 'POST',
          body: JSON.stringify({ path: targetTab.path, content: liveContent }),
        }
      )
      setCounts(response.counts)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      const savedPath = (response.path || targetTab.path || '').trim()
      if (savedPath && savedPath !== targetTab.path) {
        remapOpenNotePaths(targetTab.path, savedPath)
      }
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.path !== path && tab.path !== savedPath) {
            return tab
          }
          return {
            ...tab,
            path: savedPath || tab.path,
            title: response.title || tab.title,
            content: liveContent,
            dirty: false,
          }
        })
      )
      setMessage(`Notiz gespeichert: ${response.title || targetTab.title}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview(), refreshNoteGroups()])
      return true
    } catch (caught) {
      setError(String(caught))
      return false
    }
  }

  const saveTab = async (path: string): Promise<boolean> => {
    const targetTab = openTabs.find((tab) => tab.path === path)
    if (!targetTab) {
      return true
    }
    if (targetTab.kind === 'settings') {
      return saveSettings()
    }
    return saveNoteTab(path)
  }

  const renameNoteBase = async () => {
    const newName = normalizeLabel(window.prompt('Neuer Name fuer die NoteBase', noteBaseName) ?? '')
    if (!newName || newName === noteBaseName) {
      return
    }

    try {
      setError('')
      const previousName = noteBaseName
      const response = await apiRequest<{
        counts: VaultCounts
        vaultPath: string
        noteBasePath?: string
        tagGroups?: unknown
      }>(backendUrl, '/notebase/rename', {
        method: 'POST',
        body: JSON.stringify({ newName }),
      })
      const loadedPath = response.noteBasePath ?? response.vaultPath
      setVaultPath(loadedPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      setOpenTabs([])
      setActiveNotePath('')
      setSplitView(false)
      setSplitPanePaths([])
      storeLastNoteBasePath(loadedPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`NoteBase umbenannt: ${previousName} -> ${getPathTail(loadedPath)}`)
      await Promise.all([refreshTasks(true), runSearch(searchQuery, true), refreshReview(true), refreshNoteGroups(true)])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteNoteBase = async () => {
    if (!window.confirm(`Soll die NoteBase "${noteBaseName}" wirklich mit allen Dateien geloescht werden?`)) {
      return
    }
    const secondCheck = normalizeLabel(
      window.prompt('Bitte "LOESCHEN" eingeben, um das vollstaendige Loeschen zu bestaetigen.', '') ?? ''
    )
    if (secondCheck.toUpperCase() !== 'LOESCHEN') {
      setMessage('Loeschen abgebrochen.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; deletedPath: string }>(backendUrl, '/notebase/delete', {
        method: 'POST',
        body: JSON.stringify({ confirmDelete: true }),
      })
      setVaultLoaded(false)
      uiSettingsReadyRef.current = false
      setVaultPath('')
      setCounts({ notes: 0, openTasks: 0, doneTasks: 0 })
      setTasks([])
      setSearchResults([])
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      setOpenTabs([])
      setActiveNotePath('')
      setSplitView(false)
      setSplitPanePaths([])
      setCustomTagGroups([])
      setNoteGroups([])
      setExplorerViewSeed(null)
      setExplorerViewSeedId((prev) => prev + 1)
      clearStoredLastNoteBasePath()
      setMessage(`NoteBase geloescht: ${response.deletedPath}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const previewCapture = async (text: string) => {
    if (!vaultLoaded) {
      return
    }

    try {
      const response = await apiRequest<{
        suggestions: Suggestion[]
        tasks: ParsedTask[]
      }>(backendUrl, '/capture/preview', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })

      setSuggestions(response.suggestions)
      setParsedTasks(response.tasks)

      setSelectedTagKeys((prev) => {
        const previous = new Set(prev)
        const next: string[] = []
        for (const item of response.suggestions) {
          if (previous.has(item.key) || item.autoApply || item.source === 'explicit') {
            next.push(item.key)
          }
        }
        return next
      })
    } catch (caught) {
      setError(String(caught))
    }
  }

  const saveCapture = async () => {
    try {
      const text = captureText.trim()
      if (!text) {
        return
      }

      const response = await apiRequest<{ counts: VaultCounts; noteId: string }>(
        backendUrl,
        '/capture/save',
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            selectedTagKeys,
          }),
        }
      )

      setCounts(response.counts)
      setCaptureText('')
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      setMessage(`Capture gespeichert (${response.noteId}).`)
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview(), refreshNoteGroups()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const markTaskDone = async (taskId: string) => {
    try {
      await apiRequest(backendUrl, `/tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
      })
      setMessage(`Task ${taskId} als erledigt markiert.`)
      await Promise.all([refreshTasks(), refreshReview(), runSearch(searchQuery)])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const fetchNoteContent = async (path: string): Promise<string> => {
    const response = await apiRequest<{ content: string }>(
      backendUrl,
      `/notes/content?path=${encodeURIComponent(path)}`
    )
    return response.content
  }

  const openNoteInTab = async (path: string, suggestedTitle?: string, options?: { activate?: boolean }) => {
    const shouldActivate = options?.activate !== false
    const fallbackTitle = suggestedTitle?.trim() || getFileName(path)
    const existing = openTabs.find((tab) => tab.path === path)
    if (existing) {
      setEditorPanelOpen(true)
      if (shouldActivate) {
        setActiveNotePath(path)
      }
      return
    }

    setOpenTabs((prev) => [
      ...prev,
      {
        kind: 'note',
        path,
        title: fallbackTitle,
        content: '',
        loading: true,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    if (shouldActivate) {
      setActiveNotePath(path)
    }

    try {
      const content = await fetchNoteContent(path)
      const parsed = parseNoteDocument(content, fallbackTitle)
      const normalizedContent = serializeNoteDocument(parsed)
      const nextTitle = parsed.frontmatter.title || fallbackTitle
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.path === path
            ? {
                ...tab,
                title: nextTitle,
                content: normalizedContent,
                loading: false,
                dirty: false,
              }
            : tab
        )
      )
    } catch (caught) {
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setError(String(caught))
    }
  }

  const confirmCloseTab = async (path: string): Promise<boolean> => {
    const tab = openTabs.find((candidate) => candidate.path === path)
    if (!tab) {
      return true
    }
    if (tab.kind !== 'note' || !tab.dirty) {
      return true
    }

    const decision = await askTagChoice(
      `Ungespeicherte Aenderungen in "${tab.title}"`,
      'Was soll passieren?',
      [
        { id: 'save', label: 'Speichern', tone: 'primary' },
        { id: 'discard', label: 'Verwerfen', tone: 'danger' },
      ]
    )
    if (!decision) {
      return false
    }

    if (decision === 'save') {
      return await saveTab(path)
    }
    if (decision === 'discard') {
      return true
    }
    return false
  }

  const closeEditorTab = async (path: string) => {
    const canClose = await confirmCloseTab(path)
    if (!canClose) {
      return
    }
    window.setTimeout(() => {
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setSplitPanePaths((prev) => prev.filter((entry) => entry !== path))
      setTabContextMenu(null)
    }, 0)
  }

  const openNoteInCurrentEditor = async (path: string, suggestedTitle?: string) => {
    const currentPath = activeTab?.kind === 'note' ? activeTab.path : ''
    if (currentPath && currentPath !== path) {
      const canCloseCurrent = await confirmCloseTab(currentPath)
      if (!canCloseCurrent) {
        return
      }
    }
    await openNoteInTab(path, suggestedTitle)
    if (currentPath && currentPath !== path) {
      window.setTimeout(() => {
        setOpenTabs((prev) => prev.filter((tab) => tab.path !== currentPath))
      }, 0)
    }
    setSplitView(false)
    setSplitPanePaths([])
  }

  const revealActiveNoteInExplorer = () => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }
    setSidebarView('notes')
    setSidebarOpen(true)
    setExplorerRevealPath(activeTab.path)
    setExplorerRevealRequestId((prev) => prev + 1)
  }

  const showNoteInSplitView = (path: string) => {
    if (openNoteTabs.length < 2) {
      return
    }
    const targetPath = path === activeNotePath ? openNoteTabs.find((tab) => tab.path !== path)?.path ?? '' : path
    if (!targetPath) {
      return
    }
    setSplitPanePaths((prev) => {
      if (prev.includes(targetPath) || targetPath === activeNotePath) {
        return prev
      }
      return [...prev, targetPath]
    })
    setSplitView(true)
    setTabContextMenu(null)
  }

  const updateNoteDocumentByPath = (
    tabPath: string,
    updater: (document: ParsedNoteDocument) => ParsedNoteDocument
  ) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== tabPath || tab.kind !== 'note') {
          return tab
        }
        const parsed = parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path))
        const nextDocument = updater(parsed)
        const nextContent = serializeNoteDocument(nextDocument)
        return {
          ...tab,
          title: nextDocument.frontmatter.title || tab.title,
          content: nextContent,
          dirty: true,
        }
      })
    )
  }

  const updateNoteContentByPath = (tabPath: string, nextBody: string) => {
    updateNoteDocumentByPath(tabPath, (document) => ({ ...document, body: nextBody }))
  }

  const updateNoteTitleByPath = (tabPath: string, nextTitle: string) => {
    const cleanTitle = normalizeLabel(nextTitle)
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        title: cleanTitle,
      },
    }))
  }

  const updateNoteTypeByPath = (tabPath: string, nextType: 'note' | 'task') => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        type: nextType,
        // Keep task metadata stable across type toggles so values survive note <-> task switches.
        status: normalizeTaskStatusValue(document.frontmatter.status),
        priority: normalizeTaskPriorityValue(document.frontmatter.priority),
        due_date: document.frontmatter.due_date,
      },
    }))
  }

  const updateNoteStatusByPath = (tabPath: string, nextStatus: TaskStatus) => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        status: nextStatus,
      },
    }))
  }

  const updateNotePriorityByPath = (tabPath: string, nextPriority: TaskPriority) => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        priority: nextPriority,
      },
    }))
  }

  const updateNoteDueDateByPath = (tabPath: string, nextDueDate: string) => {
    const clean = normalizeLabel(nextDueDate)
    const normalized = clean && /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : ''
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        due_date: normalized,
      },
    }))
  }

  const addNoteTagByPath = (tabPath: string, rawTag: string) => {
    const normalized = normalizeTagCandidate(rawTag)
    if (!normalized) {
      return
    }
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        tags: Array.from(new Set([...document.frontmatter.tags, normalized])).sort((left, right) =>
          left.localeCompare(right, 'de', { sensitivity: 'base' })
        ),
      },
    }))
  }
  const removeNoteTagByPath = (tabPath: string, tag: string) => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        tags: document.frontmatter.tags.filter((item) => item !== tag),
      },
    }))
  }

  const addNoteRelatedByPath = (tabPath: string, rawRelated: string) => {
    const normalized = normalizeRelatedCandidate(rawRelated)
    if (!normalized) {
      return
    }
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        related: Array.from(new Set([...document.frontmatter.related, normalized])).sort((left, right) =>
          left.localeCompare(right, 'de', { sensitivity: 'base' })
        ),
      },
    }))
  }
  const removeNoteRelatedByPath = (tabPath: string, related: string) => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        related: document.frontmatter.related.filter((item) => item !== related),
      },
    }))
  }

  const openPropertyTagInput = (tabPath: string) => {
    setPropertyTagInputOpenByPath((prev) => ({ ...prev, [tabPath]: true }))
  }
  const closePropertyTagInput = (tabPath: string) => {
    setPropertyTagInputOpenByPath((prev) => ({ ...prev, [tabPath]: false }))
    setPropertyTagDraftByPath((prev) => ({ ...prev, [tabPath]: '' }))
  }
  const commitPropertyTagInput = (tabPath: string) => {
    const draft = propertyTagDraftByPath[tabPath] || ''
    if (!normalizeLabel(draft)) {
      closePropertyTagInput(tabPath)
      return
    }
    addNoteTagByPath(tabPath, draft)
    closePropertyTagInput(tabPath)
  }

  const openPropertyRelatedInput = (tabPath: string) => {
    setPropertyRelatedInputOpenByPath((prev) => ({ ...prev, [tabPath]: true }))
  }
  const closePropertyRelatedInput = (tabPath: string) => {
    setPropertyRelatedInputOpenByPath((prev) => ({ ...prev, [tabPath]: false }))
    setPropertyRelatedDraftByPath((prev) => ({ ...prev, [tabPath]: '' }))
  }
  const commitPropertyRelatedInput = (tabPath: string) => {
    const draft = propertyRelatedDraftByPath[tabPath] || ''
    if (!normalizeLabel(draft)) {
      closePropertyRelatedInput(tabPath)
      return
    }
    addNoteRelatedByPath(tabPath, draft)
    closePropertyRelatedInput(tabPath)
  }

  const renderNoteProperties = (tabPath: string, document: ParsedNoteDocument, compact = false) => {
    const manualTags = document.frontmatter.tags
    const manualTagSet = new Set(manualTags)
    const autoTags = document.frontmatter.tags_auto.filter((item) => !manualTagSet.has(item))
    const manualRelated = document.frontmatter.related
    const manualRelatedSet = new Set(manualRelated)
    const autoRelated = document.frontmatter.related_auto.filter((item) => !manualRelatedSet.has(item))
    const tagDraft = propertyTagDraftByPath[tabPath] ?? ''
    const relatedDraft = propertyRelatedDraftByPath[tabPath] ?? ''
    const tagInputOpen = propertyTagInputOpenByPath[tabPath] ?? false
    const relatedInputOpen = propertyRelatedInputOpenByPath[tabPath] ?? false
    const listToken = tabPath.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    const tagDatalistId = `property-tags-${listToken}`
    const relatedDatalistId = `property-related-${listToken}`
    const relatedOptionsForPath = propertyRelatedOptions.filter(
      (item) => normalizeWikiLookup(item) !== normalizeWikiLookup(toNoteDisplayName(tabPath))
    )
    const toTagChipVisual = (rawTag: string): { label: string; color: string } => {
      const normalized = rawTag.trim().toLowerCase()
      const mapped = tagVisualByKey.get(normalized)
      if (mapped) {
        return mapped
      }
      const tagPart = rawTag.includes(':') ? rawTag.split(':', 2)[1] || rawTag : rawTag
      return { label: tagPart, color: '#94a3b8' }
    }

    const onTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
        event.preventDefault()
        commitPropertyTagInput(tabPath)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closePropertyTagInput(tabPath)
      }
    }

    const onRelatedInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
        event.preventDefault()
        commitPropertyRelatedInput(tabPath)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closePropertyRelatedInput(tabPath)
      }
    }

    return (
      <section className={`note-properties-panel ${compact ? 'split-note-properties-panel' : ''}`}>
        <div className="note-title-row">
          <input
            className="note-title-input"
            value={document.frontmatter.title}
            onChange={(event) => {
              updateNoteTitleByPath(tabPath, event.target.value)
            }}
            onBlur={(event) => {
              void syncNotePathWithTitle(tabPath, event.currentTarget.value)
            }}
            placeholder="Untitled"
          />
        </div>

        <div className={`note-properties-grid ${compact ? 'compact' : ''}`}>
          <span className="property-key">Type</span>
          <div className="property-toggle-group">
            <button
              type="button"
              className={`property-toggle-badge ${document.frontmatter.type === 'note' ? 'active' : ''}`}
              onClick={() => {
                updateNoteTypeByPath(tabPath, 'note')
              }}
            >
              Note
            </button>
            <button
              type="button"
              className={`property-toggle-badge ${document.frontmatter.type === 'task' ? 'active' : ''}`}
              onClick={() => {
                updateNoteTypeByPath(tabPath, 'task')
              }}
            >
              Task
            </button>
          </div>

          {document.frontmatter.type === 'task' ? (
            <>
              <span className="property-key">Status</span>
              <div className="property-value-inline">
                <label className="property-picker-badge">
                  <span className={taskStatusDotClassName(document.frontmatter.status)} aria-hidden="true" />
                  <select
                    className="property-picker-select property-picker-select-status"
                    value={document.frontmatter.status}
                    onChange={(event) => {
                      const value = event.target.value as TaskStatus
                      if (TASK_STATUS_OPTIONS.some((entry) => entry.value === value)) {
                        updateNoteStatusByPath(tabPath, value)
                      }
                    }}
                  >
                    {TASK_STATUS_OPTIONS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {taskStatusOptionLabel(entry.value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <span className="property-key">Priority</span>
              <div className="property-value-inline">
                <label className="property-picker-badge">
                  <span className={taskPriorityDotClassName(document.frontmatter.priority)} aria-hidden="true" />
                  <select
                    className="property-picker-select property-picker-select-priority"
                    value={document.frontmatter.priority}
                    onChange={(event) => {
                      const value = event.target.value as TaskPriority
                      if (TASK_PRIORITY_OPTIONS.some((entry) => entry.value === value)) {
                        updateNotePriorityByPath(tabPath, value)
                      }
                    }}
                  >
                    {TASK_PRIORITY_OPTIONS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {taskPriorityOptionLabel(entry.value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <span className="property-key">Due Date</span>
              <div className="property-value-inline">
                <input
                  className="property-date-input"
                  type="date"
                  value={document.frontmatter.due_date}
                  onChange={(event) => {
                    updateNoteDueDateByPath(tabPath, event.target.value)
                  }}
                />
                {document.frontmatter.due_date ? (
                  <button
                    type="button"
                    className="property-chip add"
                    onClick={() => {
                      updateNoteDueDateByPath(tabPath, '')
                    }}
                    title="Fälligkeitsdatum entfernen"
                  >
                    x
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          <span className="property-key">Tags</span>
          <div className="property-token-line">
            {manualTags.map((item) => {
              const visual = toTagChipVisual(item)
              return (
              <span
                key={`tag-manual-${item}`}
                className="property-chip tag-chip manual interactive"
                style={{ '--tag-chip-color': visual.color } as CSSProperties}
                title={item}
              >
                <span>{visual.label}</span>
                <button
                  type="button"
                  className="property-chip-remove"
                  onClick={() => {
                    removeNoteTagByPath(tabPath, item)
                  }}
                  title="Tag entfernen"
                >
                  x
                </button>
              </span>
              )
            })}
            {autoTags.map((item) => {
              const visual = toTagChipVisual(item)
              return (
              <span
                key={`tag-auto-${item}`}
                className="property-chip tag-chip auto"
                style={{ '--tag-chip-color': visual.color } as CSSProperties}
                title={`Automatisch erkannt • ${item}`}
              >
                {visual.label}
              </span>
              )
            })}
            {tagInputOpen ? (
              <>
                <input
                  className="property-chip-input"
                  list={tagDatalistId}
                  value={tagDraft}
                  onChange={(event) => {
                    setPropertyTagDraftByPath((prev) => ({ ...prev, [tabPath]: event.target.value }))
                  }}
                  onKeyDown={onTagInputKeyDown}
                  onBlur={() => {
                    commitPropertyTagInput(tabPath)
                  }}
                  placeholder="tag..."
                  autoFocus
                />
                <datalist id={tagDatalistId}>
                  {propertyTagOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </>
            ) : null}
            <button
              type="button"
              className="property-chip add"
              onClick={() => {
                openPropertyTagInput(tabPath)
              }}
              title="Tag hinzufügen"
            >
              +
            </button>
          </div>

          <span className="property-key">Related</span>
          <div className="property-token-line">
            {manualRelated.map((item) => (
              <span key={`related-manual-${item}`} className="property-chip manual interactive">
                <span>{item}</span>
                <button
                  type="button"
                  className="property-chip-remove"
                  onClick={() => {
                    removeNoteRelatedByPath(tabPath, item)
                  }}
                  title="Link entfernen"
                >
                  x
                </button>
              </span>
            ))}
            {autoRelated.map((item) => (
              <span key={`related-auto-${item}`} className="property-chip auto" title="Automatisch erkannt">
                {item}
              </span>
            ))}
            {relatedInputOpen ? (
              <>
                <input
                  className="property-chip-input"
                  list={relatedDatalistId}
                  value={relatedDraft}
                  onChange={(event) => {
                    setPropertyRelatedDraftByPath((prev) => ({ ...prev, [tabPath]: event.target.value }))
                  }}
                  onKeyDown={onRelatedInputKeyDown}
                  onBlur={() => {
                    commitPropertyRelatedInput(tabPath)
                  }}
                  placeholder="note/link..."
                  autoFocus
                />
                <datalist id={relatedDatalistId}>
                  {relatedOptionsForPath.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </>
            ) : null}
            <button
              type="button"
              className="property-chip add"
              onClick={() => {
                openPropertyRelatedInput(tabPath)
              }}
              title="Verknüpfung hinzufügen"
            >
              +
            </button>
          </div>

          <span className="property-key">Created</span>
          <span className="property-value-static">{toGermanTimestamp(document.frontmatter.created_at)}</span>

          <span className="property-key">Updated</span>
          <span className="property-value-static">{toGermanTimestamp(document.frontmatter.updated_at)}</span>
        </div>
      </section>
    )
  }

  const syncNotePathWithTitle = async (tabPath: string, rawTitleOverride?: string) => {
    const tab = openTabs.find((entry) => entry.path === tabPath && entry.kind === 'note')
    if (!tab || tab.loading) {
      return
    }
    const document = parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path))
    const typedTitle = normalizeLabel(rawTitleOverride ?? document.frontmatter.title)
    const targetTitle = typedTitle || 'Untitled'
    if (!typedTitle) {
      updateNoteTitleByPath(tabPath, targetTitle)
    }
    const currentStem = normalizeLabel(toNoteDisplayName(tab.path))
    if (currentStem.toLowerCase() === targetTitle.toLowerCase()) {
      return
    }
    await renameExplorerFile(tab.path, targetTitle)
  }

  const updateActiveNoteContent = (nextBody: string) => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }
    updateNoteContentByPath(activeTab.path, nextBody)
  }

  const uploadImageForNote = async (notePath: string, file: File): Promise<string | null> => {
    if (!notePath || !file) {
      return null
    }
    try {
      const encoded = await readFileAsBase64(file)
      const response = await apiRequest<MediaUploadResponse>(backendUrl, '/notes/media/add', {
        method: 'POST',
        body: JSON.stringify({
          path: notePath,
          fileName: file.name || 'image',
          contentType: file.type || '',
          dataBase64: encoded,
        }),
      })
      const altText = deriveImageAltText(file.name || response.fileName)
      return `![${altText}](${response.markdownPath})`
    } catch (caught) {
      setError(String(caught))
      return null
    }
  }

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: !prev[folderKey] }))
  }

  const setFolderOpen = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: true }))
  }

  const handleExplorerViewStateChange = (nextState: ExplorerViewState) => {
    if (!vaultLoaded || !uiSettingsReadyRef.current) {
      return
    }
    if (explorerViewSaveTimerRef.current) {
      window.clearTimeout(explorerViewSaveTimerRef.current)
    }
    explorerViewSaveTimerRef.current = window.setTimeout(() => {
      void saveUiSettingsPatch({ explorer: nextState }).catch(() => {
        // Best effort.
      })
    }, 250)
  }

  const getDraggedNoteData = (event: DragEvent<HTMLElement>) => {
    const notePath =
      event.dataTransfer.getData('application/x-note-path') ||
      event.dataTransfer.getData('application/x-open-tab-path') ||
      event.dataTransfer.getData('text/plain')
    const noteTitle =
      event.dataTransfer.getData('application/x-note-title') ||
      event.dataTransfer.getData('application/x-open-tab-title')

    const cleanPath = normalizeLabel(notePath)
    if (!cleanPath) {
      return null
    }

    return {
      path: cleanPath,
      title: normalizeLabel(noteTitle) || undefined,
    }
  }

  const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '')

  const sanitizeSplitPanePaths = (paths: string[], nextActivePath: string = activeNotePath): string[] => {
    const seen = new Set<string>()
    const next: string[] = []
    for (const rawPath of paths) {
      const cleanPath = normalizePath(rawPath)
      if (!cleanPath || cleanPath === normalizePath(nextActivePath) || seen.has(cleanPath)) {
        continue
      }
      seen.add(cleanPath)
      next.push(cleanPath)
    }
    return next
  }

  const remapOpenNotePaths = (fromPrefix: string, toPrefix: string) => {
    const cleanFrom = normalizePath(fromPrefix)
    const cleanTo = normalizePath(toPrefix)
    if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) {
      return
    }

    const rewritePath = (path: string): string => {
      if (!path || path === SETTINGS_TAB_PATH) {
        return path
      }
      const normalized = normalizePath(path)
      const lower = normalized.toLowerCase()
      const fromLower = cleanFrom.toLowerCase()
      if (lower !== fromLower && !lower.startsWith(`${fromLower}/`)) {
        return path
      }
      return `${cleanTo}${normalized.slice(cleanFrom.length)}`
    }

    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.kind !== 'note') {
          return tab
        }
        const nextPath = rewritePath(tab.path)
        if (nextPath === tab.path) {
          return tab
        }
        return {
          ...tab,
          path: nextPath,
          title: toNoteDisplayName(nextPath),
        }
      })
    )
    setActiveNotePath((prev) => rewritePath(prev))
    setSplitPanePaths((prev) => sanitizeSplitPanePaths(prev.map((path) => rewritePath(path))))
  }

  const createExplorerFolder = async (parentGroupKey: string, groupName: string) => {
    const cleanGroupName = normalizeLabel(groupName)
    if (!cleanGroupName) {
      return
    }

    const effectiveParentKey = parentGroupKey && noteGroupsByKey.has(parentGroupKey) ? parentGroupKey : ''
    const targetGroup = noteGroupsByKey.get(effectiveParentKey)
    if (targetGroup?.canCreateGroups === false) {
      setMessage('In diesem Ordner koennen keine neuen Unterordner angelegt werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[] }>(backendUrl, '/note-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({ groupName: cleanGroupName, parentKey: effectiveParentKey }),
      })
      setNoteGroups(response.groups)
      setMessage(`Ordner angelegt: ${response.group.label}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createExplorerFile = async (groupKey: string, title: string) => {
    const cleanTitle = normalizeLabel(title)
    if (!cleanTitle) {
      return
    }

    const effectiveGroupKey = groupKey && noteGroupsByKey.has(groupKey) ? groupKey : ''
    const targetGroup = noteGroupsByKey.get(effectiveGroupKey)
    if (targetGroup?.canCreateNotes === false) {
      setMessage('In diesem Ordner koennen keine neuen Notizen angelegt werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; title?: string; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey: effectiveGroupKey, title: cleanTitle, noteType: 'note', status: 'open' }),
        }
      )
      setCounts(response.counts)
      setNoteGroups(response.groups)
      setMessage(`Notiz erstellt (${response.noteId}).`)
      await Promise.all([runSearch(searchQuery), refreshReview()])
      await openNoteInTab(response.notePath, response.title || cleanTitle)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const migrateExistingNotesToTemplate = async () => {
    if (!vaultLoaded) {
      return
    }
    try {
      setError('')
      const response = await apiRequest<{ updated: number; counts: VaultCounts; tagGroups?: unknown }>(
        backendUrl,
        '/notes/migrate-templates',
        {
          method: 'POST',
        }
      )
      setCounts(response.counts)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`Templates angewendet: ${response.updated} Dateien aktualisiert.`)
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview(), refreshExplorerSidebarData()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createExplorerTask = async (groupKey: string, title: string) => {
    const cleanTitle = normalizeLabel(title)
    if (!cleanTitle) {
      return
    }

    const effectiveGroupKey = groupKey && noteGroupsByKey.has(groupKey) ? groupKey : ''
    const targetGroup = noteGroupsByKey.get(effectiveGroupKey)
    if (targetGroup?.canCreateNotes === false) {
      setMessage('In diesem Ordner koennen keine neuen Tasks angelegt werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; title?: string; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey: effectiveGroupKey, title: cleanTitle, noteType: 'task', status: 'open' }),
        }
      )
      setCounts(response.counts)
      setNoteGroups(response.groups)
      setMessage(`Task erstellt (${response.noteId}).`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
      await openNoteInTab(response.notePath, response.title || cleanTitle)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameExplorerFolder = async (groupKey: string, newName: string) => {
    const cleanName = normalizeLabel(newName)
    const group = noteGroupsByKey.get(groupKey)
    if (!group || !cleanName || cleanName === group.label || group.canDelete === false) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/rename',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, newName: cleanName }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      remapOpenNotePaths(group.path, response.group.path)
      setMessage(`Ordner umbenannt: ${response.group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveExplorerFolder = async (groupKey: string, targetParentKey: string) => {
    const sourceGroup = noteGroupsByKey.get(groupKey)
    if (!sourceGroup || sourceGroup.canDelete === false) {
      return
    }

    const targetParent = noteGroupsByKey.get(targetParentKey)
    if (targetParent?.canCreateGroups === false) {
      setMessage('In diesen Zielordner kann nicht verschoben werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/move',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, targetParentKey }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      remapOpenNotePaths(sourceGroup.path, response.group.path)
      setMessage(`Ordner verschoben: ${response.group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteExplorerFolder = async (groupKey: string) => {
    const group = noteGroupsByKey.get(groupKey)
    if (!group || group.canDelete === false) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/delete',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      const groupPath = normalizePath(group.path)
      const groupPathLower = groupPath.toLowerCase()
      setOpenTabs((prev) =>
        prev.filter((tab) => {
          if (tab.kind !== 'note') {
            return true
          }
          const tabPath = normalizePath(tab.path).toLowerCase()
          return tabPath !== groupPathLower && !tabPath.startsWith(`${groupPathLower}/`)
        })
      )
      setMessage(`Ordner geloescht: ${group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const toggleFavoriteFolder = async (groupKey: string) => {
    const group = noteGroupsByKey.get(groupKey)
    if (!group) {
      return
    }
    if (group.favorite && isPermanentPinnedRootGroupKey(group.key)) {
      setMessage('Die Ordner daily, tags und tasks sind immer fixiert.')
      return
    }

    try {
      setError('')
      const endpoint = group.favorite ? '/note-groups/unfavorite' : '/note-groups/favorite'
      const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, endpoint, {
        method: 'POST',
        body: JSON.stringify({ groupKey }),
      })
      setNoteGroups(response.groups)
      setMessage(group.favorite ? 'Fixierung aufgehoben.' : 'Ordner fixiert.')
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameExplorerFile = async (path: string, newName: string) => {
    const cleanName = normalizeLabel(newName)
    if (!cleanName) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ renamedPath: string; counts: VaultCounts }>(backendUrl, '/notes/rename', {
        method: 'POST',
        body: JSON.stringify({ path, newName: cleanName }),
      })
      setCounts(response.counts)
      remapOpenNotePaths(path, response.renamedPath)
      try {
        const refreshed = await fetchNoteContent(response.renamedPath)
        const parsed = parseNoteDocument(refreshed, toNoteDisplayName(response.renamedPath))
        const normalized = serializeNoteDocument(parsed)
        const renamedPathLower = normalizePath(response.renamedPath).toLowerCase()
        setOpenTabs((prev) =>
          prev.map((tab) => {
            if (tab.kind !== 'note' || normalizePath(tab.path).toLowerCase() !== renamedPathLower) {
              return tab
            }
            return {
              ...tab,
              title: parsed.frontmatter.title || toNoteDisplayName(response.renamedPath),
              content: normalized,
              dirty: false,
              loading: false,
            }
          })
        )
      } catch {
        // Best effort refresh of canonical title/content after rename.
      }
      setMessage(`Datei umbenannt: ${toNoteDisplayName(response.renamedPath)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveExplorerFile = async (path: string, targetGroupKey: string) => {
    try {
      setError('')
      const response = await apiRequest<{ movedPath: string; counts: VaultCounts }>(backendUrl, '/notes/move', {
        method: 'POST',
        body: JSON.stringify({ path, targetGroupKey }),
      })
      setCounts(response.counts)
      remapOpenNotePaths(path, response.movedPath)
      setMessage(`Datei verschoben: ${toNoteDisplayName(response.movedPath)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteExplorerFile = async (path: string) => {
    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; counts: VaultCounts }>(backendUrl, '/notes/delete', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setCounts(response.counts)
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setMessage(`Datei geloescht: ${toNoteDisplayName(path)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const openTagActionDialog = (config: {
    kind: 'input' | 'choice' | 'group-form' | 'tag-form' | 'color-form'
    title: string
    message?: string
    placeholder?: string
    initialValue?: string
    initialGroupValues?: TagGroupFormValues
    initialTagValues?: TagFormValues
    actions: TagActionDialogAction[]
  }): Promise<TagActionDialogResult> =>
    new Promise((resolve) => {
      setTagActionDialog({
        kind: config.kind,
        title: config.title,
        message: config.message,
        placeholder: config.placeholder,
        value: config.initialValue ?? '',
        groupValues: config.initialGroupValues,
        tagValues: config.initialTagValues,
        actions: config.actions,
        resolve,
      })
    })

  const closeTagActionDialog = (actionId: string) => {
    const current = tagActionDialogRef.current
    if (!current) {
      return
    }
    const payload: TagActionDialogResult = {
      actionId,
      value: current.value,
      groupValues: current.groupValues,
      tagValues: current.tagValues,
    }
    setTagActionDialog(null)
    window.setTimeout(() => {
      current.resolve(payload)
    }, 0)
  }

  const askTagChoice = async (
    title: string,
    message: string,
    actions: TagActionDialogAction[]
  ): Promise<string | null> => {
    const result = await openTagActionDialog({
      kind: 'choice',
      title,
      message,
      actions: [...actions, { id: 'cancel', label: 'Abbrechen' }],
    })
    if (result.actionId === 'cancel') {
      return null
    }
    return result.actionId
  }

  const openTagGroupFormDialog = async (config: {
    title: string
    message?: string
    confirmLabel: string
    initialValues: TagGroupFormValues
    colorOnly?: boolean
  }): Promise<TagGroupFormValues | null> => {
    const kind = config.colorOnly ? 'color-form' : 'group-form'
    const result = await openTagActionDialog({
      kind,
      title: config.title,
      message: config.message,
      initialGroupValues: config.initialValues,
      actions: [
        { id: 'confirm', label: config.confirmLabel, tone: 'primary' },
        { id: 'cancel', label: 'Abbrechen' },
      ],
    })
    if (result.actionId !== 'confirm' || !result.groupValues) {
      return null
    }
    return {
      id: normalizeTagId(result.groupValues.id),
      displayName: normalizeLabel(result.groupValues.displayName),
      color: normalizeTagColor(result.groupValues.color),
    }
  }

  const openTagFormDialog = async (config: {
    title: string
    message?: string
    confirmLabel: string
    initialValues: TagFormValues
  }): Promise<TagFormValues | null> => {
    const result = await openTagActionDialog({
      kind: 'tag-form',
      title: config.title,
      message: config.message,
      initialTagValues: config.initialValues,
      actions: [
        { id: 'confirm', label: config.confirmLabel, tone: 'primary' },
        { id: 'cancel', label: 'Abbrechen' },
      ],
    })
    if (result.actionId !== 'confirm' || !result.tagValues) {
      return null
    }
    return {
      id: normalizeTagId(result.tagValues.id),
      displayName: normalizeLabel(result.tagValues.displayName),
    }
  }

  const resolveTagGroupById = (groupId: string): TagGroupDefinition | null => {
    const clean = normalizeTagId(groupId)
    if (!clean) {
      return null
    }
    return mergedTagGroupsById.get(clean.toLowerCase()) ?? null
  }

  const createTagGroup = async () => {
    const form = await openTagGroupFormDialog({
      title: 'Neue Tag-Gruppe',
      confirmLabel: 'Anlegen',
      initialValues: {
        id: 'projekt',
        displayName: 'Projekte',
        color: TAG_COLOR_PRESETS[0],
      },
    })
    if (!form) {
      return
    }
    const nextGroupId = normalizeTagId(form.id)
    if (!nextGroupId) {
      setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicate = resolveTagGroupById(nextGroupId)
    if (duplicate) {
      setMessage(`Die Tag-Gruppe "${duplicate.displayName}" (${duplicate.id}) existiert bereits.`)
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown }>(backendUrl, '/tag-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({
          groupId: nextGroupId,
          displayName: normalizeLabel(form.displayName) || nextGroupId,
          color: normalizeTagColor(form.color),
        }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${nextGroupId}`)
      setMessage(`Tag-Gruppe angelegt: ${form.displayName || nextGroupId}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createTagInExistingGroup = async (preferredGroup: string | null) => {
    if (mergedTagGroups.length === 0) {
      setMessage('Lege zuerst eine Tag-Gruppe an.')
      return
    }

    const firstGroup = mergedTagGroups[0] ?? null
    const requestedGroup = preferredGroup ? resolveTagGroupById(preferredGroup) : null
    const group = requestedGroup ?? firstGroup
    if (!group) {
      setMessage('Keine gueltige Tag-Gruppe gefunden.')
      return
    }

    const form = await openTagFormDialog({
      title: `Neuer Tag in "${group.displayName}"`,
      confirmLabel: 'Anlegen',
      initialValues: {
        id: 'neuer-tag',
        displayName: 'Neuer Tag',
      },
    })
    if (!form) {
      return
    }
    const tagId = normalizeTagId(form.id)
    if (!tagId) {
      setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicateTag = group.tags.find((entry) => entry.id.toLowerCase() === tagId.toLowerCase())
    if (duplicateTag) {
      setMessage(`Der Tag "${duplicateTag.displayName}" (${duplicateTag.id}) existiert in "${group.displayName}" bereits.`)
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown }>(backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({
          groupId: group.id,
          tagId,
          displayName: normalizeLabel(form.displayName) || tagId,
        }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${group.id}`)
      setMessage(`Tag hinzugefuegt: ${group.displayName} / ${form.displayName || tagId}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameTagGroup = async (groupName: string) => {
    const group = resolveTagGroupById(groupName)
    if (!group) {
      setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const form = await openTagGroupFormDialog({
      title: `Tag-Gruppe bearbeiten (${group.displayName})`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: group.id,
        displayName: group.displayName,
        color: group.color || TAG_COLOR_PRESETS[0],
      },
    })
    if (!form) {
      return
    }
    const newGroupId = normalizeTagId(form.id)
    if (!newGroupId) {
      setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicateGroup = resolveTagGroupById(newGroupId)
    if (duplicateGroup && duplicateGroup.id.toLowerCase() !== group.id.toLowerCase()) {
      setMessage(`Die Tag-Gruppe "${duplicateGroup.displayName}" (${duplicateGroup.id}) existiert bereits.`)
      return
    }

    const nextDisplayName = normalizeLabel(form.displayName) || newGroupId
    const newColor = normalizeTagColor(form.color)

    const idChanged = newGroupId.toLowerCase() !== group.id.toLowerCase()
    const displayChanged = normalizeLabel(nextDisplayName) !== group.displayName
    const colorChanged = newColor !== group.color
    if (!idChanged && !displayChanged && !colorChanged) {
      return
    }

    let applyToNotes = false
    if (idChanged) {
      const applyChoice = await askTagChoice(
        'Notiz-Tags mit umbenennen?',
        `Sollen bestehende Notiz-Tags von "${group.id}:*" automatisch auf "${newGroupId}:*" umgestellt werden?`,
        [
          { id: 'apply', label: 'Ja, in Notizen aktualisieren', tone: 'primary' },
          { id: 'keep', label: 'Nein, nur Verwaltung aendern' },
        ]
      )
      if (!applyChoice) {
        return
      }
      applyToNotes = applyChoice === 'apply'
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-group',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            newGroupId,
            newDisplayName: normalizeLabel(nextDisplayName) || newGroupId,
            newColor,
            applyToNotes,
          }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setFolderOpen(`tag-group-${newGroupId}`)
      setMessage(
        idChanged && applyToNotes
          ? `Tag-Gruppe umbenannt und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag-Gruppe aktualisiert.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const setTagGroupColor = async (groupName: string) => {
    const group = resolveTagGroupById(groupName)
    if (!group) {
      setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const form = await openTagGroupFormDialog({
      title: `Farbe fuer "${group.displayName}"`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: group.id,
        displayName: group.displayName,
        color: group.color || TAG_COLOR_PRESETS[0],
      },
      colorOnly: true,
    })
    if (!form) {
      return
    }

    const newColor = normalizeTagColor(form.color)
    if (newColor === group.color) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-group',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            newGroupId: group.id,
            newDisplayName: group.displayName,
            newColor,
            applyToNotes: false,
          }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(`Farbe aktualisiert: ${group.displayName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteTagGroup = async (groupName: string) => {
    const group = resolveTagGroupById(groupName)
    const groupLabel = group ? `${group.displayName} (${group.id})` : groupName
    const option = await askTagChoice(
      `Tag-Gruppe "${groupLabel}" loeschen`,
      'Wie sollen vorhandene Tag-Verwendungen in Notizen behandelt werden?',
      [
        { id: 'remove', label: 'Auch aus Notizen entfernen', tone: 'danger' },
        { id: 'keep', label: 'Nur aus Tag-Verwaltung loeschen' },
      ]
    )
    if (!option) {
      return
    }
    const removeFromNotes = option === 'remove'

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/delete-group',
        {
          method: 'POST',
          body: JSON.stringify({ groupId: groupName, removeFromNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        removeFromNotes
          ? `Tag-Gruppe geloescht und Tags aus ${response.notesUpdated} Notizen entfernt.`
          : 'Tag-Gruppe aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameTag = async (groupName: string, tagName: string) => {
    const group = resolveTagGroupById(groupName)
    if (!group) {
      setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const tag = group.tags.find((entry) => entry.id.toLowerCase() === tagName.toLowerCase())
    if (!tag) {
      setMessage(`Tag nicht gefunden: ${groupName}/${tagName}`)
      return
    }

    const form = await openTagFormDialog({
      title: `Tag bearbeiten (${group.displayName} / ${tag.displayName})`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: tag.id,
        displayName: tag.displayName,
      },
    })
    if (!form) {
      return
    }
    const newTagId = normalizeTagId(form.id)
    if (!newTagId) {
      setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicate = group.tags.find(
      (entry) => entry.id.toLowerCase() === newTagId.toLowerCase() && entry.id.toLowerCase() !== tag.id.toLowerCase()
    )
    if (duplicate) {
      setMessage(`Der Tag "${duplicate.displayName}" (${duplicate.id}) existiert in "${group.displayName}" bereits.`)
      return
    }

    const nextDisplayName = normalizeLabel(form.displayName) || newTagId

    const idChanged = newTagId.toLowerCase() !== tag.id.toLowerCase()
    const displayChanged = normalizeLabel(nextDisplayName) !== tag.displayName
    if (!idChanged && !displayChanged) {
      return
    }

    let applyToNotes = false
    if (idChanged) {
      const applyChoice = await askTagChoice(
        'Notiz-Tags mit umbenennen?',
        `Soll "${group.id}:${tag.id}" in allen Notizen automatisch in "${group.id}:${newTagId}" umbenannt werden?`,
        [
          { id: 'apply', label: 'Ja, in Notizen aktualisieren', tone: 'primary' },
          { id: 'keep', label: 'Nein, nur Verwaltung aendern' },
        ]
      )
      if (!applyChoice) {
        return
      }
      applyToNotes = applyChoice === 'apply'
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-tag',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            tagId: tag.id,
            newTagId,
            newDisplayName: normalizeLabel(nextDisplayName) || newTagId,
            applyToNotes,
          }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        idChanged && applyToNotes
          ? `Tag umbenannt und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag aktualisiert.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteTag = async (groupName: string, tagName: string) => {
    const group = resolveTagGroupById(groupName)
    const tag = group?.tags.find((entry) => entry.id.toLowerCase() === tagName.toLowerCase()) ?? null
    const tagLabel = tag && group ? `${group.displayName} / ${tag.displayName}` : `${groupName}:${tagName}`
    const option = await askTagChoice(
      `Tag "${tagLabel}" loeschen`,
      'Wie sollen vorhandene Tag-Verwendungen in Notizen behandelt werden?',
      [
        { id: 'remove', label: 'Auch aus Notizen entfernen', tone: 'danger' },
        { id: 'keep', label: 'Nur aus Tag-Verwaltung loeschen' },
      ]
    )
    if (!option) {
      return
    }
    const removeFromNotes = option === 'remove'

    try {
      setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/delete-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupId: groupName, tagId: tagName, removeFromNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        removeFromNotes
          ? `Tag geloescht und aus ${response.notesUpdated} Notizen entfernt.`
          : 'Tag aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const handleViewerDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setViewerDropActive(false)
    setSplitDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }
    void openNoteInTab(payload.path, payload.title)
  }

  const handleDropOnPrimaryPane = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setViewerDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }

    void (async () => {
      await openNoteInTab(payload.path, payload.title, { activate: true })
      setActiveNotePath(payload.path)
      setSplitPanePaths((prev) => sanitizeSplitPanePaths(prev.filter((path) => normalizePath(path) !== normalizePath(payload.path)), payload.path))
    })()
  }

  const handleDropOnSplitPane = (event: DragEvent<HTMLElement>, currentPanePath: string) => {
    event.preventDefault()
    setViewerDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }

    void (async () => {
      await openNoteInTab(payload.path, payload.title, { activate: false })
      setSplitView(true)
      setSplitPanePaths((prev) => {
        const replaced = prev.map((path) =>
          normalizePath(path) === normalizePath(currentPanePath) ? normalizePath(payload.path) : normalizePath(path)
        )
        return sanitizeSplitPanePaths(replaced)
      })
    })()
  }

  const handleDropToNewSplitPane = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setSplitDropActive(false)
    setViewerDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }

    void (async () => {
      await openNoteInTab(payload.path, payload.title, { activate: false })
      setSplitView(true)
      setSplitPanePaths((prev) => sanitizeSplitPanePaths([...prev, normalizePath(payload.path)]))
    })()
  }

  const toggleSplitView = () => {
    if (activeTab?.kind !== 'note' || openNoteTabs.length < 2) {
      return
    }

    setSplitView((previous) => {
      if (!previous && splitPanePaths.length === 0) {
        const candidate = openNoteTabs.find((tab) => tab.path !== activeNotePath)
        if (candidate) {
          setSplitPanePaths(sanitizeSplitPanePaths([candidate.path]))
        }
      }
      if (previous) {
        setSplitPanePaths([])
      }
      return !previous
    })
  }

  const toggleEditorPanel = () => {
    setEditorPanelOpen((previous) => !previous)
  }

  const closeCapturePanel = () => {
    setCapturePanelOpen(false)
  }

  const toggleCapturePinned = () => {
    setCapturePinned((previous) => {
      if (previous) {
        setCapturePanelOpen(false)
        return false
      }
      setCapturePanelOpen(true)
      return true
    })
  }

  const openCaptureFromDock = () => {
    setCapturePinned(true)
    setCapturePanelOpen(true)
  }

  const setThemeMode = (nextMode: ThemeMode) => {
    setTheme(nextMode)
  }

  const openSidebarView = (view: SidebarView) => {
    if (sidebarView === view) {
      setSidebarOpen((prev) => !prev)
      return
    }

    setSidebarView(view)
    setSidebarOpen(true)
  }

  const onQuickCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void saveCapture()
    }
  }

  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!activeTab) {
          return
        }
        void saveTab(activeTab.path)
      }
    }

    window.addEventListener('keydown', onGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown)
    }
  }, [activeTab, saveTab])

  const renderSidebarContent = () => {
    if (sidebarView === 'vault') {
      return (
        <div className="sidebar-content">
          <h3>Board</h3>
          <p className="muted-label">Aktive NoteBase</p>
          <div className="active-notebase-row">
            <strong>{noteBaseName || 'Keine NoteBase'}</strong>
            <div className="hover-menu-anchor">
              <button className="icon-button compact muted" title="NoteBase-Menue">
                <LucideNamedIcon name="MoreHorizontal" size={14} />
              </button>
              <div className="hover-menu">
                <button onClick={() => void renameNoteBase()}>NoteBase umbenennen</button>
                <button className="danger" onClick={() => void deleteNoteBase()}>
                  NoteBase loeschen
                </button>
              </div>
            </div>
          </div>

          <div className="stacked-actions">
            <button onClick={() => void pickAndOpenVault()}>NoteBase laden</button>
            <button onClick={() => void createVault()}>NoteBase anlegen</button>
            <button onClick={() => void migrateExistingNotesToTemplate()} disabled={!vaultLoaded}>
              Templates migrieren
            </button>
          </div>
        </div>
      )
    }

    if (sidebarView === 'tasks') {
      return (
        <div className="sidebar-content">
          <div className="sidebar-header-row">
            <h3>Tasks</h3>
            <button onClick={() => void refreshTasks()} disabled={!vaultLoaded}>
              Aktualisieren
            </button>
          </div>

          <div className="task-list">
            {tasks.length === 0 ? <p className="empty-copy">Keine offenen Tasks.</p> : null}
            {tasks.map((task) => (
              <article key={task.id} className="task-item">
                <header>
                  <strong>{task.title}</strong>
                  <div className="task-meta-badges">
                    <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                    <span className="task-priority-badge">
                      <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                      {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                </header>
                <p>{task.due_date ? `Faellig: ${task.due_date}` : 'Kein Faelligkeitsdatum'}</p>
                <p className="muted-copy">{toGermanTimestamp(task.updated_at)}</p>
                <button onClick={() => void markTaskDone(task.id)} disabled={task.status === 'done'}>
                  Done
                </button>
              </article>
            ))}
          </div>
        </div>
      )
    }

    if (sidebarView === 'review') {
      return (
        <div className="sidebar-content">
          <div className="sidebar-header-row">
            <h3>Review</h3>
            <button onClick={() => void refreshReview()} disabled={!vaultLoaded}>
              Aktualisieren
            </button>
          </div>

          <section className="review-card">
            <h4>Daily</h4>
            {daily ? (
              <>
                <p>Datum: {daily.date}</p>
                <p>Neue Notizen: {daily.new_notes}</p>
                <p>Offene Tasks: {daily.open_tasks}</p>
                <p>Heute erledigt: {daily.done_today}</p>
              </>
            ) : (
              <p className="empty-copy">Keine Daily-Daten.</p>
            )}
          </section>

          <section className="review-card">
            <h4>Weekly</h4>
            {weekly ? (
              <>
                <p>
                  Zeitraum: {weekly.from} bis {weekly.to}
                </p>
                <p>Notizen gesamt: {weekly.notes_total}</p>
                <p>Tasks offen: {weekly.tasks_open}</p>
                <p>Tasks erledigt: {weekly.tasks_done}</p>
              </>
            ) : (
              <p className="empty-copy">Keine Weekly-Daten.</p>
            )}
          </section>
        </div>
      )
    }

    if (sidebarView === 'tags') {
      return (
        <TagSidebar
          vaultLoaded={vaultLoaded}
          width={explorerWidth}
          onWidthChange={setExplorerWidth}
          groups={mergedTagGroups}
          expandedGroups={expandedFolders}
          onToggleGroup={toggleFolder}
          onCreateGroup={() => {
            void createTagGroup()
          }}
          onCreateTag={(groupName) => {
            void createTagInExistingGroup(groupName)
          }}
          onRenameGroup={(groupName) => {
            void renameTagGroup(groupName)
          }}
          onSetGroupColor={(groupName) => {
            void setTagGroupColor(groupName)
          }}
          onDeleteGroup={(groupName) => {
            void deleteTagGroup(groupName)
          }}
          onRenameTag={(groupName, tagName) => {
            void renameTag(groupName, tagName)
          }}
          onDeleteTag={(groupName, tagName) => {
            void deleteTag(groupName, tagName)
          }}
        />
      )
    }

    return (
      <ExplorerSidebar
        vaultLoaded={vaultLoaded}
        vaultPath={vaultPath}
        groups={noteGroups}
        files={explorerRows}
        activeFilePath={activeTab?.kind === 'note' ? activeTab.path : ''}
        dirtyFilePaths={dirtyFilePaths}
        width={explorerWidth}
        onWidthChange={setExplorerWidth}
        onOpenFile={openNoteInTab}
        onPreviewFile={openNoteInCurrentEditor}
        onCreateFile={createExplorerFile}
        onCreateTask={createExplorerTask}
        onCreateFolder={createExplorerFolder}
        onRenameFile={renameExplorerFile}
        onRenameFolder={renameExplorerFolder}
        onDeleteFile={deleteExplorerFile}
        onDeleteFolder={deleteExplorerFolder}
        onMoveFile={moveExplorerFile}
        onMoveFolder={moveExplorerFolder}
        onToggleFavoriteFolder={toggleFavoriteFolder}
        options={explorerOptions}
        contentMatchFilePathKeys={explorerContentMatchPathKeys}
        onFilterQueryChange={setExplorerFilterQuery}
        onOptionsChange={setExplorerOptions}
        revealFilePath={explorerRevealPath}
        revealRequestId={explorerRevealRequestId}
        viewStateSeed={explorerViewSeed}
        viewStateSeedId={explorerViewSeedId}
        onViewStateChange={handleExplorerViewStateChange}
        onRefresh={() => {
          void refreshExplorerSidebarData()
        }}
      />
    )
  }

  const showCaptureInline = capturePanelOpen && capturePinned

  if (!vaultLoaded) {
    return (
      <div className="window-frame">
        <div className="window-titlebar" aria-hidden="true" />
        <div className="window-content">
          <div className="launch-shell">
            <div className="launch-card">
              <h1>Hallo {displayName}</h1>
              <p>Waehle eine NoteBase aus und wir laden sie direkt automatisch.</p>

              <label htmlFor="launch-display-name" className="field-label">
                Anrede
              </label>
              <input
                id="launch-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(normalizeLabel(event.target.value) || 'Max')}
                placeholder="Dein Name"
              />

              <div className="launch-actions">
                <button onClick={() => void pickAndOpenVault()}>NoteBase laden</button>
                <button onClick={() => void createVault()}>NoteBase anlegen</button>
                <button onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}>
                  {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>

              {message ? <p className="launch-message">{message}</p> : null}
              {error ? <p className="launch-error">{error}</p> : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="window-frame">
      <div className="window-titlebar" aria-hidden="true" />
      <div className="window-content">
        <div className="workbench-shell">
      <aside className="activity-rail">
        <div className="rail-brand">
          <span className="rail-logo">NN</span>
          <div className="rail-brand-copy">
            <strong>NickNotes</strong>
            <span>Workspace</span>
          </div>
        </div>

        <div className="rail-menu">
          <button
            className={sidebarView === 'vault' ? 'active' : ''}
            onClick={() => openSidebarView('vault')}
            title="Board"
          >
            <span className="rail-glyph">
              <LucideNamedIcon name="LayoutGrid" size={14} />
            </span>
            <span className="rail-label">Board</span>
          </button>
          <button
            className={sidebarView === 'notes' ? 'active' : ''}
            onClick={() => openSidebarView('notes')}
            title="Notizen"
          >
            <span className="rail-glyph">
              <LucideNamedIcon name="FileText" size={14} />
            </span>
            <span className="rail-label">Notizen</span>
          </button>
          <button
            className={sidebarView === 'tasks' ? 'active' : ''}
            onClick={() => openSidebarView('tasks')}
            title="Tasks"
          >
            <span className="rail-glyph">
              <LucideNamedIcon name="CheckSquare" size={14} />
            </span>
            <span className="rail-label">Tasks</span>
          </button>
          <button
            className={sidebarView === 'tags' ? 'active' : ''}
            onClick={() => openSidebarView('tags')}
            title="Tagging"
          >
            <span className="rail-glyph">
              <LucideNamedIcon name="Tag" size={14} />
            </span>
            <span className="rail-label">Tags</span>
          </button>
          <button
            className={sidebarView === 'review' ? 'active' : ''}
            onClick={() => openSidebarView('review')}
            title="Review"
          >
            <span className="rail-glyph">
              <LucideNamedIcon name="BarChart3" size={14} />
            </span>
            <span className="rail-label">Review</span>
          </button>
        </div>

        <div className="rail-spacer" />

        <button
          className={settingsTabOpen ? 'active' : ''}
          onClick={openSettingsTab}
          title="Einstellungen"
          aria-label="Einstellungen"
        >
          <span className="rail-glyph">
            <LucideNamedIcon name="Settings" size={14} />
          </span>
        </button>
      </aside>

      {sidebarOpen ? (
        <aside className="left-sidebar" style={{ width: `${explorerWidth}px` }}>
          {renderSidebarContent()}
        </aside>
      ) : null}

      <section className="main-region">
        <div
          ref={workspaceGridRef}
          className={`workspace-grid ${showCaptureInline ? 'with-capture-column' : ''}`}
          style={
            showCaptureInline
              ? ({
                  '--capture-inline-height': `${captureInlineHeight}px`,
                } as CSSProperties)
              : undefined
          }
        >
          {editorPanelOpen ? (
            <article className="workspace-panel editor-workspace-panel">
              <div className="editor-tabs">
                <div className="editor-tab-list">
                  {openTabs.map((tab) => {
                    const displayTitle = tab.kind === 'note' ? tab.title.replace(/\.md$/i, '') : tab.title
                    return (
                      <div
                        key={`editor-tab-${tab.path}`}
                        className={`editor-tab ${activeTab?.path === tab.path ? 'active' : ''}`}
                        draggable={tab.kind === 'note'}
                        onDragStart={(event) => {
                          if (tab.kind !== 'note') {
                            event.preventDefault()
                            return
                          }
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('application/x-open-tab-path', tab.path)
                          event.dataTransfer.setData('application/x-open-tab-title', tab.title)
                          event.dataTransfer.setData('text/plain', tab.path)
                          setDraggingTabPath(tab.path)
                        }}
                        onDragEnd={() => {
                          setDraggingTabPath('')
                          setSplitDropActive(false)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setTabContextMenu({ x: event.clientX, y: event.clientY, path: tab.path })
                        }}
                      >
                        <button
                          className="tab-open"
                          onClick={() => {
                            setActiveNotePath(tab.path)
                            setEditorPanelOpen(true)
                          }}
                          title={displayTitle}
                        >
                          <span>{displayTitle}</span>
                          {tab.dirty ? (
                            <span className="tab-dirty-dot">
                              <LucideNamedIcon name="Circle" size={8} />
                            </span>
                          ) : null}
                        </button>
                        <button className="tab-close" onClick={() => void closeEditorTab(tab.path)} title="Tab schliessen">
                          <LucideNamedIcon name="X" size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="editor-tab-actions">
                  <button
                    className="icon-button compact muted"
                    onClick={() => (activeTab ? void saveTab(activeTab.path) : undefined)}
                    disabled={!activeTab || !activeTab.dirty}
                    title="Speichern"
                  >
                    <LucideNamedIcon name="Save" size={14} />
                  </button>
                  <button
                    className="icon-button compact muted"
                    onClick={revealActiveNoteInExplorer}
                    disabled={activeTab?.kind !== 'note'}
                    title="Im Explorer anzeigen"
                  >
                    <LucideNamedIcon name="FolderSearch" size={14} />
                  </button>
                  <button
                    className="icon-button compact muted"
                    onClick={toggleSplitView}
                    disabled={activeTab?.kind !== 'note' || openNoteTabs.length < 2}
                    title={splitView ? 'Split aus' : 'Split an'}
                  >
                    <LucideNamedIcon name="Columns2" size={14} />
                  </button>
                  <button className="icon-button compact muted" onClick={toggleEditorPanel} title="Editor schliessen">
                    <LucideNamedIcon name="X" size={14} />
                  </button>
                </div>
              </div>

              <div
                className={`editor-grid ${splitView && splitPaneTabs.length > 0 ? 'split' : ''} ${
                  viewerDropActive ? 'drop-active' : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setViewerDropActive(true)
                }}
                onDragLeave={() => setViewerDropActive(false)}
                onDrop={handleViewerDrop}
                style={
                  splitView && activeTab?.kind === 'note' && splitPaneTabs.length > 0
                    ? { gridTemplateColumns: `repeat(${1 + splitPaneTabs.length}, minmax(0, 1fr))` }
                    : undefined
                }
              >
                <article
                  className="editor-pane"
                  onDragOver={(event) => {
                    event.preventDefault()
                    setViewerDropActive(true)
                  }}
                  onDrop={(event) => {
                    event.stopPropagation()
                    handleDropOnPrimaryPane(event)
                  }}
                >
                  {activeTab?.kind === 'note' && !activeTab.loading ? (
                    <div className="note-editor-shell">
                      {activeNoteDocument ? (
                        <div className="note-flow-content">
                          {renderNoteProperties(activeTab.path, activeNoteDocument)}
                          <CodeMirrorMarkdownEditor
                            key={`editor-${activeTab.path}`}
                            className="note-body-editor"
                            embeddedInScroll
                            value={activeNoteDocument.body}
                            theme={theme}
                            notePath={activeTab.path}
                            backendUrl={backendUrl}
                            tagGroups={mergedTagGroups}
                            searchHighlightQuery={explorerFilterQuery}
                            onChange={updateActiveNoteContent}
                            onInsertImageAsset={(file) => uploadImageForNote(activeTab.path, file)}
                            editorApiRef={activeEditorRef}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab ? (
                    activeTab.loading ? (
                      <p className="empty-copy">Lade Notiz ...</p>
                    ) : activeTab.kind === 'settings' ? (
                      <div className="settings-editor">
                        <h3>Einstellungen</h3>

                        <section className="settings-block">
                          <h4>Profil</h4>
                          <label htmlFor="settings-display-name">Anrede</label>
                          <input
                            id="settings-display-name"
                            value={displayName}
                            onChange={(event) => setDisplayName(normalizeLabel(event.target.value) || 'Max')}
                            placeholder="Dein Name"
                          />
                        </section>

                        <section className="settings-block">
                          <h4>Theme</h4>
                          <div className="theme-actions">
                            <button className={theme === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}>
                              Light
                            </button>
                            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}>
                              Dark
                            </button>
                          </div>
                        </section>

                        <section className="settings-block">
                          <h4>Layout</h4>
                          <label className="checkbox-row" htmlFor="settings-sidebar-open">
                            <input
                              id="settings-sidebar-open"
                              type="checkbox"
                              checked={sidebarOpen}
                              onChange={(event) => setSidebarOpen(event.target.checked)}
                            />
                            Sidebar anzeigen
                          </label>
                        </section>

                        <section className="settings-block">
                          <h4>Note Explorer</h4>
                          <label className="checkbox-row" htmlFor="settings-explorer-show-hidden">
                            <input
                              id="settings-explorer-show-hidden"
                              type="checkbox"
                              checked={explorerOptions.showHiddenFiles}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, showHiddenFiles: event.target.checked }))
                              }
                            />
                            Nicht-Markdown-Dateien anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-folders-first">
                            <input
                              id="settings-explorer-folders-first"
                              type="checkbox"
                              checked={explorerOptions.foldersFirst}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, foldersFirst: event.target.checked }))
                              }
                            />
                            Ordner zuerst anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-show-icons">
                            <input
                              id="settings-explorer-show-icons"
                              type="checkbox"
                              checked={explorerOptions.showIcons}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, showIcons: event.target.checked }))
                              }
                            />
                            Dateisymbole anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-compact">
                            <input
                              id="settings-explorer-compact"
                              type="checkbox"
                              checked={explorerOptions.compactMode}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, compactMode: event.target.checked }))
                              }
                            />
                            Kompakte Zeilen
                          </label>
                        </section>

                        <section className="settings-block">
                          <h4>Statusleiste</h4>
                          <label className="checkbox-row" htmlFor="settings-status-notebase">
                            <input
                              id="settings-status-notebase"
                              type="checkbox"
                              checked={statusBarPrefs.showNoteBaseName}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showNoteBaseName: event.target.checked }))
                              }
                            />
                            NoteBase-Name anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-open-tasks">
                            <input
                              id="settings-status-open-tasks"
                              type="checkbox"
                              checked={statusBarPrefs.showOpenTasks}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showOpenTasks: event.target.checked }))
                              }
                            />
                            Offene Tasks anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-due-today">
                            <input
                              id="settings-status-due-today"
                              type="checkbox"
                              checked={statusBarPrefs.showDueToday}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showDueToday: event.target.checked }))
                              }
                            />
                            Heute faellige Tasks anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-total-notes">
                            <input
                              id="settings-status-total-notes"
                              type="checkbox"
                              checked={statusBarPrefs.showTotalNotes}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showTotalNotes: event.target.checked }))
                              }
                            />
                            Anzahl Notizen anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-message">
                            <input
                              id="settings-status-message"
                              type="checkbox"
                              checked={statusBarPrefs.showStateMessage}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showStateMessage: event.target.checked }))
                              }
                            />
                            Statusmeldung anzeigen
                          </label>
                        </section>

                        <div className="settings-editor-actions">
                            <button
                              onClick={() => {
                                void saveSettings()
                              }}
                              disabled={!settingsDirty}
                            >
                              Speichern
                            </button>
                          <button onClick={discardSettings} disabled={!settingsDirty}>
                            Verwerfen
                          </button>
                        </div>
                      </div>
                    ) : null
                  ) : (
                    <div className="main-empty-state">
                      <p className="main-empty-glyph">
                        <LucideNamedIcon name="FileText" size={20} />
                      </p>
                      <p className="empty-copy">Noch keine Notiz geoeffnet.</p>
                    </div>
                  )}
                </article>

                {splitView && activeTab?.kind === 'note'
                  ? splitPaneTabs.map((paneTab) => {
                      const paneDocument = parseNoteDocument(paneTab.content, paneTab.title || toNoteDisplayName(paneTab.path))
                      return (
                        <article
                          key={`split-pane-${paneTab.path}`}
                          className="editor-pane split-editor-pane"
                          onDragOver={(event) => {
                            event.preventDefault()
                            setViewerDropActive(true)
                          }}
                          onDrop={(event) => {
                            event.stopPropagation()
                            handleDropOnSplitPane(event, paneTab.path)
                          }}
                        >
                          {paneTab.loading ? (
                            <p className="empty-copy">Lade Notiz ...</p>
                          ) : (
                            <div className="note-editor-shell split-note-editor-shell">
                              <div className="note-flow-content split-note-flow-content">
                                {renderNoteProperties(paneTab.path, paneDocument, true)}
                                <CodeMirrorMarkdownEditor
                                  key={`editor-split-${paneTab.path}`}
                                  className="note-body-editor split-note-body-editor"
                                  embeddedInScroll
                                  value={paneDocument.body}
                                  theme={theme}
                                  notePath={paneTab.path}
                                  backendUrl={backendUrl}
                                  tagGroups={mergedTagGroups}
                                  searchHighlightQuery={explorerFilterQuery}
                                  onChange={(nextContent) => updateNoteContentByPath(paneTab.path, nextContent)}
                                  onInsertImageAsset={(file) => uploadImageForNote(paneTab.path, file)}
                                  editorApiRef={secondaryEditorRef}
                                />
                              </div>
                            </div>
                          )}
                        </article>
                      )
                    })
                  : null}

                {draggingTabPath ? (
                  <aside
                    className={`editor-split-dropzone ${splitDropActive ? 'active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setSplitDropActive(true)
                    }}
                    onDragLeave={() => {
                      setSplitDropActive(false)
                    }}
                    onDrop={(event) => {
                      event.stopPropagation()
                      handleDropToNewSplitPane(event)
                    }}
                    title="Als neues Split-Fenster oeffnen"
                  >
                    <LucideNamedIcon name="Plus" size={18} />
                  </aside>
                ) : null}
              </div>

            </article>
          ) : null}

          {showCaptureInline ? (
            <div
              className={`capture-resize-handle ${captureResizing ? 'active' : ''}`}
              onPointerDown={(event) => {
                event.preventDefault()
                setCaptureResizing(true)
              }}
              title="Quick Capture Hoehe anpassen"
            />
          ) : null}

          {showCaptureInline ? (
            <section className="workspace-panel capture-workspace-panel">
              <div className="panel-header-row">
                <h3>Quick Capture</h3>
                <div className="panel-inline-actions">
                  <button className="icon-button compact muted" onClick={toggleCapturePinned} title="In Dock verschieben">
                    <LucideNamedIcon name="Pin" size={14} />
                  </button>
                  <button className="icon-button compact muted" onClick={closeCapturePanel} title="Quick Capture schliessen">
                    <LucideNamedIcon name="X" size={14} />
                  </button>
                </div>
              </div>
              <div className="capture-panel-body">
                <p className="capture-meta">Vorschlaege {suggestions.length} | Tags {chosenTags.size} | Tasks erkannt {parsedTasks.length}</p>
                <div className="capture-input-wrap">
                  <span className="capture-prompt">&gt;</span>
                  <input
                    value={captureText}
                    onChange={(event) => setCaptureText(event.target.value)}
                    onKeyDown={onQuickCaptureKeyDown}
                    placeholder="Gedanke eingeben und Enter druecken"
                  />
                  <button onClick={() => void saveCapture()} disabled={!captureText.trim()}>
                    Senden
                  </button>
                </div>
                <div className="capture-result">{error ? <span className="state-error">{error}</span> : <span>{message}</span>}</div>
              </div>
            </section>
          ) : null}
        </div>
        <div className="bottom-dock">
          {!showCaptureInline ? (
            <button className="dock-tab" onClick={openCaptureFromDock}>
              Quick Capture
            </button>
          ) : (
            <span className="dock-placeholder">Dock bereit</span>
          )}
        </div>
      </section>

      {tabContextMenu && tabContextTarget?.kind === 'note' ? (
        <div
          className="editor-tab-context-menu"
          style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              showNoteInSplitView(tabContextTarget.path)
            }}
            disabled={openNoteTabs.length < 2}
          >
            In separater Registerkarte anzeigen
          </button>
          <button
            className="muted"
            onClick={() => {
              void closeEditorTab(tabContextTarget.path)
            }}
          >
            Registerkarte schliessen
          </button>
        </div>
      ) : null}

      <footer className="status-bar">
        <div className="status-bar-left">
          {statusBarPrefs.showStateMessage ? (
            <span className={`status-item ${error ? 'error' : ''}`}>{error || message}</span>
          ) : (
            <span className="status-item">&nbsp;</span>
          )}
        </div>
        <div className="status-bar-right">
          {statusBarPrefs.showTotalNotes ? <span className="status-item">Notizen: {counts.notes}</span> : null}
          {statusBarPrefs.showOpenTasks ? <span className="status-item">Tasks offen: {counts.openTasks}</span> : null}
          {statusBarPrefs.showDueToday ? <span className="status-item">Heute faellig: {dueTodayCount}</span> : null}
          {statusBarPrefs.showNoteBaseName ? <span className="status-item">NoteBase: {noteBaseName}</span> : null}
        </div>
      </footer>

      {tagActionDialog ? (
        <div
          className="modal-overlay"
          onClick={() => {
            closeTagActionDialog('cancel')
          }}
        >
          <aside
            className="tag-action-modal"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeTagActionDialog('cancel')
                return
              }
              if (event.key === 'Enter') {
                const target = event.target
                if (target instanceof HTMLTextAreaElement) {
                  return
                }
                event.preventDefault()
                closeTagActionDialog('confirm')
              }
            }}
          >
            <header className="sidebar-header-row">
              <h3>{tagActionDialog.title}</h3>
            </header>

            {tagActionDialog.message ? <p className="muted-copy">{tagActionDialog.message}</p> : null}

            {tagActionDialog.kind === 'input' ? (
              <input
                value={tagActionDialog.value}
                placeholder={tagActionDialog.placeholder}
                autoFocus
                onChange={(event) => {
                  const nextValue = event.target.value
                  setTagActionDialog((current) => (current ? { ...current, value: nextValue } : current))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    closeTagActionDialog('confirm')
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeTagActionDialog('cancel')
                  }
                }}
              />
            ) : null}

            {tagActionDialog.kind === 'group-form' ? (
              <div className="tag-form-grid">
                <label className="tag-form-label" htmlFor="tag-group-id">
                  Gruppen-ID
                </label>
                <input
                  id="tag-group-id"
                  autoFocus
                  value={tagActionDialog.groupValues?.id ?? ''}
                  placeholder="z. B. projekt"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTagActionDialog((current) =>
                      current && current.kind === 'group-form'
                        ? {
                            ...current,
                            groupValues: {
                              id: nextValue,
                              displayName: current.groupValues?.displayName ?? '',
                              color: current.groupValues?.color ?? TAG_COLOR_PRESETS[0],
                            },
                          }
                        : current
                    )
                  }}
                />

                <label className="tag-form-label" htmlFor="tag-group-display-name">
                  Anzeigename
                </label>
                <input
                  id="tag-group-display-name"
                  value={tagActionDialog.groupValues?.displayName ?? ''}
                  placeholder="z. B. Projekte"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTagActionDialog((current) =>
                      current && current.kind === 'group-form'
                        ? {
                            ...current,
                            groupValues: {
                              id: current.groupValues?.id ?? '',
                              displayName: nextValue,
                              color: current.groupValues?.color ?? TAG_COLOR_PRESETS[0],
                            },
                          }
                        : current
                    )
                  }}
                />

                <label className="tag-form-label">Farbe</label>
                <div className="tag-color-picker-stack">
                  <div className="tag-color-presets">
                    {TAG_COLOR_PRESETS.map((preset) => {
                      const isActive = normalizeTagColor(tagActionDialog.groupValues?.color ?? '') === normalizeTagColor(preset)
                      return (
                        <button
                          key={`tag-color-${preset}`}
                          type="button"
                          className={`tag-color-swatch ${isActive ? 'active' : ''}`}
                          style={{ backgroundColor: preset }}
                          onClick={() => {
                            setTagActionDialog((current) =>
                              current && current.kind === 'group-form'
                                ? {
                                    ...current,
                                    groupValues: {
                                      id: current.groupValues?.id ?? '',
                                      displayName: current.groupValues?.displayName ?? '',
                                      color: preset,
                                    },
                                  }
                                : current
                            )
                          }}
                          title={preset}
                          aria-label={`Farbe ${preset}`}
                        />
                      )
                    })}
                  </div>
                  <div className="tag-color-custom-row">
                    <input
                      type="color"
                      value={normalizeTagColor(tagActionDialog.groupValues?.color ?? TAG_COLOR_PRESETS[0])}
                      onChange={(event) => {
                        const nextColor = normalizeTagColor(event.target.value)
                        setTagActionDialog((current) =>
                          current && current.kind === 'group-form'
                            ? {
                                ...current,
                                groupValues: {
                                  id: current.groupValues?.id ?? '',
                                  displayName: current.groupValues?.displayName ?? '',
                                  color: nextColor,
                                },
                              }
                            : current
                        )
                      }}
                      aria-label="Benutzerdefinierte Farbe"
                    />
                    <span className="muted-copy">Eigene Farbe waehlen</span>
                  </div>
                </div>
              </div>
            ) : null}

            {tagActionDialog.kind === 'tag-form' ? (
              <div className="tag-form-grid">
                <label className="tag-form-label" htmlFor="tag-id">
                  Tag-ID
                </label>
                <input
                  id="tag-id"
                  autoFocus
                  value={tagActionDialog.tagValues?.id ?? ''}
                  placeholder="z. B. projekt-a"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTagActionDialog((current) =>
                      current && current.kind === 'tag-form'
                        ? {
                            ...current,
                            tagValues: {
                              id: nextValue,
                              displayName: current.tagValues?.displayName ?? '',
                            },
                          }
                        : current
                    )
                  }}
                />

                <label className="tag-form-label" htmlFor="tag-display-name">
                  Anzeigename
                </label>
                <input
                  id="tag-display-name"
                  value={tagActionDialog.tagValues?.displayName ?? ''}
                  placeholder="z. B. Projekt A"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTagActionDialog((current) =>
                      current && current.kind === 'tag-form'
                        ? {
                            ...current,
                            tagValues: {
                              id: current.tagValues?.id ?? '',
                              displayName: nextValue,
                            },
                          }
                        : current
                    )
                  }}
                />
              </div>
            ) : null}

            {tagActionDialog.kind === 'color-form' ? (
              <div className="tag-form-grid">
                <label className="tag-form-label">Farbe</label>
                <div className="tag-color-picker-stack">
                  <div className="tag-color-presets">
                    {TAG_COLOR_PRESETS.map((preset) => {
                      const isActive = normalizeTagColor(tagActionDialog.groupValues?.color ?? '') === normalizeTagColor(preset)
                      return (
                        <button
                          key={`group-color-only-${preset}`}
                          type="button"
                          className={`tag-color-swatch ${isActive ? 'active' : ''}`}
                          style={{ backgroundColor: preset }}
                          onClick={() => {
                            setTagActionDialog((current) =>
                              current && current.kind === 'color-form'
                                ? {
                                    ...current,
                                    groupValues: {
                                      id: current.groupValues?.id ?? '',
                                      displayName: current.groupValues?.displayName ?? '',
                                      color: preset,
                                    },
                                  }
                                : current
                            )
                          }}
                          title={preset}
                          aria-label={`Farbe ${preset}`}
                        />
                      )
                    })}
                  </div>
                  <div className="tag-color-custom-row">
                    <input
                      type="color"
                      autoFocus
                      value={normalizeTagColor(tagActionDialog.groupValues?.color ?? TAG_COLOR_PRESETS[0])}
                      onChange={(event) => {
                        const nextColor = normalizeTagColor(event.target.value)
                        setTagActionDialog((current) =>
                          current && current.kind === 'color-form'
                            ? {
                                ...current,
                                groupValues: {
                                  id: current.groupValues?.id ?? '',
                                  displayName: current.groupValues?.displayName ?? '',
                                  color: nextColor,
                                },
                              }
                            : current
                        )
                      }}
                      aria-label="Benutzerdefinierte Farbe"
                    />
                    <span className="muted-copy">Eigene Farbe waehlen</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="tag-action-modal-actions">
              {tagActionDialog.actions.map((action) => (
                <button
                  key={`tag-action-${action.id}`}
                  className={`tag-action-button ${action.tone === 'danger' ? 'danger' : ''} ${
                    action.tone === 'primary' ? 'primary' : ''
                  }`}
                  onClick={() => {
                    closeTagActionDialog(action.id)
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

        </div>
      </div>
    </div>
  )
}

export default App



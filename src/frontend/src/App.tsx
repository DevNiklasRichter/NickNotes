import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CodeMirrorMarkdownEditor } from './editor/CodeMirrorMarkdownEditor'
import type { MarkdownEditorApi, MarkdownLinkTarget } from './editor/CodeMirrorMarkdownEditor'
import { NotePropertiesPanel } from './editor/NotePropertiesPanel'
import {
  parseNoteDocument,
  serializeNoteDocument,
  extractAutoTags,
  extractRelatedLinks,
  type ParsedNoteDocument,
  type TaskPriority,
  type TaskStatus,
} from './editor/noteDocument'
import { LucideNamedIcon } from './icons/lucideCatalog'
import { ActivityRail } from './layout/ActivityRail'
import { StatusBar } from './layout/StatusBar'
import { WorkbenchSidebarContent } from './sidebar/WorkbenchSidebarContent'
import { SettingsEditorPanel } from './settings/SettingsEditorPanel'
import { TodoDashboardCanvas } from './todos/TodoDashboardCanvas'
import { TaskDashboardCanvas } from './tasks/TaskDashboardCanvas'
import { FocusDashboardCanvas } from './focus/FocusDashboardCanvas'
import { ReviewDashboardCanvas } from './review/ReviewDashboardCanvas'
import { GraphDashboardCanvas } from './graph/GraphDashboardCanvas'
import { GraphWorkspaceProvider } from './graph/GraphWorkspaceContext'
import { EditorWorkspaceLayout, type ExternalNoteDropPayload } from './workspace/EditorWorkspaceLayout'
import {
  createInitialWorkspaceState,
  findPaneByTabId,
  findOpenTabByNoteId,
  getActiveTabIdForPane,
  type PaneId,
  workspaceReducer,
} from './workspace/workspaceState'
import type { ExplorerOptions, ExplorerViewState } from './explorer/types'
import {
  normalizeTagColor,
  normalizeTagId,
  type TagGroupDefinition,
} from './tags/tagTypes'
import {
  TagActionDialogModal,
  type TagActionDialogAction,
  type TagActionDialogResult,
  type TagActionDialogState,
  type TagFormValues,
  type TagGroupFormValues,
} from './tags/TagActionDialogModal'
import './App.css'
import {
  SETTINGS_TAB_PATH,
  TODO_DASHBOARD_TAB_PATH,
  TASK_DASHBOARD_TAB_PATH,
  FOCUS_DASHBOARD_TAB_PATH,
  REVIEW_DASHBOARD_TAB_PATH,
  GRAPH_DASHBOARD_TAB_PATH,
  DEFAULT_STATUS_BAR_PREFS,
  DEFAULT_TASK_FEATURE_SETTINGS,
  DEFAULT_EXPLORER_OPTIONS,
  DEFAULT_EXPLORER_VIEW_STATE,
  DEFAULT_TODO_DASHBOARD_FILTERS,
  DEFAULT_TASK_DASHBOARD_FILTERS,
  DEFAULT_FOCUS_DASHBOARD_FILTERS,
  DEFAULT_REVIEW_DASHBOARD_FILTERS,
  TAG_COLOR_PRESETS,
  TASK_STATUS_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  normalizeWikiLookup,
  getPreferredTheme,
  apiRequest,
  toGermanTimestamp,
  getFileName,
  getPathTail,
  toNoteDisplayName,
  normalizeFilePathKey,
  normalizeNoteTypeValue,
  normalizeLabel,
  normalizeTagCandidate,
  normalizeRelatedCandidate,
  deriveImageAltText,
  readFileAsBase64,
  normalizeTaskStatusValue,
  taskStatusLabel,
  taskStatusClassName,
  taskStatusDotClassName,
  taskStatusOptionLabel,
  normalizeTaskPriorityValue,
  taskPriorityLabel,
  taskPriorityDotClassName,
  taskPriorityOptionLabel,
  isPermanentPinnedRootGroupKey,
  toStorageTagGroups,
  getStoredLastNoteBasePath,
  storeLastNoteBasePath,
  clearStoredLastNoteBasePath,
  areStatusBarPrefsEqual,
  areTaskFeatureSettingsEqual,
  areExplorerOptionsEqual,
  toBoolean,
  toBoundedNumber,
  toThemeMode,
  toStatusBarPrefsFromSettings,
  toTaskFeatureSettingsFromSettings,
  toExplorerOptionsFromSettings,
  toExpandedTagGroups,
  toExplorerViewStateFromSettings,
  areExplorerViewStatesEqual,
  toLocalIsoDate,
  getRelativeVaultPath,
} from './app/AppShared'
import type {
  VaultCounts,
  Suggestion,
  TaskRow,
  TodoRow,
  SearchRow,
  MediaUploadResponse,
  BackendState,
  ThemeMode,
  SidebarView,
  NoteTab,
  TodoDashboardFilters,
  TaskDashboardFilters,
  FocusDashboardFilters,
  ReviewDashboardFilters,
  ReviewDashboardResponse,
  FocusDashboardAggregateResponse,
  EditorTabContextMenuState,
  StatusBarPrefs,
  TaskFeatureSettings,
  UiSettingsPayload,
  NoteGroup,
  GraphIndexStatus,
} from './app/AppShared'

const CAPTURE_PREVIEW_IDLE_MS = 1200
const CAPTURE_PREVIEW_MIN_CHARS = 3
const NOTEBASE_OPEN_POLL_MS = 160

type NoteBaseOpenStatus = {
  active: boolean
  done: boolean
  error: string | null
  phase: string
  processed: number
  total: number
  currentPath?: string | null
  result?: {
    counts: VaultCounts
    noteBasePath?: string
    vaultPath?: string
    tagGroups?: unknown
  } | null
}

type TagMatchCandidate = {
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

type TagMatchAssistantState = {
  open: boolean
  loading: boolean
  applying: boolean
  cursor: number
  items: TagMatchCandidate[]
  skippedIds: string[]
}

function resolveGraphNodePath(path: string, vaultPath: string): string {
  const cleanPath = normalizeLabel(path)
  if (!cleanPath || /^[A-Za-z]:[\\/]/.test(cleanPath) || cleanPath.startsWith('\\\\')) {
    return cleanPath
  }
  const cleanVaultPath = normalizeLabel(vaultPath).replace(/[\\/]+$/, '')
  if (!cleanVaultPath) {
    return cleanPath
  }
  const relativePath = cleanPath.replace(/^[\\/]+/, '').replace(/\//g, '\\')
  return `${cleanVaultPath}\\${relativePath}`
}

function App() {
  const autoOpenTriedRef = useRef(false)
  const explorerRecoveryRef = useRef(false)
  const uiSettingsReadyRef = useRef(false)
  const explorerViewSaveTimerRef = useRef<number | null>(null)
  const appLayoutSaveTimerRef = useRef<number | null>(null)
  const workspaceGridRef = useRef<HTMLDivElement | null>(null)
  const capturePreviewRequestSeqRef = useRef(0)
  const capturePreviewLastTextRef = useRef('')
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8765')
  const [theme, setTheme] = useState<ThemeMode>(getPreferredTheme)

  const [vaultPath, setVaultPath] = useState(getStoredLastNoteBasePath)
  const [vaultLoaded, setVaultLoaded] = useState(false)
  const [noteBaseOpenStatus, setNoteBaseOpenStatus] = useState<NoteBaseOpenStatus | null>(null)
  const [counts, setCounts] = useState<VaultCounts>({ notes: 0, openTasks: 0, doneTasks: 0 })

  const [captureText, setCaptureText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([])
  const [ignoredCaptureTagKeys, setIgnoredCaptureTagKeys] = useState<string[]>([])

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [taskDashboardFilters, setTaskDashboardFilters] = useState<TaskDashboardFilters>({ ...DEFAULT_TASK_DASHBOARD_FILTERS })
  const [todoDashboardFilters, setTodoDashboardFilters] = useState<TodoDashboardFilters>({ ...DEFAULT_TODO_DASHBOARD_FILTERS })
  const [focusDashboardFilters, setFocusDashboardFilters] = useState<FocusDashboardFilters>({ ...DEFAULT_FOCUS_DASHBOARD_FILTERS })
  const [reviewDashboardFilters, setReviewDashboardFilters] = useState<ReviewDashboardFilters>({ ...DEFAULT_REVIEW_DASHBOARD_FILTERS })
  const [reviewDashboardData, setReviewDashboardData] = useState<ReviewDashboardResponse | null>(null)
  const [focusMitIds, setFocusMitIds] = useState<string[]>([])
  const [searchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  const [allNotes, setAllNotes] = useState<SearchRow[]>([])
  const [explorerFiles, setExplorerFiles] = useState<SearchRow[]>([])
  const [explorerFilterQuery, setExplorerFilterQuery] = useState('')
  const [explorerContentMatchPathKeys, setExplorerContentMatchPathKeys] = useState<Set<string>>(new Set())

  const [sidebarView, setSidebarView] = useState<SidebarView>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [displayName, setDisplayName] = useState('Max')
  const [createNoteBaseDialogOpen, setCreateNoteBaseDialogOpen] = useState(false)
  const [createNoteBaseParentPath, setCreateNoteBaseParentPath] = useState('')
  const [createNoteBaseName, setCreateNoteBaseName] = useState('')
  const [createNoteBaseDisplayName, setCreateNoteBaseDisplayName] = useState('Max')
  const [createNoteBasePending, setCreateNoteBasePending] = useState(false)
  const [statusBarPrefs, setStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS })
  const [taskFeatureSettings, setTaskFeatureSettings] = useState<TaskFeatureSettings>({ ...DEFAULT_TASK_FEATURE_SETTINGS })
  const [explorerOptions, setExplorerOptions] = useState<ExplorerOptions>({ ...DEFAULT_EXPLORER_OPTIONS })
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(getPreferredTheme)
  const [savedDisplayName, setSavedDisplayName] = useState('Max')
  const [savedSidebarOpen, setSavedSidebarOpen] = useState(true)
  const [savedStatusBarPrefs, setSavedStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS })
  const [savedTaskFeatureSettings, setSavedTaskFeatureSettings] = useState<TaskFeatureSettings>({ ...DEFAULT_TASK_FEATURE_SETTINGS })
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
  const [explorerViewState, setExplorerViewState] = useState<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE })
  const explorerViewStateRef = useRef<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE })
  const [explorerViewSeed, setExplorerViewSeed] = useState<ExplorerViewState | null>(null)
  const [explorerViewSeedId, setExplorerViewSeedId] = useState(0)
  const [explorerRevealPath, setExplorerRevealPath] = useState('')
  const [explorerRevealRequestId, setExplorerRevealRequestId] = useState(0)
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupDefinition[]>([])
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([])
  const [graphUpdateToken, setGraphUpdateToken] = useState(0)
  const [latestGraphStatus, setLatestGraphStatus] = useState<GraphIndexStatus | null>(null)

  const [openTabs, setOpenTabs] = useState<NoteTab[]>([])
  const openTabsRef = useRef<NoteTab[]>([])
  const [workspaceState, dispatchWorkspace] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState)
  const workspaceStateRef = useRef(workspaceState)
  const tabIdCounterRef = useRef(0)
  const [tabContextMenu, setTabContextMenu] = useState<EditorTabContextMenuState>(null)
  const [tagActionDialog, setTagActionDialog] = useState<TagActionDialogState | null>(null)
  const tagActionDialogRef = useRef<TagActionDialogState | null>(null)
  const [tagMatchAssistant, setTagMatchAssistant] = useState<TagMatchAssistantState>({
    open: false,
    loading: false,
    applying: false,
    cursor: 0,
    items: [],
    skippedIds: [],
  })
  const [propertyTagInputOpenByPath, setPropertyTagInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyTagDraftByPath, setPropertyTagDraftByPath] = useState<Record<string, string>>({})
  const [propertyRelatedInputOpenByPath, setPropertyRelatedInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyRelatedDraftByPath, setPropertyRelatedDraftByPath] = useState<Record<string, string>>({})
  const [propertyTaskFieldErrorsByPath, setPropertyTaskFieldErrorsByPath] = useState<
    Record<string, { estimate_minutes?: string; follow_up_date?: string }>
  >({})
  const leftEditorRef = useRef<MarkdownEditorApi | null>(null)
  const rightEditorRef = useRef<MarkdownEditorApi | null>(null)
  const captureEditorRef = useRef<MarkdownEditorApi | null>(null)

  const [message, setMessage] = useState('Backend wird vorbereitet ...')
  const [error, setError] = useState('')

  useEffect(() => {
    explorerViewStateRef.current = explorerViewState
  }, [explorerViewState])

  openTabsRef.current = openTabs
  workspaceStateRef.current = workspaceState

  const createTabId = () => {
    tabIdCounterRef.current += 1
    return `tab-${Date.now()}-${tabIdCounterRef.current}`
  }

  const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '')
  const toNoteId = (path: string): string => normalizePath(path).toLowerCase()
  const isTagOverviewPath = (path: string): boolean => {
    const normalized = normalizePath(path).toLowerCase()
    return /\/(tags|02_tags)\//.test(normalized) && normalized.endsWith('/overview.md')
  }
  const isTagIndexFrontmatter = (content: string): boolean => {
    const normalized = content.replace(/^\uFEFF/, '')
    if (!normalized.startsWith('---')) {
      return false
    }
    const frontmatterEnd = normalized.indexOf('\n---', 3)
    const frontmatter = frontmatterEnd >= 0 ? normalized.slice(0, frontmatterEnd) : normalized.slice(0, 2000)
    return /(^|\n)\s*type\s*:\s*tag_index\s*($|\n)/i.test(frontmatter)
  }
  const isTagOverviewReadOnly = (path: string, content: string): boolean => isTagOverviewPath(path) || isTagIndexFrontmatter(content)
  const parseTagReference = (rawTag: string): { groupId: string; tagId: string } | null => {
    const cleanRaw = normalizeLabel(rawTag).replace(/^\{tag:/i, '').replace(/\}$/g, '').replace(/^#+/, '')
    if (!cleanRaw) {
      return null
    }
    const delimiter = cleanRaw.includes(':') ? ':' : cleanRaw.includes('/') ? '/' : ''
    if (!delimiter) {
      return null
    }
    const [groupRaw, tagRaw] = cleanRaw.split(delimiter, 2)
    const groupId = groupRaw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    const tagId = tagRaw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!groupId || !tagId) {
      return null
    }
    return { groupId, tagId }
  }

  const findTabByPath = (path: string, tabs: NoteTab[] = openTabsRef.current): NoteTab | null => {
    const targetKey = toNoteId(path)
    for (const tab of tabs) {
      if (toNoteId(tab.path) === targetKey) {
        return tab
      }
    }
    return null
  }

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
  }, [
    backendUrl,
    capturePanelOpen,
    capturePinned,
    editorPanelOpen,
    expandedFolders,
    explorerWidth,
    vaultLoaded,
    workspaceState.layoutMode,
    workspaceState.splitRatio,
  ])

  const settingsDirty = useMemo(
    () =>
      theme !== savedTheme ||
      displayName !== savedDisplayName ||
      sidebarOpen !== savedSidebarOpen ||
      !areStatusBarPrefsEqual(statusBarPrefs, savedStatusBarPrefs) ||
      !areTaskFeatureSettingsEqual(taskFeatureSettings, savedTaskFeatureSettings) ||
      !areExplorerOptionsEqual(explorerOptions, savedExplorerOptions),
    [
      displayName,
      explorerOptions,
      savedDisplayName,
      savedExplorerOptions,
      savedSidebarOpen,
      savedStatusBarPrefs,
      savedTaskFeatureSettings,
      savedTheme,
      sidebarOpen,
      statusBarPrefs,
      taskFeatureSettings,
      theme,
    ]
  )

  const hasUnsavedChanges = useMemo(
    () => settingsDirty || openTabs.some((tab) => tab.kind === 'note' && tab.dirty),
    [openTabs, settingsDirty]
  )

  const tabsById = useMemo<Record<string, NoteTab>>(() => {
    const map: Record<string, NoteTab> = {}
    for (const tab of openTabs) {
      map[tab.id] = tab
    }
    return map
  }, [openTabs])

  const tabRegistryKey = useMemo(
    () =>
      openTabs
        .map((tab) => `${tab.id}\u0000${toNoteId(tab.path)}`)
        .sort((left, right) => left.localeCompare(right))
        .join('\n'),
    [openTabs]
  )

  useEffect(() => {
    const registry = openTabs.map((tab) => ({
      id: tab.id,
      noteId: toNoteId(tab.path),
    }))
    dispatchWorkspace({ type: 'REGISTER_TABS', tabs: registry })
    // tabRegistryKey intentionally excludes content/title-only updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRegistryKey])

  const paneTabs = useMemo<Record<PaneId, NoteTab[]>>(() => {
    const leftTabs = workspaceState.panes.left.tabIds.map((tabId) => tabsById[tabId]).filter(Boolean) as NoteTab[]
    const rightTabs = workspaceState.panes.right.tabIds.map((tabId) => tabsById[tabId]).filter(Boolean) as NoteTab[]
    return {
      left: leftTabs,
      right: rightTabs,
    }
  }, [tabsById, workspaceState.panes.left.tabIds, workspaceState.panes.right.tabIds])

  const paneActiveTabs = useMemo<Record<PaneId, NoteTab | null>>(() => {
    const leftActiveId = getActiveTabIdForPane(workspaceState, 'left')
    const rightActiveId = getActiveTabIdForPane(workspaceState, 'right')
    return {
      left: leftActiveId ? tabsById[leftActiveId] ?? null : null,
      right: rightActiveId ? tabsById[rightActiveId] ?? null : null,
    }
  }, [tabsById, workspaceState])

  const activePaneId = workspaceState.lastFocusedPane
  const activeTab = paneActiveTabs[activePaneId] ?? paneActiveTabs.left ?? paneActiveTabs.right ?? null

  const refreshTasks = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=true')
    setTasks(response.items)
  }

  const refreshTodos = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: TodoRow[] }>(backendUrl, '/todos')
    setTodos(response.items)
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

  const toReviewWindowDays = (windowValue: ReviewDashboardFilters['window']): number => {
    if (windowValue === 'today') {
      return 1
    }
    if (windowValue === '7d') {
      return 7
    }
    if (windowValue === '90d') {
      return 90
    }
    return 30
  }

  const refreshReview = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const todayIso = toLocalIsoDate()
      const reviewDays = toReviewWindowDays(reviewDashboardFilters.window)
      const dashboard = await apiRequest<ReviewDashboardResponse>(
        backendUrl,
        `/review/dashboard?days=${reviewDays}&top=10&day=${encodeURIComponent(todayIso)}`
      )
      setReviewDashboardData(dashboard)
    } catch (caught) {
      setError(String(caught))
      setReviewDashboardData(null)
    }
  }

  useEffect(() => {
    if (!vaultLoaded) {
      return
    }
    void refreshReview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultLoaded, reviewDashboardFilters.window])

  const refreshFocusAggregate = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    const todayIso = toLocalIsoDate()
    const response = await apiRequest<FocusDashboardAggregateResponse>(
      backendUrl,
      `/focus/dashboard?date=${encodeURIComponent(todayIso)}`
    )
    setTasks(Array.isArray(response.tasks) ? response.tasks : [])
    setTodos(Array.isArray(response.todos) ? response.todos : [])
    setAllNotes(Array.isArray(response.notes) ? response.notes : [])
    setFocusMitIds(Array.isArray(response.mitIds) ? response.mitIds : [])
    if (response.counts) {
      setCounts(response.counts)
    }
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
    await Promise.allSettled([refreshTasks(force), refreshNoteGroups(force), refreshAllNotes(force), refreshExplorerFiles(force)])
  }

  const refreshWorkspaceData = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    await Promise.allSettled([
      refreshTasks(force),
      refreshFocusAggregate(force),
      runSearch(searchQuery, force),
      refreshReview(force),
      refreshTagGroups(force),
      refreshExplorerSidebarData(force),
    ])
  }

  const saveUiSettingsPatch = useCallback(
    async (patch: { app?: Record<string, unknown>; explorer?: ExplorerViewState }) => {
      await apiRequest<{ settings: UiSettingsPayload }>(backendUrl, '/ui-settings', {
        method: 'POST',
        body: JSON.stringify(patch),
      })
    },
    [backendUrl]
  )

  const buildFullAppUiSettings = (): Record<string, unknown> => ({
    theme,
    displayName,
    sidebarOpen,
    statusBarPrefs,
    taskFeatureSettings,
    explorerOptions,
    explorerWidth,
    editorPanelOpen,
    capturePanelOpen,
    capturePinned,
    tagExpandedGroups: expandedFolders,
    workspaceLayoutMode: workspaceState.layoutMode,
    workspaceSplitRatio: workspaceState.splitRatio,
  })

  const buildLayoutUiSettings = (): Record<string, unknown> => ({
    explorerWidth,
    editorPanelOpen,
    capturePanelOpen,
    capturePinned,
    tagExpandedGroups: expandedFolders,
    workspaceLayoutMode: workspaceState.layoutMode,
    workspaceSplitRatio: workspaceState.splitRatio,
  })

  const applyUiSettings = (settings: UiSettingsPayload) => {
    const appSettings = settings.app ?? {}

    const nextTheme = toThemeMode(appSettings.theme, getPreferredTheme())
    const nextDisplayName = normalizeLabel(typeof appSettings.displayName === 'string' ? appSettings.displayName : '') || 'Max'
    const nextSidebarOpen = toBoolean(appSettings.sidebarOpen, true)
    const nextStatusBarPrefs = toStatusBarPrefsFromSettings(appSettings.statusBarPrefs)
    const nextTaskFeatureSettings = toTaskFeatureSettingsFromSettings(appSettings.taskFeatureSettings)
    const nextExplorerOptions = toExplorerOptionsFromSettings(appSettings.explorerOptions)
    const nextExplorerWidth = toBoundedNumber(appSettings.explorerWidth, 300, 220, 520)
    const nextEditorPanelOpen = toBoolean(appSettings.editorPanelOpen, true)
    const nextCapturePanelOpen = toBoolean(appSettings.capturePanelOpen, true)
    const nextCapturePinned = toBoolean(appSettings.capturePinned, true)
    const nextExpandedGroups = toExpandedTagGroups(appSettings.tagExpandedGroups)
    const nextWorkspaceLayoutMode = appSettings.workspaceLayoutMode === 'split' ? 'split' : 'single'
    const nextWorkspaceSplitRatio = toBoundedNumber(appSettings.workspaceSplitRatio, 0.5, 0.15, 0.85)

    setTheme(nextTheme)
    setDisplayName(nextDisplayName)
    setSidebarOpen(nextSidebarOpen)
    setStatusBarPrefs(nextStatusBarPrefs)
    setTaskFeatureSettings(nextTaskFeatureSettings)
    setExplorerOptions(nextExplorerOptions)
    setSavedTheme(nextTheme)
    setSavedDisplayName(nextDisplayName)
    setSavedSidebarOpen(nextSidebarOpen)
    setSavedStatusBarPrefs(nextStatusBarPrefs)
    setSavedTaskFeatureSettings(nextTaskFeatureSettings)
    setSavedExplorerOptions(nextExplorerOptions)
    setExplorerWidth(nextExplorerWidth)
    setEditorPanelOpen(nextEditorPanelOpen)
    setCapturePanelOpen(nextCapturePanelOpen)
    setCapturePinned(nextCapturePinned)
    setExpandedFolders(nextExpandedGroups)
    dispatchWorkspace({
      type: 'TOGGLE_SPLIT_MODE',
      enabled: nextWorkspaceLayoutMode === 'split',
    })
    dispatchWorkspace({
      type: 'SET_SPLIT_RATIO',
      splitRatio: nextWorkspaceSplitRatio,
    })

    const nextExplorerViewState = toExplorerViewStateFromSettings(settings.explorer)
    setExplorerViewState(nextExplorerViewState)
    setExplorerViewSeed(nextExplorerViewState)
    setExplorerViewSeedId((prev) => prev + 1)
    setExplorerFilterQuery('')
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

  const waitForNoteBaseOpen = async (): Promise<NonNullable<NoteBaseOpenStatus['result']>> => {
    while (true) {
      const status = await apiRequest<NoteBaseOpenStatus>(backendUrl, '/notebase/open/status')
      setNoteBaseOpenStatus(status)
      if (status.done) {
        if (status.error) {
          throw new Error(status.error)
        }
        if (!status.result) {
          throw new Error('NoteBase wurde geladen, aber das Ergebnis fehlt.')
        }
        return status.result
      }
      await new Promise((resolve) => window.setTimeout(resolve, NOTEBASE_OPEN_POLL_MS))
    }
  }

  const openVaultAtPath = async (rawPath: string, successMessage: string): Promise<boolean> => {
    const path = normalizeLabel(rawPath)
    if (!path) {
      throw new Error('Bitte zuerst einen NoteBase-Pfad angeben.')
    }

    setVaultLoaded(false)
    setNoteBaseOpenStatus({
      active: true,
      done: false,
      error: null,
      phase: 'NoteBase wird vorbereitet ...',
      processed: 0,
      total: 0,
      result: null,
    })
    setMessage('NoteBase wird geladen ...')
    await apiRequest<{ started: boolean; path: string }>(backendUrl, '/notebase/open/start', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
    const response = await waitForNoteBaseOpen()
    const loadedPath = response.noteBasePath ?? response.vaultPath ?? path
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
    setNoteBaseOpenStatus(null)

    await loadUiSettings()
    await refreshWorkspaceData(true)
    return true
  }

  const isMissingNoteBasePathError = (value: unknown): boolean => {
    const text = String(value || '').toLowerCase()
    return text.includes('notebase path not found') || text.includes('path not found') || text.includes('enoent')
  }

  const loadState = async () => {
    try {
      const state = await apiRequest<BackendState>(backendUrl, '/state')
      if (!state.vaultLoaded) {
        uiSettingsReadyRef.current = false
        setVaultLoaded(false)
        if (!noteBaseOpenStatus?.active) {
          setNoteBaseOpenStatus(null)
        }
        setFocusMitIds([])
        setOpenTabs([])
        dispatchWorkspace({ type: 'RESET' })
        setExplorerViewState({ ...DEFAULT_EXPLORER_VIEW_STATE })
        setExplorerViewSeed(null)
        setExplorerViewSeedId((prev) => prev + 1)
        let missingRememberedPathHandled = false
        const rememberedPath = getStoredLastNoteBasePath()
        if (rememberedPath && !autoOpenTriedRef.current) {
          autoOpenTriedRef.current = true
          setVaultPath(rememberedPath)
          try {
            await openVaultAtPath(rememberedPath, 'Letzte NoteBase automatisch geladen.')
            return
          } catch (autoOpenError) {
            if (isMissingNoteBasePathError(autoOpenError)) {
              clearStoredLastNoteBasePath()
              setVaultPath('')
              setError('')
              setMessage('Letzte NoteBase nicht gefunden. Bitte waehle eine NoteBase aus.')
              missingRememberedPathHandled = true
            } else {
              setError(String(autoOpenError))
            }
          }
        }
        if (!missingRememberedPathHandled) {
          setMessage('Keine NoteBase geladen.')
        }
        return
      }

      setVaultLoaded(true)
      setNoteBaseOpenStatus(null)
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
      setFocusMitIds([])
      setOpenTabs([])
      dispatchWorkspace({ type: 'RESET' })
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

    const normalizedCapture = captureText.trim()
    if (!normalizedCapture) {
      setSuggestions([])
      setSelectedTagKeys([])
      setIgnoredCaptureTagKeys([])
      capturePreviewLastTextRef.current = ''
      capturePreviewRequestSeqRef.current += 1
      return
    }

    if (normalizedCapture.length < CAPTURE_PREVIEW_MIN_CHARS) {
      setSuggestions([])
      setSelectedTagKeys([])
      capturePreviewLastTextRef.current = ''
      capturePreviewRequestSeqRef.current += 1
      return
    }

    const timeout = window.setTimeout(() => {
      void previewCapture(normalizedCapture)
    }, CAPTURE_PREVIEW_IDLE_MS)

    return () => {
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureText, vaultLoaded])

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

  const liveNoteTypeKey = useMemo(() => {
    const entries: string[] = []
    for (const tab of openTabs) {
      if (tab.kind !== 'note' || !tab.noteType) {
        continue
      }
      entries.push(`${normalizeFilePathKey(tab.path)}\u0000${normalizeNoteTypeValue(tab.noteType)}`)
    }
    entries.sort((left, right) => left.localeCompare(right))
    return entries.join('\n')
  }, [openTabs])

  const liveNoteTypeByPath = useMemo(() => {
    const map = new Map<string, 'note' | 'task'>()
    if (!liveNoteTypeKey) {
      return map
    }
    for (const entry of liveNoteTypeKey.split('\n')) {
      const [pathKey, noteTypeRaw] = entry.split('\u0000', 2)
      if (!pathKey) {
        continue
      }
      map.set(pathKey, normalizeNoteTypeValue(noteTypeRaw))
    }
    return map
  }, [liveNoteTypeKey])

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
    return Array.from(deduped.values()).map((row) => {
      const liveType = liveNoteTypeByPath.get(normalizeFilePathKey(row.path))
      if (!liveType) {
        return row
      }
      return {
        ...row,
        note_type: liveType,
      }
    })
  }, [explorerFiles, linkIndexRows, liveNoteTypeByPath])

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

  const explorerFileIconOverrides = useMemo(() => {
    const map = new Map<string, string>()
    const source = explorerViewState.iconOverrides.files
    for (const [rawPath, rawIcon] of Object.entries(source)) {
      const iconName = typeof rawIcon === 'string' ? rawIcon.trim() : ''
      if (!iconName) {
        continue
      }
      map.set(normalizeFilePathKey(rawPath), iconName)
    }
    return map
  }, [explorerViewState.iconOverrides.files])

  const explorerNoteTypeByPath = useMemo(() => {
    const map = new Map<string, 'note' | 'task'>()
    for (const row of explorerRows) {
      map.set(normalizeFilePathKey(row.path), normalizeNoteTypeValue(row.note_type))
    }
    return map
  }, [explorerRows])

  const dirtyPathKey = useMemo(() => {
    return openTabs
      .filter((tab) => tab.kind === 'note' && tab.dirty)
      .map((tab) => tab.path)
      .sort((left, right) => left.localeCompare(right))
      .join('\n')
  }, [openTabs])
  const dirtyFilePaths = useMemo(() => {
    const next = new Set<string>()
    if (!dirtyPathKey) {
      return next
    }
    for (const path of dirtyPathKey.split('\n')) {
      if (path) {
        next.add(path)
      }
    }
    return next
  }, [dirtyPathKey])

  const noteBaseName = useMemo(() => (vaultPath ? getPathTail(vaultPath) : 'Keine NoteBase'), [vaultPath])
  const tabContextTarget = tabContextMenu ? tabsById[tabContextMenu.tabId] ?? null : null
  const resolveNoteTabIconName = (tab: NoteTab): string => {
    if (tab.kind !== 'note') {
      if (tab.kind === 'settings') {
        return 'Settings'
      }
      if (tab.kind === 'todo_dashboard') {
        return 'ListTodo'
      }
      if (tab.kind === 'task_dashboard') {
        return 'LayoutDashboard'
      }
      if (tab.kind === 'focus_dashboard') {
        return 'Target'
      }
      if (tab.kind === 'review_dashboard') {
        return 'BarChart3'
      }
      if (tab.kind === 'graph_dashboard') {
        return 'Network'
      }
      return 'Circle'
    }
    const pathKey = normalizeFilePathKey(tab.path)
    const customIcon = explorerFileIconOverrides.get(pathKey)
    if (customIcon) {
      return customIcon
    }

    const knownType = tab.noteType ?? explorerNoteTypeByPath.get(pathKey)
    if (knownType) {
      return knownType === 'task' ? 'CheckSquare' : 'FileText'
    }

    const parsedType = normalizeNoteTypeValue(
      (tab.parsedDocument ?? parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path))).frontmatter.type
    )
    return parsedType === 'task' ? 'CheckSquare' : 'FileText'
  }
  const getTabTooltip = (tab: NoteTab): string => {
    if (tab.kind !== 'note') {
      return tab.title
    }
    const relativePath = getRelativeVaultPath(tab.path, vaultPath).replace(/\.md$/i, '')
    if (relativePath) {
      return relativePath
    }
    return tab.title.replace(/\.md$/i, '')
  }
  const dueTodayCount = useMemo(() => {
    const today = toLocalIsoDate()
    return tasks.filter((task) => task.status !== 'done' && task.due_date === today).length
  }, [tasks])

  const toWikiTargetForRow = (row: SearchRow): string => {
    return getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '') || toNoteDisplayName(row.path)
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
  const markdownLinkTargets = useMemo<MarkdownLinkTarget[]>(() => {
    return explorerRows
      .map((row) => {
        const relativePath = getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '')
        return {
          path: row.path,
          title: normalizeLabel(row.title) || toNoteDisplayName(row.path),
          target: toWikiTargetForRow(row),
          relativePath: relativePath || toNoteDisplayName(row.path),
          noteType: normalizeNoteTypeValue(row.note_type),
        }
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'de', { sensitivity: 'base' }))
  }, [explorerRows, toWikiTargetForRow, vaultPath])

  const pickDirectory = async (): Promise<string | null> => {
    if (!window.nicknotes?.selectDirectory) {
      return window.prompt('Bitte absoluten Pfad eingeben:') || null
    }
    return window.nicknotes.selectDirectory()
  }

  const deriveParentDirectory = (path: string): string => {
    const cleanPath = normalizeLabel(path).replace(/[\\/]+$/g, '')
    if (!cleanPath) {
      return ''
    }
    const splitIndex = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'))
    if (splitIndex < 0) {
      return ''
    }
    const parent = cleanPath.slice(0, splitIndex)
    if (/^[A-Za-z]:$/i.test(parent)) {
      return `${parent}\\`
    }
    return parent
  }

  const suggestNoteBaseName = (name: string): string => {
    const cleanName = normalizeLabel(name)
    if (!cleanName) {
      return 'NeueNoteBase'
    }
    return `${cleanName}NoteBase`
  }

  const closeCreateNoteBaseDialog = () => {
    if (createNoteBasePending) {
      return
    }
    setCreateNoteBaseDialogOpen(false)
  }

  const createVault = () => {
    setCreateNoteBaseParentPath(deriveParentDirectory(vaultPath))
    setCreateNoteBaseDisplayName(displayName)
    setCreateNoteBaseName(suggestNoteBaseName(displayName))
    setCreateNoteBaseDialogOpen(true)
  }

  const chooseCreateNoteBaseParentDirectory = async () => {
    try {
      setError('')
      const selectedPath = await pickDirectory()
      if (!selectedPath) {
        return
      }
      setCreateNoteBaseParentPath(selectedPath)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const submitCreateNoteBaseDialog = async () => {
    const parentPath = normalizeLabel(createNoteBaseParentPath)
    const name = normalizeLabel(createNoteBaseName)
    const nextDisplayName = normalizeLabel(createNoteBaseDisplayName)
    if (!parentPath) {
      setError('Bitte zuerst einen Speicherort fuer die neue NoteBase auswaehlen.')
      return
    }
    if (!name) {
      setError('Bitte einen Namen fuer die neue NoteBase eingeben.')
      return
    }
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      setError('Der NoteBase-Name darf keine Pfadtrenner enthalten.')
      return
    }

    try {
      setError('')
      setCreateNoteBasePending(true)
      const response = await apiRequest<{
        vaultPath: string
        noteBasePath?: string
        counts: VaultCounts
        tagGroups?: unknown
      }>(backendUrl, '/notebase/create', {
        method: 'POST',
        body: JSON.stringify({ parentPath, name }),
      })

      const loadedPath = response.noteBasePath ?? response.vaultPath
      setVaultPath(loadedPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      uiSettingsReadyRef.current = false
      storeLastNoteBasePath(loadedPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      if (nextDisplayName) {
        setDisplayName(nextDisplayName)
      }
      setCreateNoteBaseDialogOpen(false)
      setMessage(`Neue NoteBase erstellt: ${loadedPath}`)
      await loadUiSettings()
      await refreshWorkspaceData(true)
    } catch (caught) {
      setError(String(caught))
    } finally {
      setCreateNoteBasePending(false)
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
      setSavedTaskFeatureSettings({ ...taskFeatureSettings })
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
    setTaskFeatureSettings({ ...savedTaskFeatureSettings })
    setExplorerOptions({ ...savedExplorerOptions })
    setMessage('Nicht gespeicherte Einstellungen verworfen.')
  }

  const openSettingsTab = () => {
    const existing = findTabByPath(SETTINGS_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'settings',
        path: SETTINGS_TAB_PATH,
        title: 'Einstellungen',
        content: '',
        loading: false,
        dirty: settingsDirty,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openTodoDashboardTab = () => {
    const existing = findTabByPath(TODO_DASHBOARD_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'todo_dashboard',
        path: TODO_DASHBOARD_TAB_PATH,
        title: 'Todo Dashboard',
        content: '',
        loading: false,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openTaskDashboardTab = () => {
    if (vaultLoaded) {
      void refreshTasks()
    }
    const existing = findTabByPath(TASK_DASHBOARD_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'task_dashboard',
        path: TASK_DASHBOARD_TAB_PATH,
        title: 'Task Dashboard',
        content: '',
        loading: false,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openFocusDashboardTab = () => {
    if (vaultLoaded) {
      void Promise.allSettled([refreshFocusAggregate(), refreshReview()])
    }
    const existing = findTabByPath(FOCUS_DASHBOARD_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'focus_dashboard',
        path: FOCUS_DASHBOARD_TAB_PATH,
        title: 'Focus Dashboard',
        content: '',
        loading: false,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openReviewDashboardTab = () => {
    if (vaultLoaded) {
      void refreshReview()
    }
    const existing = findTabByPath(REVIEW_DASHBOARD_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'review_dashboard',
        path: REVIEW_DASHBOARD_TAB_PATH,
        title: 'Review Dashboard',
        content: '',
        loading: false,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openGraphDashboardTab = () => {
    const existing = findTabByPath(GRAPH_DASHBOARD_TAB_PATH, openTabs)
    const targetPane = workspaceStateRef.current.lastFocusedPane
    if (existing) {
      setEditorPanelOpen(true)
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: existing.id,
        activate: true,
      })
      return
    }

    const nextTabId = createTabId()
    setOpenTabs((prev) => [
      ...prev,
      {
        id: nextTabId,
        kind: 'graph_dashboard',
        path: GRAPH_DASHBOARD_TAB_PATH,
        title: 'Graph Preview',
        content: '',
        loading: false,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    dispatchWorkspace({
      type: 'OPEN_TAB',
      paneId: targetPane,
      tabId: nextTabId,
      activate: true,
    })
  }

  const openGraphNodePath = (path: string, title: string, noteType: 'note' | 'task') => {
    const cleanPath = normalizeLabel(path)
    if (!cleanPath) {
      return
    }
    const resolvedPath = resolveGraphNodePath(cleanPath, vaultPath)
    void openNoteInTab(resolvedPath, title, { initialNoteType: noteType })
  }

  const revealGraphNodePath = (path: string) => {
    const cleanPath = normalizeLabel(path)
    if (!cleanPath) {
      return
    }
    setSidebarView('notes')
    setSidebarOpen(true)
    setExplorerRevealPath(resolveGraphNodePath(cleanPath, vaultPath))
    setExplorerRevealRequestId((prev) => prev + 1)
  }

  const getLiveMarkdownForTab = (tab: NoteTab): string | null => {
    const paneId = findPaneByTabId(workspaceStateRef.current, tab.id)
    if (!paneId) {
      return null
    }
    const activeTabId = getActiveTabIdForPane(workspaceStateRef.current, paneId)
    if (activeTabId !== tab.id) {
      return null
    }
    const editorApi = paneId === 'left' ? leftEditorRef.current : rightEditorRef.current
    return editorApi?.getMarkdown() ?? null
  }

  const saveNoteTab = async (path: string): Promise<boolean> => {
    const targetTab = findTabByPath(path)
    if (!targetTab || targetTab.kind !== 'note' || targetTab.loading || !targetTab.dirty) {
      return true
    }
    if (targetTab.readOnly) {
      setMessage('Diese Tag-Overview wird automatisch generiert und ist schreibgeschuetzt.')
      return true
    }
    const baseDocument = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path))
    const liveBody = getLiveMarkdownForTab(targetTab)
    const nextDocument = liveBody !== null ? { ...baseDocument, body: liveBody } : baseDocument
    const liveContent = serializeNoteDocument(nextDocument)

    try {
      setError('')
      const response = await apiRequest<{ counts: VaultCounts; path: string; title?: string; tagGroups?: unknown; graphStatus?: GraphIndexStatus }>(
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
      if (response.graphStatus) {
        setLatestGraphStatus(response.graphStatus)
        setGraphUpdateToken((current) => current + 1)
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
            parsedDocument: {
              ...nextDocument,
              frontmatter: {
                ...nextDocument.frontmatter,
                title: response.title || nextDocument.frontmatter.title,
              },
            },
          }
        })
      )
      setMessage(`Notiz gespeichert: ${response.title || targetTab.title}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview(), refreshNoteGroups()])
      return true
    } catch (caught) {
      setError(String(caught))
      return false
    }
  }

  const saveTab = async (path: string): Promise<boolean> => {
    const targetTab = findTabByPath(path)
    if (!targetTab) {
      return true
    }
    if (targetTab.kind === 'settings') {
      return saveSettings()
    }
    if (
      targetTab.kind === 'todo_dashboard' ||
      targetTab.kind === 'task_dashboard' ||
      targetTab.kind === 'focus_dashboard' ||
      targetTab.kind === 'review_dashboard' ||
      targetTab.kind === 'graph_dashboard'
    ) {
      return true
    }
    return saveNoteTab(path)
  }

  const renameNoteBase = async () => {
    const renameDialog = await openTagActionDialog({
      kind: 'input',
      title: 'NoteBase umbenennen',
      message: 'Neuen Namen festlegen',
      initialValue: noteBaseName,
      actions: [
        { id: 'confirm', label: 'Speichern', tone: 'primary' },
        { id: 'cancel', label: 'Abbrechen' },
      ],
    })
    if (renameDialog.actionId !== 'confirm') {
      return
    }
    const newName = normalizeLabel(renameDialog.value)
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
      dispatchWorkspace({ type: 'RESET' })
      storeLastNoteBasePath(loadedPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`NoteBase umbenannt: ${previousName} -> ${getPathTail(loadedPath)}`)
      await Promise.all([
        refreshFocusAggregate(true),
        runSearch(searchQuery, true),
        refreshReview(true),
        refreshNoteGroups(true),
      ])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteNoteBase = async () => {
    const confirmed = await askTagChoice(
      'NoteBase loeschen',
      `Soll die NoteBase "${noteBaseName}" wirklich mit allen Dateien geloescht werden?`,
      [{ id: 'delete', label: 'Loeschen', tone: 'danger' }]
    )
    if (confirmed !== 'delete') {
      return
    }
    const secondCheckDialog = await openTagActionDialog({
      kind: 'input',
      title: 'Loeschen bestaetigen',
      message: 'Bitte "LOESCHEN" eingeben, um das vollstaendige Loeschen zu bestaetigen.',
      initialValue: '',
      actions: [
        { id: 'confirm', label: 'Endgueltig loeschen', tone: 'danger' },
        { id: 'cancel', label: 'Abbrechen' },
      ],
    })
    if (secondCheckDialog.actionId !== 'confirm') {
      return
    }
    const secondCheck = normalizeLabel(secondCheckDialog.value)
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
      setTodos([])
      setFocusMitIds([])
      setSearchResults([])
      setSuggestions([])
      setSelectedTagKeys([])
      setOpenTabs([])
      dispatchWorkspace({ type: 'RESET' })
      setCustomTagGroups([])
      setNoteGroups([])
      setExplorerViewState({ ...DEFAULT_EXPLORER_VIEW_STATE })
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

    const normalizedText = text.trim()
    if (normalizedText.length < CAPTURE_PREVIEW_MIN_CHARS) {
      return
    }
    if (capturePreviewLastTextRef.current === normalizedText) {
      return
    }

    const requestSeq = capturePreviewRequestSeqRef.current + 1
    capturePreviewRequestSeqRef.current = requestSeq

    try {
      const response = await apiRequest<{
        suggestions: Suggestion[]
      }>(backendUrl, '/capture/preview', {
        method: 'POST',
        body: JSON.stringify({ text: normalizedText }),
      })

      if (requestSeq !== capturePreviewRequestSeqRef.current) {
        return
      }

      capturePreviewLastTextRef.current = normalizedText
      const ignoredKeys = new Set(ignoredCaptureTagKeys)
      const visibleSuggestions = response.suggestions.filter((item) => !ignoredKeys.has(item.key))
      setSuggestions(visibleSuggestions)
      setSelectedTagKeys((prev) => prev.filter((key) => visibleSuggestions.some((item) => item.key === key)))
    } catch {
      if (requestSeq !== capturePreviewRequestSeqRef.current) {
        return
      }
    }
  }

  const toggleCaptureTag = (tagKey: string) => {
    setSuggestions((prev) => prev.filter((item) => item.key !== tagKey))
    setSelectedTagKeys((prev) => prev.filter((item) => item !== tagKey))
  }

  const rejectCaptureTag = (tagKey: string) => {
    setIgnoredCaptureTagKeys((prev) => (prev.includes(tagKey) ? prev : [...prev, tagKey]))
    setSuggestions((prev) => prev.filter((item) => item.key !== tagKey))
    setSelectedTagKeys((prev) => prev.filter((item) => item !== tagKey))
  }

  const saveCapture = async (rawText?: string) => {
    try {
      const text = (rawText ?? captureEditorRef.current?.getMarkdown() ?? captureText).trim()
      if (!text) {
        return
      }

      const response = await apiRequest<{ counts: VaultCounts; date: string; notePath: string }>(
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
      setIgnoredCaptureTagKeys([])
      setMessage(`Quick Capture in Daily ${response.date} gespeichert.`)
      await Promise.all([refreshTodos(), runSearch(searchQuery), refreshReview(), refreshNoteGroups(), refreshExplorerSidebarData()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const openOrCreateTodayDaily = async (): Promise<void> => {
    const todayIso = toLocalIsoDate()
    try {
      const response = await apiRequest<{ date: string; notePath: string; title?: string; created: boolean; counts: VaultCounts }>(
        backendUrl,
        `/daily/open-today?date=${encodeURIComponent(todayIso)}`,
        { method: 'POST' }
      )
      setCounts(response.counts)
      setMessage(response.created ? `Daily Note erstellt: ${response.date}` : `Daily Note geoeffnet: ${response.date}`)
      setError('')
      await Promise.all([runSearch(searchQuery), refreshReview(), refreshExplorerSidebarData()])
      await openNoteInCurrentEditor(response.notePath, response.title || response.date)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const saveFocusMit = async (nextMitIds: string[]): Promise<string[]> => {
    const todayIso = toLocalIsoDate()
    const response = await apiRequest<{ mitIds: string[]; counts: VaultCounts }>(backendUrl, '/focus/mit', {
      method: 'POST',
      body: JSON.stringify({
        date: todayIso,
        mitIds: nextMitIds,
      }),
    })
    setFocusMitIds(Array.isArray(response.mitIds) ? response.mitIds : [])
    setCounts(response.counts)
    await Promise.all([refreshFocusAggregate(), refreshReview()])
    return Array.isArray(response.mitIds) ? response.mitIds : []
  }

  const quickCaptureFocusTodo = async (rawText: string): Promise<void> => {
    const text = rawText.trim()
    if (!text) {
      return
    }
    const todayIso = toLocalIsoDate()
    const response = await apiRequest<{ notePath: string; todoText: string; counts: VaultCounts }>(backendUrl, '/focus/quick-capture', {
      method: 'POST',
      body: JSON.stringify({
        text,
        date: todayIso,
      }),
    })
    setCounts(response.counts)
    setMessage(`Todo fuer heute erfasst: ${response.todoText}`)
    await Promise.all([refreshFocusAggregate(), refreshReview()])
  }

  const toggleTodo = async (todoId: string, checked?: boolean) => {
    try {
      await apiRequest<{ todo?: TodoRow }>(backendUrl, `/todos/${encodeURIComponent(todoId)}/toggle`, {
        method: 'POST',
        body: JSON.stringify(typeof checked === 'boolean' ? { checked } : {}),
      })
      setMessage(`Todo aktualisiert (${todoId}).`)
      await Promise.all([refreshTodos(), runSearch(searchQuery)])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const promoteTodo = async (todoId: string) => {
    try {
      const response = await apiRequest<{ taskId: string; taskPath?: string; created?: boolean }>(
        backendUrl,
        `/todos/${encodeURIComponent(todoId)}/promote`,
        {
          method: 'POST',
        }
      )
      const verb = response.created === false ? 'bereits verknuepft' : 'zu Task promoted'
      setMessage(`Todo ${verb}: ${response.taskId}`)
      await Promise.all([refreshTodos(), refreshTasks(), refreshReview(), runSearch(searchQuery)])
      if (response.taskPath) {
        await openNoteInTab(response.taskPath, undefined, { initialNoteType: 'task' })
      }
    } catch (caught) {
      setError(String(caught))
    }
  }

  const openTodoOrigin = async (notePath: string, title?: string) => {
    await openNoteInTab(notePath, title, { initialNoteType: 'note' })
  }

  const fetchNoteContent = async (path: string): Promise<string> => {
    const response = await apiRequest<{ content: string }>(
      backendUrl,
      `/notes/content?path=${encodeURIComponent(path)}`
    )
    return response.content
  }

  const openNoteInTab = async (
    path: string,
    suggestedTitle?: string,
    options?: { activate?: boolean; replacePath?: string; initialNoteType?: 'note' | 'task'; targetPane?: PaneId }
  ) => {
    const cleanPath = normalizeLabel(path)
    if (!cleanPath) {
      return
    }

    const shouldActivate = options?.activate !== false
    const initialNoteType = normalizeNoteTypeValue(options?.initialNoteType)
    const fallbackTitle = suggestedTitle?.trim() || getFileName(cleanPath)
    const targetPane = options?.targetPane ?? workspaceStateRef.current.lastFocusedPane
    const explicitTargetPane = Boolean(options?.targetPane)
    const replacePath = normalizeLabel(options?.replacePath ?? '')
    const replaceIsDifferent = replacePath && toNoteId(replacePath) !== toNoteId(cleanPath)

    if (replaceIsDifferent) {
      const replaceTab = findTabByPath(replacePath)
      if (replaceTab?.kind === 'note' && replaceTab.dirty) {
        const canReplace = await confirmCloseTab(replaceTab.id)
        if (!canReplace) {
          return
        }
      }
    }

    const existingOpenRef = findOpenTabByNoteId(workspaceStateRef.current, toNoteId(cleanPath))
    const existing =
      (existingOpenRef ? openTabsRef.current.find((tab) => tab.id === existingOpenRef.id) ?? null : null) ?? findTabByPath(cleanPath)
    if (existing) {
      if (existing.kind === 'note' && (!existing.noteType || (!existing.readOnly && isTagOverviewPath(existing.path)))) {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === existing.id && tab.kind === 'note'
              ? {
                  ...tab,
                  noteType: initialNoteType,
                  readOnly: tab.readOnly || isTagOverviewPath(tab.path),
                }
              : tab
          )
        )
      }

      if (replaceIsDifferent) {
        const replaceTab = findTabByPath(replacePath)
        if (replaceTab && replaceTab.id !== existing.id) {
          setOpenTabs((prev) => prev.filter((tab) => tab.id !== replaceTab.id))
          dispatchWorkspace({ type: 'CLOSE_TAB', tabId: replaceTab.id })
        }
      }

      setEditorPanelOpen(true)
      if (shouldActivate) {
        if (explicitTargetPane) {
          dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: existing.id,
            activate: true,
          })
        } else {
          const existingPane = findPaneByTabId(workspaceStateRef.current, existing.id)
          if (existingPane) {
            dispatchWorkspace({
              type: 'ACTIVATE_TAB',
              paneId: existingPane,
              tabId: existing.id,
            })
          } else {
            dispatchWorkspace({
              type: 'OPEN_TAB',
              paneId: targetPane,
              tabId: existing.id,
              activate: true,
            })
          }
        }
      }
      return
    }

    let nextTabId = createTabId()
    const replaceTab = replaceIsDifferent ? findTabByPath(replacePath) : null
    if (replaceTab?.kind === 'note') {
      nextTabId = replaceTab.id
    }

    const loadingTab: NoteTab = {
      id: nextTabId,
      kind: 'note',
      path: cleanPath,
      title: fallbackTitle,
      content: '',
      loading: true,
      dirty: false,
      readOnly: isTagOverviewPath(cleanPath),
      noteType: initialNoteType,
    }

    setOpenTabs((prev) => {
      const withoutPathDuplicates = prev.filter((tab) => toNoteId(tab.path) !== toNoteId(cleanPath))
      if (replaceTab) {
        const replaceIndex = withoutPathDuplicates.findIndex((tab) => tab.id === replaceTab.id)
        if (replaceIndex >= 0) {
          const next = [...withoutPathDuplicates]
          next.splice(replaceIndex, 1, loadingTab)
          return next
        }
      }
      return [...withoutPathDuplicates, loadingTab]
    })

    setEditorPanelOpen(true)
    if (shouldActivate) {
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: nextTabId,
        activate: true,
      })
    } else if (!findPaneByTabId(workspaceStateRef.current, nextTabId)) {
      dispatchWorkspace({
        type: 'OPEN_TAB',
        paneId: targetPane,
        tabId: nextTabId,
        activate: false,
      })
    }

    try {
      const content = await fetchNoteContent(cleanPath)
      const parsed = parseNoteDocument(content, fallbackTitle)
      const normalizedContent = serializeNoteDocument(parsed)
      const nextTitle = parsed.frontmatter.title || fallbackTitle
      const readOnly = isTagOverviewReadOnly(cleanPath, content)
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.id === nextTabId
            ? {
                ...tab,
                title: nextTitle,
                path: cleanPath,
                content: normalizedContent,
                loading: false,
                dirty: false,
                readOnly,
                noteType: normalizeNoteTypeValue(parsed.frontmatter.type),
                parsedDocument: parsed,
              }
            : tab
        )
      )
    } catch (caught) {
      setOpenTabs((prev) => prev.filter((tab) => tab.id !== nextTabId))
      dispatchWorkspace({ type: 'CLOSE_TAB', tabId: nextTabId })
      setError(String(caught))
    }
  }

  const openTagOverviewByReference = useCallback(
    async (rawTag: string, options?: { targetPane?: PaneId }) => {
      const parsed = parseTagReference(rawTag)
      if (!parsed) {
        return
      }
      try {
        setError('')
        const response = await apiRequest<{ path: string; title?: string }>(
          backendUrl,
          `/tags/overview?groupId=${encodeURIComponent(parsed.groupId)}&tagId=${encodeURIComponent(parsed.tagId)}`
        )
        await openNoteInTab(response.path, response.title || `${parsed.groupId}:${parsed.tagId}`, {
          targetPane: options?.targetPane ?? workspaceStateRef.current.lastFocusedPane,
          initialNoteType: 'note',
        })
      } catch (caught) {
        setError(String(caught))
      }
    },
    [backendUrl, openNoteInTab]
  )

  const confirmCloseTab = async (tabId: string): Promise<boolean> => {
    const tab = openTabsRef.current.find((candidate) => candidate.id === tabId)
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
      return await saveTab(tab.path)
    }
    if (decision === 'discard') {
      return true
    }
    return false
  }

  const closeEditorTab = async (tabId: string) => {
    await closeEditorTabs([tabId])
  }

  const closeEditorTabs = async (tabIds: string[]): Promise<boolean> => {
    if (tabIds.length === 0) {
      return true
    }

    const openTabIdSet = new Set(openTabsRef.current.map((tab) => tab.id))
    const uniqueTabIds: string[] = []
    for (const tabId of tabIds) {
      if (!openTabIdSet.has(tabId) || uniqueTabIds.includes(tabId)) {
        continue
      }
      uniqueTabIds.push(tabId)
    }
    if (uniqueTabIds.length === 0) {
      return true
    }

    for (const tabId of uniqueTabIds) {
      const canClose = await confirmCloseTab(tabId)
      if (!canClose) {
        return false
      }
    }

    const closeSet = new Set(uniqueTabIds)
    setOpenTabs((prev) => prev.filter((tab) => !closeSet.has(tab.id)))
    for (const tabId of uniqueTabIds) {
      dispatchWorkspace({ type: 'CLOSE_TAB', tabId })
    }
    setTabContextMenu(null)
    return true
  }

  const closeAllEditorTabs = async (): Promise<boolean> => {
    return await closeEditorTabs(openTabsRef.current.map((tab) => tab.id))
  }

  const closeOtherEditorTabs = async (keepTabId: string): Promise<boolean> => {
    return await closeEditorTabs(openTabsRef.current.filter((tab) => tab.id !== keepTabId).map((tab) => tab.id))
  }

  const openNoteInCurrentEditor = async (path: string, suggestedTitle?: string) => {
    const focusedPane = workspaceStateRef.current.lastFocusedPane
    const focusedTabId = getActiveTabIdForPane(workspaceStateRef.current, focusedPane)
    const currentTab = focusedTabId ? openTabsRef.current.find((tab) => tab.id === focusedTabId) ?? null : null
    const currentNoteTab = currentTab?.kind === 'note' ? currentTab : null
    const currentPath = currentNoteTab?.path ?? ''
    if (currentNoteTab && toNoteId(currentPath) !== toNoteId(path)) {
      const canCloseCurrent = await confirmCloseTab(currentNoteTab.id)
      if (!canCloseCurrent) {
        return
      }
    }
    await openNoteInTab(path, suggestedTitle, {
      targetPane: focusedPane,
      replacePath: currentPath && toNoteId(currentPath) !== toNoteId(path) ? currentPath : '',
    })
  }

  const openWikiLinkInEditor = useCallback(
    (rawTarget: string, paneId?: PaneId) => {
      const normalizedTarget = normalizeRelatedCandidate(rawTarget)
      if (!normalizedTarget) {
        return
      }

      const lookup = normalizeWikiLookup(normalizedTarget)
      const relativeMatches = explorerRows.filter((row) => {
        const relativePath = getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '')
        return normalizeWikiLookup(relativePath) === lookup
      })

      const titleMatches =
        relativeMatches.length > 0
          ? relativeMatches
          : explorerRows.filter((row) => normalizeWikiLookup(toNoteDisplayName(row.path)) === lookup)

      if (titleMatches.length === 0) {
        setMessage(`Wiki-Link nicht gefunden: ${normalizedTarget}`)
        return
      }
      if (titleMatches.length > 1) {
        setMessage(`Wiki-Link ist nicht eindeutig: ${normalizedTarget}`)
        return
      }

      const match = titleMatches[0]
      if (!match) {
        return
      }

      void openNoteInTab(match.path, match.title || toNoteDisplayName(match.path), {
        initialNoteType: normalizeNoteTypeValue(match.note_type),
        targetPane: paneId ?? workspaceStateRef.current.lastFocusedPane,
      })
    },
    [explorerRows, openNoteInTab, vaultPath]
  )

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
    const tab = findTabByPath(path)
    if (!tab) {
      return
    }
    const sourcePane = findPaneByTabId(workspaceStateRef.current, tab.id) ?? 'left'
    const targetPane: PaneId = sourcePane === 'left' ? 'right' : 'left'
    dispatchWorkspace({ type: 'INITIALIZE_SPLIT_LAYOUT' })
    dispatchWorkspace({
      type: 'MOVE_TAB_TO_OTHER_PANE',
      fromPaneId: sourcePane,
      toPaneId: targetPane,
      tabId: tab.id,
    })
    setTabContextMenu(null)
  }

  const updateNoteDocumentByPath = (
    tabPath: string,
    updater: (document: ParsedNoteDocument) => ParsedNoteDocument
  ) => {
    setOpenTabs((prev) => {
      const targetIndex = prev.findIndex((tab) => tab.path === tabPath && tab.kind === 'note')
      if (targetIndex < 0) {
        return prev
      }

      const targetTab = prev[targetIndex]
      if (!targetTab || targetTab.kind !== 'note') {
        return prev
      }
      if (targetTab.readOnly) {
        return prev
      }

      const parsed = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path))
      const nextDocument = updater(parsed)
      if (nextDocument === parsed) {
        return prev
      }
      const nextAutoTags = extractAutoTags(nextDocument.body)
      const nextAutoRelated = extractRelatedLinks(nextDocument.body)
      const normalizedDocument: ParsedNoteDocument = {
        ...nextDocument,
        frontmatter: {
          ...nextDocument.frontmatter,
          tags_auto: nextAutoTags,
          related_auto: nextAutoRelated,
        },
      }

      const next = prev.slice()
      next[targetIndex] = {
        ...targetTab,
        title: normalizedDocument.frontmatter.title || targetTab.title,
        dirty: true,
        noteType: normalizeNoteTypeValue(normalizedDocument.frontmatter.type),
        parsedDocument: normalizedDocument,
      }
      return next
    })
  }

  const updateNoteContentByPath = (tabPath: string, nextBody: string) => {
    updateNoteDocumentByPath(tabPath, (document) => (document.body === nextBody ? document : { ...document, body: nextBody }))
  }

  const updateNoteTitleByPath = (tabPath: string, nextTitle: string) => {
    const sanitizedTitle = nextTitle.replace(/[\r\n]+/g, ' ')
    updateNoteDocumentByPath(tabPath, (document) => {
      if (document.frontmatter.title === sanitizedTitle) {
        return document
      }
      return {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          title: sanitizedTitle,
        },
      }
    })
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

  const setTaskFieldErrorByPath = (tabPath: string, field: 'estimate_minutes' | 'follow_up_date', message: string) => {
    setPropertyTaskFieldErrorsByPath((prev) => {
      const current = prev[tabPath] || {}
      const nextForPath = { ...current, [field]: message || undefined }
      if (!nextForPath.estimate_minutes && !nextForPath.follow_up_date) {
        if (!(tabPath in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[tabPath]
        return next
      }
      return { ...prev, [tabPath]: nextForPath }
    })
  }

  const updateNoteEstimateMinutesByPath = (tabPath: string, rawEstimateMinutes: string) => {
    const clean = normalizeLabel(rawEstimateMinutes)
    if (!clean) {
      setTaskFieldErrorByPath(tabPath, 'estimate_minutes', '')
      updateNoteDocumentByPath(tabPath, (document) => ({
        ...document,
        frontmatter: {
          ...document.frontmatter,
          estimate_minutes: null,
        },
      }))
      return
    }

    const parsed = Number.parseInt(clean, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setTaskFieldErrorByPath(tabPath, 'estimate_minutes', 'Bitte eine positive Zahl eingeben.')
      return
    }

    setTaskFieldErrorByPath(tabPath, 'estimate_minutes', '')
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        estimate_minutes: Math.min(parsed, 10000),
      },
    }))
  }

  const updateNoteBlockedByIdsByPath = (tabPath: string, rawBlockedByIds: string) => {
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        blocked_by_ids: Array.from(
          new Set(
            rawBlockedByIds
              .split(/[,\n;]+/)
              .map((entry) => normalizeLabel(entry))
              .filter(Boolean)
              .filter((entry) => entry.toLowerCase() !== document.frontmatter.id.trim().toLowerCase())
          )
        ),
      },
    }))
  }

  const updateNoteWaitingForByPath = (tabPath: string, rawWaitingFor: string) => {
    const normalized = rawWaitingFor.trim()
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        waiting_for: normalized,
      },
    }))
  }

  const updateNoteFollowUpDateByPath = (tabPath: string, rawFollowUpDate: string) => {
    const clean = normalizeLabel(rawFollowUpDate)
    if (!clean) {
      setTaskFieldErrorByPath(tabPath, 'follow_up_date', '')
      updateNoteDocumentByPath(tabPath, (document) => ({
        ...document,
        frontmatter: {
          ...document.frontmatter,
          follow_up_date: '',
        },
      }))
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      setTaskFieldErrorByPath(tabPath, 'follow_up_date', 'Bitte ein gueltiges ISO-Datum eingeben.')
      return
    }
    setTaskFieldErrorByPath(tabPath, 'follow_up_date', '')
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        follow_up_date: clean,
      },
    }))
  }

  const updateNoteBlockedReasonByPath = (tabPath: string, rawBlockedReason: string) => {
    const normalized = rawBlockedReason.trim()
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        blocked_reason: normalized,
      },
    }))
  }

  const updateNoteNextActionHintByPath = (tabPath: string, rawNextActionHint: string) => {
    const normalized = rawNextActionHint.trim()
    updateNoteDocumentByPath(tabPath, (document) => ({
      ...document,
      frontmatter: {
        ...document.frontmatter,
        next_action_hint: normalized,
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
    const tagDraft = propertyTagDraftByPath[tabPath] ?? ''
    const relatedDraft = propertyRelatedDraftByPath[tabPath] ?? ''
    const tagInputOpen = propertyTagInputOpenByPath[tabPath] ?? false
    const relatedInputOpen = propertyRelatedInputOpenByPath[tabPath] ?? false
    const taskFieldErrors = propertyTaskFieldErrorsByPath[tabPath] || {}
    const relatedOptionsForPath = propertyRelatedOptions.filter(
      (item) => normalizeWikiLookup(item) !== normalizeWikiLookup(toNoteDisplayName(tabPath))
    )
    const currentTaskId = normalizeLabel(document.frontmatter.id).toLowerCase()
    const taskIdOptions = tasks
      .map((task) => normalizeLabel(task.id))
      .filter((taskId) => taskId && taskId.toLowerCase() !== currentTaskId)
      .sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }))

    return (
      <NotePropertiesPanel
        tabPath={tabPath}
        document={document}
        compact={compact}
        taskStatusOptions={TASK_STATUS_OPTIONS}
        taskPriorityOptions={TASK_PRIORITY_OPTIONS}
        taskStatusDotClassName={taskStatusDotClassName}
        taskPriorityDotClassName={taskPriorityDotClassName}
        taskStatusOptionLabel={taskStatusOptionLabel}
        taskPriorityOptionLabel={taskPriorityOptionLabel}
        propertyTagOptions={propertyTagOptions}
        relatedOptions={relatedOptionsForPath}
        taskIdOptions={taskIdOptions}
        tagVisualByKey={tagVisualByKey}
        tagInputOpen={tagInputOpen}
        tagDraft={tagDraft}
        relatedInputOpen={relatedInputOpen}
        relatedDraft={relatedDraft}
        taskAdvancedHandlingEnabled={taskFeatureSettings.advancedTaskHandling}
        taskTimeManagementEnabled={taskFeatureSettings.taskTimeManagement}
        taskFieldErrors={taskFieldErrors}
        formatTimestamp={toGermanTimestamp}
        onTitleChange={(nextTitle) => {
          updateNoteTitleByPath(tabPath, nextTitle)
        }}
        onTitleBlur={(nextTitle) => {
          void syncNotePathWithTitle(tabPath, nextTitle)
        }}
        onTypeChange={(nextType) => {
          updateNoteTypeByPath(tabPath, nextType)
        }}
        onStatusChange={(nextStatus) => {
          updateNoteStatusByPath(tabPath, nextStatus)
        }}
        onPriorityChange={(nextPriority) => {
          updateNotePriorityByPath(tabPath, nextPriority)
        }}
        onDueDateChange={(nextDueDate) => {
          updateNoteDueDateByPath(tabPath, nextDueDate)
        }}
        onRemoveDueDate={() => {
          updateNoteDueDateByPath(tabPath, '')
        }}
        onEstimateMinutesChange={(nextEstimateMinutes) => {
          updateNoteEstimateMinutesByPath(tabPath, nextEstimateMinutes)
        }}
        onBlockedByIdsChange={(nextBlockedByIds) => {
          updateNoteBlockedByIdsByPath(tabPath, nextBlockedByIds)
        }}
        onWaitingForChange={(nextWaitingFor) => {
          updateNoteWaitingForByPath(tabPath, nextWaitingFor)
        }}
        onFollowUpDateChange={(nextFollowUpDate) => {
          updateNoteFollowUpDateByPath(tabPath, nextFollowUpDate)
        }}
        onBlockedReasonChange={(nextBlockedReason) => {
          updateNoteBlockedReasonByPath(tabPath, nextBlockedReason)
        }}
        onNextActionHintChange={(nextActionHint) => {
          updateNoteNextActionHintByPath(tabPath, nextActionHint)
        }}
        onOpenTagOverview={(rawTag) => {
          void openTagOverviewByReference(rawTag)
        }}
        onRemoveTag={(tag) => {
          removeNoteTagByPath(tabPath, tag)
        }}
        onOpenTagInput={() => {
          openPropertyTagInput(tabPath)
        }}
        onTagDraftChange={(value) => {
          setPropertyTagDraftByPath((prev) => ({ ...prev, [tabPath]: value }))
        }}
        onCommitTagInput={() => {
          commitPropertyTagInput(tabPath)
        }}
        onCloseTagInput={() => {
          closePropertyTagInput(tabPath)
        }}
        onRemoveRelated={(related) => {
          removeNoteRelatedByPath(tabPath, related)
        }}
        onOpenRelatedInput={() => {
          openPropertyRelatedInput(tabPath)
        }}
        onRelatedDraftChange={(value) => {
          setPropertyRelatedDraftByPath((prev) => ({ ...prev, [tabPath]: value }))
        }}
        onCommitRelatedInput={() => {
          commitPropertyRelatedInput(tabPath)
        }}
        onCloseRelatedInput={() => {
          closePropertyRelatedInput(tabPath)
        }}
      />
    )
  }

  const syncNotePathWithTitle = async (tabPath: string, rawTitleOverride?: string) => {
    const tab = openTabsRef.current.find((entry) => entry.path === tabPath && entry.kind === 'note')
    if (!tab || tab.loading) {
      return
    }
    const document = tab.parsedDocument ?? parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path))
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

  const handleExplorerViewStateChange = useCallback(
    (nextState: ExplorerViewState) => {
      if (areExplorerViewStatesEqual(explorerViewStateRef.current, nextState)) {
        return
      }

      explorerViewStateRef.current = nextState
      setExplorerViewState(nextState)
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
    },
    [saveUiSettingsPatch, vaultLoaded]
  )

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
      await openNoteInTab(response.notePath, response.title || cleanTitle, { initialNoteType: 'note' })
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
      await Promise.all([refreshTasks(), refreshTodos(), runSearch(searchQuery), refreshReview(), refreshExplorerSidebarData()])
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
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
      await openNoteInTab(response.notePath, response.title || cleanTitle, { initialNoteType: 'task' })
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
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
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
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
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
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
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
      setMessage(`Datei umbenannt: ${toNoteDisplayName(response.renamedPath)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveExplorerFiles = async (paths: string[], targetGroupKey: string) => {
    const uniquePaths = Array.from(new Set(paths.map((item) => String(item ?? '').trim()).filter(Boolean)))
    if (uniquePaths.length === 0) {
      return
    }

    const applyMoveResult = (
      movedEntries: { fromPath: string; movedPath: string }[],
      counts: VaultCounts,
      fallbackUsed = false
    ) => {
      setCounts(counts)

      const moveMap = new Map<string, string>()
      const changedTargets: string[] = []
      for (const entry of movedEntries) {
        const fromPath = normalizePath(String(entry?.fromPath ?? ''))
        const movedPath = normalizePath(String(entry?.movedPath ?? ''))
        if (!fromPath || !movedPath) {
          continue
        }
        moveMap.set(fromPath.toLowerCase(), movedPath)
        if (fromPath.toLowerCase() !== movedPath.toLowerCase()) {
          changedTargets.push(movedPath)
        }
      }

      if (moveMap.size > 0) {
        setOpenTabs((prev) =>
          prev.map((tab) => {
            if (tab.kind !== 'note') {
              return tab
            }
            const key = normalizePath(tab.path).toLowerCase()
            const nextPath = moveMap.get(key)
            if (!nextPath || nextPath === tab.path) {
              return tab
            }
            return {
              ...tab,
              path: nextPath,
              title: toNoteDisplayName(nextPath),
            }
          })
        )
      }

      if (changedTargets.length === 1) {
        setMessage(`Datei verschoben: ${toNoteDisplayName(changedTargets[0])}`)
      } else if (changedTargets.length > 1) {
        setMessage(`Dateien verschoben: ${changedTargets.length}${fallbackUsed ? ' (Fallback)' : ''}`)
      } else {
        setMessage('Keine Dateien verschoben.')
      }
    }

    try {
      setError('')
      const response = await apiRequest<
        { movedPaths: { fromPath: string; movedPath: string }[]; counts: VaultCounts }
      >(backendUrl, '/notes/move-batch', {
        method: 'POST',
        body: JSON.stringify({ paths: uniquePaths, targetGroupKey }),
      })
      applyMoveResult(Array.isArray(response.movedPaths) ? response.movedPaths : [], response.counts)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
    } catch {
      try {
        const movedEntries: { fromPath: string; movedPath: string }[] = []
        let latestCounts: VaultCounts | null = null

        for (const path of uniquePaths) {
          const response = await apiRequest<{ movedPath: string; counts: VaultCounts }>(backendUrl, '/notes/move', {
            method: 'POST',
            body: JSON.stringify({ path, targetGroupKey }),
          })
          latestCounts = response.counts
          movedEntries.push({
            fromPath: path,
            movedPath: response.movedPath,
          })
        }

        if (latestCounts) {
          applyMoveResult(movedEntries, latestCounts, true)
        }
        await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
      } catch (caughtFallback) {
        setError(String(caughtFallback))
      }
    }
  }

  const moveExplorerFile = async (path: string, targetGroupKey: string) => {
    await moveExplorerFiles([path], targetGroupKey)
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
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshTodos(), refreshReview()])
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
    tagGroupOptions?: Array<{ id: string; displayName: string }>
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
        tagGroupOptions: config.tagGroupOptions,
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

  const requestSaveBeforeAppClose = useCallback(async (): Promise<boolean> => {
    if (settingsDirty) {
      const settingsSaved = await saveSettings()
      if (!settingsSaved) {
        return false
      }
    }

    const dirtyTabs = openTabsRef.current.filter((tab) => tab.kind === 'note' && tab.dirty)
    for (const tab of dirtyTabs) {
      const saved = await saveTab(tab.path)
      if (!saved) {
        return false
      }
    }
    return true
  }, [saveSettings, saveTab, settingsDirty])

  useEffect(() => {
    window.nicknotes?.setUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges])

  useEffect(() => {
    const register = window.nicknotes?.onRequestSaveBeforeClose
    if (!register) {
      return
    }
    const cleanup = register(() => {
      void requestSaveBeforeAppClose()
        .then((ok) => {
          window.nicknotes?.respondSaveBeforeClose?.(ok)
        })
        .catch(() => {
          window.nicknotes?.respondSaveBeforeClose?.(false)
        })
    })
    return () => {
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
  }, [requestSaveBeforeAppClose])

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
    tagGroupOptions?: Array<{ id: string; displayName: string }>
  }): Promise<TagFormValues | null> => {
    const result = await openTagActionDialog({
      kind: 'tag-form',
      title: config.title,
      message: config.message,
      initialTagValues: config.initialValues,
      tagGroupOptions: config.tagGroupOptions,
      actions: [
        { id: 'confirm', label: config.confirmLabel, tone: 'primary' },
        { id: 'cancel', label: 'Abbrechen' },
      ],
    })
    if (result.actionId !== 'confirm' || !result.tagValues) {
      return null
    }
    return {
      groupId: result.tagValues.groupId ? normalizeTagId(result.tagValues.groupId) : undefined,
      newGroupId: result.tagValues.newGroupId ? normalizeTagId(result.tagValues.newGroupId) : undefined,
      newGroupDisplayName: normalizeLabel(result.tagValues.newGroupDisplayName ?? ''),
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

  const createTagFromEditorSelection = async (
    selectedText: string,
    replaceSelection: (tagSyntax: string) => void
  ): Promise<void> => {
    const displayName = normalizeLabel(selectedText)
    if (!displayName) {
      return
    }
    if (mergedTagGroups.length === 0) {
      setMessage('Lege zuerst eine Tag-Gruppe an.')
      return
    }

    const firstGroup = mergedTagGroups[0]
    const form = await openTagFormDialog({
      title: 'Neuen Tag aus Auswahl erstellen',
      message: 'Waehle die Tag-Gruppe und pruefe ID sowie Anzeigename.',
      confirmLabel: 'Anlegen und einfuegen',
      initialValues: {
        groupId: firstGroup.id,
        id: normalizeTagId(displayName),
        displayName,
      },
      tagGroupOptions: mergedTagGroups.map((group) => ({ id: group.id, displayName: group.displayName })),
    })
    if (!form) {
      return
    }

    const creatingNewGroup = form.groupId === 'create-new-tag-group'
    const groupId = creatingNewGroup ? normalizeTagId(form.newGroupId || '') : normalizeTagId(form.groupId || firstGroup.id)

    const tagId = normalizeTagId(form.id)
    if (!tagId) {
      setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const tagDisplayName = normalizeLabel(form.displayName) || displayName
    if (!groupId) {
      setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const existingGroup = resolveTagGroupById(groupId)
    if (!creatingNewGroup && !existingGroup) {
      setMessage(`Tag-Gruppe nicht gefunden: ${groupId}`)
      return
    }

    if (creatingNewGroup && existingGroup) {
      setMessage(`Die Tag-Gruppe "${existingGroup.displayName}" (${existingGroup.id}) existiert bereits.`)
      return
    }

    const tagSyntax = `{tag:${groupId}/${tagId}}`
    const duplicateTag = existingGroup?.tags.find((entry) => entry.id.toLowerCase() === tagId.toLowerCase())
    if (duplicateTag && existingGroup) {
      replaceSelection(tagSyntax)
      setMessage(`Bestehenden Tag eingefuegt: ${existingGroup.displayName} / ${duplicateTag.displayName}`)
      return
    }

    try {
      setError('')
      let latestGroups: unknown = null
      let groupDisplayName = existingGroup?.displayName || normalizeLabel(form.newGroupDisplayName || '') || groupId
      if (creatingNewGroup) {
        const groupResponse = await apiRequest<{ groups: unknown }>(backendUrl, '/tag-groups/add-group', {
          method: 'POST',
          body: JSON.stringify({
            groupId,
            displayName: groupDisplayName,
            color: TAG_COLOR_PRESETS[0],
          }),
        })
        latestGroups = groupResponse.groups
      }

      const response = await apiRequest<{ groups: unknown }>(backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({
          groupId,
          tagId,
          displayName: tagDisplayName,
        }),
      })
      latestGroups = response.groups ?? latestGroups
      const normalizedGroups = toStorageTagGroups(latestGroups)
      const createdGroup = normalizedGroups.find((group) => group.id.toLowerCase() === groupId.toLowerCase())
      groupDisplayName = createdGroup?.displayName || groupDisplayName
      setCustomTagGroups(normalizedGroups)
      setFolderOpen(`tag-group-${groupId}`)
      replaceSelection(tagSyntax)
      setMessage(`Tag angelegt und eingefuegt: ${groupDisplayName} / ${tagDisplayName}`)
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

  const openTagMatchAssistant = async () => {
    if (!vaultLoaded) {
      return
    }
    setTagMatchAssistant({
      open: true,
      loading: true,
      applying: false,
      cursor: 0,
      items: [],
      skippedIds: [],
    })
    try {
      setError('')
      const response = await apiRequest<{ items: TagMatchCandidate[]; total: number }>(
        backendUrl,
        '/tag-groups/match-candidates'
      )
      setTagMatchAssistant((current) => ({
        ...current,
        loading: false,
        cursor: 0,
        items: response.items,
        skippedIds: [],
      }))
      setMessage(response.total > 0 ? `${response.total} moegliche Tag-Fundstellen gefunden.` : 'Keine offenen Tag-Fundstellen gefunden.')
    } catch (caught) {
      setTagMatchAssistant((current) => ({ ...current, loading: false }))
      setError(String(caught))
    }
  }

  const closeTagMatchAssistant = () => {
    if (tagMatchAssistant.applying) {
      return
    }
    setTagMatchAssistant((current) => ({ ...current, open: false }))
  }

  const visibleTagMatchItems = tagMatchAssistant.items.filter((item) => !tagMatchAssistant.skippedIds.includes(item.id))
  const activeTagMatch =
    visibleTagMatchItems.length > 0
      ? visibleTagMatchItems[Math.min(tagMatchAssistant.cursor, visibleTagMatchItems.length - 1)]
      : null

  const moveTagMatchCursor = (direction: 1 | -1) => {
    setTagMatchAssistant((current) => {
      const visibleCount = current.items.filter((item) => !current.skippedIds.includes(item.id)).length
      if (visibleCount <= 0) {
        return current
      }
      return {
        ...current,
        cursor: (current.cursor + direction + visibleCount) % visibleCount,
      }
    })
  }

  const skipActiveTagMatch = () => {
    if (!activeTagMatch) {
      return
    }
    setTagMatchAssistant((current) => {
      const skippedIds = current.skippedIds.includes(activeTagMatch.id)
        ? current.skippedIds
        : [...current.skippedIds, activeTagMatch.id]
      const visibleCount = current.items.filter((item) => !skippedIds.includes(item.id)).length
      return {
        ...current,
        skippedIds,
        cursor: Math.max(0, Math.min(current.cursor, visibleCount - 1)),
      }
    })
  }

  const applyTagMatches = async (matches: TagMatchCandidate[]) => {
    const uniqueMatches = Array.from(new Map(matches.map((item) => [item.id, item])).values())
    if (uniqueMatches.length === 0) {
      return
    }
    const targetPathKeys = new Set(uniqueMatches.map((item) => normalizeFilePathKey(item.path)))
    const dirtyTargets = openTabsRef.current.filter(
      (tab) => tab.kind === 'note' && tab.dirty && targetPathKeys.has(normalizeFilePathKey(tab.path))
    )
    if (dirtyTargets.length > 0) {
      setError('Bitte speichere offene geaenderte Notizen, bevor Tag-Fundstellen darin uebernommen werden.')
      return
    }
    setTagMatchAssistant((current) => ({ ...current, applying: true }))
    try {
      setError('')
      const response = await apiRequest<{
        applied: number
        notesUpdated: number
        paths: string[]
        counts: VaultCounts
        tagGroups?: unknown
      }>(backendUrl, '/tag-groups/apply-matches', {
        method: 'POST',
        body: JSON.stringify({ matches: uniqueMatches }),
      })
      setCounts(response.counts)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setOpenTabs((tabs) =>
        tabs.map((tab) => {
          if (tab.kind !== 'note' || !response.paths.some((path) => normalizeFilePathKey(path) === normalizeFilePathKey(tab.path))) {
            return tab
          }
          return { ...tab, dirty: false, loading: true }
        })
      )
      await Promise.all([refreshWorkspaceData(true), refreshOpenTabsFromDisk(response.paths)])
      setTagMatchAssistant((current) => {
        const appliedIds = new Set(uniqueMatches.map((item) => item.id))
        const items = current.items.filter((item) => !appliedIds.has(item.id))
        return {
          ...current,
          applying: false,
          items,
          cursor: Math.max(0, Math.min(current.cursor, items.length - 1)),
        }
      })
      setMessage(`${response.applied} Fundstellen in ${response.notesUpdated} Notizen uebernommen.`)
    } catch (caught) {
      setTagMatchAssistant((current) => ({ ...current, applying: false }))
      setError(String(caught))
    }
  }

  const applyActiveTagMatch = () => {
    if (activeTagMatch) {
      void applyTagMatches([activeTagMatch])
    }
  }

  const applyActiveTagEverywhere = () => {
    if (!activeTagMatch) {
      return
    }
    const matches = visibleTagMatchItems.filter(
      (item) =>
        item.groupId.toLowerCase() === activeTagMatch.groupId.toLowerCase() &&
        item.tagId.toLowerCase() === activeTagMatch.tagId.toLowerCase()
    )
    void applyTagMatches(matches)
  }

  const applyAllTagMatches = () => {
    void applyTagMatches(visibleTagMatchItems)
  }

  const refreshOpenTabsFromDisk = async (paths: string[]) => {
    if (paths.length === 0) {
      return
    }
    const pathKeys = new Set(paths.map(normalizeFilePathKey))
    const noteTabs = openTabsRef.current.filter((tab) => tab.kind === 'note' && pathKeys.has(normalizeFilePathKey(tab.path)))
    await Promise.allSettled(
      noteTabs.map(async (tab) => {
        const response = await apiRequest<{ path: string; content: string }>(
          backendUrl,
          `/notes/content?path=${encodeURIComponent(tab.path)}`
        )
        const parsed = parseNoteDocument(response.content, tab.title || toNoteDisplayName(response.path))
        setOpenTabs((tabs) =>
          tabs.map((entry) =>
            entry.id === tab.id
              ? {
                  ...entry,
                  path: response.path,
                  title: normalizeLabel(String(parsed.frontmatter.title ?? '')) || toNoteDisplayName(response.path),
                  content: response.content,
                  parsedDocument: parsed,
                  dirty: false,
                  loading: false,
                }
              : entry
          )
        )
      })
    )
  }

  const handleWorkspaceExternalDrop = (paneId: PaneId, payload: ExternalNoteDropPayload) => {
    void openNoteInTab(payload.path, payload.title, {
      targetPane: paneId,
    })
  }

  const handleActivatePaneTab = (paneId: PaneId, tabId: string) => {
    dispatchWorkspace({
      type: 'ACTIVATE_TAB',
      paneId,
      tabId,
    })
    setEditorPanelOpen(true)
  }

  const handleFocusPane = (paneId: PaneId, tabId?: string | null) => {
    dispatchWorkspace({
      type: 'SET_LAST_FOCUSED_PANE',
      paneId,
      tabId: tabId ?? null,
    })
  }

  const handleMoveTabWithinPane = (paneId: PaneId, fromIndex: number, toIndex: number) => {
    dispatchWorkspace({
      type: 'MOVE_TAB_WITHIN_PANE',
      paneId,
      fromIndex,
      toIndex,
    })
  }

  const handleMoveTabToOtherPane = (fromPaneId: PaneId, toPaneId: PaneId, tabId: string) => {
    dispatchWorkspace({
      type: 'MOVE_TAB_TO_OTHER_PANE',
      fromPaneId,
      toPaneId,
      tabId,
    })
  }

  const toggleSplitView = () => {
    dispatchWorkspace({ type: 'TOGGLE_SPLIT_MODE' })
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

  const handleOneNoteImportComplete = (response: {
    counts?: VaultCounts
    tagGroups?: unknown
    groups?: NoteGroup[]
    import?: { importedPages?: number; reportPath?: string }
  }) => {
    if (response.counts) {
      setCounts(response.counts)
    }
    if (response.tagGroups) {
      setCustomTagGroups(toStorageTagGroups(response.tagGroups))
    }
    if (response.groups) {
      setNoteGroups(response.groups)
    }
    const importedPages = response.import?.importedPages ?? 0
    setMessage(`OneNote-Import abgeschlossen: ${importedPages} Seiten importiert.`)
    setError('')
    void Promise.allSettled([refreshExplorerSidebarData(true), runSearch(searchQuery, true), refreshReview()])
  }

  const openSidebarView = (view: SidebarView) => {
    if (sidebarView === view) {
      setSidebarOpen((prev) => !prev)
      return
    }

    setSidebarView(view)
    setSidebarOpen(true)
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

  const renderWorkspacePaneContent = (paneId: PaneId, paneTab: NoteTab | null) => {
    if (!paneTab) {
      return null
    }

    if (paneTab.loading) {
      return <p className="empty-copy">Lade Notiz ...</p>
    }

    if (paneTab.kind === 'settings') {
      return (
        <SettingsEditorPanel
          displayName={displayName}
          theme={theme}
          backendUrl={backendUrl}
          vaultLoaded={vaultLoaded}
          sidebarOpen={sidebarOpen}
          explorerOptions={explorerOptions}
          statusBarPrefs={statusBarPrefs}
          taskFeatureSettings={taskFeatureSettings}
          settingsDirty={settingsDirty}
          setSidebarOpen={setSidebarOpen}
          setExplorerOptions={setExplorerOptions}
          setStatusBarPrefs={setStatusBarPrefs}
          setTaskFeatureSettings={setTaskFeatureSettings}
          onDisplayNameChange={(nextRawValue) => setDisplayName(normalizeLabel(nextRawValue) || 'Max')}
          onThemeChange={setThemeMode}
          onSave={() => {
            void saveSettings()
          }}
          onDiscard={discardSettings}
          onOneNoteImportComplete={handleOneNoteImportComplete}
        />
      )
    }

    if (paneTab.kind === 'todo_dashboard') {
      return (
        <TodoDashboardCanvas
          todos={todos}
          tasks={tasks}
          tagGroups={mergedTagGroups}
          filters={todoDashboardFilters}
          onToggleTodo={(todoId, checked) => {
            void toggleTodo(todoId, checked)
          }}
          onOpenOrigin={(path, title) => {
            void openTodoOrigin(path, title)
          }}
          onOpenTagOverview={(tagKey) => {
            void openTagOverviewByReference(tagKey)
          }}
          onPromoteTodo={(todoId) => {
            void promoteTodo(todoId)
          }}
          onOpenTaskPath={(path, title) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: 'task' })
          }}
        />
      )
    }

    if (paneTab.kind === 'task_dashboard') {
      return (
        <TaskDashboardCanvas
          tasks={tasks}
          filters={taskDashboardFilters}
          tagGroups={mergedTagGroups}
          onFiltersChange={setTaskDashboardFilters}
          onOpenTaskPath={(path, title) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: 'task' })
          }}
          taskStatusClassName={taskStatusClassName}
          taskStatusLabel={taskStatusLabel}
          taskPriorityDotClassName={taskPriorityDotClassName}
          taskPriorityLabel={taskPriorityLabel}
          toGermanTimestamp={toGermanTimestamp}
        />
      )
    }

    if (paneTab.kind === 'focus_dashboard') {
      return (
        <FocusDashboardCanvas
          tasks={tasks}
          todos={todos}
          notes={allNotes}
          noteBasePath={vaultPath}
          filters={focusDashboardFilters}
          mitIds={focusMitIds}
          taskFeatureSettings={taskFeatureSettings}
          onFiltersChange={setFocusDashboardFilters}
          onSaveMit={saveFocusMit}
          onQuickCaptureTodo={quickCaptureFocusTodo}
          onOpenTaskPath={(path, title) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: 'task' })
          }}
          onOpenTodoOrigin={(path, title) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: 'note' })
          }}
          onOpenNotePath={(path, title, noteType) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: noteType === 'task' ? 'task' : 'note' })
          }}
          toGermanTimestamp={toGermanTimestamp}
        />
      )
    }

    if (paneTab.kind === 'review_dashboard') {
      return (
        <ReviewDashboardCanvas
          data={reviewDashboardData}
          filters={reviewDashboardFilters}
          onFiltersChange={setReviewDashboardFilters}
          onOpenNotePath={(path, title, noteType) => {
            if (!path) {
              return
            }
            void openNoteInTab(path, title, { initialNoteType: noteType === 'task' ? 'task' : 'note' })
          }}
        />
      )
    }

    if (paneTab.kind === 'graph_dashboard') {
      return <GraphDashboardCanvas />
    }

    const document = paneTab.parsedDocument ?? parseNoteDocument(paneTab.content, paneTab.title || toNoteDisplayName(paneTab.path))
    const isReadOnlyNote = Boolean(paneTab.readOnly)
    const readOnlyTitle = normalizeLabel(document.frontmatter.title) || paneTab.title || toNoteDisplayName(paneTab.path)
    return (
      <div className="note-editor-shell">
        <div className={`note-flow-content ${workspaceState.layoutMode === 'split' ? 'split-note-flow-content' : ''}`}>
          {isReadOnlyNote ? (
            <section className={`note-readonly-banner ${workspaceState.layoutMode === 'split' ? 'split-note-readonly-banner' : ''}`}>
              <h2>{readOnlyTitle}</h2>
              <p>Diese Notiz wird automatisch aus allen Tag-Verwendungen generiert und kann nicht manuell bearbeitet werden.</p>
            </section>
          ) : (
            renderNoteProperties(paneTab.path, document, workspaceState.layoutMode === 'split')
          )}
          <CodeMirrorMarkdownEditor
            key={`editor-${paneId}-${paneTab.id}`}
            className={`note-body-editor ${workspaceState.layoutMode === 'split' ? 'split-note-body-editor' : ''}`}
            embeddedInScroll
            value={document.body}
            theme={theme}
            notePath={paneTab.path}
            backendUrl={backendUrl}
            readOnly={isReadOnlyNote}
            tagGroups={mergedTagGroups}
            linkTargets={markdownLinkTargets}
            searchHighlightQuery={explorerFilterQuery}
            onChange={(nextContent) => {
              if (isReadOnlyNote) {
                return
              }
              dispatchWorkspace({
                type: 'SET_LAST_FOCUSED_PANE',
                paneId,
                tabId: paneTab.id,
              })
              updateNoteContentByPath(paneTab.path, nextContent)
            }}
            onInsertImageAsset={(file) => {
              if (isReadOnlyNote) {
                return Promise.resolve(null)
              }
              return uploadImageForNote(paneTab.path, file)
            }}
            onOpenWikiLink={(target) => {
              openWikiLinkInEditor(target, paneId)
            }}
            onOpenTagReference={(groupId, tagId) => {
              void openTagOverviewByReference(`${groupId}:${tagId}`, { targetPane: paneId })
            }}
            onCreateTagFromSelection={(selectedText, replaceSelection) => {
              void createTagFromEditorSelection(selectedText, replaceSelection)
            }}
            editorApiRef={paneId === 'left' ? leftEditorRef : rightEditorRef}
          />
        </div>
      </div>
    )
  }

  const showCaptureInline = capturePanelOpen && capturePinned
  const windowTitlebar = (
    <div className="window-titlebar">
      <div className="window-titlebar-brand" aria-label="NickNotes">
        <span className="window-titlebar-logo">NN</span>
        <span className="window-titlebar-title">NickNotes</span>
      </div>
    </div>
  )
  const createNoteBaseDialog = createNoteBaseDialogOpen ? (
    <div
      className="modal-overlay"
      onClick={() => {
        closeCreateNoteBaseDialog()
      }}
    >
      <aside
        className="create-notebase-modal"
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeCreateNoteBaseDialog()
          }
        }}
      >
        <header className="sidebar-header-row">
          <h3>Neue NoteBase anlegen</h3>
        </header>
        <p className="muted-copy">Lege Name, Speicherort und Anrede fuer die neue NoteBase fest.</p>
        <form
          className="create-notebase-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitCreateNoteBaseDialog()
          }}
        >
          <label className="create-notebase-label" htmlFor="create-notebase-display-name">
            Anrede
          </label>
          <input
            id="create-notebase-display-name"
            value={createNoteBaseDisplayName}
            onChange={(event) => {
              setCreateNoteBaseDisplayName(normalizeLabel(event.target.value))
            }}
            placeholder="z. B. Max"
            autoFocus
          />

          <label className="create-notebase-label" htmlFor="create-notebase-name">
            NoteBase-Name
          </label>
          <input
            id="create-notebase-name"
            value={createNoteBaseName}
            onChange={(event) => {
              setCreateNoteBaseName(normalizeLabel(event.target.value))
            }}
            placeholder="z. B. MeineNoteBase"
          />

          <label className="create-notebase-label" htmlFor="create-notebase-parent-path">
            Speicherort
          </label>
          <div className="create-notebase-path-row">
            <input
              id="create-notebase-parent-path"
              value={createNoteBaseParentPath}
              onChange={(event) => {
                setCreateNoteBaseParentPath(event.target.value)
              }}
              placeholder="Ordner fuer die neue NoteBase"
            />
            <button
              type="button"
              onClick={() => {
                void chooseCreateNoteBaseParentDirectory()
              }}
              disabled={createNoteBasePending}
            >
              Ordner waehlen
            </button>
          </div>

          <div className="create-notebase-modal-actions">
            <button type="button" onClick={closeCreateNoteBaseDialog} disabled={createNoteBasePending}>
              Abbrechen
            </button>
            <button type="submit" className="primary" disabled={createNoteBasePending}>
              {createNoteBasePending ? 'Wird angelegt ...' : 'NoteBase anlegen'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  ) : null

  const renderTagMatchPreview = (match: TagMatchCandidate, mode: 'before' | 'after') => (
    <div className="tag-match-editor-preview">
      <span className="tag-match-context">{match.before}</span>
      {mode === 'before' ? (
        <mark className="tag-match-highlight">{match.matchedText}</mark>
      ) : (
        <span
          className="cm-md-inline-tag-chip tag-match-chip"
          style={{ '--cm-md-tag-color': match.groupColor } as CSSProperties}
          title={`${match.groupDisplayName} / ${match.tagDisplayName}`}
        >
          {match.tagDisplayName}
        </span>
      )}
      <span className="tag-match-context">{match.after}</span>
    </div>
  )

  const tagMatchAssistantModal = tagMatchAssistant.open ? (
    <div
      className="modal-overlay tag-match-overlay"
      onClick={() => {
        closeTagMatchAssistant()
      }}
    >
      <aside
        className="tag-match-modal"
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeTagMatchAssistant()
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            moveTagMatchCursor(1)
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            moveTagMatchCursor(-1)
          }
        }}
      >
        <header className="tag-match-header">
          <div>
            <h3>Tag-Fundstellen pruefen</h3>
            <p>
              {tagMatchAssistant.loading
                ? 'NoteBase wird durchsucht ...'
                : activeTagMatch
                  ? `${activeTagMatch.relativePath} - Zeile ${activeTagMatch.line}`
                  : 'Keine offenen Fundstellen.'}
            </p>
          </div>
          <button className="icon-button compact muted" onClick={closeTagMatchAssistant} title="Schliessen">
            <LucideNamedIcon name="X" size={14} />
          </button>
        </header>

        {tagMatchAssistant.loading ? <div className="tag-match-empty">Suche laeuft ...</div> : null}

        {!tagMatchAssistant.loading && activeTagMatch ? (
          <>
            <div className="tag-match-summary-row">
              <span>
                Treffer {Math.min(tagMatchAssistant.cursor + 1, visibleTagMatchItems.length)} von {visibleTagMatchItems.length}
              </span>
              <span>
                {activeTagMatch.groupDisplayName} / {activeTagMatch.tagDisplayName}
              </span>
            </div>

            <div className="tag-match-compare-grid">
              <section>
                <h4>Vorher</h4>
                {renderTagMatchPreview(activeTagMatch, 'before')}
              </section>
              <section>
                <h4>Nachher</h4>
                {renderTagMatchPreview(activeTagMatch, 'after')}
              </section>
            </div>

            <footer className="tag-match-actions">
              <div className="tag-match-nav-actions">
                <button type="button" onClick={() => moveTagMatchCursor(-1)} disabled={visibleTagMatchItems.length <= 1}>
                  <LucideNamedIcon name="ChevronLeft" size={14} />
                </button>
                <button type="button" onClick={() => moveTagMatchCursor(1)} disabled={visibleTagMatchItems.length <= 1}>
                  <LucideNamedIcon name="ChevronRight" size={14} />
                </button>
              </div>
              <div className="tag-match-apply-actions">
                <button type="button" onClick={skipActiveTagMatch} disabled={tagMatchAssistant.applying}>
                  Ueberspringen
                </button>
                <button type="button" onClick={applyActiveTagEverywhere} disabled={tagMatchAssistant.applying}>
                  Diesen Tag ueberall
                </button>
                <button type="button" onClick={applyAllTagMatches} disabled={tagMatchAssistant.applying}>
                  Alle uebernehmen
                </button>
                <button type="button" className="primary" onClick={applyActiveTagMatch} disabled={tagMatchAssistant.applying}>
                  Uebernehmen
                </button>
              </div>
            </footer>
          </>
        ) : null}

        {!tagMatchAssistant.loading && !activeTagMatch ? (
          <div className="tag-match-empty">
            <p>Keine Fundstellen mehr offen.</p>
            <button type="button" onClick={closeTagMatchAssistant}>
              Fertig
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  ) : null

  const noteBaseProgressTotal = noteBaseOpenStatus?.total ?? 0
  const noteBaseProgressProcessed = noteBaseOpenStatus?.processed ?? 0
  const noteBaseProgressPercent =
    noteBaseProgressTotal > 0 ? Math.min(100, Math.round((noteBaseProgressProcessed / noteBaseProgressTotal) * 100)) : 0
  const noteBaseProgressLabel =
    noteBaseOpenStatus && noteBaseProgressTotal > 0
      ? `${noteBaseProgressProcessed} von ${noteBaseProgressTotal} Dateien`
      : 'Fortschritt wird ermittelt ...'
  const noteBaseProgressPath = noteBaseOpenStatus?.currentPath
    ? getRelativeVaultPath(noteBaseOpenStatus.currentPath, vaultPath)
    : ''

  if (!vaultLoaded) {
    return (
      <div className="window-frame">
        {windowTitlebar}
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
                <button onClick={() => void pickAndOpenVault()} disabled={noteBaseOpenStatus?.active}>
                  NoteBase laden
                </button>
                <button onClick={() => void createVault()} disabled={noteBaseOpenStatus?.active}>
                  NoteBase anlegen
                </button>
                <button onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}>
                  {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>

              {noteBaseOpenStatus?.active || noteBaseOpenStatus?.done ? (
                <div className="launch-progress" role="status" aria-live="polite">
                  <div className="launch-progress-header">
                    <span>{noteBaseOpenStatus.phase || 'NoteBase wird geladen ...'}</span>
                    <strong>{noteBaseProgressTotal > 0 ? `${noteBaseProgressPercent}%` : ''}</strong>
                  </div>
                  <div
                    className={`launch-progress-track ${noteBaseProgressTotal > 0 ? '' : 'indeterminate'}`}
                    aria-label="NoteBase-Ladefortschritt"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={noteBaseProgressTotal > 0 ? noteBaseProgressPercent : undefined}
                    role="progressbar"
                  >
                    <span style={{ width: noteBaseProgressTotal > 0 ? `${noteBaseProgressPercent}%` : '42%' }} />
                  </div>
                  <p className="launch-progress-meta">{noteBaseProgressLabel}</p>
                  {noteBaseProgressPath ? <p className="launch-progress-path">{noteBaseProgressPath}</p> : null}
                </div>
              ) : null}

              {message ? <p className="launch-message">{message}</p> : null}
              {error ? <p className="launch-error">{error}</p> : null}
            </div>
          </div>
        </div>
        {createNoteBaseDialog}
      </div>
    )
  }

  return (
    <div className="window-frame">
      {windowTitlebar}
      <div className="window-content">
        <GraphWorkspaceProvider
          backendUrl={backendUrl}
          vaultLoaded={vaultLoaded}
          graphUpdateToken={graphUpdateToken}
          latestGraphStatus={latestGraphStatus}
          onOpenNodePath={openGraphNodePath}
          onRevealNodePath={revealGraphNodePath}
        >
        <div className="workbench-shell">
      <ActivityRail
        sidebarView={sidebarView}
        onOpenSidebarView={openSidebarView}
        onOpenSettings={openSettingsTab}
      />

      {sidebarOpen ? (
        <aside className="left-sidebar" style={{ width: `${explorerWidth}px` }}>
          <WorkbenchSidebarContent
            sidebarView={sidebarView}
            noteBaseName={noteBaseName}
            vaultLoaded={vaultLoaded}
            explorerWidth={explorerWidth}
            onExplorerWidthChange={setExplorerWidth}
            onRenameNoteBase={() => {
              void renameNoteBase()
            }}
            onDeleteNoteBase={() => {
              void deleteNoteBase()
            }}
            onPickAndOpenVault={() => {
              void pickAndOpenVault()
            }}
            onCreateVault={() => {
              void createVault()
            }}
            onMigrateExistingNotesToTemplate={() => {
              void migrateExistingNotesToTemplate()
            }}
            tasks={tasks}
            taskFilters={taskDashboardFilters}
            todoFilters={todoDashboardFilters}
            focusFilters={focusDashboardFilters}
            onTaskFiltersChange={setTaskDashboardFilters}
            onTodoFiltersChange={setTodoDashboardFilters}
            onFocusFiltersChange={setFocusDashboardFilters}
            onRefreshTasks={() => {
              void refreshTasks()
            }}
            onRefreshTodos={() => {
              void refreshTodos()
            }}
            onRefreshFocusData={() => {
              void Promise.allSettled([refreshFocusAggregate(), refreshReview()])
            }}
            onOpenTodoDashboard={() => {
              openTodoDashboardTab()
            }}
            onOpenTaskDashboard={() => {
              openTaskDashboardTab()
            }}
            onOpenFocusDashboard={() => {
              openFocusDashboardTab()
            }}
            onOpenReviewDashboard={() => {
              openReviewDashboardTab()
            }}
            onOpenGraphDashboard={() => {
              openGraphDashboardTab()
            }}
            reviewFilters={reviewDashboardFilters}
            onReviewFiltersChange={setReviewDashboardFilters}
            onRefreshReview={() => {
              void refreshReview()
            }}
            mergedTagGroups={mergedTagGroups}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onCreateTagGroup={() => {
              void createTagGroup()
            }}
            onCreateTagInExistingGroup={(groupName) => {
              void createTagInExistingGroup(groupName)
            }}
            onRenameTagGroup={(groupName) => {
              void renameTagGroup(groupName)
            }}
            onSetTagGroupColor={(groupName) => {
              void setTagGroupColor(groupName)
            }}
            onDeleteTagGroup={(groupName) => {
              void deleteTagGroup(groupName)
            }}
            onRenameTag={(groupName, tagName) => {
              void renameTag(groupName, tagName)
            }}
            onDeleteTag={(groupName, tagName) => {
              void deleteTag(groupName, tagName)
            }}
            onOpenTagOverview={(groupName, tagName) => {
              void openTagOverviewByReference(`${groupName}:${tagName}`)
            }}
            onOpenTagMatchAssistant={() => {
              void openTagMatchAssistant()
            }}
            noteGroups={noteGroups}
            explorerRows={explorerRows}
            activeNotePath={activeTab?.kind === 'note' ? activeTab.path : ''}
            dirtyFilePaths={dirtyFilePaths}
            vaultPath={vaultPath}
            onOpenNoteInTab={openNoteInTab}
            onOpenNoteInCurrentEditor={openNoteInCurrentEditor}
            onOpenOrCreateTodayDaily={openOrCreateTodayDaily}
            onCreateExplorerFile={createExplorerFile}
            onCreateExplorerTask={createExplorerTask}
            onCreateExplorerFolder={createExplorerFolder}
            onRenameExplorerFile={renameExplorerFile}
            onRenameExplorerFolder={renameExplorerFolder}
        onDeleteExplorerFile={deleteExplorerFile}
        onDeleteExplorerFolder={deleteExplorerFolder}
        onMoveExplorerFile={moveExplorerFile}
        onMoveExplorerFiles={moveExplorerFiles}
        onMoveExplorerFolder={moveExplorerFolder}
            onToggleFavoriteFolder={toggleFavoriteFolder}
            explorerOptions={explorerOptions}
            explorerContentMatchPathKeys={explorerContentMatchPathKeys}
            onExplorerFilterQueryChange={setExplorerFilterQuery}
            onExplorerOptionsChange={setExplorerOptions}
            explorerRevealPath={explorerRevealPath}
            explorerRevealRequestId={explorerRevealRequestId}
            explorerViewSeed={explorerViewSeed}
            explorerViewSeedId={explorerViewSeedId}
            onExplorerViewStateChange={handleExplorerViewStateChange}
            onRefreshExplorerSidebarData={() => {
              void refreshExplorerSidebarData()
            }}
          />
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
            <EditorWorkspaceLayout
              workspace={workspaceState}
              paneTabs={paneTabs}
              paneActiveTabs={paneActiveTabs}
              activePaneId={activePaneId}
              disableSave={!activeTab || !activeTab.dirty}
              disableReveal={activeTab?.kind !== 'note'}
              onSaveActive={() => {
                if (activeTab) {
                  void saveTab(activeTab.path)
                }
              }}
              onRevealActive={revealActiveNoteInExplorer}
              onToggleSplitMode={toggleSplitView}
              onCloseEditorPanel={toggleEditorPanel}
              onSetSplitRatio={(nextRatio) => {
                dispatchWorkspace({
                  type: 'SET_SPLIT_RATIO',
                  splitRatio: nextRatio,
                })
              }}
              onActivateTab={handleActivatePaneTab}
              onCloseTab={(tabId) => {
                void closeEditorTab(tabId)
              }}
              onFocusPane={handleFocusPane}
              onMoveTabWithinPane={handleMoveTabWithinPane}
              onMoveTabToPane={handleMoveTabToOtherPane}
              onDropExternalNote={handleWorkspaceExternalDrop}
              onTabContextMenu={(tabId, x, y) => {
                setTabContextMenu({ x, y, tabId })
              }}
              renderPaneContent={renderWorkspacePaneContent}
              resolveTabIconName={resolveNoteTabIconName}
              getTabTooltip={getTabTooltip}
            />
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
                <div className="capture-input-wrap">
                  <span className="capture-prompt">&gt;</span>
                  <CodeMirrorMarkdownEditor
                    className="capture-markdown-editor"
                    value={captureText}
                    theme={theme}
                    notePath=""
                    backendUrl={backendUrl}
                    tagGroups={mergedTagGroups}
                    linkTargets={markdownLinkTargets}
                    placeholderText="Notiz erfassen und optional To-do nennen"
                    tagSuggestions={suggestions}
                    selectedTagSuggestionKeys={selectedTagKeys}
                    onChange={setCaptureText}
                    onToggleTagSuggestion={toggleCaptureTag}
                    onRejectTagSuggestion={rejectCaptureTag}
                    onSubmitShortcut={(markdown) => {
                      void saveCapture(markdown)
                    }}
                    onOpenWikiLink={(target) => {
                      openWikiLinkInEditor(target, activePaneId)
                    }}
                    onOpenTagReference={(groupId, tagId) => {
                      void openTagOverviewByReference(`${groupId}:${tagId}`, { targetPane: activePaneId })
                    }}
                    editorApiRef={captureEditorRef}
                  />
                  <button onClick={() => void saveCapture()} disabled={!captureText.trim()}>
                    Senden
                  </button>
                </div>
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

      {tabContextMenu && tabContextTarget ? (
        <div
          className="editor-tab-context-menu"
          style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              showNoteInSplitView(tabContextTarget.path)
            }}
          >
            In anderen Bereich verschieben
          </button>
          <button
            className="muted"
            onClick={() => {
              void closeEditorTab(tabContextTarget.id)
            }}
          >
            Registerkarte schliessen
          </button>
          <button
            className="muted"
            onClick={() => {
              void closeOtherEditorTabs(tabContextTarget.id)
            }}
            disabled={openTabs.length <= 1}
          >
            Alle anderen Registerkarten schliessen
          </button>
          <button
            className="muted"
            onClick={() => {
              void closeAllEditorTabs()
            }}
            disabled={openTabs.length === 0}
          >
            Alle Registerkarten schliessen
          </button>
        </div>
      ) : null}

      <StatusBar
        prefs={statusBarPrefs}
        message={message}
        error={error}
        noteBaseName={noteBaseName}
        counts={counts}
        dueTodayCount={dueTodayCount}
      />

      <TagActionDialogModal
        dialog={tagActionDialog}
        colorPresets={TAG_COLOR_PRESETS}
        setDialog={setTagActionDialog}
        onClose={closeTagActionDialog}
      />
      {tagMatchAssistantModal}
      {createNoteBaseDialog}

        </div>
        </GraphWorkspaceProvider>
      </div>
    </div>
  )
}

export default App






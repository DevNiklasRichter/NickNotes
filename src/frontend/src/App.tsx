import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { CodeMirrorMarkdownEditor } from './editor/CodeMirrorMarkdownEditor'
import type { MarkdownEditorApi } from './editor/CodeMirrorMarkdownEditor'
import { NotePropertiesPanel } from './editor/NotePropertiesPanel'
import {
  parseNoteDocument,
  serializeNoteDocument,
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
  DEFAULT_STATUS_BAR_PREFS,
  DEFAULT_EXPLORER_OPTIONS,
  DEFAULT_EXPLORER_VIEW_STATE,
  DEFAULT_TODO_DASHBOARD_FILTERS,
  DEFAULT_TASK_DASHBOARD_FILTERS,
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
  areExplorerOptionsEqual,
  toBoolean,
  toBoundedNumber,
  toThemeMode,
  toStatusBarPrefsFromSettings,
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
  ParsedTask,
  TaskRow,
  TodoRow,
  SearchRow,
  MediaUploadResponse,
  ReviewDaily,
  ReviewWeekly,
  BackendState,
  ThemeMode,
  SidebarView,
  NoteTab,
  TodoDashboardFilters,
  TaskDashboardFilters,
  EditorTabContextMenuState,
  StatusBarPrefs,
  UiSettingsPayload,
  NoteGroup,
} from './app/AppShared'

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
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [taskDashboardFilters, setTaskDashboardFilters] = useState<TaskDashboardFilters>({ ...DEFAULT_TASK_DASHBOARD_FILTERS })
  const [todoDashboardFilters, setTodoDashboardFilters] = useState<TodoDashboardFilters>({ ...DEFAULT_TODO_DASHBOARD_FILTERS })
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
  const [explorerViewState, setExplorerViewState] = useState<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE })
  const explorerViewStateRef = useRef<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE })
  const [explorerViewSeed, setExplorerViewSeed] = useState<ExplorerViewState | null>(null)
  const [explorerViewSeedId, setExplorerViewSeedId] = useState(0)
  const [explorerRevealPath, setExplorerRevealPath] = useState('')
  const [explorerRevealRequestId, setExplorerRevealRequestId] = useState(0)
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupDefinition[]>([])
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([])

  const [openTabs, setOpenTabs] = useState<NoteTab[]>([])
  const openTabsRef = useRef<NoteTab[]>([])
  const [workspaceState, dispatchWorkspace] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState)
  const workspaceStateRef = useRef(workspaceState)
  const tabIdCounterRef = useRef(0)
  const [tabContextMenu, setTabContextMenu] = useState<EditorTabContextMenuState>(null)
  const [tagActionDialog, setTagActionDialog] = useState<TagActionDialogState | null>(null)
  const tagActionDialogRef = useRef<TagActionDialogState | null>(null)
  const [propertyTagInputOpenByPath, setPropertyTagInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyTagDraftByPath, setPropertyTagDraftByPath] = useState<Record<string, string>>({})
  const [propertyRelatedInputOpenByPath, setPropertyRelatedInputOpenByPath] = useState<Record<string, boolean>>({})
  const [propertyRelatedDraftByPath, setPropertyRelatedDraftByPath] = useState<Record<string, string>>({})
  const leftEditorRef = useRef<MarkdownEditorApi | null>(null)
  const rightEditorRef = useRef<MarkdownEditorApi | null>(null)

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

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
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
      refreshTodos(force),
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
        setOpenTabs([])
        dispatchWorkspace({ type: 'RESET' })
        setExplorerViewState({ ...DEFAULT_EXPLORER_VIEW_STATE })
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
  const settingsTabOpen = openTabs.some((tab) => tab.path === SETTINGS_TAB_PATH)
  const todoDashboardTabOpen = openTabs.some((tab) => tab.path === TODO_DASHBOARD_TAB_PATH)
  const taskDashboardTabOpen = openTabs.some((tab) => tab.path === TASK_DASHBOARD_TAB_PATH)
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
    const baseDocument = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path))
    const liveBody = getLiveMarkdownForTab(targetTab)
    const nextDocument = liveBody !== null ? { ...baseDocument, body: liveBody } : baseDocument
    const liveContent = serializeNoteDocument(nextDocument)

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
    if (targetTab.kind === 'todo_dashboard' || targetTab.kind === 'task_dashboard') {
      return true
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
      dispatchWorkspace({ type: 'RESET' })
      storeLastNoteBasePath(loadedPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`NoteBase umbenannt: ${previousName} -> ${getPathTail(loadedPath)}`)
      await Promise.all([refreshTasks(true), refreshTodos(true), runSearch(searchQuery, true), refreshReview(true), refreshNoteGroups(true)])
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
      setTodos([])
      setSearchResults([])
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
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
      await Promise.all([refreshTasks(), refreshTodos(), runSearch(searchQuery), refreshReview(), refreshNoteGroups()])
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
      await Promise.all([refreshTasks(), refreshTodos(), refreshReview(), runSearch(searchQuery)])
    } catch (caught) {
      setError(String(caught))
    }
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
      if (existing.kind === 'note' && !existing.noteType) {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === existing.id && tab.kind === 'note'
              ? {
                  ...tab,
                  noteType: initialNoteType,
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
    const canClose = await confirmCloseTab(tabId)
    if (!canClose) {
      return
    }
    setOpenTabs((prev) => prev.filter((tab) => tab.id !== tabId))
    dispatchWorkspace({ type: 'CLOSE_TAB', tabId })
    setTabContextMenu(null)
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

      const parsed = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path))
      const nextDocument = updater(parsed)
      if (nextDocument === parsed) {
        return prev
      }

      const next = prev.slice()
      next[targetIndex] = {
        ...targetTab,
        title: nextDocument.frontmatter.title || targetTab.title,
        dirty: true,
        noteType: normalizeNoteTypeValue(nextDocument.frontmatter.type),
        parsedDocument: nextDocument,
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
    const relatedOptionsForPath = propertyRelatedOptions.filter(
      (item) => normalizeWikiLookup(item) !== normalizeWikiLookup(toNoteDisplayName(tabPath))
    )

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
        tagVisualByKey={tagVisualByKey}
        tagInputOpen={tagInputOpen}
        tagDraft={tagDraft}
        relatedInputOpen={relatedInputOpen}
        relatedDraft={relatedDraft}
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

  const openSidebarView = (view: SidebarView) => {
    if (sidebarView === view) {
      setSidebarOpen((prev) => !prev)
      if (view === 'todos' && !todoDashboardTabOpen) {
        openTodoDashboardTab()
      }
      if (view === 'tasks' && !taskDashboardTabOpen) {
        openTaskDashboardTab()
      }
      return
    }

    setSidebarView(view)
    setSidebarOpen(true)
    if (view === 'todos') {
      openTodoDashboardTab()
    }
    if (view === 'tasks') {
      openTaskDashboardTab()
    }
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
          sidebarOpen={sidebarOpen}
          explorerOptions={explorerOptions}
          statusBarPrefs={statusBarPrefs}
          settingsDirty={settingsDirty}
          setSidebarOpen={setSidebarOpen}
          setExplorerOptions={setExplorerOptions}
          setStatusBarPrefs={setStatusBarPrefs}
          onDisplayNameChange={(nextRawValue) => setDisplayName(normalizeLabel(nextRawValue) || 'Max')}
          onThemeChange={setThemeMode}
          onSave={() => {
            void saveSettings()
          }}
          onDiscard={discardSettings}
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

    const document = paneTab.parsedDocument ?? parseNoteDocument(paneTab.content, paneTab.title || toNoteDisplayName(paneTab.path))
    return (
      <div className="note-editor-shell">
        <div className={`note-flow-content ${workspaceState.layoutMode === 'split' ? 'split-note-flow-content' : ''}`}>
          {renderNoteProperties(paneTab.path, document, workspaceState.layoutMode === 'split')}
          <CodeMirrorMarkdownEditor
            key={`editor-${paneId}-${paneTab.id}`}
            className={`note-body-editor ${workspaceState.layoutMode === 'split' ? 'split-note-body-editor' : ''}`}
            embeddedInScroll
            value={document.body}
            theme={theme}
            notePath={paneTab.path}
            backendUrl={backendUrl}
            tagGroups={mergedTagGroups}
            searchHighlightQuery={explorerFilterQuery}
            onChange={(nextContent) => {
              dispatchWorkspace({
                type: 'SET_LAST_FOCUSED_PANE',
                paneId,
                tabId: paneTab.id,
              })
              updateNoteContentByPath(paneTab.path, nextContent)
            }}
            onInsertImageAsset={(file) => uploadImageForNote(paneTab.path, file)}
            editorApiRef={paneId === 'left' ? leftEditorRef : rightEditorRef}
          />
        </div>
      </div>
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
      <ActivityRail
        sidebarView={sidebarView}
        settingsTabOpen={settingsTabOpen}
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
            todos={todos}
            taskFilters={taskDashboardFilters}
            todoFilters={todoDashboardFilters}
            onTaskFiltersChange={setTaskDashboardFilters}
            onTodoFiltersChange={setTodoDashboardFilters}
            onRefreshTasks={() => {
              void refreshTasks()
            }}
            onRefreshTodos={() => {
              void refreshTodos()
            }}
            onMarkTaskDone={(id) => {
              void markTaskDone(id)
            }}
            onToggleTodo={(id) => {
              void toggleTodo(id)
            }}
            onPromoteTodo={(id) => {
              void promoteTodo(id)
            }}
            onOpenTodoOrigin={(path, title) => {
              void openTodoOrigin(path, title)
            }}
            onOpenTodoDashboard={() => {
              openTodoDashboardTab()
            }}
            onOpenTaskDashboard={() => {
              openTaskDashboardTab()
            }}
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
            daily={daily}
            weekly={weekly}
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
            noteGroups={noteGroups}
            explorerRows={explorerRows}
            activeNotePath={activeTab?.kind === 'note' ? activeTab.path : ''}
            dirtyFilePaths={dirtyFilePaths}
            vaultPath={vaultPath}
            onOpenNoteInTab={openNoteInTab}
            onOpenNoteInCurrentEditor={openNoteInCurrentEditor}
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

        </div>
      </div>
    </div>
  )
}

export default App






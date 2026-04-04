import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
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
  counts?: VaultCounts
}

type ThemeMode = 'light' | 'dark'
type SidebarView = 'vault' | 'notes' | 'tags' | 'tasks' | 'review'

type NoteTab = {
  path: string
  title: string
  content: string
  loading: boolean
}

const THEME_STORAGE_KEY = 'nicknotes-theme'
const TAG_GROUPS_STORAGE_KEY = 'nicknotes-custom-tag-groups'

type TagGroupsMap = Record<string, string[]>

function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

async function apiRequest<T>(baseUrl: string, endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
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

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function toStorageTagGroups(value: unknown): TagGroupsMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const result: TagGroupsMap = {}
  const candidate = value as Record<string, unknown>
  for (const [groupName, maybeTags] of Object.entries(candidate)) {
    if (typeof groupName !== 'string' || !Array.isArray(maybeTags)) {
      continue
    }

    const cleanGroup = normalizeLabel(groupName)
    if (!cleanGroup) {
      continue
    }

    const cleanTags = maybeTags
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeLabel(entry))
      .filter(Boolean)

    if (cleanTags.length > 0) {
      result[cleanGroup] = Array.from(new Set(cleanTags)).sort((left, right) =>
        left.localeCompare(right, 'de')
      )
    }
  }

  return result
}

function getStoredTagGroups(): TagGroupsMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(TAG_GROUPS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    return toStorageTagGroups(JSON.parse(raw))
  } catch {
    return {}
  }
}

function parseTagFromNote(row: SearchRow): { group: string; tag: string } | null {
  const title = normalizeLabel(row.title)
  if (title.includes(':')) {
    const separatorIndex = title.indexOf(':')
    const group = normalizeLabel(title.slice(0, separatorIndex))
    const tag = normalizeLabel(title.slice(separatorIndex + 1))
    if (group && tag) {
      return { group, tag }
    }
  }

  const normalizedPath = row.path.replace(/\\/g, '/')
  const entityMatch = normalizedPath.match(/\/02_entities\/([^/]+)\/([^/]+)\.md$/i)
  if (entityMatch) {
    const group = normalizeLabel(entityMatch[1].replace(/_/g, ' '))
    const tag = normalizeLabel(entityMatch[2].replace(/_/g, ' '))
    if (group && tag) {
      return { group, tag }
    }
  }

  return null
}

function App() {
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8765')
  const [theme, setTheme] = useState<ThemeMode>(getPreferredTheme)

  const [vaultPath, setVaultPath] = useState('')
  const [vaultLoaded, setVaultLoaded] = useState(false)
  const [counts, setCounts] = useState<VaultCounts>({ notes: 0, openTasks: 0, doneTasks: 0 })

  const [captureText, setCaptureText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([])
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([])

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])

  const [daily, setDaily] = useState<ReviewDaily | null>(null)
  const [weekly, setWeekly] = useState<ReviewWeekly | null>(null)

  const [sidebarView, setSidebarView] = useState<SidebarView>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    daily: true,
    tags: true,
    other: true,
  })
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupsMap>(getStoredTagGroups)
  const [newTagGroupName, setNewTagGroupName] = useState('')
  const [selectedTagGroup, setSelectedTagGroup] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [viewerDropActive, setViewerDropActive] = useState(false)
  const [splitDropActive, setSplitDropActive] = useState(false)

  const [openTabs, setOpenTabs] = useState<NoteTab[]>([])
  const [activeNotePath, setActiveNotePath] = useState('')
  const [splitView, setSplitView] = useState(false)
  const [compareNotePath, setCompareNotePath] = useState('')

  const [message, setMessage] = useState('Backend wird vorbereitet ...')
  const [error, setError] = useState('')

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem(TAG_GROUPS_STORAGE_KEY, JSON.stringify(customTagGroups))
  }, [customTagGroups])

  const refreshTasks = async () => {
    if (!vaultLoaded) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
    setTasks(response.items)
  }

  const runSearch = async (query: string) => {
    if (!vaultLoaded) {
      return
    }

    const response = await apiRequest<{ items: SearchRow[] }>(
      backendUrl,
      `/search?query=${encodeURIComponent(query)}`
    )
    setSearchResults(response.items)
  }

  const refreshReview = async () => {
    if (!vaultLoaded) {
      return
    }

    const response = await apiRequest<{ daily: ReviewDaily; weekly: ReviewWeekly }>(backendUrl, '/review')
    setDaily(response.daily)
    setWeekly(response.weekly)
  }

  const loadState = async () => {
    try {
      const state = await apiRequest<BackendState>(backendUrl, '/state')
      if (!state.vaultLoaded) {
        setVaultLoaded(false)
        setMessage('Kein Vault geladen.')
        return
      }

      setVaultLoaded(true)
      setVaultPath(state.vaultPath ?? '')
      if (state.counts) {
        setCounts(state.counts)
      }
      setMessage('Vault geladen.')
      setError('')

      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
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
      setCompareNotePath('')
      setSplitView(false)
      return
    }

    if (!openTabs.some((tab) => tab.path === activeNotePath)) {
      setActiveNotePath(openTabs[openTabs.length - 1].path)
    }

    if (compareNotePath && !openTabs.some((tab) => tab.path === compareNotePath)) {
      setCompareNotePath('')
    }

    if (openTabs.length < 2 && splitView) {
      setSplitView(false)
    }
  }, [activeNotePath, compareNotePath, openTabs, splitView])

  const chosenTags = useMemo(() => new Set(selectedTagKeys), [selectedTagKeys])

  const sortedNotes = useMemo(() => {
    return [...searchResults].sort((left, right) => {
      const leftTime = new Date(left.updated_at).getTime()
      const rightTime = new Date(right.updated_at).getTime()
      return rightTime - leftTime
    })
  }, [searchResults])

  const dailyNotes = useMemo(() => {
    return sortedNotes.filter((row) => {
      const type = row.note_type.toLowerCase()
      return type.includes('daily') || /daily/i.test(row.path) || /\d{4}-\d{2}-\d{2}/.test(row.title)
    })
  }, [sortedNotes])

  const groupedTagNotes = useMemo(() => {
    const groups: Record<string, SearchRow[]> = {}
    const ungrouped: SearchRow[] = []

    for (const row of sortedNotes) {
      const parsed = parseTagFromNote(row)
      if (!parsed) {
        continue
      }

      if (!groups[parsed.group]) {
        groups[parsed.group] = []
      }
      groups[parsed.group].push(row)
    }

    for (const row of sortedNotes) {
      const type = row.note_type.toLowerCase()
      const parsed = parseTagFromNote(row)
      if (!parsed && (type.includes('tag') || /tag/i.test(row.path) || row.title.includes(':'))) {
        ungrouped.push(row)
      }
    }

    for (const rows of Object.values(groups)) {
      rows.sort((left, right) => left.title.localeCompare(right.title, 'de'))
    }

    ungrouped.sort((left, right) => left.title.localeCompare(right.title, 'de'))

    return { groups, ungrouped }
  }, [sortedNotes])

  const tagNotes = useMemo(() => {
    return Object.values(groupedTagNotes.groups).flat()
  }, [groupedTagNotes.groups])

  const otherNotes = useMemo(() => {
    const knownPaths = new Set([...dailyNotes, ...tagNotes, ...groupedTagNotes.ungrouped].map((item) => item.path))
    return sortedNotes.filter((row) => !knownPaths.has(row.path))
  }, [dailyNotes, groupedTagNotes.ungrouped, sortedNotes, tagNotes])

  const discoveredTagGroups = useMemo(() => {
    const result: TagGroupsMap = {}
    for (const row of sortedNotes) {
      const parsed = parseTagFromNote(row)
      if (!parsed) {
        continue
      }

      if (!result[parsed.group]) {
        result[parsed.group] = []
      }
      result[parsed.group].push(parsed.tag)
    }

    for (const [group, tags] of Object.entries(result)) {
      result[group] = Array.from(new Set(tags)).sort((left, right) => left.localeCompare(right, 'de'))
    }

    return result
  }, [sortedNotes])

  const mergedTagGroups = useMemo(() => {
    const merged: TagGroupsMap = {}
    const allGroups = new Set([...Object.keys(discoveredTagGroups), ...Object.keys(customTagGroups)])

    for (const group of allGroups) {
      const combined = [...(discoveredTagGroups[group] ?? []), ...(customTagGroups[group] ?? [])]
      merged[group] = Array.from(new Set(combined)).sort((left, right) => left.localeCompare(right, 'de'))
    }

    return merged
  }, [customTagGroups, discoveredTagGroups])

  const sortedTagGroupNames = useMemo(
    () => Object.keys(mergedTagGroups).sort((left, right) => left.localeCompare(right, 'de')),
    [mergedTagGroups]
  )

  useEffect(() => {
    if (!selectedTagGroup && sortedTagGroupNames.length > 0) {
      setSelectedTagGroup(sortedTagGroupNames[0])
      return
    }

    if (selectedTagGroup && !sortedTagGroupNames.includes(selectedTagGroup)) {
      setSelectedTagGroup(sortedTagGroupNames[0] ?? '')
    }
  }, [selectedTagGroup, sortedTagGroupNames])

  const activeTab = openTabs.find((tab) => tab.path === activeNotePath) ?? openTabs[0] ?? null
  const compareCandidates = openTabs.filter((tab) => tab.path !== activeTab?.path)
  const compareTab = splitView
    ? openTabs.find((tab) => tab.path === compareNotePath) ?? compareCandidates[0] ?? null
    : null

  const pickDirectory = async (): Promise<string | null> => {
    if (!window.nicknotes?.selectDirectory) {
      return window.prompt('Bitte absoluten Pfad eingeben:') || null
    }
    return window.nicknotes.selectDirectory()
  }

  const openVault = async () => {
    try {
      setError('')
      const path = vaultPath.trim()
      if (!path) {
        throw new Error('Bitte zuerst einen Board-Pfad angeben.')
      }

      const response = await apiRequest<{ counts: VaultCounts }>(backendUrl, '/vault/open', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setVaultLoaded(true)
      setCounts(response.counts)
      setMessage('Board erfolgreich geladen und indexiert.')

      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createVault = async () => {
    try {
      setError('')
      const parentPath = await pickDirectory()
      if (!parentPath) {
        return
      }

      const name = window.prompt('Name des neuen Boards:', 'NickNotesBoard')?.trim()
      if (!name) {
        return
      }

      const response = await apiRequest<{ vaultPath: string; counts: VaultCounts }>(
        backendUrl,
        '/vault/create',
        {
          method: 'POST',
          body: JSON.stringify({ parentPath, name }),
        }
      )

      setVaultPath(response.vaultPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      setMessage(`Neues Board erstellt: ${response.vaultPath}`)
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const reindexVault = async () => {
    try {
      const response = await apiRequest<{ counts: VaultCounts }>(backendUrl, '/vault/reindex', {
        method: 'POST',
      })
      setCounts(response.counts)
      setMessage('Reindex abgeschlossen.')
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
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
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
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

  const openNoteInTab = async (path: string, suggestedTitle?: string) => {
    const fallbackTitle = suggestedTitle?.trim() || getFileName(path)
    const existing = openTabs.find((tab) => tab.path === path)
    if (existing) {
      setActiveNotePath(path)
      return
    }

    setOpenTabs((prev) => [
      ...prev,
      {
        path,
        title: fallbackTitle,
        content: '',
        loading: true,
      },
    ])
    setActiveNotePath(path)

    try {
      const content = await fetchNoteContent(path)
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.path === path
            ? {
                ...tab,
                title: fallbackTitle,
                content,
                loading: false,
              }
            : tab
        )
      )
    } catch (caught) {
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setError(String(caught))
    }
  }

  const closeTab = (path: string) => {
    setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
  }

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: !prev[folderKey] }))
  }

  const setFolderOpen = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: true }))
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

  const onNoteDragStart = (event: DragEvent<HTMLElement>, path: string, title: string) => {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('application/x-note-path', path)
    event.dataTransfer.setData('application/x-note-title', title)
    event.dataTransfer.setData('text/plain', path)
  }

  const onTabDragStart = (event: DragEvent<HTMLElement>, tab: NoteTab) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-open-tab-path', tab.path)
    event.dataTransfer.setData('application/x-open-tab-title', tab.title)
    event.dataTransfer.setData('text/plain', tab.path)
  }

  const addTagGroup = () => {
    const nextGroupName = normalizeLabel(newTagGroupName)
    if (!nextGroupName) {
      return
    }

    setCustomTagGroups((prev) => {
      if (prev[nextGroupName]) {
        return prev
      }
      return { ...prev, [nextGroupName]: [] }
    })
    setFolderOpen(`tag-group-${nextGroupName}`)
    setSelectedTagGroup(nextGroupName)
    setNewTagGroupName('')
    setMessage(`Tag-Gruppe angelegt: ${nextGroupName}`)
  }

  const addTagToGroup = () => {
    const groupName = normalizeLabel(selectedTagGroup)
    const tagName = normalizeLabel(newTagName)
    if (!groupName || !tagName) {
      return
    }

    setCustomTagGroups((prev) => {
      const existing = prev[groupName] ?? []
      if (existing.includes(tagName)) {
        return prev
      }

      return {
        ...prev,
        [groupName]: [...existing, tagName].sort((left, right) => left.localeCompare(right, 'de')),
      }
    })
    setFolderOpen(`tag-group-${groupName}`)
    setNewTagName('')
    setMessage(`Tag hinzugefuegt: ${groupName}:${tagName}`)
  }

  const handleViewerDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setViewerDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }
    void openNoteInTab(payload.path, payload.title)
  }

  const handleSplitDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setSplitDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }

    const applySplitWithPath = (path: string) => {
      const fallback = openTabs.find((tab) => tab.path !== activeTab?.path && tab.path !== path)?.path
      setSplitView(true)
      if (activeTab && path !== activeTab.path) {
        setCompareNotePath(path)
      } else {
        setCompareNotePath(fallback ?? '')
      }
    }

    const alreadyOpen = openTabs.some((tab) => tab.path === payload.path)
    if (alreadyOpen) {
      applySplitWithPath(payload.path)
      return
    }

    void openNoteInTab(payload.path, payload.title).then(() => {
      applySplitWithPath(payload.path)
    })
  }

  const toggleSplitView = () => {
    if (openTabs.length < 2) {
      return
    }

    setSplitView((previous) => {
      if (!previous && !compareNotePath) {
        const candidate = openTabs.find((tab) => tab.path !== activeNotePath)
        if (candidate) {
          setCompareNotePath(candidate.path)
        }
      }
      return !previous
    })
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

  const runSearchFromInput = () => {
    void runSearch(searchQuery)
  }

  const onQuickCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void saveCapture()
    }
  }

  const renderNoteItem = (row: SearchRow, depth = 1) => {
    const noteTitle = row.title || getFileName(row.path)

    return (
      <button
        key={row.path}
        className="tree-item note-item"
        style={{ paddingLeft: `${0.45 + depth * 0.55}rem` }}
        draggable
        onDragStart={(event) => onNoteDragStart(event, row.path, noteTitle)}
        onClick={() => void openNoteInTab(row.path, row.title)}
      >
        <strong>{noteTitle}</strong>
        <span>{row.note_type}</span>
      </button>
    )
  }

  const renderFolder = (
    folderKey: string,
    label: string,
    items: SearchRow[],
    depth = 0,
    emptyText = 'Keine Eintraege.'
  ) => {
    const isOpen = expandedFolders[folderKey] ?? true

    return (
      <div className="folder-node" key={folderKey}>
        <button
          className="folder-toggle"
          style={{ paddingLeft: `${0.35 + depth * 0.55}rem` }}
          onClick={() => toggleFolder(folderKey)}
        >
          <span>{isOpen ? 'v' : '>'}</span>
          <strong>{label}</strong>
          <em>{items.length}</em>
        </button>

        {isOpen ? (
          <div className="folder-children">
            {items.length === 0 ? <p className="empty-copy folder-empty">{emptyText}</p> : null}
            {items.map((row) => renderNoteItem(row, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const renderSidebarContent = () => {
    if (sidebarView === 'vault') {
      return (
        <div className="sidebar-content">
          <h3>Boards</h3>
          <p className="muted-label">Aktives Board</p>
          <p className="mono-block">{vaultPath || 'Kein Board geladen'}</p>

          <label className="field-label" htmlFor="vault-path-input">
            Board-Pfad
          </label>
          <input
            id="vault-path-input"
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
            placeholder="C:\\Pfad\\zum\\Board"
          />

          <div className="stacked-actions">
            <button onClick={() => void pickDirectory().then((dir) => dir && setVaultPath(dir))}>Ordner waehlen</button>
            <button onClick={() => void openVault()}>Board laden</button>
            <button onClick={() => void createVault()}>Neues Board</button>
            <button onClick={() => void reindexVault()} disabled={!vaultLoaded}>
              Reindex
            </button>
            <button onClick={() => void loadState()}>Status aktualisieren</button>
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
                  <span>{task.priority}</span>
                </header>
                <p>
                  {task.status}
                  {task.due_date ? ` | due ${task.due_date}` : ''}
                </p>
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
        <div className="sidebar-content">
          <div className="sidebar-header-row">
            <h3>Tagging</h3>
          </div>

          <section className="tag-actions">
            <label className="field-label" htmlFor="new-tag-group-input">
              Neue Tag-Gruppe
            </label>
            <div className="tag-action-row">
              <input
                id="new-tag-group-input"
                value={newTagGroupName}
                onChange={(event) => setNewTagGroupName(event.target.value)}
                placeholder="z. B. Personen"
              />
              <button onClick={addTagGroup} disabled={!newTagGroupName.trim()}>
                Gruppe anlegen
              </button>
            </div>
          </section>

          <section className="tag-actions">
            <label className="field-label" htmlFor="existing-tag-group-select">
              Tag in Gruppe anlegen
            </label>
            <div className="tag-action-row">
              <select
                id="existing-tag-group-select"
                value={selectedTagGroup}
                onChange={(event) => setSelectedTagGroup(event.target.value)}
              >
                <option value="" disabled>
                  Gruppe waehlen
                </option>
                {sortedTagGroupNames.map((groupName) => (
                  <option key={groupName} value={groupName}>
                    {groupName}
                  </option>
                ))}
              </select>
              <input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="z. B. Max"
              />
              <button onClick={addTagToGroup} disabled={!selectedTagGroup || !newTagName.trim()}>
                Tag anlegen
              </button>
            </div>
          </section>

          <section className="tree-scroll">
            {sortedTagGroupNames.length === 0 ? <p className="empty-copy">Keine Tag-Gruppen vorhanden.</p> : null}
            {sortedTagGroupNames.map((groupName) => {
              const folderKey = `tag-group-${groupName}`
              const tags = mergedTagGroups[groupName] ?? []
              const isOpen = expandedFolders[folderKey] ?? true

              return (
                <div className="folder-node" key={folderKey}>
                  <button className="folder-toggle" onClick={() => toggleFolder(folderKey)}>
                    <span>{isOpen ? 'v' : '>'}</span>
                    <strong>{groupName}</strong>
                    <em>{tags.length}</em>
                  </button>

                  {isOpen ? (
                    <div className="folder-children">
                      {tags.length === 0 ? <p className="empty-copy folder-empty">Noch keine Tags.</p> : null}
                      {tags.map((tag) => (
                        <div key={`${groupName}:${tag}`} className="tag-pill">
                          {groupName}:{tag}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        </div>
      )
    }

    return (
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Notizen</h3>
          <button onClick={runSearchFromInput} disabled={!vaultLoaded}>
            Suchen
          </button>
        </div>

        <div className="search-row">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runSearchFromInput()
              }
            }}
            placeholder="Datei, Tag, Text"
          />
        </div>

        <section className="tree-scroll">
          {renderFolder('daily', 'Daily Notes', dailyNotes, 0, 'Keine Daily Notes gefunden.')}

          <div className="folder-node">
            <button className="folder-toggle" onClick={() => toggleFolder('tags')}>
              <span>{(expandedFolders.tags ?? true) ? 'v' : '>'}</span>
              <strong>Tag Notes</strong>
              <em>{tagNotes.length + groupedTagNotes.ungrouped.length}</em>
            </button>

            {(expandedFolders.tags ?? true) ? (
              <div className="folder-children">
                {Object.keys(groupedTagNotes.groups)
                  .sort((left, right) => left.localeCompare(right, 'de'))
                  .map((groupName) =>
                    renderFolder(
                      `notes-tag-group-${groupName}`,
                      groupName,
                      groupedTagNotes.groups[groupName],
                      1,
                      'Keine Notizen in dieser Gruppe.'
                    )
                  )}
                {renderFolder(
                  'notes-tag-ungrouped',
                  'Ohne Gruppe',
                  groupedTagNotes.ungrouped,
                  1,
                  'Keine ungruppierten Tag-Notizen.'
                )}
              </div>
            ) : null}
          </div>

          {renderFolder('other', 'Weitere Notizen', otherNotes, 0, 'Keine weiteren Notizen gefunden.')}
        </section>
      </div>
    )
  }

  if (!vaultLoaded) {
    return (
      <div className="launch-shell">
        <div className="launch-card">
          <h1>NickNotes Workbench</h1>
          <p>Board einmal oeffnen und danach in der Workbench arbeiten.</p>

          <label htmlFor="launch-vault-path" className="field-label">
            Board-Pfad
          </label>
          <input
            id="launch-vault-path"
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
            placeholder="C:\\Pfad\\zum\\Board"
          />

          <div className="launch-actions">
            <button onClick={() => void pickDirectory().then((dir) => dir && setVaultPath(dir))}>Ordner waehlen</button>
            <button onClick={() => void openVault()}>Board laden</button>
            <button onClick={() => void createVault()}>Neues Board</button>
            <button onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          {message ? <p className="launch-message">{message}</p> : null}
          {error ? <p className="launch-error">{error}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="workbench-shell">
      <aside className="activity-rail">
        <button
          className={sidebarView === 'vault' ? 'active' : ''}
          onClick={() => openSidebarView('vault')}
          title="Boards"
        >
          B
        </button>
        <button
          className={sidebarView === 'notes' ? 'active' : ''}
          onClick={() => openSidebarView('notes')}
          title="Notizen"
        >
          N
        </button>
        <button
          className={sidebarView === 'tasks' ? 'active' : ''}
          onClick={() => openSidebarView('tasks')}
          title="Tasks"
        >
          T
        </button>
        <button
          className={sidebarView === 'tags' ? 'active' : ''}
          onClick={() => openSidebarView('tags')}
          title="Tagging"
        >
          #
        </button>
        <button
          className={sidebarView === 'review' ? 'active' : ''}
          onClick={() => openSidebarView('review')}
          title="Review"
        >
          R
        </button>

        <div className="rail-spacer" />

        <button
          className={settingsOpen ? 'active' : ''}
          onClick={() => setSettingsOpen((prev) => !prev)}
          title="Einstellungen"
        >
          E
        </button>
      </aside>

      {sidebarOpen ? <aside className="left-sidebar">{renderSidebarContent()}</aside> : null}

      <section className="main-region">
        <header className="main-header">
          <div>
            <h2>{activeTab?.title || 'Keine Notiz geoeffnet'}</h2>
            <p>
              {vaultPath} | Notizen {counts.notes} | Tasks offen {counts.openTasks} | Tasks done {counts.doneTasks}
            </p>
          </div>

          <div className="header-actions">
            <button onClick={() => void runSearch(searchQuery)} disabled={!vaultLoaded}>
              Explorer refresh
            </button>
            <button onClick={toggleSplitView} disabled={openTabs.length < 2}>
              {splitView ? 'Split aus' : 'Split an'}
            </button>
          </div>
        </header>

        <div className="editor-tabs">
          {openTabs.length === 0 ? <p className="empty-copy">Links eine Notiz auswaehlen, um sie zu oeffnen.</p> : null}
          {openTabs.map((tab) => (
            <div key={tab.path} className={`editor-tab ${tab.path === activeTab?.path ? 'active' : ''}`}>
              <button
                className="tab-open"
                onClick={() => setActiveNotePath(tab.path)}
                draggable
                onDragStart={(event) => onTabDragStart(event, tab)}
              >
                {tab.title}
              </button>
              <button className="tab-close" onClick={() => closeTab(tab.path)}>
                x
              </button>
            </div>
          ))}

          <div
            className={`split-drop-target ${splitDropActive ? 'active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setSplitDropActive(true)
            }}
            onDragLeave={() => setSplitDropActive(false)}
            onDrop={handleSplitDrop}
          >
            Fuer Split hier ablegen
          </div>
        </div>

        {splitView && compareCandidates.length > 0 ? (
          <div className="compare-selector">
            <label htmlFor="compare-note-select">Vergleichs-Tab</label>
            <select
              id="compare-note-select"
              value={compareTab?.path || ''}
              onChange={(event) => setCompareNotePath(event.target.value)}
            >
              {compareCandidates.map((candidate) => (
                <option key={candidate.path} value={candidate.path}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div
          className={`editor-grid ${splitView && compareTab ? 'split' : ''} ${
            viewerDropActive ? 'drop-active' : ''
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            setViewerDropActive(true)
          }}
          onDragLeave={() => setViewerDropActive(false)}
          onDrop={handleViewerDrop}
        >
          <article className="editor-pane">
            {activeTab ? (
              activeTab.loading ? (
                <p className="empty-copy">Lade Notiz ...</p>
              ) : (
                <pre>{activeTab.content || 'Leere Notiz.'}</pre>
              )
            ) : (
              <p className="empty-copy">Noch keine Notiz geoeffnet.</p>
            )}
          </article>

          {splitView && compareTab ? (
            <article className="editor-pane">
              {compareTab.loading ? (
                <p className="empty-copy">Lade Vergleich ...</p>
              ) : (
                <pre>{compareTab.content || 'Leere Notiz.'}</pre>
              )}
            </article>
          ) : null}
        </div>

        <footer className="capture-bar">
          <div className="capture-left">
            <span className="capture-label">Quick Capture</span>
            <span className="capture-meta">
              Vorschlaege {suggestions.length} | Tags {chosenTags.size} | Tasks erkannt {parsedTasks.length}
            </span>
          </div>

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

          <div className="capture-right">
            {error ? <span className="state-error">{error}</span> : <span>{message}</span>}
          </div>
        </footer>
      </section>

      {settingsOpen ? (
        <aside className="settings-drawer">
          <header>
            <h3>Einstellungen</h3>
            <button onClick={() => setSettingsOpen(false)}>Schliessen</button>
          </header>

          <section>
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

          <section>
            <h4>Layout</h4>
            <button onClick={() => setSidebarOpen((prev) => !prev)}>{sidebarOpen ? 'Sidebar ausblenden' : 'Sidebar einblenden'}</button>
          </section>
        </aside>
      ) : null}
    </div>
  )
}

export default App

import { useEffect, useMemo, useRef, useState } from 'react'
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
  noteBasePath?: string
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
const DISPLAY_NAME_STORAGE_KEY = 'nicknotes-display-name'
const LAST_NOTEBASE_STORAGE_KEY = 'nicknotes-last-notebase-path'

type TagGroupsMap = Record<string, string[]>
type TagMenuTarget = { groupName: string; tagName: string } | null
type NoteGroup = {
  key: string
  label: string
  path: string
  favorite: boolean
  canCreateNotes: boolean
}

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

function getPathTail(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
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

    result[cleanGroup] = Array.from(new Set(cleanTags)).sort((left, right) =>
      left.localeCompare(right, 'de')
    )
  }

  return result
}

function getStoredDisplayName(): string {
  if (typeof window === 'undefined') {
    return 'Max'
  }

  try {
    const raw = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)
    if (!raw) {
      return 'Max'
    }
    const parsed = normalizeLabel(raw)
    return parsed || 'Max'
  } catch {
    return 'Max'
  }
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

function getTopLevelGroupKey(path: string, noteBasePath: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedBase = noteBasePath.replace(/\\/g, '/').replace(/\/+$/, '')

  if (normalizedBase && normalizedPath.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
    const relative = normalizedPath.slice(normalizedBase.length + 1)
    return relative.split('/')[0] || ''
  }

  const parts = normalizedPath.split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
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
  const tagOverviewMatch = normalizedPath.match(/\/02_tags\/([^/]+)\/([^/]+)\/overview\.md$/i)
  if (tagOverviewMatch) {
    const group = normalizeLabel(tagOverviewMatch[1].replace(/_/g, ' '))
    const tag = normalizeLabel(tagOverviewMatch[2].replace(/_/g, ' '))
    if (group && tag) {
      return { group, tag }
    }
  }

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
  const autoOpenTriedRef = useRef(false)
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])

  const [daily, setDaily] = useState<ReviewDaily | null>(null)
  const [weekly, setWeekly] = useState<ReviewWeekly | null>(null)

  const [sidebarView, setSidebarView] = useState<SidebarView>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displayName, setDisplayName] = useState(getStoredDisplayName)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    daily: true,
    tags: true,
    other: true,
  })
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupsMap>({})
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([])
  const [newNoteGroupName, setNewNoteGroupName] = useState('')
  const [selectedNoteGroupKey, setSelectedNoteGroupKey] = useState('')
  const [newGroupedNoteTitle, setNewGroupedNoteTitle] = useState('')
  const [newTagGroupName, setNewTagGroupName] = useState('')
  const [selectedTagGroup, setSelectedTagGroup] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [tagMenuTarget, setTagMenuTarget] = useState<TagMenuTarget>(null)
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
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName)
  }, [displayName])

  const refreshTasks = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
    setTasks(response.items)
  }

  const runSearch = async (query: string, force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: SearchRow[] }>(
      backendUrl,
      `/search?query=${encodeURIComponent(query)}`
    )
    setSearchResults(response.items)
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

    const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups')
    setCustomTagGroups(toStorageTagGroups(response.groups))
  }

  const refreshNoteGroups = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, '/note-groups')
    setNoteGroups(response.groups)
  }

  const openVaultAtPath = async (rawPath: string, successMessage: string): Promise<boolean> => {
    const path = normalizeLabel(rawPath)
    if (!path) {
      throw new Error('Bitte zuerst einen NoteBase-Pfad angeben.')
    }

    const response = await apiRequest<{
      counts: VaultCounts
      noteBasePath?: string
      tagGroups?: TagGroupsMap
    }>(backendUrl, '/notebase/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
    const loadedPath = response.noteBasePath ?? path
    setVaultPath(loadedPath)
    setVaultLoaded(true)
    setCounts(response.counts)
    if (response.tagGroups) {
      setCustomTagGroups(toStorageTagGroups(response.tagGroups))
    }
    storeLastNoteBasePath(loadedPath)
    setMessage(successMessage)
    setError('')

    await Promise.all([
      refreshTasks(true),
      runSearch(searchQuery, true),
      refreshReview(true),
      refreshTagGroups(true),
      refreshNoteGroups(true),
    ])
    return true
  }

  const loadState = async () => {
    try {
      const state = await apiRequest<BackendState>(backendUrl, '/state')
      if (!state.vaultLoaded) {
        setVaultLoaded(false)
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
      if (state.counts) {
        setCounts(state.counts)
      }
      setMessage('NoteBase geladen.')
      setError('')

      await Promise.all([
        refreshTasks(true),
        runSearch(searchQuery, true),
        refreshReview(true),
        refreshTagGroups(true),
        refreshNoteGroups(true),
      ])
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

  const notesByTopGroup = useMemo(() => {
    const grouped: Record<string, SearchRow[]> = {}
    for (const row of sortedNotes) {
      const topGroup = getTopLevelGroupKey(row.path, vaultPath)
      if (!topGroup) {
        continue
      }
      if (!grouped[topGroup]) {
        grouped[topGroup] = []
      }
      grouped[topGroup].push(row)
    }

    for (const rows of Object.values(grouped)) {
      rows.sort((left, right) => left.title.localeCompare(right.title, 'de'))
    }

    return grouped
  }, [sortedNotes, vaultPath])

  const customNoteGroups = useMemo(
    () => noteGroups.filter((group) => !group.favorite),
    [noteGroups]
  )
  const creatableNoteGroups = useMemo(
    () => noteGroups.filter((group) => group.canCreateNotes),
    [noteGroups]
  )

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

  useEffect(() => {
    if (!selectedNoteGroupKey && creatableNoteGroups.length > 0) {
      setSelectedNoteGroupKey(creatableNoteGroups[0].key)
      return
    }

    if (selectedNoteGroupKey && !creatableNoteGroups.some((group) => group.key === selectedNoteGroupKey)) {
      setSelectedNoteGroupKey(creatableNoteGroups[0]?.key ?? '')
    }
  }, [creatableNoteGroups, selectedNoteGroupKey])

  const activeTab = openTabs.find((tab) => tab.path === activeNotePath) ?? openTabs[0] ?? null
  const compareCandidates = openTabs.filter((tab) => tab.path !== activeTab?.path)
  const compareTab = splitView
    ? openTabs.find((tab) => tab.path === compareNotePath) ?? compareCandidates[0] ?? null
    : null
  const noteBaseName = useMemo(() => (vaultPath ? getPathTail(vaultPath) : 'Keine NoteBase'), [vaultPath])

  const pickDirectory = async (): Promise<string | null> => {
    if (!window.nicknotes?.selectDirectory) {
      return window.prompt('Bitte absoluten Pfad eingeben:') || null
    }
    return window.nicknotes.selectDirectory()
  }

  const openVault = async () => {
    try {
      setError('')
      await openVaultAtPath(vaultPath, 'NoteBase erfolgreich geladen und indexiert.')
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
        tagGroups?: TagGroupsMap
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
      storeLastNoteBasePath(response.noteBasePath ?? response.vaultPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`Neue NoteBase erstellt: ${response.noteBasePath ?? response.vaultPath}`)
      await Promise.all([
        refreshTasks(true),
        runSearch(searchQuery, true),
        refreshReview(true),
        refreshTagGroups(true),
        refreshNoteGroups(true),
      ])
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

  const addNoteGroup = async () => {
    const groupName = normalizeLabel(newNoteGroupName)
    if (!groupName) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, '/note-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({ groupName }),
      })
      setNoteGroups(response.groups)
      setNewNoteGroupName('')
      setMessage(`Notizgruppe angelegt: ${groupName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const addNoteToGroup = async () => {
    const groupKey = normalizeLabel(selectedNoteGroupKey)
    if (!groupKey) {
      return
    }

    const title = normalizeLabel(newGroupedNoteTitle)
    if (!title) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, title }),
        }
      )
      setCounts(response.counts)
      setNoteGroups(response.groups)
      setNewGroupedNoteTitle('')
      setMessage(`Notiz erstellt (${response.noteId}).`)
      await Promise.all([runSearch(searchQuery), refreshReview()])
      await openNoteInTab(response.notePath, title)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const addTagGroup = async () => {
    const nextGroupName = normalizeLabel(newTagGroupName)
    if (!nextGroupName) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({ groupName: nextGroupName }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${nextGroupName}`)
      setSelectedTagGroup(nextGroupName)
      setNewTagGroupName('')
      setMessage(`Tag-Gruppe angelegt: ${nextGroupName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const addTagToGroup = async () => {
    const groupName = normalizeLabel(selectedTagGroup)
    const tagName = normalizeLabel(newTagName)
    if (!groupName || !tagName) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({ groupName, tagName }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${groupName}`)
      setNewTagName('')
      setMessage(`Tag hinzugefuegt: ${groupName}:${tagName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameTag = async (groupName: string, tagName: string) => {
    const newTagName = window.prompt(`Tag umbenennen (${groupName}:${tagName})`, tagName)?.trim()
    if (!newTagName || newTagName === tagName) {
      return
    }
    const applyToNotes = window.confirm(
      `Soll "${groupName}:${tagName}" in allen Notizen automatisch in "${groupName}:${newTagName}" umbenannt werden?`
    )

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, tagName, newTagName, applyToNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setTagMenuTarget(null)
      setMessage(
        applyToNotes
          ? `Tag umbenannt und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag umbenannt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveTagToOtherGroup = async (groupName: string, tagName: string) => {
    const targetGroup = window.prompt(
      `Tag "${tagName}" nach welcher Gruppe verschieben?`,
      sortedTagGroupNames.find((name) => name !== groupName) ?? ''
    )
    const cleanTarget = normalizeLabel(targetGroup ?? '')
    if (!cleanTarget || cleanTarget === groupName) {
      return
    }

    const applyToNotes = window.confirm(
      `Soll der Tag in bestehenden Notizen automatisch von "${groupName}:${tagName}" nach "${cleanTarget}:${tagName}" verschoben werden?`
    )

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/move-tag',
        {
          method: 'POST',
          body: JSON.stringify({
            fromGroup: groupName,
            tagName,
            toGroup: cleanTarget,
            applyToNotes,
          }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setTagMenuTarget(null)
      setMessage(
        applyToNotes
          ? `Tag verschoben und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag in andere Gruppe verschoben. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteTag = async (groupName: string, tagName: string) => {
    const option = window.prompt(
      `Tag "${groupName}:${tagName}" loeschen:\n1 = auch aus bestehenden Notizen entfernen\n2 = nur aus der Tag-Verwaltung loeschen`,
      '2'
    )
    if (!option || !['1', '2'].includes(option.trim())) {
      return
    }
    const removeFromNotes = option.trim() === '1'

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/delete-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, tagName, removeFromNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setTagMenuTarget(null)
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
          <h3>NoteBase</h3>
          <p className="muted-label">Aktive NoteBase</p>
          <p className="mono-block">{vaultPath || 'Keine NoteBase geladen'}</p>

          <label className="field-label" htmlFor="vault-path-input">
            NoteBase-Pfad
          </label>
          <input
            id="vault-path-input"
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
            placeholder="C:\\Pfad\\zur\\NoteBase"
          />

          <div className="stacked-actions">
            <button onClick={() => void pickAndOpenVault()}>Ordner waehlen + laden</button>
            <button onClick={() => void openVault()}>Pfad laden</button>
            <button onClick={() => void createVault()}>Neue NoteBase</button>
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
            <button className="icon-button" onClick={() => setTagManagerOpen(true)} title="Tag-Manager oeffnen">
              +
            </button>
          </div>

          <p className="muted-copy">Mit dem Plus oben rechts oeffnest du den Tag-Manager.</p>

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
                        <div key={`${groupName}:${tag}`} className="tag-pill-row">
                          <div className="tag-pill">
                            {groupName}:{tag}
                          </div>
                          <div className="tag-row-actions">
                            <button
                              className="icon-button muted"
                              onClick={() =>
                                setTagMenuTarget((prev) =>
                                  prev?.groupName === groupName && prev?.tagName === tag ? null : { groupName, tagName: tag }
                                )
                              }
                              title="Tag verwalten"
                            >
                              ...
                            </button>
                            {tagMenuTarget?.groupName === groupName && tagMenuTarget?.tagName === tag ? (
                              <div className="tag-context-menu">
                                <button onClick={() => void renameTag(groupName, tag)}>Tag umbenennen</button>
                                <button onClick={() => void moveTagToOtherGroup(groupName, tag)}>
                                  In andere Gruppe verschieben
                                </button>
                                <button className="danger" onClick={() => void deleteTag(groupName, tag)}>
                                  Tag loeschen
                                </button>
                              </div>
                            ) : null}
                          </div>
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
          <div className="header-inline-actions">
            <button onClick={runSearchFromInput} disabled={!vaultLoaded}>
              Suchen
            </button>
            <button onClick={() => void refreshNoteGroups()} disabled={!vaultLoaded}>
              Gruppen
            </button>
          </div>
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

        <section className="tag-actions">
          <label className="field-label" htmlFor="note-group-name">
            Neue Notizgruppe
          </label>
          <div className="tag-action-row">
            <input
              id="note-group-name"
              value={newNoteGroupName}
              onChange={(event) => setNewNoteGroupName(event.target.value)}
              placeholder="z. B. Wissensbasis"
            />
            <button onClick={() => void addNoteGroup()} disabled={!newNoteGroupName.trim()}>
              Gruppe anlegen
            </button>
          </div>

          <label className="field-label" htmlFor="note-group-select">
            Neue Notiz in Gruppe
          </label>
          <div className="tag-action-row">
            <select
              id="note-group-select"
              value={selectedNoteGroupKey}
              onChange={(event) => setSelectedNoteGroupKey(event.target.value)}
            >
              <option value="" disabled>
                Gruppe waehlen
              </option>
              {creatableNoteGroups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </select>
            <input
              value={newGroupedNoteTitle}
              onChange={(event) => setNewGroupedNoteTitle(event.target.value)}
              placeholder="Titel der neuen Notiz"
            />
            <button
              onClick={() => void addNoteToGroup()}
              disabled={!selectedNoteGroupKey || !newGroupedNoteTitle.trim()}
            >
              Notiz anlegen
            </button>
          </div>
        </section>

        <section className="tree-scroll">
          <p className="muted-label">Favouriten</p>
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

          <p className="muted-label">Weitere Notizgruppen</p>
          {customNoteGroups.length === 0 ? (
            <p className="empty-copy">Noch keine weiteren Notizgruppen vorhanden.</p>
          ) : null}
          {customNoteGroups.map((group) =>
            renderFolder(
              `notes-group-${group.key}`,
              group.label,
              notesByTopGroup[group.key] ?? [],
              0,
              'Keine Notizen in dieser Gruppe.'
            )
          )}
        </section>
      </div>
    )
  }

  if (!vaultLoaded) {
    return (
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

          <label htmlFor="launch-vault-path" className="field-label">
            NoteBase-Pfad
          </label>
          <input
            id="launch-vault-path"
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
            placeholder="C:\\Pfad\\zur\\NoteBase"
          />

          <div className="launch-actions">
            <button onClick={() => void pickAndOpenVault()}>Ordner waehlen + laden</button>
            <button onClick={() => void openVault()}>Pfad laden</button>
            <button onClick={() => void createVault()}>Neue NoteBase</button>
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
          title="NoteBase"
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
              Notizen {counts.notes} | Tasks offen {counts.openTasks} | Tasks done {counts.doneTasks}
            </p>
          </div>

          <div className="header-actions">
            <button onClick={() => void runSearch(searchQuery)} disabled={!vaultLoaded}>
              Ansicht aktualisieren
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
            <div>{error ? <span className="state-error">{error}</span> : <span>{message}</span>}</div>
            <div className="status-note-base">NoteBase: {noteBaseName}</div>
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

      {tagManagerOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setTagManagerOpen(false)
            setTagMenuTarget(null)
          }}
        >
          <aside
            className="tag-manager-modal"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <header className="sidebar-header-row">
              <h3>Tag-Manager</h3>
              <button
                onClick={() => {
                  setTagManagerOpen(false)
                  setTagMenuTarget(null)
                }}
              >
                Schliessen
              </button>
            </header>

            <section className="tag-manager-grid">
              <div className="tag-manager-column">
                <label className="field-label" htmlFor="manager-new-tag-group-input">
                  Neue Tag-Gruppe
                </label>
                <div className="tag-action-row">
                  <input
                    id="manager-new-tag-group-input"
                    value={newTagGroupName}
                    onChange={(event) => setNewTagGroupName(event.target.value)}
                    placeholder="z. B. Customer"
                  />
                  <button onClick={() => void addTagGroup()} disabled={!newTagGroupName.trim()}>
                    Gruppe anlegen
                  </button>
                </div>
              </div>

              <div className="tag-manager-column">
                <label className="field-label" htmlFor="manager-existing-tag-group-select">
                  Tag in bestehender Gruppe
                </label>
                <div className="tag-action-row">
                  <select
                    id="manager-existing-tag-group-select"
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
                    placeholder="z. B. Acme GmbH"
                  />
                  <button onClick={() => void addTagToGroup()} disabled={!selectedTagGroup || !newTagName.trim()}>
                    Tag anlegen
                  </button>
                </div>
              </div>
            </section>

            <section className="tree-scroll">
              {sortedTagGroupNames.map((groupName) => {
                const tags = mergedTagGroups[groupName] ?? []
                return (
                  <div key={`manager-${groupName}`} className="tag-manager-group">
                    <h4>{groupName}</h4>
                    {tags.length === 0 ? <p className="empty-copy">Noch keine Tags.</p> : null}
                    {tags.map((tag) => (
                      <div key={`manager-${groupName}-${tag}`} className="tag-pill-row">
                        <div className="tag-pill">
                          {groupName}:{tag}
                        </div>
                        <div className="tag-row-actions">
                          <button
                            className="icon-button muted"
                            onClick={() =>
                              setTagMenuTarget((prev) =>
                                prev?.groupName === groupName && prev?.tagName === tag ? null : { groupName, tagName: tag }
                              )
                            }
                            title="Tag verwalten"
                          >
                            ...
                          </button>
                          {tagMenuTarget?.groupName === groupName && tagMenuTarget?.tagName === tag ? (
                            <div className="tag-context-menu">
                              <button onClick={() => void renameTag(groupName, tag)}>Tag umbenennen</button>
                              <button onClick={() => void moveTagToOtherGroup(groupName, tag)}>
                                In andere Gruppe verschieben
                              </button>
                              <button className="danger" onClick={() => void deleteTag(groupName, tag)}>
                                Tag loeschen
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

export default App

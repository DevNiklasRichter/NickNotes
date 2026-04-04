import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
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
type SidebarView = 'vault' | 'notes' | 'tasks' | 'review'

type NoteTab = {
  path: string
  title: string
  content: string
  loading: boolean
}

const THEME_STORAGE_KEY = 'nicknotes-theme'

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

  const tagNotes = useMemo(() => {
    return sortedNotes.filter((row) => {
      const type = row.note_type.toLowerCase()
      return type.includes('tag') || /tag/i.test(row.path) || row.title.includes(':')
    })
  }, [sortedNotes])

  const otherNotes = useMemo(() => {
    const knownPaths = new Set([...dailyNotes, ...tagNotes].map((item) => item.path))
    return sortedNotes.filter((row) => !knownPaths.has(row.path))
  }, [dailyNotes, sortedNotes, tagNotes])

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

        <section className="tree-group">
          <h4>Daily Notes</h4>
          {dailyNotes.length === 0 ? <p className="empty-copy">Keine Daily Notes gefunden.</p> : null}
          {dailyNotes.map((row) => (
            <button key={row.path} className="tree-item" onClick={() => void openNoteInTab(row.path, row.title)}>
              <strong>{row.title || getFileName(row.path)}</strong>
              <span>{toGermanTimestamp(row.updated_at)}</span>
            </button>
          ))}
        </section>

        <section className="tree-group">
          <h4>Tag Notes</h4>
          {tagNotes.length === 0 ? <p className="empty-copy">Keine Tag-Notizen gefunden.</p> : null}
          {tagNotes.map((row) => (
            <button key={row.path} className="tree-item" onClick={() => void openNoteInTab(row.path, row.title)}>
              <strong>{row.title || getFileName(row.path)}</strong>
              <span>{row.note_type}</span>
            </button>
          ))}
        </section>

        <section className="tree-group">
          <h4>Weitere Notizen</h4>
          {otherNotes.length === 0 ? <p className="empty-copy">Keine weiteren Notizen gefunden.</p> : null}
          {otherNotes.map((row) => (
            <button key={row.path} className="tree-item" onClick={() => void openNoteInTab(row.path, row.title)}>
              <strong>{row.title || getFileName(row.path)}</strong>
              <span>{row.note_type}</span>
            </button>
          ))}
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
          className={sidebarView === 'review' ? 'active' : ''}
          onClick={() => openSidebarView('review')}
          title="Review"
        >
          R
        </button>

        <div className="rail-spacer" />

        <button className={settingsOpen ? 'active' : ''} onClick={() => setSettingsOpen((prev) => !prev)} title="Einstellungen">
          G
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
              <button className="tab-open" onClick={() => setActiveNotePath(tab.path)}>
                {tab.title}
              </button>
              <button className="tab-close" onClick={() => closeTab(tab.path)}>
                x
              </button>
            </div>
          ))}
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

        <div className={`editor-grid ${splitView && compareTab ? 'split' : ''}`}>
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

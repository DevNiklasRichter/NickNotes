import { useEffect, useMemo, useState } from 'react'
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

type TabId = 'capture' | 'tasks' | 'search' | 'review'
type ThemeMode = 'light' | 'dark'

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

function App() {
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8765')
  const [activeTab, setActiveTab] = useState<TabId>('capture')
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
  const [selectedNotePath, setSelectedNotePath] = useState('')
  const [selectedNoteContent, setSelectedNoteContent] = useState('')

  const [daily, setDaily] = useState<ReviewDaily | null>(null)
  const [weekly, setWeekly] = useState<ReviewWeekly | null>(null)

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

    const timeout = window.setTimeout(() => {
      void previewCapture(captureText)
    }, 320)

    return () => {
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureText, vaultLoaded])

  const chosenTags = useMemo(() => new Set(selectedTagKeys), [selectedTagKeys])

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
        throw new Error('Bitte zuerst einen Vault-Pfad angeben.')
      }

      const response = await apiRequest<{ counts: VaultCounts }>(backendUrl, '/vault/open', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setVaultLoaded(true)
      setCounts(response.counts)
      setMessage('Vault erfolgreich geladen und indexiert.')
      await Promise.all([refreshTasks(), runSearch(''), refreshReview(), previewCapture(captureText)])
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

      const name = window.prompt('Name des neuen Vaults:', 'NickNotesVault')?.trim()
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
      setMessage(`Neuer Vault erstellt: ${response.vaultPath}`)
      await Promise.all([refreshTasks(), runSearch(''), refreshReview()])
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
      if (!captureText.trim()) {
        throw new Error('Capture-Text ist leer.')
      }

      const response = await apiRequest<{ counts: VaultCounts; noteId: string }>(
        backendUrl,
        '/capture/save',
        {
          method: 'POST',
          body: JSON.stringify({
            text: captureText,
            selectedTagKeys,
          }),
        }
      )

      setCounts(response.counts)
      setCaptureText('')
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      setMessage(`Notiz gespeichert (${response.noteId}).`)
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const refreshTasks = async () => {
    if (!vaultLoaded) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
    setTasks(response.items)
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

  const loadNoteContent = async (path: string) => {
    try {
      const response = await apiRequest<{ content: string }>(
        backendUrl,
        `/notes/content?path=${encodeURIComponent(path)}`
      )
      setSelectedNotePath(path)
      setSelectedNoteContent(response.content)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const openNoteFile = async () => {
    if (!selectedNotePath) {
      return
    }

    try {
      await apiRequest(backendUrl, '/notes/open', {
        method: 'POST',
        body: JSON.stringify({ path: selectedNotePath }),
      })
    } catch (caught) {
      setError(String(caught))
    }
  }

  const refreshReview = async () => {
    if (!vaultLoaded) {
      return
    }

    const response = await apiRequest<{ daily: ReviewDaily; weekly: ReviewWeekly }>(backendUrl, '/review')
    setDaily(response.daily)
    setWeekly(response.weekly)
  }

  const toggleTheme = () => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>NickNotes</h1>
          <p>React + TypeScript + Electron mit Python-Backend</p>
        </div>

        <div className="topbar-meta">
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>

        <div className="vault-controls">
          <input
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
            placeholder="C:\\Pfad\\zum\\Vault"
          />
          <button onClick={() => void pickDirectory().then((dir) => dir && setVaultPath(dir))}>Ordner waehlen</button>
          <button onClick={() => void openVault()}>Vault laden</button>
          <button onClick={() => void createVault()}>Neuen Vault</button>
          <button onClick={() => void reindexVault()} disabled={!vaultLoaded}>
            Reindex
          </button>
        </div>
      </header>

      <section className="status-bar">
        <div>
          <strong>Vault:</strong> {vaultLoaded ? vaultPath : 'nicht geladen'}
        </div>
        <div>
          <strong>Notizen:</strong> {counts.notes} | <strong>Tasks offen:</strong> {counts.openTasks} |{' '}
          <strong>Tasks done:</strong> {counts.doneTasks}
        </div>
      </section>

      {message ? <section className="message ok">{message}</section> : null}
      {error ? <section className="message error">{error}</section> : null}

      <nav className="tabs">
        <button className={activeTab === 'capture' ? 'active' : ''} onClick={() => setActiveTab('capture')}>
          Capture
        </button>
        <button className={activeTab === 'tasks' ? 'active' : ''} onClick={() => setActiveTab('tasks')}>
          Tasks
        </button>
        <button className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>
          Suche
        </button>
        <button className={activeTab === 'review' ? 'active' : ''} onClick={() => setActiveTab('review')}>
          Review
        </button>
      </nav>

      <main className="tab-body">
        {activeTab === 'capture' ? (
          <section className="panel two-col">
            <div>
              <h2>Quick Capture</h2>
              <textarea
                value={captureText}
                onChange={(event) => setCaptureText(event.target.value)}
                placeholder="Schreibe hier deine Gedanken. Tasks mit 'todo:' erfassen."
              />
              <div className="row-actions">
                <button onClick={() => void previewCapture(captureText)} disabled={!vaultLoaded}>
                  Vorschlaege aktualisieren
                </button>
                <button onClick={() => void saveCapture()} disabled={!vaultLoaded}>
                  Notiz speichern
                </button>
              </div>
            </div>

            <div>
              <h2>Tag-Vorschlaege</h2>
              <div className="list-card">
                {suggestions.length === 0 ? (
                  <p>Keine Vorschlaege.</p>
                ) : (
                  suggestions.map((item) => (
                    <label key={item.key} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={chosenTags.has(item.key)}
                        onChange={() => {
                          setSelectedTagKeys((prev) =>
                            prev.includes(item.key)
                              ? prev.filter((entry) => entry !== item.key)
                              : [...prev, item.key]
                          )
                        }}
                      />
                      <span>
                        {item.key} ({item.source}, conf={item.confidence.toFixed(2)})
                      </span>
                    </label>
                  ))
                )}
              </div>

              <h2>Erkannte Tasks</h2>
              <div className="list-card">
                {parsedTasks.length === 0 ? (
                  <p>Keine Tasks erkannt.</p>
                ) : (
                  parsedTasks.map((task, index) => (
                    <p key={`${task.title}-${index}`}>
                      {index + 1}. {task.title} | status={task.status} | prio={task.priority}
                      {task.dueDate ? ` | due=${task.dueDate}` : ''}
                    </p>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'tasks' ? (
          <section className="panel">
            <div className="row-actions">
              <button onClick={() => void refreshTasks()} disabled={!vaultLoaded}>
                Aktualisieren
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Titel</th>
                  <th>Status</th>
                  <th>Prio</th>
                  <th>Due</th>
                  <th>Projekt</th>
                  <th>Update</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.id}</td>
                    <td>{task.title}</td>
                    <td>{task.status}</td>
                    <td>{task.priority}</td>
                    <td>{task.due_date ?? ''}</td>
                    <td>{task.project_tag ?? ''}</td>
                    <td>{toGermanTimestamp(task.updated_at)}</td>
                    <td>
                      <button onClick={() => void markTaskDone(task.id)} disabled={task.status === 'done'}>
                        Done
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === 'search' ? (
          <section className="panel two-col">
            <div>
              <div className="row-actions">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Suchbegriff"
                />
                <button onClick={() => void runSearch(searchQuery)} disabled={!vaultLoaded}>
                  Suchen
                </button>
                <button onClick={() => void openNoteFile()} disabled={!selectedNotePath}>
                  Datei oeffnen
                </button>
              </div>

              <div className="search-list">
                {searchResults.map((item) => (
                  <button
                    key={`${item.id}-${item.path}`}
                    className="search-item"
                    onClick={() => void loadNoteContent(item.path)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.note_type}</span>
                    <span>{toGermanTimestamp(item.updated_at)}</span>
                    <code>{item.path}</code>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2>Vorschau</h2>
              <pre className="preview-box">{selectedNoteContent || 'Keine Datei ausgewaehlt.'}</pre>
            </div>
          </section>
        ) : null}

        {activeTab === 'review' ? (
          <section className="panel two-col review-grid">
            <div className="list-card">
              <h2>Daily</h2>
              {daily ? (
                <>
                  <p>Datum: {daily.date}</p>
                  <p>Neue Notizen: {daily.new_notes}</p>
                  <p>Offene Tasks: {daily.open_tasks}</p>
                  <p>Heute erledigt: {daily.done_today}</p>
                </>
              ) : (
                <p>Keine Daten.</p>
              )}
            </div>

            <div className="list-card">
              <h2>Weekly</h2>
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
                <p>Keine Daten.</p>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App

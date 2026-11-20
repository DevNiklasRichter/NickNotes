import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { beginSessionSwitch } from '../app/apiClient'
import { apiRequest, getRelativeVaultPath, normalizeLabel, normalizeNoteTypeValue, toNoteDisplayName, toStorageTagGroups, type SearchRow } from '../app/AppShared'
import { CodeMirrorMarkdownEditor, type MarkdownEditorApi, type MarkdownLinkTarget } from '../editor/CodeMirrorMarkdownEditor'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'
import './QuickCaptureWindow.css'

type Theme = 'light' | 'dark'
type Status = { kind: 'info' | 'error'; text: string } | null
type NoteBaseInfo = { loaded: boolean; name: string; path: string }

const HIDE_AFTER_SAVE_MS = 900

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function toLinkTargets(rows: SearchRow[], noteBasePath: string): MarkdownLinkTarget[] {
  return rows
    .map((row) => {
      const relativePath = getRelativeVaultPath(row.path, noteBasePath).replace(/\.md$/i, '') || toNoteDisplayName(row.path)
      return { path: row.path, title: normalizeLabel(row.title) || toNoteDisplayName(row.path), target: relativePath, relativePath, noteType: normalizeNoteTypeValue(row.note_type) }
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'de', { sensitivity: 'base' }))
}

function savedMessage(date: string, tasks: Array<{ dueDate: string }>): string {
  const due = tasks.map((task) => new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })).join(', ')
  const taskNote = tasks.length === 1 ? ` Task fällig am ${due} angelegt.` : tasks.length > 1 ? ` ${tasks.length} Tasks angelegt (fällig ${due}).` : ''
  return `In der Tagesnotiz ${date} gespeichert.${taskNote}`
}

/**
 * The window behind the global shortcut: the same Markdown capture as in the app (links, tags,
 * @dates), saved to today's daily note. Its draft lives on this device until it is sent.
 */
export function QuickCaptureWindow() {
  const [theme, setTheme] = useState<Theme>(window.nicknotes?.startupTheme === 'dark' ? 'dark' : 'light')
  const [text, setText] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [backendUrl, setBackendUrl] = useState('')
  const [noteBase, setNoteBase] = useState<NoteBaseInfo | null>(null)
  const [tagGroups, setTagGroups] = useState<TagGroupDefinition[]>([])
  const [linkTargets, setLinkTargets] = useState<MarkdownLinkTarget[]>([])
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<MarkdownEditorApi | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    editorRef.current?.flushChanges()
    // Leave the caret in the editor, so the first key after the next shortcut is not lost.
    editorRef.current?.focus()
    void window.nicknotes?.quickCapture?.hide()
  }, [])
  const refreshRun = useRef(0)

  /** The NoteBase may have changed while the window was hidden; read it fresh on every show. */
  const refresh = useCallback(async (url: string) => {
    const run = ++refreshRun.current
    try {
      const state = await apiRequest<{ vaultLoaded: boolean; noteBasePath?: string | null; vaultPath?: string | null }>(url, '/state')
      const path = state.noteBasePath || state.vaultPath || ''
      if (run !== refreshRun.current) return
      setNoteBase({ loaded: state.vaultLoaded, path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? '' })
      if (!state.vaultLoaded) return
      const [groups, files] = await Promise.all([
        apiRequest<{ groups: unknown }>(url, '/tag-groups'),
        apiRequest<{ items: SearchRow[] }>(url, '/explorer/files'),
      ])
      if (run !== refreshRun.current) return
      setTagGroups(toStorageTagGroups(groups.groups))
      setLinkTargets(toLinkTargets(files.items, path))
    } catch (error) {
      // A newer refresh (the window was shown again) replaced this one; it was aborted on purpose.
      if (run !== refreshRun.current) return
      setNoteBase(null)
      setStatus({ kind: 'error', text: errorText(error, 'NickNotes ist gerade nicht erreichbar.') })
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const [url, draft] = await Promise.all([
        window.nicknotes?.getBackendUrl?.() ?? Promise.resolve(''),
        window.nicknotes?.quickCapture?.readDraft() ?? Promise.resolve(''),
      ])
      if (!active) return
      setText(draft)
      setDraftReady(true)
      setBackendUrl(url)
      if (url) void refresh(url)
    })().catch((error: unknown) => setStatus({ kind: 'error', text: errorText(error, 'Die Schnellerfassung konnte nicht starten.') }))
    return () => { active = false }
  }, [refresh])

  useEffect(() => window.nicknotes?.quickCapture?.onShown(({ theme: next }) => {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    setStatus(null)
    // Bind to whichever NoteBase is open now; an older session would be rejected as stale.
    beginSessionSwitch()
    if (backendUrl) void refresh(backendUrl)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }), [backendUrl, refresh])

  // The first show can arrive before the editor exists; focus it as soon as it does.
  useEffect(() => {
    if (draftReady) window.requestAnimationFrame(() => editorRef.current?.focus())
  }, [draftReady])

  // The draft is device-local and survives hiding, quitting and crashes until it is sent.
  useEffect(() => {
    if (!draftReady) return
    void window.nicknotes?.quickCapture?.writeDraft(text).catch((error: unknown) => {
      setStatus({ kind: 'error', text: `Der Entwurf konnte nicht lokal gesichert werden: ${errorText(error, 'unbekannter Fehler')}` })
    })
  }, [draftReady, text])

  const send = async (markdown?: string) => {
    const content = (markdown ?? editorRef.current?.getMarkdown() ?? text).trim()
    if (!content || busy || !backendUrl || !noteBase?.loaded) return
    setBusy(true)
    setStatus(null)
    try {
      const response = await apiRequest<{ date: string; tasks?: Array<{ dueDate: string }> }>(backendUrl, '/capture/save', {
        method: 'POST',
        body: JSON.stringify({ text: content, selectedTagKeys: [] }),
      })
      setText('')
      setStatus({ kind: 'info', text: savedMessage(response.date, response.tasks ?? []) })
      hideTimer.current = window.setTimeout(hide, HIDE_AFTER_SAVE_MS)
    } catch (error) {
      setStatus({ kind: 'error', text: errorText(error, 'Die Schnellerfassung konnte nicht gespeichert werden.') })
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Editor menus close themselves first and mark the key as handled.
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      hide()
    }
  }

  const ready = Boolean(noteBase?.loaded)
  return (
    <div className="quick-capture-window" onKeyDown={onKeyDown}>
      <header className="quick-capture-head">
        <span className="quick-capture-title">Schnellerfassung</span>
        {noteBase?.name ? <span className="quick-capture-notebase">{noteBase.name}</span> : null}
        <button type="button" className="icon-button compact muted" aria-label="Schließen (Esc), der Entwurf bleibt" data-tooltip="Schließen (Esc), der Entwurf bleibt" onClick={hide}>
          <LucideNamedIcon name="X" size={14} />
        </button>
      </header>
      {noteBase && !noteBase.loaded ? (
        <p className="quick-capture-hint" role="status">Keine NoteBase geöffnet. Öffne sie in NickNotes – dein Entwurf bleibt so lange hier.</p>
      ) : null}
      {draftReady ? (
        <CodeMirrorMarkdownEditor className="capture-markdown-editor quick-capture-editor" value={text} theme={theme} notePath="" backendUrl={backendUrl}
          tagGroups={tagGroups} linkTargets={linkTargets} placeholderText="Gedanken festhalten · [[ verlinkt · # taggt · @ setzt einen Termin"
          onChange={setText} onSubmitShortcut={(markdown) => void send(markdown)} editorApiRef={editorRef} />
      ) : <div className="quick-capture-editor" />}
      <footer className="quick-capture-foot">
        <span className={`quick-capture-status${status?.kind === 'error' ? ' error' : ''}`} role="status">
          {status?.text ?? 'Strg+Enter speichert in der heutigen Tagesnotiz · Esc schließt'}
        </span>
        <button type="button" className="primary" onClick={() => void send()} disabled={busy || !ready || !text.trim()}>Senden</button>
      </footer>
    </div>
  )
}

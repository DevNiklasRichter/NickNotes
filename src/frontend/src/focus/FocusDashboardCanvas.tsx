import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { getRelativeVaultPath, normalizeFilePathKey, taskStatusLabel, toLocalIsoDate, type SearchRow, type TaskRow, type TodoRow } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { localCalendarDay } from '../shared/dates'
import { formatMinutes } from '../shared/duration'
import { ContextMenuItem } from '../ui/ContextMenu'
import { MenuButton } from '../ui/MenuButton'
import {
  addDays,
  buildFocusDashboardData,
  deferOptions,
  MAX_MIT_ITEMS,
  toHeaderDateLabel,
  toPlainTodoText,
  toShortDayLabel,
  toTaskReasonLabel,
  type FocusMitEntry,
  type FocusNoteItem,
  type FocusTaskItem,
  type FocusTodoItem,
} from './focusDashboardModel'
import type { FocusTimerTarget } from './focusTimerModel'
import { TaskRepeatMark } from '../tasks/TaskRepeatMark'

/** One neighbour from `/graph/related`: linked notes and notes sharing weighted tags. */
export type FocusRelatedNote = {
  path: string
  title: string
  linked: boolean
  sharedTags: string[]
}

type NoteType = 'note' | 'task'

type FocusDashboardCanvasProps = {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  noteBasePath: string
  query: string
  mitIds: string[]
  /** Focus time logged in today's daily note. */
  focusMinutesToday: number
  showTaskDetails: boolean
  onSaveMit: (nextMitIds: string[]) => Promise<string[]>
  onQuickCaptureTodo: (rawText: string) => Promise<void>
  onToggleTodo: (todoId: string, checked: boolean) => Promise<void>
  onSetTaskFollowUp: (taskId: string, date: string) => Promise<void>
  onLoadRelatedNotes: (path: string) => Promise<FocusRelatedNote[]>
  /** Task or to-do the focus timer is running for. */
  focusTimerTargetId: string
  focusTimerMinutes: number
  onStartFocusTimer: (target: FocusTimerTarget, minutes?: number) => void
  onOpenNotePath: (path: string, title?: string, noteType?: NoteType) => void
  onOpenTodayDaily: () => void
  onOpenTodoDashboard: () => void
  onOpenTaskDashboard: () => void
}

const EARLIER_TODO_LIMIT = 30

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

/** Time for today's edits, the short day otherwise. */
function toEditedLabel(updatedAt: string, todayIso: string): string {
  const day = localCalendarDay(updatedAt)
  if (!day) return ''
  if (day !== todayIso) return toShortDayLabel(day, todayIso)
  const stamp = new Date(updatedAt)
  return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function toNoteBaseAbsolutePath(relativePath: string, noteBasePath: string): string {
  const separator = noteBasePath.includes('\\') ? '\\' : '/'
  return `${noteBasePath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]+/g, separator)}`
}

function IconButton({ label, icon, onClick, pressed, expanded, disabled, className = '' }: {
  label: string
  icon: string
  onClick: () => void
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button type="button" className={`icon-button compact muted ${className}`} aria-label={label} data-tooltip={label}
      aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>
      <LucideNamedIcon name={icon} size={14} />
    </button>
  )
}

function MitMarker() {
  return <span className="focus-mit-marker" data-tooltip="Heute wichtig"><LucideNamedIcon name="Star" size={12} /></span>
}

function ColumnHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <header className="focus-column-header">
      <h3>{title}</h3>
      {typeof count === 'number' ? <span className="focus-count">{count}</span> : null}
      <span className="focus-column-header-action">{action}</span>
    </header>
  )
}

type ContextLine = { label: string; value: string }

function FocusContextPanel({ path, lines, origin, linkedTitles, notes, noteBasePath, onLoadRelatedNotes, onOpenNotePath }: {
  path: string | null
  lines: ContextLine[]
  origin?: { path: string; title: string }
  linkedTitles: string[]
  notes: SearchRow[]
  noteBasePath: string
  onLoadRelatedNotes: (path: string) => Promise<FocusRelatedNote[]>
  onOpenNotePath: (path: string, title?: string, noteType?: NoteType) => void
}) {
  const [related, setRelated] = useState<{ path: string; items: FocusRelatedNote[]; error: string } | null>(null)
  useEffect(() => {
    if (!path) return
    let current = true
    onLoadRelatedNotes(path).then(
      (items) => { if (current) setRelated({ path, items, error: '' }) },
      (error: unknown) => { if (current) setRelated({ path, items: [], error: errorText(error, 'Verknüpfte Notizen konnten nicht geladen werden.') }) },
    )
    return () => { current = false }
  }, [onLoadRelatedNotes, path])

  const notesByRelativePath = useMemo(() => new Map(notes.map((note) => [normalizeFilePathKey(getRelativeVaultPath(note.path, noteBasePath)), note])), [noteBasePath, notes])
  const notesByTitle = useMemo(() => new Map(notes.map((note) => [note.title.replace(/\.md$/i, '').trim().toLowerCase(), note])), [notes])
  const open = (relativeOrAbsolute: string, title: string) => {
    const known = notesByRelativePath.get(normalizeFilePathKey(relativeOrAbsolute))
    const noteType: NoteType = known?.note_type.trim().toLowerCase() === 'task' ? 'task' : 'note'
    onOpenNotePath(known?.path || toNoteBaseAbsolutePath(relativeOrAbsolute, noteBasePath), title, noteType)
  }
  const linkedNotes = linkedTitles.map((title) => notesByTitle.get(title.split('/').pop()!.trim().toLowerCase())).filter((note): note is SearchRow => Boolean(note))
  const shown = new Set([origin?.path, ...linkedNotes.map((note) => note.path)].filter(Boolean).map((entry) => normalizeFilePathKey(getRelativeVaultPath(entry!, noteBasePath))))
  const relatedItems = related?.path === path ? related.items.filter((item) => !shown.has(normalizeFilePathKey(item.path))) : []
  const loading = Boolean(path) && related?.path !== path

  return (
    <div className="focus-context">
      {lines.length > 0 ? (
        <dl className="focus-context-lines">
          {lines.map((line) => (
            <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>
          ))}
        </dl>
      ) : null}
      <ul className="focus-context-notes">
        {origin ? (
          <li><button type="button" onClick={() => onOpenNotePath(origin.path, origin.title, 'note')}>{origin.title}</button><span>steht in</span></li>
        ) : null}
        {linkedNotes.map((note) => (
          <li key={`linked:${note.path}`}><button type="button" onClick={() => onOpenNotePath(note.path, note.title, note.note_type.trim().toLowerCase() === 'task' ? 'task' : 'note')}>{note.title}</button><span>im To-do verlinkt</span></li>
        ))}
        {relatedItems.map((item) => (
          <li key={item.path}>
            <button type="button" onClick={() => open(item.path, item.title)}>{item.title}</button>
            <span>{item.linked ? 'verlinkt' : item.sharedTags.map((tag) => `#${tag.split(':').pop()}`).join(' ')}</span>
          </li>
        ))}
      </ul>
      {loading ? <p className="focus-hint">Suche verknüpfte Notizen …</p> : null}
      {related?.path === path && related.error ? <p className="focus-inline-error">{related.error}</p> : null}
      {related?.path === path && !related.error && relatedItems.length === 0 && !origin && linkedNotes.length === 0 ? <p className="focus-hint">Keine verknüpften Notizen.</p> : null}
    </div>
  )
}

export function FocusDashboardCanvas({
  tasks,
  todos,
  notes,
  noteBasePath,
  query,
  mitIds,
  focusMinutesToday,
  showTaskDetails,
  onSaveMit,
  onQuickCaptureTodo,
  onToggleTodo,
  onSetTaskFollowUp,
  onLoadRelatedNotes,
  focusTimerTargetId,
  focusTimerMinutes,
  onStartFocusTimer,
  onOpenNotePath,
  onOpenTodayDaily,
  onOpenTodoDashboard,
  onOpenTaskDashboard,
}: FocusDashboardCanvasProps) {
  const todayIso = toLocalIsoDate()
  const data = useMemo(() => buildFocusDashboardData({ tasks, todos, notes, mitIds, todayIso, query }), [mitIds, notes, query, tasks, todayIso, todos])

  const [mitBusy, setMitBusy] = useState(false)
  const [mitError, setMitError] = useState('')
  const [taskError, setTaskError] = useState('')
  const [todoError, setTodoError] = useState('')
  const [contextKey, setContextKey] = useState('')
  const [pickingKey, setPickingKey] = useState('')
  const [busyTaskKey, setBusyTaskKey] = useState('')
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>({})
  const [captureValue, setCaptureValue] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)

  const toggleContext = (key: string) => setContextKey((current) => (current === key ? '' : key))

  const saveMit = async (next: string[]) => {
    if (mitBusy) return
    setMitBusy(true)
    setMitError('')
    try {
      await onSaveMit(next)
    } catch (error) {
      setMitError(errorText(error, '„Heute wichtig“ konnte nicht gespeichert werden.'))
    } finally {
      setMitBusy(false)
    }
  }
  const toggleMit = (key: string) => {
    void saveMit(data.mitIds.includes(key) ? data.mitIds.filter((entry) => entry !== key) : [...data.mitIds, key])
  }

  const deferTask = async (task: FocusTaskItem, date: string) => {
    setBusyTaskKey(task.key)
    setTaskError('')
    try {
      await onSetTaskFollowUp(task.id, date)
      setPickingKey('')
    } catch (error) {
      setTaskError(errorText(error, 'Die Task konnte nicht zurückgestellt werden.'))
    } finally {
      setBusyTaskKey('')
    }
  }

  const toggleTodo = async (todo: FocusTodoItem, checked: boolean) => {
    setPendingChecks((current) => ({ ...current, [todo.id]: checked }))
    setTodoError('')
    try {
      await onToggleTodo(todo.id, checked)
    } catch (error) {
      setTodoError(errorText(error, 'Das To-do konnte nicht gespeichert werden.'))
    } finally {
      setPendingChecks((current) => {
        const next = { ...current }
        delete next[todo.id]
        return next
      })
    }
  }

  const submitCapture = async () => {
    const clean = captureValue.trim()
    if (!clean || captureBusy) return
    setCaptureBusy(true)
    setTodoError('')
    try {
      await onQuickCaptureTodo(clean)
      setCaptureValue('')
    } catch (error) {
      setTodoError(errorText(error, 'Das To-do konnte nicht gespeichert werden.'))
    } finally {
      setCaptureBusy(false)
    }
  }
  const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitCapture()
    } else if (event.key === 'Escape' && captureValue) {
      event.preventDefault()
      setCaptureValue('')
    }
  }

  const mitButton = (key: string, isMit: boolean, title: string) => (
    <IconButton
      label={isMit ? `„${title}“ aus „Heute wichtig“ entfernen` : data.canAddMit ? 'Zu „Heute wichtig“ hinzufügen' : `Höchstens ${MAX_MIT_ITEMS} Einträge – erst einen entfernen`}
      icon="Star"
      className={`focus-star ${isMit ? 'active' : ''}`}
      pressed={isMit}
      disabled={mitBusy || (!isMit && !data.canAddMit)}
      onClick={() => toggleMit(key)}
    />
  )

  const contextPanelProps = { notes, noteBasePath, onLoadRelatedNotes, onOpenNotePath }

  const timerButton = (target: FocusTimerTarget) => {
    const active = Boolean(target.id) && target.id === focusTimerTargetId
    return (
      <IconButton label={active ? 'Fokuszeit läuft – groß anzeigen' : `Fokuszeit starten (${focusTimerMinutes} min)`} icon="Timer"
        className={`focus-timer-button ${active ? 'active' : ''}`} pressed={active} onClick={() => onStartFocusTimer(target)} />
    )
  }

  const renderTask = (task: FocusTaskItem) => {
    const label = toTaskReasonLabel(task, todayIso)
    const contextOpen = contextKey === task.key
    const lines: ContextLine[] = [
      { label: 'Status', value: taskStatusLabel(task.status) },
      ...(task.dueDate ? [{ label: 'Fällig', value: toShortDayLabel(task.dueDate, todayIso) }] : []),
      ...(task.followUpDate ? [{ label: 'Wiedervorlage', value: toShortDayLabel(task.followUpDate, todayIso) }] : []),
      ...(showTaskDetails && task.nextActionHint ? [{ label: 'Nächster Schritt', value: task.nextActionHint }] : []),
      ...(showTaskDetails && task.waitingFor ? [{ label: 'Warten auf', value: task.waitingFor }] : []),
      ...(showTaskDetails && task.blockedReason ? [{ label: 'Blockiert', value: task.blockedReason }] : []),
    ]
    return (
      <li key={task.key} className={`focus-row ${contextOpen ? 'expanded' : ''}`} aria-busy={busyTaskKey === task.key || undefined}>
        <div className="focus-row-line">
          <span className={`focus-priority ${task.priority === 'high' ? 'high' : ''}`} aria-hidden="true" />
          <button type="button" className="focus-row-title" onClick={() => task.path && onOpenNotePath(task.path, task.title, 'task')} disabled={!task.path}>
            {task.title}
          </button>
          {task.isMit ? <MitMarker /> : null}
          <TaskRepeatMark repeat={task.repeat} />
          {label ? <span className={`focus-row-meta ${task.overdueDays > 0 ? 'overdue' : ''}`}>{label}</span> : null}
          <span className="focus-row-actions">
            {timerButton({ kind: 'task', id: task.id, title: task.title, path: task.path ?? '', detail: showTaskDetails ? task.nextActionHint ?? '' : '' })}
            {mitButton(task.key, task.isMit, task.title)}
            <MenuButton label="Zurückstellen" heading="Wieder anzeigen ab" icon={<LucideNamedIcon name="CalendarClock" size={14} />} className="icon-button compact muted" disabled={busyTaskKey === task.key}>
              {deferOptions(todayIso).map((option) => (
                <ContextMenuItem key={option.label} onClick={() => void deferTask(task, option.date)}>
                  {option.label}<span className="focus-menu-date">{toShortDayLabel(option.date, todayIso)}</span>
                </ContextMenuItem>
              ))}
              <ContextMenuItem onClick={() => setPickingKey(task.key)}>Datum wählen …</ContextMenuItem>
              {task.followUpDate ? <ContextMenuItem onClick={() => void deferTask(task, '')}>Wiedervorlage entfernen</ContextMenuItem> : null}
            </MenuButton>
            <IconButton label={contextOpen ? 'Kontext ausblenden' : 'Kontext anzeigen'} icon="Info" expanded={contextOpen} onClick={() => toggleContext(task.key)} />
          </span>
        </div>
        {pickingKey === task.key ? (
          <form className="focus-defer-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('follow-up')
            if (typeof value === 'string' && value) void deferTask(task, value)
          }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setPickingKey('') } }}>
            <label>
              <span>Wieder anzeigen ab</span>
              <input name="follow-up" type="date" min={addDays(todayIso, 1)} defaultValue={task.followUpDate && task.followUpDate > todayIso ? task.followUpDate : addDays(todayIso, 7)} required autoFocus />
            </label>
            <button type="submit" className="primary" disabled={busyTaskKey === task.key}>Zurückstellen</button>
            <button type="button" onClick={() => setPickingKey('')}>Abbrechen</button>
          </form>
        ) : null}
        {contextOpen ? <FocusContextPanel path={task.path} lines={lines} linkedTitles={[]} {...contextPanelProps} /> : null}
      </li>
    )
  }

  const renderTodo = (todo: FocusTodoItem, showOrigin: boolean) => {
    const checked = pendingChecks[todo.id] ?? todo.checked
    const contextOpen = contextKey === todo.key
    const text = toPlainTodoText(todo.text)
    return (
      <li key={todo.key} className={`focus-row ${checked ? 'done' : ''} ${contextOpen ? 'expanded' : ''}`}>
        <div className="focus-row-line">
          <label className="focus-todo-check">
            <input type="checkbox" checked={checked} onChange={(event) => void toggleTodo(todo, event.target.checked)} />
            <span className="focus-row-text">{text}</span>
          </label>
          {todo.isMit ? <MitMarker /> : null}
          {showOrigin ? <span className="focus-row-meta">{todo.noteTitle}</span> : null}
          <span className="focus-row-actions">
            {checked ? null : timerButton({ kind: 'todo', id: todo.id, title: text, path: todo.notePath })}
            {mitButton(todo.key, todo.isMit, text)}
            <IconButton label={contextOpen ? 'Kontext ausblenden' : 'Kontext anzeigen'} icon="Info" expanded={contextOpen} onClick={() => toggleContext(todo.key)} />
            <IconButton label={`„${todo.noteTitle}“ öffnen`} icon="ArrowUpRight" onClick={() => onOpenNotePath(todo.notePath, todo.noteTitle, 'note')} />
          </span>
        </div>
        {contextOpen ? (
          <FocusContextPanel path={todo.notePath} origin={{ path: todo.notePath, title: todo.noteTitle }} lines={todo.createdDay ? [{ label: 'Notiert', value: toShortDayLabel(todo.createdDay, todayIso) }] : []}
            linkedTitles={todo.links} {...contextPanelProps} />
        ) : null}
      </li>
    )
  }

  const renderNote = (note: FocusNoteItem) => (
    <li key={note.key} className="focus-row">
      <div className="focus-row-line">
        <LucideNamedIcon name={note.isDaily ? 'CalendarDays' : 'FileText'} size={13} className="focus-note-icon" />
        <button type="button" className="focus-row-title" onClick={() => onOpenNotePath(note.path, note.title, 'note')}>{note.title}</button>
        <span className="focus-row-meta">{toEditedLabel(note.updatedAt, todayIso)}</span>
      </div>
    </li>
  )

  const renderMit = (entry: FocusMitEntry) => (
    <li key={entry.key} className={entry.isDone ? 'done' : ''}>
      <span className="focus-mit-bullet" aria-hidden="true">{entry.isDone ? <LucideNamedIcon name="Check" size={13} /> : null}</span>
      <button type="button" className="focus-row-title" disabled={!entry.path} onClick={() => entry.path && onOpenNotePath(entry.path, entry.title, entry.noteType)}>
        {entry.kind === 'todo' ? toPlainTodoText(entry.title) : entry.title}
      </button>
      {entry.isDone ? <span className="focus-row-meta">erledigt</span> : timerButton({
        kind: entry.kind,
        id: entry.key.slice(entry.key.indexOf(':') + 1),
        title: entry.kind === 'todo' ? toPlainTodoText(entry.title) : entry.title,
        path: entry.path ?? '',
      })}
      <IconButton label="Aus „Heute wichtig“ entfernen" icon="X" disabled={mitBusy} onClick={() => void saveMit(data.mitIds.filter((key) => key !== entry.key))} />
    </li>
  )

  const earlierTodos = data.todosEarlier.slice(0, EARLIER_TODO_LIMIT)
  const doneShare = data.stats.doneToday + data.stats.openToday > 0 ? data.stats.doneToday / (data.stats.doneToday + data.stats.openToday) : 0

  return (
    <div className="focus-canvas">
      <div className="focus-layout">
      <header className="focus-head">
        <div className="focus-head-title">
          <h2>Fokus</h2>
          <span>{toHeaderDateLabel(todayIso)}</span>
        </div>
        <dl className="focus-stats">
          <div>
            <dt>Erledigt heute</dt>
            <dd>{data.stats.doneToday}</dd>
            <span className="focus-progress" role="progressbar" aria-label="Tagesfortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(doneShare * 100)}>
              <span style={{ width: `${Math.round(doneShare * 100)}%` }} />
            </span>
          </div>
          <div><dt>Offen heute</dt><dd>{data.stats.openToday}</dd></div>
          <div className={data.stats.overdue > 0 ? 'overdue' : ''}><dt>Überfällig</dt><dd>{data.stats.overdue}</dd></div>
          <div><dt>Zurückgestellt</dt><dd>{data.stats.deferred}</dd></div>
          <div data-tooltip="Aus den Fokuszeit-Zeilen der heutigen Tagesnotiz"><dt>Fokuszeit heute</dt><dd>{formatMinutes(focusMinutesToday)}</dd></div>
        </dl>
      </header>

      <section className="focus-mit" aria-labelledby="focus-mit-title">
        <header className="focus-column-header">
          <h3 id="focus-mit-title">Heute wichtig</h3>
          <span className="focus-count">{data.mitEntries.length}/{MAX_MIT_ITEMS}</span>
        </header>
        {data.mitEntries.length === 0 ? (
          <p className="focus-hint">Was zählt heute wirklich? Markiere bis zu drei Tasks oder To-dos mit dem Stern.</p>
        ) : (
          <ul className="focus-mit-list">{data.mitEntries.map(renderMit)}</ul>
        )}
        {mitError ? <p className="focus-inline-error" role="alert">{mitError}</p> : null}
      </section>

      <div className="focus-columns">
        <section className="focus-column" aria-label="Tasks">
          <ColumnHeader title="Tasks" count={data.tasksToday.length}
            action={<IconButton label="Alle Tasks öffnen" icon="ArrowUpRight" onClick={onOpenTaskDashboard} />} />
          <div className="focus-column-body">
            {taskError ? <p className="focus-inline-error" role="alert">{taskError}</p> : null}
            {data.tasksToday.length === 0 ? <p className="focus-hint">Heute ist keine Task fällig.</p> : <ul className="focus-list">{data.tasksToday.map(renderTask)}</ul>}
            {data.tasksUpcoming.length > 0 ? (
              <details className="focus-group">
                <summary>Nächste 7 Tage <span className="focus-count">{data.tasksUpcoming.length}</span></summary>
                <ul className="focus-list">{data.tasksUpcoming.map(renderTask)}</ul>
              </details>
            ) : null}
            {data.tasksDeferred.length > 0 ? (
              <details className="focus-group">
                <summary>Zurückgestellt <span className="focus-count">{data.tasksDeferred.length}</span></summary>
                <ul className="focus-list">{data.tasksDeferred.map(renderTask)}</ul>
              </details>
            ) : null}
          </div>
        </section>

        <section className="focus-column" aria-label="To-dos">
          <ColumnHeader title="To-dos" count={data.openTodosToday}
            action={<IconButton label="Alle To-dos öffnen" icon="ArrowUpRight" onClick={onOpenTodoDashboard} />} />
          <div className="focus-capture">
            <LucideNamedIcon name="Plus" size={14} aria-hidden="true" />
            <input value={captureValue} onChange={(event) => setCaptureValue(event.target.value)} onKeyDown={onCaptureKeyDown}
              placeholder="Neues To-do für heute …" aria-label="Neues To-do für heute" disabled={captureBusy} />
          </div>
          <div className="focus-column-body">
            {todoError ? <p className="focus-inline-error" role="alert">{todoError}</p> : null}
            {data.todosToday.length === 0 ? <p className="focus-hint">Noch keine To-dos für heute.</p> : <ul className="focus-list">{data.todosToday.map((todo) => renderTodo(todo, false))}</ul>}
            {data.todosEarlier.length > 0 ? (
              <details className="focus-group">
                <summary>Früher notiert <span className="focus-count">{data.openTodosEarlier}</span></summary>
                <ul className="focus-list">{earlierTodos.map((todo) => renderTodo(todo, true))}</ul>
                {data.todosEarlier.length > earlierTodos.length ? (
                  <button type="button" className="focus-link-button" onClick={onOpenTodoDashboard}>Alle {data.openTodosEarlier} offenen To-dos ansehen</button>
                ) : null}
              </details>
            ) : null}
          </div>
        </section>

        <section className="focus-column focus-column-notes" aria-label="Notizen">
          <ColumnHeader title="Notizen heute" count={data.notesToday.length}
            action={<IconButton label="Tagesnotiz öffnen" icon="CalendarDays" onClick={onOpenTodayDaily} />} />
          <div className="focus-column-body">
            {data.notesToday.length > 0 ? <ul className="focus-list">{data.notesToday.map(renderNote)}</ul> : (
              <>
                <p className="focus-hint">Heute noch keine Notiz bearbeitet.</p>
                {data.recentNotes.length > 0 ? (
                  <>
                    <h4 className="focus-subheading">Zuletzt bearbeitet</h4>
                    <ul className="focus-list">{data.recentNotes.map(renderNote)}</ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  taskPriorityDotClassName,
  taskPriorityLabel,
  taskStatusClassName,
  taskStatusLabel,
  toLocalIsoDate,
  type FocusDashboardFilters,
  type SearchRow,
  type TaskRow,
  type TodoRow,
} from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { buildFocusContextHits, buildFocusDashboardData, toDotDateLabel, type FocusPrimaryItem } from './focusDashboardModel'

type FocusDashboardCanvasProps = {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  filters: FocusDashboardFilters
  onOpenTaskPath: (path: string, title?: string) => void
  onOpenTodoOrigin: (notePath: string, title?: string) => void
  onOpenNotePath: (path: string, title?: string, noteType?: 'note' | 'task') => void
  toGermanTimestamp: (value: string) => string
}

function focusItemMetaLabel(item: FocusPrimaryItem): string {
  if (item.kind === 'task') {
    const dueLabel = toDotDateLabel(item.dueDate)
    return `Faellig: ${dueLabel} | Update: ${item.updatedAt.slice(0, 10)}`
  }
  return `Todo | Update: ${item.updatedAt.slice(0, 10)}`
}

function cleanNoteTitle(rawTitle: string): string {
  return rawTitle.replace(/\.md$/i, '')
}

function focusHeaderScopeLabel(scope: FocusDashboardFilters['scope']): string {
  if (scope === 'today') {
    return 'Heute'
  }
  if (scope === 'week') {
    return 'Diese Woche'
  }
  return 'Gesamt'
}

function noteTypeIcon(noteType: string): string {
  return noteType.trim().toLowerCase() === 'task' ? 'CheckSquare' : 'FileText'
}

export function FocusDashboardCanvas({
  tasks,
  todos,
  notes,
  filters,
  onOpenTaskPath,
  onOpenTodoOrigin,
  onOpenNotePath,
  toGermanTimestamp,
}: FocusDashboardCanvasProps) {
  const todayIso = useMemo(() => toLocalIsoDate(), [])
  const data = useMemo(
    () =>
      buildFocusDashboardData({
        tasks,
        todos,
        notes,
        filters,
        todayIso,
      }),
    [filters, notes, tasks, todayIso, todos]
  )
  const [selectedKey, setSelectedKey] = useState<string>('')
  const selectedItem = useMemo(() => data.primaryItems.find((item) => item.key === selectedKey) || data.primaryItems[0] || null, [data.primaryItems, selectedKey])
  const contextHits = useMemo(
    () => (selectedItem ? buildFocusContextHits(selectedItem, notes, todayIso) : []),
    [notes, selectedItem, todayIso]
  )

  useEffect(() => {
    if (!selectedItem) {
      if (selectedKey) {
        setSelectedKey('')
      }
      return
    }
    if (selectedKey && selectedItem.key === selectedKey) {
      return
    }
    setSelectedKey(selectedItem.key)
  }, [selectedItem, selectedKey])

  const scopeLabel = focusHeaderScopeLabel(filters.scope)

  return (
    <div className="focus-canvas">
      <div className="focus-canvas-header">
        <h2>Focus Dashboard</h2>
        <p>
          Zeitraum: {scopeLabel} | Query: {filters.query.trim() || 'keine'} | Fokuspunkte: {data.primaryItems.length}
        </p>
      </div>

      <div className="focus-metric-grid">
        <article className="focus-metric-card">
          <span className="focus-metric-label">Offene Tasks</span>
          <strong>{data.openTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">In Progress</span>
          <strong>{data.inProgressTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">Heute faellig</span>
          <strong>{data.dueTodayTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">Offene Todos</span>
          <strong>{data.openTodoCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">Notizen heute</span>
          <strong>{data.notesTodayCount}</strong>
        </article>
      </div>

      <div className="focus-canvas-grid">
        <section className="focus-panel">
          <header className="focus-panel-header">
            <h3>Heute im Fokus</h3>
            <span>{data.primaryItems.length}</span>
          </header>
          {data.primaryItems.length === 0 ? <p className="empty-copy">Keine Fokuspunkte fuer den aktuellen Filter.</p> : null}
          <div className="focus-primary-list">
            {data.primaryItems.map((item) => {
              const isSelected = selectedItem?.key === item.key
              const canOpen = Boolean(item.path)
              return (
                <article key={item.key} className={`focus-primary-card ${isSelected ? 'selected' : ''}`}>
                  <button
                    className="focus-primary-card-main"
                    onClick={() => {
                      setSelectedKey(item.key)
                    }}
                    title="Kontext zu diesem Fokuspunkt anzeigen"
                  >
                    <div className="focus-primary-card-head">
                      <span className={`item-kind-pill ${item.kind === 'todo' ? 'todo' : ''}`}>{item.kind === 'task' ? 'TASK' : 'TODO'}</span>
                      {item.kind === 'task' ? (
                        <span className={taskStatusClassName(item.status || 'open')}>{taskStatusLabel(item.status || 'open')}</span>
                      ) : null}
                      {item.kind === 'task' ? (
                        <span className="task-priority-badge">
                          <span className={taskPriorityDotClassName(item.priority || 'medium')} aria-hidden="true" />
                          {taskPriorityLabel(item.priority || 'medium')}
                        </span>
                      ) : null}
                    </div>
                    <strong>{item.title}</strong>
                    <p>{focusItemMetaLabel(item)}</p>
                  </button>

                  <div className="focus-primary-actions">
                    <button
                      className="icon-button compact muted"
                      disabled={!canOpen}
                      onClick={() => {
                        if (!item.path) {
                          return
                        }
                        if (item.kind === 'task') {
                          onOpenTaskPath(item.path, item.title)
                        } else {
                          onOpenTodoOrigin(item.path, item.title)
                        }
                      }}
                      title={canOpen ? 'Eintrag oeffnen' : 'Kein Ursprungspfad vorhanden'}
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="focus-panel">
          <header className="focus-panel-header">
            <h3>Kontext</h3>
            <span>{contextHits.length}</span>
          </header>
          {!selectedItem ? <p className="empty-copy">Waehle links einen Fokuspunkt aus.</p> : null}
          {selectedItem ? (
            <p className="focus-context-subtitle">
              Aktiv: {selectedItem.kind === 'task' ? 'Task' : 'Todo'} | {selectedItem.title}
            </p>
          ) : null}
          {selectedItem && contextHits.length === 0 ? <p className="empty-copy">Keine passenden Querverweise gefunden.</p> : null}
          <ul className="focus-context-list">
            {contextHits.map((note) => (
              <li key={note.key} className="focus-context-row">
                <div className="focus-context-row-main">
                  <span className="focus-context-note-type">
                    <LucideNamedIcon name={noteTypeIcon(note.noteType)} size={12} />
                  </span>
                  <span className="focus-context-note-title">{cleanNoteTitle(note.title)}</span>
                  <span className="focus-context-reasons">{note.reasons.join(', ')}</span>
                </div>
                <button
                  className="icon-button compact muted"
                  onClick={() => {
                    const noteType = note.noteType.trim().toLowerCase() === 'task' ? 'task' : 'note'
                    onOpenNotePath(note.path, note.title, noteType)
                  }}
                  title={`Notiz oeffnen (${note.path})`}
                >
                  <LucideNamedIcon name="ArrowUpRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="focus-canvas-grid">
        <section className="focus-panel">
          <header className="focus-panel-header">
            <h3>Daily heute</h3>
            <span>{data.todayDailyNote ? '1' : '0'}</span>
          </header>
          {data.todayDailyNote ? (
            <article className="focus-note-card">
              <div>
                <strong>{cleanNoteTitle(data.todayDailyNote.title)}</strong>
                <p>{toGermanTimestamp(data.todayDailyNote.updated_at)}</p>
              </div>
              <button
                className="icon-button compact muted"
                onClick={() => {
                  onOpenNotePath(data.todayDailyNote?.path || '', data.todayDailyNote?.title, 'note')
                }}
                title="Daily Note oeffnen"
              >
                <LucideNamedIcon name="ArrowUpRight" size={14} />
              </button>
            </article>
          ) : (
            <p className="empty-copy">Keine Daily-Notiz fuer heute gefunden.</p>
          )}

          <header className="focus-panel-header focus-panel-header-sub">
            <h3>Notizen heute</h3>
            <span>{data.notesToday.length}</span>
          </header>
          <ul className="focus-note-list">
            {data.notesToday.length === 0 ? <li className="empty-copy">Heute noch keine Notizen.</li> : null}
            {data.notesToday.map((note) => (
              <li key={`${note.id}:${note.path}`} className="focus-note-row">
                <span className="focus-note-row-title">{cleanNoteTitle(note.title)}</span>
                <button
                  className="icon-button compact muted"
                  onClick={() => {
                    const noteType = note.note_type.trim().toLowerCase() === 'task' ? 'task' : 'note'
                    onOpenNotePath(note.path, note.title, noteType)
                  }}
                  title="Notiz oeffnen"
                >
                  <LucideNamedIcon name="ArrowUpRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="focus-panel">
          <header className="focus-panel-header">
            <h3>Aktuelle Notizen</h3>
            <span>{data.recentNotes.length}</span>
          </header>
          <ul className="focus-note-list">
            {data.recentNotes.length === 0 ? <li className="empty-copy">Keine Notizen passend zum Filter.</li> : null}
            {data.recentNotes.map((note) => (
              <li key={`${note.id}:${note.path}`} className="focus-note-row">
                <div className="focus-note-row-main">
                  <span className="focus-note-row-title">{cleanNoteTitle(note.title)}</span>
                  <span className="focus-note-row-time">{toGermanTimestamp(note.updated_at)}</span>
                </div>
                <button
                  className="icon-button compact muted"
                  onClick={() => {
                    const noteType = note.note_type.trim().toLowerCase() === 'task' ? 'task' : 'note'
                    onOpenNotePath(note.path, note.title, noteType)
                  }}
                  title="Notiz oeffnen"
                >
                  <LucideNamedIcon name="ArrowUpRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="focus-canvas-footer">
        <p>
          Fokus-Hinweis: Tasks werden priorisiert nach Status, Prioritaet und Faelligkeit. Todos und Notizen liefern den Tageskontext
          fuer die direkte Ausfuehrung.
        </p>
      </div>
    </div>
  )
}

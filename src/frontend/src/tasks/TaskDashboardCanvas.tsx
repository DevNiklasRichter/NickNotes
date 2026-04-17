import { useMemo } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TaskDashboardFilters, TaskRow } from '../app/AppShared'
import { filterTaskRows, groupTaskRows, toTaskDashboardTodayIso, toTaskDueIso } from './taskDashboardModel'

type TaskDashboardCanvasProps = {
  tasks: TaskRow[]
  filters: TaskDashboardFilters
  onOpenTaskPath: (path: string, title?: string) => void
  taskStatusClassName: (raw: string) => string
  taskStatusLabel: (raw: string) => string
  taskPriorityDotClassName: (raw: string) => string
  taskPriorityLabel: (raw: string) => string
  toGermanTimestamp: (value: string) => string
}

function dueLabel(task: TaskRow): string {
  const dueIso = toTaskDueIso(task.due_date)
  return dueIso ? `Faellig: ${dueIso}` : 'Ohne Faelligkeit'
}

export function TaskDashboardCanvas({
  tasks,
  filters,
  onOpenTaskPath,
  taskStatusClassName,
  taskStatusLabel,
  taskPriorityDotClassName,
  taskPriorityLabel,
  toGermanTimestamp,
}: TaskDashboardCanvasProps) {
  const todayIso = useMemo(() => toTaskDashboardTodayIso(), [])
  const visibleTasks = useMemo(() => filterTaskRows(tasks, filters, todayIso), [filters, tasks, todayIso])
  const groups = useMemo(
    () => groupTaskRows(visibleTasks, filters.grouping, filters, todayIso),
    [filters, todayIso, visibleTasks]
  )

  return (
    <div className="task-canvas">
      <div className="task-canvas-header">
        <h2>Task Dashboard</h2>
        <p>
          Treffer: {visibleTasks.length} | Gruppierung: {filters.grouping} | Darstellung: {filters.layout}
        </p>
      </div>

      <div className="task-canvas-body">
        {visibleTasks.length === 0 ? <p className="empty-copy">Keine Tasks fuer den aktuellen Filter.</p> : null}
        {filters.layout === 'list' ? (
          <div className="task-canvas-list">
            {groups.map((group) => (
              <section key={group.key} className="task-list-section">
                <h3>{group.heading}</h3>
                {group.items.length === 0 ? <p className="empty-copy">Keine Eintraege</p> : null}
                <ul className="task-list-lines">
                  {group.items.map((task) => {
                    const canOpen = Boolean(task.path)
                    return (
                      <li key={task.id} className="task-list-line">
                        <button
                          className="task-list-line-main"
                          onClick={() => {
                            if (!task.path) {
                              return
                            }
                            onOpenTaskPath(task.path, task.title)
                          }}
                          disabled={!canOpen}
                          title={canOpen ? `Task oeffnen (${task.id})` : 'Task kann nicht geoeffnet werden'}
                        >
                          <span className="task-list-line-title">{task.title}</span>
                          <span className="task-list-line-meta">
                            <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                            <span className="task-priority-badge">
                              <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                              {taskPriorityLabel(task.priority)}
                            </span>
                            <span className="task-list-line-due">{dueLabel(task)}</span>
                            <span className="task-list-line-updated">{toGermanTimestamp(task.updated_at)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="task-canvas-board">
            {groups.map((group) => (
              <section key={group.key} className="task-board-column">
                <header className="task-board-column-header">
                  <h3>{group.heading}</h3>
                  <span>{group.items.length}</span>
                </header>
                <div className="task-board-list">
                  {group.items.length === 0 ? <p className="empty-copy">Keine Eintraege</p> : null}
                  {group.items.map((task) => {
                    const canOpen = Boolean(task.path)
                    return (
                      <article key={task.id} className="task-item task-board-card">
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
                        <p>{dueLabel(task)}</p>
                        <p className="muted-copy">{toGermanTimestamp(task.updated_at)}</p>
                        <div className="task-board-card-actions">
                          <button
                            className="icon-button compact muted"
                            onClick={() => {
                              if (!task.path) {
                                return
                              }
                              onOpenTaskPath(task.path, task.title)
                            }}
                            disabled={!canOpen}
                            title={canOpen ? `Task oeffnen (${task.id})` : 'Task kann nicht geoeffnet werden'}
                          >
                            <LucideNamedIcon name="ArrowUpRight" size={14} />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TaskDashboardFilters, TaskRow } from '../app/AppShared'
import type { TagGroupDefinition } from '../tags/tagTypes'
import { filterTaskRows, groupTaskRows, toTaskDashboardTodayIso, toTaskDueIso } from './taskDashboardModel'
import { normalizeTaskPriorityValue } from '../app/AppShared'

type TaskDashboardCanvasProps = {
  tasks: TaskRow[]
  filters: TaskDashboardFilters
  tagGroups: TagGroupDefinition[]
  onFiltersChange: (next: TaskDashboardFilters) => void
  onOpenTaskPath: (path: string, title?: string) => void
  taskStatusClassName: (raw: string) => string
  taskStatusLabel: (raw: string) => string
  taskPriorityDotClassName: (raw: string) => string
  taskPriorityLabel: (raw: string) => string
  toGermanTimestamp: (value: string) => string
}

type TagVisual = {
  label: string
}

function buildTagLookup(tagGroups: TagGroupDefinition[]): Map<string, TagVisual> {
  const map = new Map<string, TagVisual>()
  for (const group of tagGroups) {
    for (const tag of group.tags) {
      const key = `${group.id}:${tag.id}`.toLowerCase()
      map.set(key, {
        label: tag.displayName || tag.id,
      })
    }
  }
  return map
}

function dueLabel(task: TaskRow): string {
  const dueIso = toTaskDueIso(task.due_date)
  if (!dueIso) {
    return '-'
  }
  if (dueIso === '[]' || dueIso.toLowerCase() === 'null') {
    return '-'
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueIso)
  if (!match) {
    return '-'
  }
  return `${match[3]}.${match[2]}.${match[1]}`
}

function sortIconName(filters: TaskDashboardFilters, field: 'priority' | 'due_date'): string {
  if (filters.listSortBy !== field) {
    return 'ArrowUpDown'
  }
  return filters.listSortDirection === 'asc' ? 'ArrowUp' : 'ArrowDown'
}

function priorityRank(rawPriority: string): number {
  const normalized = normalizeTaskPriorityValue(rawPriority)
  if (normalized === 'high') {
    return 3
  }
  if (normalized === 'medium') {
    return 2
  }
  return 1
}

function sortRowsForList(items: TaskRow[], filters: TaskDashboardFilters): TaskRow[] {
  if (filters.listSortBy === 'default') {
    return items
  }
  const dir = filters.listSortDirection === 'asc' ? 1 : -1
  return [...items].sort((left, right) => {
    if (filters.listSortBy === 'priority') {
      const byPriority = (priorityRank(left.priority) - priorityRank(right.priority)) * dir
      if (byPriority !== 0) {
        return byPriority
      }
      return left.title.localeCompare(right.title, 'de', { sensitivity: 'base' })
    }
    const leftDue = toTaskDueIso(left.due_date)
    const rightDue = toTaskDueIso(right.due_date)
    if (!leftDue && !rightDue) {
      return 0
    }
    if (!leftDue) {
      return 1
    }
    if (!rightDue) {
      return -1
    }
    const byDue = leftDue.localeCompare(rightDue) * dir
    if (byDue !== 0) {
      return byDue
    }
    return left.title.localeCompare(right.title, 'de', { sensitivity: 'base' })
  })
}

function normalizePropertyTag(rawTag: string): string {
  const clean = rawTag.trim().toLowerCase()
  if (!clean) {
    return ''
  }
  if (clean.includes(':')) {
    return clean
  }
  return clean.includes('/') ? clean.replace('/', ':') : `topic:${clean}`
}

function toDisplayTag(rawTag: string, lookup: Map<string, TagVisual>): string {
  const normalized = normalizePropertyTag(rawTag)
  const mapped = lookup.get(normalized)
  if (mapped) {
    return mapped.label
  }
  if (normalized.includes(':')) {
    const [, tail = normalized] = normalized.split(':', 2)
    return tail
  }
  return rawTag
}

function toTaskPropertyTokens(task: TaskRow, lookup: Map<string, TagVisual>): { tags: string[]; related: string[] } {
  const tags = Array.from(new Set((task.tags || []).map((item) => toDisplayTag(item, lookup).trim()).filter(Boolean)))
  const related = Array.from(new Set((task.related || []).map((item) => item.trim()).filter(Boolean)))
  return { tags, related }
}

export function TaskDashboardCanvas({
  tasks,
  filters,
  tagGroups,
  onFiltersChange,
  onOpenTaskPath,
  taskStatusClassName,
  taskStatusLabel,
  taskPriorityDotClassName,
  taskPriorityLabel,
  toGermanTimestamp,
}: TaskDashboardCanvasProps) {
  const todayIso = useMemo(() => toTaskDashboardTodayIso(), [])
  const tagLookup = useMemo(() => buildTagLookup(tagGroups), [tagGroups])
  const visibleTasks = useMemo(() => filterTaskRows(tasks, filters, todayIso), [filters, tasks, todayIso])
  const groups = useMemo(
    () => groupTaskRows(visibleTasks, filters.grouping, filters, todayIso),
    [filters, todayIso, visibleTasks]
  )

  const toggleListSort = (field: 'priority' | 'due_date') => {
    if (filters.listSortBy !== field) {
      onFiltersChange({
        ...filters,
        listSortBy: field,
        listSortDirection: field === 'priority' ? 'desc' : 'asc',
      })
      return
    }
    onFiltersChange({
      ...filters,
      listSortDirection: filters.listSortDirection === 'asc' ? 'desc' : 'asc',
    })
  }

  const clearListSort = () => {
    onFiltersChange({
      ...filters,
      listSortBy: 'default',
      listSortDirection: 'desc',
    })
  }

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
            {groups.map((group) => {
              const sortedItems = sortRowsForList(group.items, filters)
              return (
                <section key={group.key} className="task-list-section">
                  <h3>{group.heading}</h3>
                  {sortedItems.length === 0 ? <p className="empty-copy">Keine Eintraege</p> : null}
                  <div className="task-list-table-head">
                    <span className="task-list-head-title" />
                    <span className="task-list-head-title task-list-head-centered">Status</span>
                    <button className="task-list-head-sort" onClick={() => toggleListSort('priority')}>
                      Prioritaet
                      <LucideNamedIcon name={sortIconName(filters, 'priority')} size={12} />
                    </button>
                    <button className="task-list-head-sort" onClick={() => toggleListSort('due_date')}>
                      Faelligkeit
                      <LucideNamedIcon name={sortIconName(filters, 'due_date')} size={12} />
                    </button>
                    <span className="task-list-head-title task-list-head-centered">Update</span>
                    <span className="task-list-head-title">Tags</span>
                    <span className="task-list-head-title">Related</span>
                    <span className="task-list-head-open" />
                    {filters.listSortBy !== 'default' ? (
                      <button
                        className="icon-button compact muted task-list-sort-reset"
                        onClick={clearListSort}
                        title="Sortierung zuruecksetzen"
                      >
                        <LucideNamedIcon name="FilterX" size={12} />
                      </button>
                    ) : (
                      <span className="task-list-head-sort-placeholder" />
                    )}
                  </div>
                  <ul className="task-list-lines task-list-lines-table">
                    {sortedItems.map((task) => {
                      const canOpen = Boolean(task.path)
                      const properties = toTaskPropertyTokens(task, tagLookup)
                      return (
                        <li key={task.id} className="task-table-row">
                          <div className="task-table-cell task-table-cell-title">
                            <span className="task-table-title-main">{task.title}</span>
                          </div>
                          <div className="task-table-cell task-table-cell-status">
                            <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                          </div>
                          <div className="task-table-cell task-table-cell-priority">
                            <span className="task-priority-badge">
                              <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                              {taskPriorityLabel(task.priority)}
                            </span>
                          </div>
                          <div className="task-table-cell task-table-cell-due">{dueLabel(task)}</div>
                          <div className="task-table-cell task-table-cell-updated">{toGermanTimestamp(task.updated_at)}</div>
                          <div className="task-table-cell task-table-cell-tags">
                            <span className="task-property-values">{properties.tags.length > 0 ? properties.tags.join(', ') : '-'}</span>
                          </div>
                          <div className="task-table-cell task-table-cell-related">
                            <span className="task-property-values">{properties.related.length > 0 ? properties.related.join(', ') : '-'}</span>
                          </div>
                          <div className="task-table-cell task-table-cell-open">
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
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
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
                    const properties = toTaskPropertyTokens(task, tagLookup)
                    return (
                      <article key={task.id} className="task-item task-board-card">
                        <header className="task-board-card-header">
                          <strong className="task-title-with-tags">{task.title}</strong>
                          <div className="task-board-meta-row">
                            <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                            <span className="task-priority-badge">
                              <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                              {taskPriorityLabel(task.priority)}
                            </span>
                          </div>
                        </header>
                        <div className="task-board-properties">
                          <p className="task-board-property-line">
                            <span className="task-property-key">Tags:</span>{' '}
                            <span className="task-property-values">
                              {properties.tags.length > 0 ? properties.tags.join(', ') : '-'}
                            </span>
                          </p>
                          <p className="task-board-property-line">
                            <span className="task-property-key">Related:</span>{' '}
                            <span className="task-property-values">
                              {properties.related.length > 0 ? properties.related.join(', ') : '-'}
                            </span>
                          </p>
                        </div>
                        <p>Faellig: {dueLabel(task)}</p>
                        <p className="muted-copy">Update: {toGermanTimestamp(task.updated_at)}</p>
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

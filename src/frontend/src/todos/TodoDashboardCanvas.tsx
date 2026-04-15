import type { ReactNode } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TaskRow, TodoDashboardFilters, TodoRow, TodoGroupingMode } from '../app/AppShared'

type TodoDashboardCanvasProps = {
  todos: TodoRow[]
  tasks: TaskRow[]
  filters: TodoDashboardFilters
  onToggleTodo: (id: string, checked: boolean) => void
  onOpenOrigin: (notePath: string, title?: string) => void
  onPromoteTodo: (id: string) => void
  onOpenTaskPath: (path: string, title?: string) => void
}

type TodoGroup = {
  key: string
  heading: string
  items: TodoRow[]
}

function normalizeTodoTags(todo: TodoRow): string[] {
  return Array.from(new Set([...(todo.explicit_tags || []), ...(todo.inherited_tags || [])])).sort((left, right) =>
    left.localeCompare(right)
  )
}

function todoNoteLabel(todo: TodoRow): string {
  const explicit = (todo.note_title || '').trim()
  if (explicit) {
    return explicit
  }
  const normalized = (todo.note_path || '').replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || todo.note_id || 'Unknown Note'
}

function textMatchesQuery(text: string, query: string): boolean {
  const clean = query.trim().toLowerCase()
  if (!clean) {
    return true
  }
  return text.toLowerCase().includes(clean)
}

function renderHighlightedText(text: string, query: string): ReactNode[] {
  const clean = query.trim()
  if (!clean) {
    return [text]
  }
  const lowerText = text.toLowerCase()
  const lowerQuery = clean.toLowerCase()
  const result: ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor)
    if (index < 0) {
      result.push(text.slice(cursor))
      break
    }
    if (index > cursor) {
      result.push(text.slice(cursor, index))
    }
    result.push(<mark key={`${index}-${cursor}`}>{text.slice(index, index + clean.length)}</mark>)
    cursor = index + clean.length
  }

  return result
}

function groupKeyForTodo(todo: TodoRow, grouping: TodoGroupingMode): { key: string; heading: string } {
  if (grouping === 'note') {
    const heading = todoNoteLabel(todo)
    return { key: todo.note_path || todo.note_id || heading, heading }
  }

  if (grouping === 'updated_at') {
    const day = (todo.updated_at || '').slice(0, 10) || 'ohne-datum'
    return { key: day, heading: day }
  }

  const tags = normalizeTodoTags(todo)
  if (grouping === 'tag_group') {
    const firstTagGroup = tags[0]?.split(':', 1)[0]?.trim() || ''
    const heading = firstTagGroup || 'Unkategorisiert'
    return { key: heading, heading }
  }

  const firstTag = tags[0] || ''
  const heading = firstTag || 'Unkategorisiert'
  return { key: heading, heading }
}

function buildFilteredGroups(todos: TodoRow[], filters: TodoDashboardFilters): TodoGroup[] {
  const filtered = todos
    .filter((todo) => {
      if (filters.status === 'open' && todo.checked) {
        return false
      }
      if (filters.status === 'done' && !todo.checked) {
        return false
      }
      if (filters.promotion === 'promoted' && !todo.promoted) {
        return false
      }
      if (filters.promotion === 'unpromoted' && todo.promoted) {
        return false
      }
      if (filters.notePath !== 'all' && todo.note_path !== filters.notePath) {
        return false
      }

      const tags = normalizeTodoTags(todo)
      if (filters.tag !== 'all' && !tags.includes(filters.tag)) {
        return false
      }
      if (filters.tagGroup !== 'all' && !tags.some((tag) => tag.startsWith(`${filters.tagGroup}:`))) {
        return false
      }

      const searchable = [todo.raw_text, todoNoteLabel(todo), tags.join(' ')].join(' ')
      if (!textMatchesQuery(searchable, filters.query)) {
        return false
      }
      return true
    })
    .sort((left, right) => {
      if (left.checked !== right.checked) {
        return left.checked ? 1 : -1
      }
      if (left.updated_at !== right.updated_at) {
        return right.updated_at.localeCompare(left.updated_at)
      }
      if (left.note_path !== right.note_path) {
        return left.note_path.localeCompare(right.note_path)
      }
      return left.line_no - right.line_no
    })

  const groups = new Map<string, TodoGroup>()
  for (const todo of filtered) {
    const key = groupKeyForTodo(todo, filters.grouping)
    const existing = groups.get(key.key)
    if (existing) {
      existing.items.push(todo)
    } else {
      groups.set(key.key, { key: key.key, heading: key.heading, items: [todo] })
    }
  }

  return Array.from(groups.values()).sort((left, right) => left.heading.localeCompare(right.heading))
}

export function TodoDashboardCanvas({
  todos,
  tasks,
  filters,
  onToggleTodo,
  onOpenOrigin,
  onPromoteTodo,
  onOpenTaskPath,
}: TodoDashboardCanvasProps) {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const groups = buildFilteredGroups(todos, filters)

  return (
    <div className="todo-canvas">
      <div className="todo-canvas-header">
        <h2>Todo Dashboard</h2>
        <p>
          Treffer: {groups.reduce((sum, group) => sum + group.items.length, 0)} | Gruppierung: {filters.grouping}
        </p>
      </div>

      <div className="todo-canvas-body">
        {groups.length === 0 ? <p className="empty-copy">Keine To-dos fuer den aktuellen Filter.</p> : null}

        {groups.map((group) => (
          <section key={group.key} className="todo-canvas-section">
            <h3>{group.heading}</h3>
            <ul>
              {group.items.map((todo) => {
                const promotedTask = todo.promoted_task_id ? taskById.get(todo.promoted_task_id) : null
                return (
                  <li key={todo.id} className="todo-canvas-line">
                    <label className="todo-canvas-checkbox">
                      <input
                        type="checkbox"
                        checked={todo.checked}
                        onChange={(event) => onToggleTodo(todo.id, event.target.checked)}
                      />
                      <span className={todo.checked ? 'done' : ''}>{renderHighlightedText(todo.raw_text, filters.query)}</span>
                    </label>

                    <div className="todo-canvas-line-actions">
                      <button
                        className="icon-button compact muted"
                        title={`Ursprung oeffnen (${todoNoteLabel(todo)})`}
                        onClick={() => onOpenOrigin(todo.note_path, todo.note_title || undefined)}
                      >
                        <LucideNamedIcon name="ArrowUpRight" size={14} />
                      </button>
                      {todo.promoted && promotedTask?.path ? (
                        <button
                          className="icon-button compact muted"
                          title={`Task oeffnen (${todo.promoted_task_id})`}
                          onClick={() => onOpenTaskPath(promotedTask.path || '', promotedTask.title)}
                        >
                          <LucideNamedIcon name="CheckSquare" size={14} />
                        </button>
                      ) : (
                        <button
                          className="icon-button compact muted"
                          title="Als Task promoten"
                          onClick={() => onPromoteTodo(todo.id)}
                          disabled={todo.promoted}
                        >
                          <LucideNamedIcon name="ArrowBigUpDash" size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

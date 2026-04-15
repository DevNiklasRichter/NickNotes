import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TaskRow, TodoDashboardFilters, TodoGroupingMode, TodoRow } from '../app/AppShared'
import type { TagGroupDefinition } from '../tags/tagTypes'

type TodoDashboardCanvasProps = {
  todos: TodoRow[]
  tasks: TaskRow[]
  tagGroups: TagGroupDefinition[]
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

type TagVisual = {
  label: string
  groupLabel: string
  color: string
}

type TagLookup = {
  groupDisplayById: Map<string, string>
  tagVisualByKey: Map<string, TagVisual>
}

type TodoInlineToken =
  | {
      kind: 'text'
      value: string
    }
  | {
      kind: 'tag'
      raw: string
      key: string
      label: string
      color: string
    }

const INLINE_TAG_PATTERN = /\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)\}/g

function normalizeKnownTodoTags(todo: TodoRow, lookup: TagLookup): string[] {
  const known = new Set<string>()
  for (const value of todo.explicit_tags || []) {
    const key = value.trim().toLowerCase()
    if (!key) {
      continue
    }
    if (lookup.tagVisualByKey.has(key)) {
      known.add(key)
    }
  }
  return Array.from(known).sort((left, right) => left.localeCompare(right))
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

function buildTagLookup(tagGroups: TagGroupDefinition[]): TagLookup {
  const groupDisplayById = new Map<string, string>()
  const tagVisualByKey = new Map<string, TagVisual>()

  for (const group of tagGroups) {
    const groupKey = group.id.toLowerCase()
    const groupLabel = group.displayName || group.id
    groupDisplayById.set(groupKey, groupLabel)
    for (const tag of group.tags) {
      tagVisualByKey.set(`${group.id}:${tag.id}`.toLowerCase(), {
        label: tag.displayName || tag.id,
        groupLabel,
        color: group.color || '#4f8cff',
      })
    }
  }

  return {
    groupDisplayById,
    tagVisualByKey,
  }
}

function resolveTagVisual(tagKey: string, lookup: TagLookup): TagVisual {
  const [groupRaw = '', tagRaw = ''] = tagKey.split(':', 2)
  const groupId = groupRaw.trim().toLowerCase()
  const fallbackLabel = tagRaw || tagKey
  const visual = lookup.tagVisualByKey.get(tagKey.toLowerCase())
  if (visual) {
    return visual
  }
  return {
    label: fallbackLabel,
    groupLabel: lookup.groupDisplayById.get(groupId) || groupId || 'Tag',
    color: '#94a3b8',
  }
}

function parseTodoInlineTokens(rawText: string, lookup: TagLookup): TodoInlineToken[] {
  const tokens: TodoInlineToken[] = []
  INLINE_TAG_PATTERN.lastIndex = 0
  let cursor = 0
  let match = INLINE_TAG_PATTERN.exec(rawText)

  while (match) {
    const full = match[0] ?? ''
    const groupId = (match[1] ?? '').toLowerCase()
    const tagId = (match[2] ?? '').toLowerCase()
    const key = `${groupId}:${tagId}`
    const from = match.index
    if (from > cursor) {
      tokens.push({ kind: 'text', value: rawText.slice(cursor, from) })
    }
    const knownVisual = lookup.tagVisualByKey.get(key)
    if (knownVisual) {
      tokens.push({
        kind: 'tag',
        raw: full,
        key,
        label: knownVisual.label,
        color: knownVisual.color,
      })
    } else {
      tokens.push({ kind: 'text', value: full })
    }
    cursor = from + full.length
    match = INLINE_TAG_PATTERN.exec(rawText)
  }

  if (cursor < rawText.length) {
    tokens.push({ kind: 'text', value: rawText.slice(cursor) })
  }

  if (tokens.length === 0) {
    return [{ kind: 'text', value: rawText }]
  }

  return tokens
}

function groupKeysForTodo(
  todo: TodoRow,
  grouping: TodoGroupingMode,
  lookup: TagLookup,
  knownTags: string[]
): Array<{ key: string; heading: string }> {
  if (grouping === 'note') {
    const heading = todoNoteLabel(todo)
    return [{ key: todo.note_path || todo.note_id || heading, heading }]
  }

  if (grouping === 'updated_at') {
    const day = (todo.updated_at || '').slice(0, 10) || 'ohne-datum'
    return [{ key: day, heading: day }]
  }

  if (grouping === 'tag_group') {
    const tagGroups = Array.from(
      new Set(
        knownTags
          .map((tag) => tag.split(':', 1)[0]?.trim().toLowerCase() || '')
          .filter((groupId) => Boolean(groupId))
      )
    )
    if (tagGroups.length === 0) {
      return [{ key: 'group:uncategorized', heading: 'Unkategorisiert' }]
    }
    return tagGroups.map((groupId) => ({
      key: `group:${groupId}`,
      heading: lookup.groupDisplayById.get(groupId) || groupId,
    }))
  }

  const uniqueTags = Array.from(new Set(knownTags.map((tag) => tag.toLowerCase())))
  if (uniqueTags.length === 0) {
    return [{ key: 'tag:uncategorized', heading: 'Unkategorisiert' }]
  }
  return uniqueTags.map((tagKey) => {
    const visual = resolveTagVisual(tagKey, lookup)
    return {
      key: `tag:${tagKey}`,
      heading: `${visual.groupLabel} / ${visual.label || tagKey}`,
    }
  })
}

function buildFilteredGroups(todos: TodoRow[], filters: TodoDashboardFilters, lookup: TagLookup): TodoGroup[] {
  const selectedStatuses = new Set(filters.statuses)
  const selectedPromotions = new Set(filters.promotions)
  const selectedTagGroups = new Set(filters.tagGroups.map((value) => value.toLowerCase()))
  const selectedTags = new Set(filters.tags)

  const filtered = todos
    .filter((todo) => {
      const statusValue = todo.checked ? 'done' : 'open'
      if (selectedStatuses.size > 0 && !selectedStatuses.has(statusValue)) {
        return false
      }

      const promotionValue = todo.promoted ? 'promoted' : 'unpromoted'
      if (selectedPromotions.size > 0 && !selectedPromotions.has(promotionValue)) {
        return false
      }

      const tags = normalizeKnownTodoTags(todo, lookup)
      if (selectedTags.size > 0 && !tags.some((tag) => selectedTags.has(tag))) {
        return false
      }
      if (
        selectedTagGroups.size > 0 &&
        !tags.some((tag) => {
          const groupId = tag.split(':', 1)[0]?.trim().toLowerCase() || ''
          return groupId && selectedTagGroups.has(groupId)
        })
      ) {
        return false
      }

      const tagLabels = tags.map((tag) => resolveTagVisual(tag, lookup).label)
      const searchable = [todo.raw_text, todoNoteLabel(todo), tags.join(' '), tagLabels.join(' ')].join(' ')
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
    const knownTags = normalizeKnownTodoTags(todo, lookup)
    const groupKeys = groupKeysForTodo(todo, filters.grouping, lookup, knownTags)
    for (const groupKey of groupKeys) {
      const existing = groups.get(groupKey.key)
      if (existing) {
        existing.items.push(todo)
      } else {
        groups.set(groupKey.key, { key: groupKey.key, heading: groupKey.heading, items: [todo] })
      }
    }
  }

  return Array.from(groups.values()).sort((left, right) => left.heading.localeCompare(right.heading, 'de', { sensitivity: 'base' }))
}

export function TodoDashboardCanvas({
  todos,
  tasks,
  tagGroups,
  filters,
  onToggleTodo,
  onOpenOrigin,
  onPromoteTodo,
  onOpenTaskPath,
}: TodoDashboardCanvasProps) {
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const tagLookup = useMemo(() => buildTagLookup(tagGroups), [tagGroups])
  const groups = useMemo(() => buildFilteredGroups(todos, filters, tagLookup), [filters, tagLookup, todos])
  const openTaskCount = useMemo(() => tasks.filter((task) => task.status !== 'done').length, [tasks])
  const totalHits = groups.reduce((sum, group) => sum + group.items.length, 0)
  const query = filters.query.trim().toLowerCase()

  return (
    <div className="todo-canvas">
      <div className="todo-canvas-header">
        <h2>Todo Dashboard</h2>
        <p>
          Treffer: {totalHits} | Offene Tasks: {openTaskCount} | Gruppierung: {filters.grouping}
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
                const canOpenPromotedTask = Boolean(todo.promoted && promotedTask?.path)
                const tokens = parseTodoInlineTokens(todo.raw_text, tagLookup)
                return (
                  <li key={todo.id} className="todo-canvas-line">
                    <div className="todo-canvas-checkbox">
                      <input
                        type="checkbox"
                        checked={todo.checked}
                        onChange={(event) => onToggleTodo(todo.id, event.target.checked)}
                      />
                      <span className={`todo-canvas-line-text ${todo.checked ? 'done' : ''}`}>
                        {tokens.map((token, index) => {
                          if (token.kind === 'text') {
                            return (
                              <span key={`${todo.id}-text-${index}`} className="todo-inline-fragment">
                                {renderHighlightedText(token.value, filters.query)}
                              </span>
                            )
                          }
                          const tagMatchesQuery = query ? `${token.label} ${token.raw}`.toLowerCase().includes(query) : false
                          return (
                            <span
                              key={`${todo.id}-tag-${token.key}-${index}`}
                              className={`todo-inline-tag-chip ${tagMatchesQuery ? 'query-match' : ''}`}
                              style={{ '--todo-tag-color': token.color } as CSSProperties}
                              title={token.raw}
                            >
                              {token.label}
                            </span>
                          )
                        })}
                      </span>
                    </div>

                    <div className="todo-canvas-line-actions">
                      <button
                        className="icon-button compact muted"
                        title={`Ursprung oeffnen (${todoNoteLabel(todo)})`}
                        onClick={() => onOpenOrigin(todo.note_path, todo.note_title || undefined)}
                      >
                        <LucideNamedIcon name="ArrowUpRight" size={14} />
                      </button>
                      {todo.promoted ? (
                        <button
                          className="icon-button compact muted"
                          title={canOpenPromotedTask ? `Task oeffnen (${todo.promoted_task_id})` : 'Task verlinkt, aber gerade nicht geladen'}
                          onClick={() => {
                            if (!canOpenPromotedTask) {
                              return
                            }
                            onOpenTaskPath(promotedTask?.path || '', promotedTask?.title)
                          }}
                          disabled={!canOpenPromotedTask}
                        >
                          <LucideNamedIcon name="CheckSquare" size={14} />
                        </button>
                      ) : (
                        <button
                          className="icon-button compact muted"
                          title="Als Task promoten"
                          onClick={() => onPromoteTodo(todo.id)}
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

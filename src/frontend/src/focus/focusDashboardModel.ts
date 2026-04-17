import {
  normalizeFilePathKey,
  normalizeRelatedCandidate,
  normalizeTagCandidate,
  normalizeTaskPriorityValue,
  normalizeTaskStatusValue,
  type FocusDashboardFilters,
  type SearchRow,
  type TaskRow,
  type TodoRow,
} from '../app/AppShared'
import { toTaskDueBucket, toTaskDueIso } from '../tasks/taskDashboardModel'

export type FocusPrimaryItemKind = 'task' | 'todo'

export type FocusPrimaryItem = {
  key: string
  kind: FocusPrimaryItemKind
  title: string
  updatedAt: string
  score: number
  path: string | null
  notePath: string | null
  taskId: string | null
  todoId: string | null
  status: string | null
  priority: string | null
  dueDate: string | null
  tags: string[]
  related: string[]
  links: string[]
}

export type FocusContextHit = {
  key: string
  path: string
  title: string
  noteType: string
  updatedAt: string
  score: number
  reasons: string[]
}

export type FocusDashboardData = {
  openTaskCount: number
  inProgressTaskCount: number
  dueTodayTaskCount: number
  openTodoCount: number
  notesTodayCount: number
  todayDailyNote: SearchRow | null
  primaryItems: FocusPrimaryItem[]
  notesToday: SearchRow[]
  recentNotes: SearchRow[]
}

const WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9_-]{2,}/g

function toDateFromIso(isoDate: string): Date | null {
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function toUpdatedDay(value: string): string {
  return value.slice(0, 10)
}

function diffDays(leftIso: string, rightIso: string): number {
  const left = toDateFromIso(leftIso)
  const right = toDateFromIso(rightIso)
  if (!left || !right) {
    return 999
  }
  return Math.floor((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24))
}

function toWords(raw: string): string[] {
  const matches = raw.toLowerCase().match(WORD_PATTERN)
  if (!matches) {
    return []
  }
  return Array.from(new Set(matches))
}

function textMatchesQuery(raw: string, query: string): boolean {
  const cleanQuery = query.trim().toLowerCase()
  if (!cleanQuery) {
    return true
  }
  return raw.toLowerCase().includes(cleanQuery)
}

function isDailyPath(path: string): boolean {
  const normalized = normalizeFilePathKey(path)
  return normalized.includes('/daily/')
}

function isTaskInScope(task: TaskRow, scope: FocusDashboardFilters['scope'], todayIso: string): boolean {
  if (scope === 'all') {
    return true
  }
  const status = normalizeTaskStatusValue(task.status)
  const dueIso = toTaskDueIso(task.due_date)
  const dueBucket = toTaskDueBucket(task.due_date, todayIso)
  const priority = normalizeTaskPriorityValue(task.priority)
  if (scope === 'today') {
    return status === 'in_progress' || dueBucket === 'overdue' || dueIso === todayIso || priority === 'high'
  }
  return status === 'in_progress' || dueBucket === 'overdue' || dueBucket === 'tomorrow' || dueBucket === 'this_week' || dueIso === todayIso
}

function isTodoInScope(todo: TodoRow, scope: FocusDashboardFilters['scope'], todayIso: string): boolean {
  if (scope === 'all') {
    return true
  }
  const updatedDay = toUpdatedDay(todo.updated_at)
  if (scope === 'today') {
    return updatedDay === todayIso || !todo.promoted
  }
  return diffDays(todayIso, updatedDay) <= 7 || !todo.promoted
}

function toTaskQueryText(task: TaskRow): string {
  return [
    task.title,
    task.id,
    task.status,
    task.priority,
    task.due_date || '',
    ...(task.tags || []),
    ...(task.related || []),
    task.path || '',
  ]
    .join(' ')
    .toLowerCase()
}

function toTodoQueryText(todo: TodoRow): string {
  return [
    todo.raw_text,
    todo.note_title,
    todo.note_path,
    ...(todo.explicit_tags || []),
    ...(todo.inherited_tags || []),
    ...(todo.links || []),
  ]
    .join(' ')
    .toLowerCase()
}

function taskFocusScore(task: TaskRow, todayIso: string): number {
  const priority = normalizeTaskPriorityValue(task.priority)
  const status = normalizeTaskStatusValue(task.status)
  const dueBucket = toTaskDueBucket(task.due_date, todayIso)
  const dueIso = toTaskDueIso(task.due_date)
  let score = 0
  score += priority === 'high' ? 55 : priority === 'medium' ? 34 : 18
  score += status === 'in_progress' ? 24 : status === 'open' ? 15 : status === 'new_topic' ? 11 : 7
  score += dueBucket === 'overdue' ? 35 : dueIso === todayIso ? 28 : dueBucket === 'tomorrow' ? 20 : dueBucket === 'this_week' ? 12 : 6
  const updatedDay = toUpdatedDay(task.updated_at)
  const age = diffDays(todayIso, updatedDay)
  if (age <= 0) {
    score += 8
  } else if (age <= 2) {
    score += 5
  } else if (age <= 6) {
    score += 2
  }
  return score
}

function todoFocusScore(todo: TodoRow, todayIso: string): number {
  let score = todo.promoted ? 26 : 34
  const updatedDay = toUpdatedDay(todo.updated_at)
  const age = diffDays(todayIso, updatedDay)
  if (age <= 0) {
    score += 10
  } else if (age <= 2) {
    score += 6
  } else if (age <= 6) {
    score += 3
  }
  if (todo.links.length > 0) {
    score += 4
  }
  return score
}

function sortByRecency(left: { updatedAt: string; title: string }, right: { updatedAt: string; title: string }): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }
  return left.title.localeCompare(right.title, 'de', { sensitivity: 'base' })
}

function findDailyNote(notes: SearchRow[], todayIso: string): SearchRow | null {
  const exact: SearchRow[] = []
  const fallback: SearchRow[] = []
  for (const note of notes) {
    if (!isDailyPath(note.path)) {
      continue
    }
    const noteKey = normalizeFilePathKey(note.path)
    if (noteKey.includes(`/${todayIso}.md`) || noteKey.includes(`/${todayIso}/`)) {
      exact.push(note)
      continue
    }
    if (note.title.includes(todayIso) || noteKey.includes(todayIso)) {
      fallback.push(note)
    }
  }
  const pool = exact.length > 0 ? exact : fallback
  if (pool.length === 0) {
    return null
  }
  return [...pool].sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))[0]
}

function toSectionFlags(filters: FocusDashboardFilters): { includeTasks: boolean; includeTodos: boolean; includeNotes: boolean } {
  const selected = new Set(filters.sections)
  const includeAll = selected.size === 0
  return {
    includeTasks: includeAll || selected.has('tasks'),
    includeTodos: includeAll || selected.has('todos'),
    includeNotes: includeAll || selected.has('notes'),
  }
}

function normalizeMaxItems(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 12
  }
  return Math.max(6, Math.min(28, Math.round(raw)))
}

function toTaskPrimaryItem(task: TaskRow, todayIso: string): FocusPrimaryItem {
  return {
    key: `task:${task.id}`,
    kind: 'task',
    title: task.title,
    updatedAt: task.updated_at,
    score: taskFocusScore(task, todayIso),
    path: task.path,
    notePath: task.path,
    taskId: task.id,
    todoId: null,
    status: task.status,
    priority: task.priority,
    dueDate: toTaskDueIso(task.due_date),
    tags: Array.from(new Set((task.tags || []).map((entry) => normalizeTagCandidate(entry)).filter(Boolean))),
    related: Array.from(new Set((task.related || []).map((entry) => normalizeRelatedCandidate(entry)).filter(Boolean))),
    links: [],
  }
}

function toTodoPrimaryItem(todo: TodoRow, todayIso: string): FocusPrimaryItem {
  return {
    key: `todo:${todo.id}`,
    kind: 'todo',
    title: todo.raw_text.trim() || '(ohne Text)',
    updatedAt: todo.updated_at,
    score: todoFocusScore(todo, todayIso),
    path: todo.note_path,
    notePath: todo.note_path,
    taskId: todo.promoted_task_id || null,
    todoId: todo.id,
    status: null,
    priority: null,
    dueDate: null,
    tags: Array.from(
      new Set([...(todo.explicit_tags || []), ...(todo.inherited_tags || [])].map((entry) => normalizeTagCandidate(entry)).filter(Boolean))
    ),
    related: [],
    links: Array.from(new Set((todo.links || []).map((entry) => normalizeRelatedCandidate(entry)).filter(Boolean))),
  }
}

function toNoteSearchText(note: SearchRow): string {
  return `${note.title} ${note.path}`.toLowerCase()
}

function matchesNoteScope(note: SearchRow, scope: FocusDashboardFilters['scope'], todayIso: string): boolean {
  if (scope === 'all') {
    return true
  }
  const noteDay = toUpdatedDay(note.updated_at)
  if (scope === 'today') {
    return noteDay === todayIso
  }
  return diffDays(todayIso, noteDay) <= 7
}

export function buildFocusDashboardData(args: {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  filters: FocusDashboardFilters
  todayIso: string
}): FocusDashboardData {
  const { tasks, todos, notes, filters, todayIso } = args
  const { includeTasks, includeTodos, includeNotes } = toSectionFlags(filters)
  const maxItems = normalizeMaxItems(filters.maxItems)
  const openTasks = tasks.filter((task) => normalizeTaskStatusValue(task.status) !== 'done')
  const openTodos = todos.filter((todo) => !todo.checked)

  const scopedTasks = includeTasks
    ? openTasks
        .filter((task) => isTaskInScope(task, filters.scope, todayIso))
        .filter((task) => textMatchesQuery(toTaskQueryText(task), filters.query))
    : []
  const scopedTodos = includeTodos
    ? openTodos
        .filter((todo) => isTodoInScope(todo, filters.scope, todayIso))
        .filter((todo) => textMatchesQuery(toTodoQueryText(todo), filters.query))
    : []

  const primaryItems = [...scopedTasks.map((task) => toTaskPrimaryItem(task, todayIso)), ...scopedTodos.map((todo) => toTodoPrimaryItem(todo, todayIso))]
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return sortByRecency(left, right)
    })
    .slice(0, maxItems)

  const dueTodayTaskCount = openTasks.filter((task) => toTaskDueIso(task.due_date) === todayIso).length
  const inProgressTaskCount = openTasks.filter((task) => normalizeTaskStatusValue(task.status) === 'in_progress').length

  const notesWithQuery = includeNotes ? notes.filter((note) => textMatchesQuery(toNoteSearchText(note), filters.query)) : []
  const notesToday = notesWithQuery
    .filter((note) => toUpdatedDay(note.updated_at) === todayIso)
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, maxItems)
  const recentNotes = notesWithQuery
    .filter((note) => matchesNoteScope(note, filters.scope, todayIso))
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, Math.max(maxItems, 8))

  return {
    openTaskCount: openTasks.length,
    inProgressTaskCount,
    dueTodayTaskCount,
    openTodoCount: openTodos.length,
    notesTodayCount: notesToday.length,
    todayDailyNote: includeNotes ? findDailyNote(notesWithQuery, todayIso) : null,
    primaryItems,
    notesToday,
    recentNotes,
  }
}

function toReferenceWords(item: FocusPrimaryItem): string[] {
  const titleWords = toWords(item.title)
  const tagWords = item.tags.flatMap((entry) => {
    const tagKey = normalizeTagCandidate(entry)
    const [, tail = tagKey] = tagKey.split(':', 2)
    return toWords(tail)
  })
  return Array.from(new Set([...titleWords, ...tagWords]))
}

function toReferenceLinks(item: FocusPrimaryItem): string[] {
  return Array.from(new Set([...item.related, ...item.links].map((entry) => normalizeRelatedCandidate(entry)).filter(Boolean)))
}

export function buildFocusContextHits(item: FocusPrimaryItem, notes: SearchRow[], todayIso: string): FocusContextHit[] {
  const referenceWords = toReferenceWords(item)
  const referenceLinks = toReferenceLinks(item)
  const linkSet = new Set(referenceLinks.map((entry) => entry.toLowerCase()))
  const originPathKey = item.notePath ? normalizeFilePathKey(item.notePath).replace(/\.md$/i, '') : ''

  const hits: FocusContextHit[] = []
  for (const note of notes) {
    const notePathKey = normalizeFilePathKey(note.path).replace(/\.md$/i, '')
    const noteTitleKey = note.title.trim().toLowerCase()
    const noteSearchText = `${note.title} ${note.path}`.toLowerCase()
    let score = 0
    const reasons: string[] = []

    if (originPathKey && notePathKey === originPathKey) {
      score += 65
      reasons.push('Ursprung')
    }

    if (linkSet.has(notePathKey) || linkSet.has(noteTitleKey)) {
      score += 78
      reasons.push('Related')
    }

    let wordHits = 0
    for (const word of referenceWords) {
      if (!word || word.length < 3) {
        continue
      }
      if (noteSearchText.includes(word)) {
        wordHits += 1
      }
    }
    if (wordHits > 0) {
      score += Math.min(28, wordHits * 6)
      reasons.push('Keyword')
    }

    if (item.tags.some((tag) => {
      const normalized = normalizeTagCandidate(tag)
      const [, tail = normalized] = normalized.split(':', 2)
      return Boolean(tail) && noteSearchText.includes(tail)
    })) {
      score += 18
      reasons.push('Tag')
    }

    const updatedDay = toUpdatedDay(note.updated_at)
    const age = diffDays(todayIso, updatedDay)
    if (age <= 0) {
      score += 4
    } else if (age <= 3) {
      score += 2
    }

    if (score <= 0) {
      continue
    }
    hits.push({
      key: `${note.id}:${note.path}`,
      path: note.path,
      title: note.title,
      noteType: note.note_type,
      updatedAt: note.updated_at,
      score,
      reasons: Array.from(new Set(reasons)),
    })
  }

  return hits
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return sortByRecency(left, right)
    })
    .slice(0, 8)
}

export function toDotDateLabel(isoDate: string | null): string {
  if (!isoDate) {
    return '-'
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim().slice(0, 10))
  if (!match) {
    return '-'
  }
  return `${match[3]}.${match[2]}.${match[1]}`
}

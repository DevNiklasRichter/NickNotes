import { localCalendarDay } from '../shared/dates'
import {
  normalizeFilePathKey,
  normalizeRelatedCandidate,
  normalizeTaskPriorityValue,
  normalizeTaskStatusValue,
  type SearchRow,
  type TaskRow,
  type TodoRow,
} from '../app/AppShared'
import type { TaskPriority, TaskStatus } from '../shared/taskDomain'

/** At most three items per day: a short list is the point of "Heute wichtig". */
export const MAX_MIT_ITEMS = 3
const UPCOMING_DAYS = 7
const MAX_NOTES_TODAY = 20
const MAX_RECENT_NOTES = 5

export type FocusTaskReason = 'overdue' | 'due_today' | 'resumed' | 'in_progress' | 'upcoming' | 'deferred'

export type FocusTaskItem = {
  key: string
  id: string
  title: string
  path: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  followUpDate: string | null
  reason: FocusTaskReason
  overdueDays: number
  isMit: boolean
  waitingFor: string | null
  nextActionHint: string | null
  blockedReason: string | null
  repeat: string | null
  remindAt: string | null
}

export type FocusTodoItem = {
  key: string
  id: string
  text: string
  notePath: string
  noteTitle: string
  checked: boolean
  isMit: boolean
  createdDay: string
  links: string[]
}

export type FocusMitEntry = {
  key: string
  kind: 'task' | 'todo'
  title: string
  path: string | null
  noteType: 'task' | 'note'
  isDone: boolean
}

export type FocusNoteItem = {
  key: string
  path: string
  title: string
  updatedAt: string
  isDaily: boolean
}

export type FocusDashboardData = {
  mitIds: string[]
  mitEntries: FocusMitEntry[]
  canAddMit: boolean
  tasksToday: FocusTaskItem[]
  tasksUpcoming: FocusTaskItem[]
  tasksDeferred: FocusTaskItem[]
  todosToday: FocusTodoItem[]
  todosEarlier: FocusTodoItem[]
  openTodosToday: number
  openTodosEarlier: number
  notesToday: FocusNoteItem[]
  recentNotes: FocusNoteItem[]
  stats: {
    doneToday: number
    openToday: number
    overdue: number
    deferred: number
  }
}

export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function diffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T00:00:00`)
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function isoDay(value: string | null | undefined): string {
  const clean = (value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : ''
}

function optionalText(value: unknown): string | null {
  const clean = String(value ?? '').trim()
  return clean || null
}

function matchesQuery(parts: Array<string | null | undefined>, query: string): boolean {
  const clean = query.trim().toLowerCase()
  return !clean || parts.join(' ').toLowerCase().includes(clean)
}

function isDailyNoteOf(path: string, dayIso: string): boolean {
  const key = normalizeFilePathKey(path)
  return key.includes('/daily/') && key.endsWith(`/${dayIso}.md`)
}

function isDailyNote(path: string): boolean {
  return /\/daily\/(?:.+\/)?\d{4}-\d{2}-\d{2}\.md$/.test(normalizeFilePathKey(path))
}

/** Canonical `task:<id>` / `todo:<id>` keys that still resolve; unknown and duplicate entries drop out. */
export function normalizeMitIds(rawIds: string[], tasks: TaskRow[], todos: TodoRow[]): string[] {
  const taskIds = new Set(tasks.map((task) => task.id))
  const todoIds = new Set(todos.map((todo) => todo.id))
  const result: string[] = []
  for (const raw of rawIds) {
    const match = /^(task|todo)\s*:\s*(.+)$/i.exec(raw.trim())
    const kind = match ? match[1].toLowerCase() : taskIds.has(raw.trim()) ? 'task' : todoIds.has(raw.trim()) ? 'todo' : ''
    const id = (match ? match[2] : raw).trim()
    if (!kind || !(kind === 'task' ? taskIds : todoIds).has(id)) {
      continue
    }
    const key = `${kind}:${id}`
    if (!result.includes(key)) {
      result.push(key)
    }
    if (result.length >= MAX_MIT_ITEMS) {
      break
    }
  }
  return result
}

function classifyTask(task: TaskRow, todayIso: string): { reason: FocusTaskReason; overdueDays: number } | null {
  const status = normalizeTaskStatusValue(task.status)
  if (status === 'done') {
    return null
  }
  const due = isoDay(task.due_date)
  const followUp = isoDay(task.follow_up_date)
  if (followUp && followUp > todayIso) {
    return { reason: 'deferred', overdueDays: 0 }
  }
  if (followUp) {
    return { reason: 'resumed', overdueDays: due && due < todayIso ? diffDays(due, todayIso) : 0 }
  }
  // Paused tasks only come back through a Wiedervorlage date.
  if (status === 'on_hold') {
    return null
  }
  if (due && due < todayIso) {
    return { reason: 'overdue', overdueDays: diffDays(due, todayIso) }
  }
  if (due === todayIso) {
    return { reason: 'due_today', overdueDays: 0 }
  }
  if (status === 'in_progress') {
    return { reason: 'in_progress', overdueDays: 0 }
  }
  if (due && diffDays(todayIso, due) <= UPCOMING_DAYS) {
    return { reason: 'upcoming', overdueDays: 0 }
  }
  return null
}

const REASON_RANK: Record<FocusTaskReason, number> = { overdue: 0, due_today: 1, resumed: 2, in_progress: 3, upcoming: 4, deferred: 5 }
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

function compareTasks(left: FocusTaskItem, right: FocusTaskItem): number {
  return (
    REASON_RANK[left.reason] - REASON_RANK[right.reason] ||
    (left.reason === 'deferred' ? (left.followUpDate || '').localeCompare(right.followUpDate || '') : 0) ||
    (left.dueDate || '9999').localeCompare(right.dueDate || '9999') ||
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    left.title.localeCompare(right.title, 'de')
  )
}

function toTaskItem(task: TaskRow, reason: FocusTaskReason, overdueDays: number, mitKeys: Set<string>): FocusTaskItem {
  const key = `task:${task.id}`
  return {
    key,
    id: task.id,
    title: task.title.trim() || task.id,
    path: task.path || null,
    status: normalizeTaskStatusValue(task.status),
    priority: normalizeTaskPriorityValue(task.priority),
    dueDate: isoDay(task.due_date) || null,
    followUpDate: isoDay(task.follow_up_date) || null,
    reason,
    overdueDays,
    isMit: mitKeys.has(key),
    waitingFor: optionalText(task.waiting_for),
    nextActionHint: optionalText(task.next_action_hint),
    blockedReason: optionalText(task.blocked_reason),
    repeat: optionalText(task.repeat),
    remindAt: optionalText(task.remind_at),
  }
}

function todoNoteTitle(todo: TodoRow): string {
  const explicit = (todo.note_title || '').trim()
  if (explicit) {
    return explicit
  }
  const tail = (todo.note_path || '').replace(/\\/g, '/').split('/').pop() || ''
  return tail.replace(/\.md$/i, '') || 'Notiz'
}

function toTodoItem(todo: TodoRow, mitKeys: Set<string>): FocusTodoItem {
  const key = `todo:${todo.id}`
  return {
    key,
    id: todo.id,
    text: todo.raw_text.trim() || '(ohne Text)',
    notePath: todo.note_path,
    noteTitle: todoNoteTitle(todo),
    checked: todo.checked,
    isMit: mitKeys.has(key),
    createdDay: localCalendarDay(todo.created_at),
    links: Array.from(new Set((todo.links || []).map((link) => normalizeRelatedCandidate(link)).filter(Boolean))),
  }
}

function toNoteItem(note: SearchRow): FocusNoteItem {
  return {
    key: `${note.id}:${note.path}`,
    path: note.path,
    title: note.title.replace(/\.md$/i, ''),
    updatedAt: note.updated_at,
    isDaily: isDailyNote(note.path),
  }
}

function byRecency(left: SearchRow, right: SearchRow): number {
  return right.updated_at.localeCompare(left.updated_at) || left.title.localeCompare(right.title, 'de')
}

/**
 * Everything the focus view shows, derived from the Markdown projections:
 * tasks due or resumed today, today's to-dos next to earlier open ones, notes edited today.
 */
export function buildFocusDashboardData(args: {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  mitIds: string[]
  todayIso: string
  query?: string
}): FocusDashboardData {
  const { tasks, todos, notes, todayIso } = args
  const query = args.query || ''
  const mitIds = normalizeMitIds(args.mitIds, tasks, todos)
  const mitKeys = new Set(mitIds)

  const tasksToday: FocusTaskItem[] = []
  const tasksUpcoming: FocusTaskItem[] = []
  const tasksDeferred: FocusTaskItem[] = []
  for (const task of tasks) {
    const classified = classifyTask(task, todayIso)
    if (!classified || !matchesQuery([task.title, task.id, ...(task.tags || [])], query)) {
      continue
    }
    const item = toTaskItem(task, classified.reason, classified.overdueDays, mitKeys)
    if (classified.reason === 'deferred') {
      tasksDeferred.push(item)
    } else if (classified.reason === 'upcoming') {
      tasksUpcoming.push(item)
    } else {
      tasksToday.push(item)
    }
  }
  tasksToday.sort(compareTasks)
  tasksUpcoming.sort(compareTasks)
  tasksDeferred.sort(compareTasks)

  // Checked-today to-dos stay in place, so a misclick can be undone where it happened.
  const todosToday: FocusTodoItem[] = []
  const todosEarlier: FocusTodoItem[] = []
  for (const todo of todos) {
    if (todo.promoted && !todo.checked) {
      continue
    }
    if (todo.checked && localCalendarDay(todo.completed_at) !== todayIso) {
      continue
    }
    if (!matchesQuery([todo.raw_text, todo.note_title], query)) {
      continue
    }
    const item = toTodoItem(todo, mitKeys)
    if (item.createdDay === todayIso || isDailyNoteOf(todo.note_path, todayIso)) {
      todosToday.push(item)
    } else {
      todosEarlier.push(item)
    }
  }
  const byLine = (left: TodoRow | undefined, right: TodoRow | undefined) => (left?.line_no ?? 0) - (right?.line_no ?? 0)
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  todosToday.sort((left, right) => left.createdDay.localeCompare(right.createdDay) || left.notePath.localeCompare(right.notePath) || byLine(todoById.get(left.id), todoById.get(right.id)))
  todosEarlier.sort((left, right) => (right.createdDay || '0').localeCompare(left.createdDay || '0') || left.noteTitle.localeCompare(right.noteTitle, 'de') || byLine(todoById.get(left.id), todoById.get(right.id)))

  const plainNotes = notes.filter((note) => note.note_type.trim().toLowerCase() !== 'task' && matchesQuery([note.title, note.path], query))
  const notesToday = plainNotes.filter((note) => localCalendarDay(note.updated_at) === todayIso).sort(byRecency).slice(0, MAX_NOTES_TODAY).map(toNoteItem)
  const recentNotes = notesToday.length > 0 ? [] : [...plainNotes].sort(byRecency).slice(0, MAX_RECENT_NOTES).map(toNoteItem)

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const mitEntries: FocusMitEntry[] = mitIds.flatMap((key): FocusMitEntry[] => {
    const [kind, ...rest] = key.split(':')
    const id = rest.join(':')
    if (kind === 'task') {
      const task = taskById.get(id)
      return task ? [{ key, kind: 'task', title: task.title.trim() || task.id, path: task.path || null, noteType: 'task', isDone: normalizeTaskStatusValue(task.status) === 'done' }] : []
    }
    const todo = todoById.get(id)
    return todo ? [{ key, kind: 'todo', title: todo.raw_text.trim() || '(ohne Text)', path: todo.note_path || null, noteType: 'note', isDone: todo.checked }] : []
  })

  // Unknown completion history stays unknown: only a recorded completion counts as done today.
  const doneTasks = tasks.filter((task) => normalizeTaskStatusValue(task.status) === 'done' && localCalendarDay(task.completed_at) === todayIso).length
  const doneTodos = todos.filter((todo) => todo.checked && localCalendarDay(todo.completed_at) === todayIso).length
  const openTodosToday = todosToday.filter((todo) => !todo.checked).length

  return {
    mitIds,
    mitEntries,
    canAddMit: mitIds.length < MAX_MIT_ITEMS,
    tasksToday,
    tasksUpcoming,
    tasksDeferred,
    todosToday,
    todosEarlier,
    openTodosToday,
    openTodosEarlier: todosEarlier.filter((todo) => !todo.checked).length,
    notesToday,
    recentNotes,
    stats: {
      doneToday: doneTasks + doneTodos,
      openToday: tasksToday.length + openTodosToday,
      overdue: tasksToday.filter((task) => task.overdueDays > 0).length,
      deferred: tasksDeferred.length,
    },
  }
}

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

/** "Fr. 21.11." — short enough for a row, unambiguous within the next weeks. */
export function toShortDayLabel(dayIso: string, todayIso: string): string {
  const delta = diffDays(todayIso, dayIso)
  if (delta === 0) return 'heute'
  if (delta === 1) return 'morgen'
  if (delta === -1) return 'gestern'
  const date = new Date(`${dayIso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dayIso
  const label = `${WEEKDAYS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
  return date.getFullYear() === new Date(`${todayIso}T00:00:00`).getFullYear() ? label : `${label}${date.getFullYear()}`
}

export function toTaskReasonLabel(task: FocusTaskItem, todayIso: string): string {
  switch (task.reason) {
    case 'overdue':
      return task.overdueDays === 1 ? 'seit gestern fällig' : `seit ${task.overdueDays} Tagen fällig`
    case 'due_today':
      return 'heute fällig'
    case 'resumed':
      return task.overdueDays > 0 ? `wieder dran · seit ${task.overdueDays} T. fällig` : 'wieder dran'
    case 'in_progress':
      return task.dueDate ? `in Arbeit · fällig ${toShortDayLabel(task.dueDate, todayIso)}` : 'in Arbeit'
    case 'upcoming':
      return task.dueDate ? `fällig ${toShortDayLabel(task.dueDate, todayIso)}` : ''
    case 'deferred':
      return task.followUpDate ? `ab ${toShortDayLabel(task.followUpDate, todayIso)}` : ''
  }
}

/** Defer targets offered in the row menu. */
export function deferOptions(todayIso: string): Array<{ label: string; date: string }> {
  const weekday = new Date(`${todayIso}T00:00:00`).getDay()
  const toMonday = ((8 - weekday) % 7) || 7
  return [
    { label: 'Morgen', date: addDays(todayIso, 1) },
    { label: 'Nächster Montag', date: addDays(todayIso, toMonday) },
    { label: 'In einer Woche', date: addDays(todayIso, 7) },
  ]
}

/** Long German date for the view header, e.g. "Mittwoch, 18. November". */
export function toHeaderDateLabel(todayIso: string): string {
  const date = new Date(`${todayIso}T00:00:00`)
  return Number.isNaN(date.getTime()) ? todayIso : date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Markdown inline syntax reads as noise in a list row: `{tag:a/b}` → `#b`, links → their label. */
export function toPlainTodoText(raw: string): string {
  return raw
    .replace(/\{tag:[A-Za-z0-9][A-Za-z0-9_-]*\/([A-Za-z0-9][A-Za-z0-9_-]*)\}/g, '#$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

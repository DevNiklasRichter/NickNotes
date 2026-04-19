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
  sourceId: string
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
  estimateMinutes: number | null
  isBlocked: boolean
  waitingFor: string | null
  followUpDate: string | null
  blockedReason: string | null
  nextActionHint: string | null
  tags: string[]
  related: string[]
  links: string[]
  isDone: boolean
  isMit: boolean
  canAddToMit: boolean
  contextBadgeCount: number
  hasOriginNote: boolean
  hasRelatedContext: boolean
  hasTagContext: boolean
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

export type FocusDailyTrailItem = {
  key: string
  path: string
  title: string
  updatedAt: string
  dayIso: string | null
  isToday: boolean
}

export type FocusDashboardData = {
  selectedScope: FocusDashboardFilters['scope']
  openTaskCount: number
  inProgressTaskCount: number
  dueTodayTaskCount: number
  openTodoCount: number
  notesTodayCount: number
  doneToday: number
  doneTodayTasks: number
  doneTodayTodos: number
  blockedTaskCount: number
  waitingTaskCount: number
  followUpTodayCount: number
  todayEstimatedMinutes: number
  todayDailyNote: SearchRow | null
  mitIds: string[]
  mitItems: FocusPrimaryItem[]
  overdueItems: FocusPrimaryItem[]
  blockedItems: FocusPrimaryItem[]
  waitingItems: FocusPrimaryItem[]
  followUpTodayItems: FocusPrimaryItem[]
  focusItems: FocusPrimaryItem[]
  candidateItems: FocusPrimaryItem[]
  primaryItems: FocusPrimaryItem[]
  notesToday: SearchRow[]
  recentNotes: SearchRow[]
  dailyTrailItems: FocusDailyTrailItem[]
}

const WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9_-]{2,}/g
const DAILY_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/
const MAX_OVERDUE_ITEMS = 20
const MAX_BLOCKING_ITEMS = 12
const MAX_MIT_ITEMS = 3
const EMPTY_CONTEXT_BADGES = {
  contextBadgeCount: 0,
  hasOriginNote: false,
  hasRelatedContext: false,
  hasTagContext: false,
}

function toDateFromIso(isoDate: string): Date | null {
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUpdatedDay(value: string): string {
  return value.slice(0, 10)
}

function isValidIsoDate(isoDate: string): boolean {
  return Boolean(toDateFromIso(isoDate))
}

function diffDays(leftIso: string, rightIso: string): number {
  const left = toDateFromIso(leftIso)
  const right = toDateFromIso(rightIso)
  if (!left || !right) {
    return 999
  }
  return Math.floor((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24))
}

function toWeekRange(todayIso: string): { startIso: string; endIso: string } | null {
  const today = toDateFromIso(todayIso)
  if (!today) {
    return null
  }
  const start = new Date(today.getTime())
  const dayIndex = start.getDay()
  const distanceToMonday = (dayIndex + 6) % 7
  start.setDate(start.getDate() - distanceToMonday)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 6)
  return {
    startIso: toIsoDate(start),
    endIso: toIsoDate(end),
  }
}

function isIsoInCurrentWeek(candidateIso: string, todayIso: string): boolean {
  if (!isValidIsoDate(candidateIso)) {
    return false
  }
  const range = toWeekRange(todayIso)
  if (!range) {
    return false
  }
  return candidateIso >= range.startIso && candidateIso <= range.endIso
}

function isIsoWithinNextDays(candidateIso: string, todayIso: string, days: number): boolean {
  if (!isValidIsoDate(candidateIso)) {
    return false
  }
  const delta = diffDays(candidateIso, todayIso)
  return delta >= 0 && delta <= days
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

function toDailyIsoCandidate(note: SearchRow): string | null {
  const combined = `${note.title} ${normalizeFilePathKey(note.path)}`
  const match = combined.match(DAILY_DATE_PATTERN)
  if (!match || !match[1]) {
    return null
  }
  const candidate = match[1]
  if (!isValidIsoDate(candidate)) {
    return null
  }
  return candidate
}

function isTodayDailyMatch(note: SearchRow, todayIso: string): boolean {
  const notePathKey = normalizeFilePathKey(note.path)
  if (notePathKey.includes(`/${todayIso}.md`) || notePathKey.includes(`/${todayIso}/`)) {
    return true
  }
  const dailyIso = toDailyIsoCandidate(note)
  if (dailyIso === todayIso) {
    return true
  }
  return note.title.includes(todayIso) || notePathKey.includes(todayIso)
}

function isOverdueTask(task: TaskRow, todayIso: string): boolean {
  if (normalizeTaskStatusValue(task.status) === 'done') {
    return false
  }
  const dueIso = toTaskDueIso(task.due_date)
  if (!dueIso || !isValidIsoDate(dueIso)) {
    return false
  }
  return dueIso < todayIso
}

function isTaskInScope(task: TaskRow, scope: FocusDashboardFilters['scope'], todayIso: string): boolean {
  if (scope === 'all') {
    return true
  }
  const status = normalizeTaskStatusValue(task.status)
  const dueIso = toTaskDueIso(task.due_date)
  const dueBucket = toTaskDueBucket(task.due_date, todayIso)
  const priority = normalizeTaskPriorityValue(task.priority)
  if (scope === 'overdue') {
    return dueBucket === 'overdue'
  }
  if (scope === 'today') {
    return status === 'in_progress' || dueBucket === 'overdue' || dueIso === todayIso || priority === 'high'
  }
  if (scope === 'tomorrow') {
    return status === 'in_progress' || dueBucket === 'overdue' || dueBucket === 'tomorrow'
  }
  if (scope === 'week') {
    return status === 'in_progress' || dueBucket === 'overdue' || (Boolean(dueIso) && isIsoInCurrentWeek(dueIso, todayIso))
  }
  return status === 'in_progress' || dueBucket === 'overdue' || (Boolean(dueIso) && isIsoWithinNextDays(dueIso, todayIso, 7))
}

function isTodoInScope(todo: TodoRow, scope: FocusDashboardFilters['scope'], todayIso: string): boolean {
  if (scope === 'all') {
    return true
  }
  const updatedDay = toUpdatedDay(todo.updated_at)
  const age = diffDays(todayIso, updatedDay)
  if (scope === 'overdue') {
    return age <= 3 || !todo.promoted
  }
  if (scope === 'today') {
    return updatedDay === todayIso || !todo.promoted
  }
  if (scope === 'tomorrow') {
    return age <= 1 || !todo.promoted
  }
  if (scope === 'week') {
    return isIsoInCurrentWeek(updatedDay, todayIso) || !todo.promoted
  }
  return age <= 7 || !todo.promoted
}

function toTaskQueryText(task: TaskRow): string {
  return [
    task.title,
    task.id,
    task.status,
    task.priority,
    task.due_date || '',
    String(task.estimate_minutes ?? ''),
    ...(task.blocked_by_ids || []),
    task.waiting_for || '',
    task.follow_up_date || '',
    task.blocked_reason || '',
    task.next_action_hint || '',
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

type TaskExecutionSignals = {
  estimateMinutes: number | null
  waitingFor: string | null
  followUpDate: string | null
  blockedReason: string | null
  nextActionHint: string | null
  blockedByIds: string[]
  blockedByDependencies: boolean
  followUpToday: boolean
  isBlocked: boolean
}

function normalizeEstimateMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    return rounded > 0 ? rounded : null
  }
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function normalizeOptionalText(value: unknown): string | null {
  const clean = String(value ?? '').trim().replace(/\s+/g, ' ')
  return clean || null
}

function normalizeTaskIdList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : []
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const clean = String(entry ?? '').trim()
    if (!clean) {
      continue
    }
    const key = clean.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(clean)
  }
  return normalized
}

function toTaskExecutionSignals(task: TaskRow, taskStatusById: Map<string, string>, todayIso: string): TaskExecutionSignals {
  const blockedByIds = normalizeTaskIdList(task.blocked_by_ids)
  const waitingFor = normalizeOptionalText(task.waiting_for)
  const followUpDate = toTaskDueIso(task.follow_up_date || null)
  const blockedByDependencies = blockedByIds.some((blockerId) => {
    const blockerStatus = taskStatusById.get(blockerId)
    if (!blockerStatus) {
      // Unknown blocker ids are treated defensively as unresolved blockers.
      return true
    }
    return normalizeTaskStatusValue(blockerStatus) !== 'done'
  })
  const followUpToday = Boolean(followUpDate) && followUpDate === todayIso
  const normalizedStatus = normalizeTaskStatusValue(task.status)
  const isBlocked = normalizedStatus !== 'done' && (blockedByDependencies || Boolean(waitingFor))

  return {
    estimateMinutes: normalizeEstimateMinutes(task.estimate_minutes),
    waitingFor,
    followUpDate: followUpDate || null,
    blockedReason: normalizeOptionalText(task.blocked_reason),
    nextActionHint: normalizeOptionalText(task.next_action_hint),
    blockedByIds,
    blockedByDependencies,
    followUpToday,
    isBlocked,
  }
}

function taskFocusScore(task: TaskRow, todayIso: string, signals: TaskExecutionSignals): number {
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

  if (signals.estimateMinutes !== null) {
    if (signals.estimateMinutes <= 15) {
      score += 6
    } else if (signals.estimateMinutes <= 30) {
      score += 4
    } else if (signals.estimateMinutes <= 60) {
      score += 2
    } else if (signals.estimateMinutes >= 240) {
      score -= 2
    }
  }

  if (signals.nextActionHint) {
    score += 4
  }

  if (signals.isBlocked) {
    // Blocked work should still stay visible, but be deprioritized for execution.
    score -= signals.followUpToday ? 2 : 12
  }
  if (signals.waitingFor && !signals.followUpToday) {
    score -= 4
  }
  if (signals.waitingFor && signals.followUpToday) {
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

function sortDailyTrailNotes(left: SearchRow, right: SearchRow): number {
  const leftDay = toDailyIsoCandidate(left)
  const rightDay = toDailyIsoCandidate(right)
  if (leftDay && rightDay && leftDay !== rightDay) {
    return rightDay.localeCompare(leftDay)
  }
  if (leftDay && !rightDay) {
    return -1
  }
  if (!leftDay && rightDay) {
    return 1
  }
  return sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title })
}

function findDailyNote(notes: SearchRow[], todayIso: string): SearchRow | null {
  const exact: SearchRow[] = []
  const fallback: SearchRow[] = []
  for (const note of notes) {
    if (!isDailyPath(note.path)) {
      continue
    }
    if (isTodayDailyMatch(note, todayIso)) {
      exact.push(note)
      continue
    }
    const noteKey = normalizeFilePathKey(note.path)
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

function toDailyTrailItems(notes: SearchRow[], todayIso: string, maxRecentItems: number): FocusDailyTrailItem[] {
  const dailyNotes = notes.filter((note) => isDailyPath(note.path))
  const todayDaily = findDailyNote(dailyNotes, todayIso)
  const recent = [...dailyNotes].sort((left, right) => sortDailyTrailNotes(left, right)).slice(0, Math.max(0, maxRecentItems))
  const combined = todayDaily ? [todayDaily, ...recent] : recent
  const seen = new Set<string>()
  const trail: FocusDailyTrailItem[] = []
  for (const note of combined) {
    const dedupeKey = normalizeFilePathKey(note.path)
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    trail.push({
      key: `${note.id}:${note.path}`,
      path: note.path,
      title: note.title,
      updatedAt: note.updated_at,
      dayIso: toDailyIsoCandidate(note),
      isToday: isTodayDailyMatch(note, todayIso),
    })
  }
  return trail
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

function toTaskPrimaryItem(task: TaskRow, todayIso: string, taskStatusById: Map<string, string>): FocusPrimaryItem {
  const normalizedStatus = normalizeTaskStatusValue(task.status)
  const signals = toTaskExecutionSignals(task, taskStatusById, todayIso)
  return {
    key: `task:${task.id}`,
    kind: 'task',
    sourceId: task.id,
    title: task.title,
    updatedAt: task.updated_at,
    score: taskFocusScore(task, todayIso, signals),
    path: task.path,
    notePath: task.path,
    taskId: task.id,
    todoId: null,
    status: task.status,
    priority: task.priority,
    dueDate: toTaskDueIso(task.due_date),
    estimateMinutes: signals.estimateMinutes,
    isBlocked: signals.isBlocked,
    waitingFor: signals.waitingFor,
    followUpDate: signals.followUpDate,
    blockedReason: signals.blockedReason,
    nextActionHint: signals.nextActionHint,
    tags: Array.from(new Set((task.tags || []).map((entry) => normalizeTagCandidate(entry)).filter(Boolean))),
    related: Array.from(new Set((task.related || []).map((entry) => normalizeRelatedCandidate(entry)).filter(Boolean))),
    links: [],
    isDone: normalizedStatus === 'done',
    isMit: false,
    canAddToMit: false,
    ...EMPTY_CONTEXT_BADGES,
  }
}

function toTodoPrimaryItem(todo: TodoRow, todayIso: string): FocusPrimaryItem {
  return {
    key: `todo:${todo.id}`,
    kind: 'todo',
    sourceId: todo.id,
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
    estimateMinutes: null,
    isBlocked: false,
    waitingFor: null,
    followUpDate: null,
    blockedReason: null,
    nextActionHint: null,
    tags: Array.from(
      new Set([...(todo.explicit_tags || []), ...(todo.inherited_tags || [])].map((entry) => normalizeTagCandidate(entry)).filter(Boolean))
    ),
    related: [],
    links: Array.from(new Set((todo.links || []).map((entry) => normalizeRelatedCandidate(entry)).filter(Boolean))),
    isDone: todo.checked,
    isMit: false,
    canAddToMit: false,
    ...EMPTY_CONTEXT_BADGES,
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
  if (scope === 'tomorrow') {
    return diffDays(todayIso, noteDay) <= 1
  }
  if (scope === 'week') {
    return isIsoInCurrentWeek(noteDay, todayIso)
  }
  return diffDays(todayIso, noteDay) <= 7
}

function withContextBadges(item: FocusPrimaryItem, badgeMap: Map<string, typeof EMPTY_CONTEXT_BADGES>): FocusPrimaryItem {
  const badges = badgeMap.get(item.key) || EMPTY_CONTEXT_BADGES
  return {
    ...item,
    ...badges,
  }
}

function withMitFlags(item: FocusPrimaryItem, mitKeySet: Set<string>, mitCount: number): FocusPrimaryItem {
  const isMit = mitKeySet.has(item.key)
  const canAdd = !isMit && !item.isDone && mitCount < MAX_MIT_ITEMS
  return {
    ...item,
    isMit,
    canAddToMit: canAdd,
  }
}

function buildContextBadgeMap(items: FocusPrimaryItem[], notes: SearchRow[], todayIso: string): Map<string, typeof EMPTY_CONTEXT_BADGES> {
  const map = new Map<string, typeof EMPTY_CONTEXT_BADGES>()
  for (const item of items) {
    if (map.has(item.key)) {
      continue
    }
    const hits = buildFocusContextHits(item, notes, todayIso)
    const reasonSet = new Set(hits.flatMap((hit) => hit.reasons))
    map.set(item.key, {
      contextBadgeCount: hits.length,
      hasOriginNote: reasonSet.has('Ursprung'),
      hasRelatedContext: reasonSet.has('Related'),
      hasTagContext: reasonSet.has('Tag'),
    })
  }
  return map
}

function parseMitRaw(rawMitId: string, taskMap: Map<string, TaskRow>, todoMap: Map<string, TodoRow>): { kind: FocusPrimaryItemKind; id: string } | null {
  const clean = rawMitId.trim()
  if (!clean) {
    return null
  }
  const prefixed = /^(task|todo)\s*:\s*(.+)$/i.exec(clean)
  if (prefixed) {
    const kind = prefixed[1].toLowerCase() as FocusPrimaryItemKind
    const id = prefixed[2]?.trim() || ''
    if (!id) {
      return null
    }
    if (kind === 'task' && taskMap.has(id)) {
      return { kind, id }
    }
    if (kind === 'todo' && todoMap.has(id)) {
      return { kind, id }
    }
    return null
  }
  if (taskMap.has(clean)) {
    return { kind: 'task', id: clean }
  }
  if (todoMap.has(clean)) {
    return { kind: 'todo', id: clean }
  }
  return null
}

function toCanonicalMitId(kind: FocusPrimaryItemKind, id: string): string {
  return `${kind}:${id}`
}

function toNormalizedMitIds(rawMitIds: string[], taskMap: Map<string, TaskRow>, todoMap: Map<string, TodoRow>): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const rawMitId of rawMitIds) {
    const parsed = parseMitRaw(rawMitId, taskMap, todoMap)
    if (!parsed) {
      continue
    }
    const canonical = toCanonicalMitId(parsed.kind, parsed.id)
    const canonicalKey = canonical.toLowerCase()
    if (seen.has(canonicalKey)) {
      continue
    }
    seen.add(canonicalKey)
    normalized.push(canonical)
    if (normalized.length >= MAX_MIT_ITEMS) {
      break
    }
  }
  return normalized
}

function resolveMitItems(
  mitIds: string[],
  taskMap: Map<string, TaskRow>,
  todoMap: Map<string, TodoRow>,
  todayIso: string,
  taskStatusById: Map<string, string>
): FocusPrimaryItem[] {
  const resolved: FocusPrimaryItem[] = []
  for (const mitId of mitIds) {
    const parsed = parseMitRaw(mitId, taskMap, todoMap)
    if (!parsed) {
      continue
    }
    if (parsed.kind === 'task') {
      const task = taskMap.get(parsed.id)
      if (task) {
        resolved.push(toTaskPrimaryItem(task, todayIso, taskStatusById))
      }
      continue
    }
    const todo = todoMap.get(parsed.id)
    if (todo) {
      resolved.push(toTodoPrimaryItem(todo, todayIso))
    }
  }
  return resolved
}

function toFocusSplitCount(maxItems: number): number {
  const heuristic = Math.round(maxItems * 0.45)
  return Math.max(5, Math.min(8, heuristic))
}

export function buildFocusDashboardData(args: {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  filters: FocusDashboardFilters
  todayIso: string
  mitIds: string[]
}): FocusDashboardData {
  const { tasks, todos, notes, filters, todayIso, mitIds } = args
  const { includeTasks, includeTodos, includeNotes } = toSectionFlags(filters)
  const maxItems = normalizeMaxItems(filters.maxItems)
  const openTasks = tasks.filter((task) => normalizeTaskStatusValue(task.status) !== 'done')
  const openTodos = todos.filter((todo) => !todo.checked)
  const taskStatusById = new Map(tasks.map((task) => [task.id, task.status]))
  const taskMapForMit = new Map(tasks.map((task) => [task.id, task]))
  const todoMapForMit = new Map(todos.map((todo) => [todo.id, todo]))
  const normalizedMitIds = toNormalizedMitIds(mitIds, taskMapForMit, todoMapForMit)
  const mitItemsRaw = resolveMitItems(normalizedMitIds, taskMapForMit, todoMapForMit, todayIso, taskStatusById)
  const mitKeySet = new Set(mitItemsRaw.map((item) => item.key))

  const filteredOpenTasks = includeTasks ? openTasks.filter((task) => textMatchesQuery(toTaskQueryText(task), filters.query)) : []

  const overdueItemsRaw = includeTasks
    ? filteredOpenTasks
        .filter((task) => isOverdueTask(task, todayIso))
        .map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById))
        .sort((left, right) => {
          if ((left.dueDate || '') !== (right.dueDate || '')) {
            return (left.dueDate || '').localeCompare(right.dueDate || '')
          }
          if (left.score !== right.score) {
            return right.score - left.score
          }
          return sortByRecency(left, right)
        })
        .slice(0, MAX_OVERDUE_ITEMS)
    : []
  const overdueKeySet = new Set(overdueItemsRaw.map((item) => item.key))

  const scopedTasks = includeTasks
    ? filteredOpenTasks
        .filter((task) => isTaskInScope(task, filters.scope, todayIso))
    : []
  const scopedTodos = includeTodos
    ? openTodos
        .filter((todo) => isTodoInScope(todo, filters.scope, todayIso))
        .filter((todo) => textMatchesQuery(toTodoQueryText(todo), filters.query))
    : []

  const rankedItemsRaw = [...scopedTasks.map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById)), ...scopedTodos.map((todo) => toTodoPrimaryItem(todo, todayIso))].sort(
    (left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return sortByRecency(left, right)
    }
  )

  const remainingRanked = rankedItemsRaw.filter((item) => !mitKeySet.has(item.key) && !overdueKeySet.has(item.key))
  const preferredRanked = remainingRanked.filter((item) => item.kind !== 'task' || !item.isBlocked || item.followUpDate === todayIso)
  const deferredRanked = remainingRanked.filter((item) => !(item.kind !== 'task' || !item.isBlocked || item.followUpDate === todayIso))
  const stitchedRanked = [...preferredRanked, ...deferredRanked]
  const focusCount = Math.min(maxItems, toFocusSplitCount(maxItems))
  const focusItemsRaw = stitchedRanked.slice(0, focusCount)
  const candidateItemsRaw = stitchedRanked.slice(focusItemsRaw.length, maxItems)
  const primaryItemsRaw = [...focusItemsRaw, ...candidateItemsRaw]

  const blockingPool = filteredOpenTasks.map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById))
  const blockedItemsRaw = blockingPool.filter((item) => item.isBlocked).sort((left, right) => {
    if (left.followUpDate !== right.followUpDate) {
      return (left.followUpDate || '9999-12-31').localeCompare(right.followUpDate || '9999-12-31')
    }
    if (left.score !== right.score) {
      return right.score - left.score
    }
    return sortByRecency(left, right)
  }).slice(0, MAX_BLOCKING_ITEMS)
  const waitingItemsRaw = blockedItemsRaw.filter((item) => Boolean(item.waitingFor)).slice(0, MAX_BLOCKING_ITEMS)
  const followUpTodayItemsRaw = waitingItemsRaw.filter((item) => item.followUpDate === todayIso).slice(0, MAX_BLOCKING_ITEMS)

  const contextBadgeMap = buildContextBadgeMap(
    [...mitItemsRaw, ...overdueItemsRaw, ...blockedItemsRaw, ...waitingItemsRaw, ...followUpTodayItemsRaw, ...focusItemsRaw, ...candidateItemsRaw],
    notes,
    todayIso
  )
  const mitItems = mitItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const overdueItems = overdueItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const blockedItems = blockedItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const waitingItems = waitingItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const followUpTodayItems = followUpTodayItemsRaw.map((item) =>
    withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length)
  )
  const focusItems = focusItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const candidateItems = candidateItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))
  const primaryItems = primaryItemsRaw.map((item) => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length))

  const dueTodayTaskCount = openTasks.filter((task) => toTaskDueIso(task.due_date) === todayIso).length
  const inProgressTaskCount = openTasks.filter((task) => normalizeTaskStatusValue(task.status) === 'in_progress').length
  const blockedTaskCount = blockingPool.filter((item) => item.isBlocked).length
  const waitingTaskCount = blockingPool.filter((item) => Boolean(item.waitingFor)).length
  const followUpTodayCount = blockingPool.filter((item) => Boolean(item.waitingFor) && item.followUpDate === todayIso).length

  const relevantEstimatedTasks = new Map<string, number>()
  for (const item of [...mitItemsRaw, ...overdueItemsRaw, ...focusItemsRaw]) {
    if (item.kind !== 'task' || item.estimateMinutes === null) {
      continue
    }
    relevantEstimatedTasks.set(item.key, item.estimateMinutes)
  }
  const todayEstimatedMinutes = Array.from(relevantEstimatedTasks.values()).reduce((sum, minutes) => sum + minutes, 0)

  const notesWithQuery = includeNotes ? notes.filter((note) => textMatchesQuery(toNoteSearchText(note), filters.query)) : []
  const notesToday = notesWithQuery
    .filter((note) => toUpdatedDay(note.updated_at) === todayIso)
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, maxItems)
  const recentNotes = notesWithQuery
    .filter((note) => matchesNoteScope(note, filters.scope, todayIso))
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, Math.max(maxItems, 8))

  // Until `completed_at` exists, "done today" is approximated by `updated_at` for done tasks/todos.
  const doneTodayTasks = tasks.filter((task) => normalizeTaskStatusValue(task.status) === 'done' && toUpdatedDay(task.updated_at) === todayIso).length
  const doneTodayTodos = todos.filter((todo) => todo.checked && toUpdatedDay(todo.updated_at) === todayIso).length

  return {
    selectedScope: filters.scope,
    openTaskCount: openTasks.length,
    inProgressTaskCount,
    dueTodayTaskCount,
    openTodoCount: openTodos.length,
    notesTodayCount: notesToday.length,
    doneToday: doneTodayTasks + doneTodayTodos,
    doneTodayTasks,
    doneTodayTodos,
    blockedTaskCount,
    waitingTaskCount,
    followUpTodayCount,
    todayEstimatedMinutes,
    todayDailyNote: includeNotes ? findDailyNote(notesWithQuery, todayIso) : null,
    mitIds: normalizedMitIds,
    mitItems,
    overdueItems,
    blockedItems,
    waitingItems,
    followUpTodayItems,
    focusItems,
    candidateItems,
    primaryItems,
    notesToday,
    recentNotes,
    dailyTrailItems: includeNotes ? toDailyTrailItems(notesWithQuery, todayIso, 5) : [],
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

    if (
      item.tags.some((tag) => {
        const normalized = normalizeTagCandidate(tag)
        const [, tail = normalized] = normalized.split(':', 2)
        return Boolean(tail) && noteSearchText.includes(tail)
      })
    ) {
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

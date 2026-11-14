import {localCalendarDay} from '../shared/dates'
import {
  normalizeFilePathKey,
  normalizeRelatedCandidate,
  normalizeTagCandidate,
  DEFAULT_TASK_FEATURE_SETTINGS,
  type FocusDashboardMode,
  normalizeTaskPriorityValue,
  normalizeTaskStatusValue,
  type FocusDashboardAggregateStats,
  type FocusDashboardFilters,
  type SearchRow,
  type TaskRow,
  type TaskFeatureSettings,
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
  hasTaskBlocker: boolean
  hasExternalWaiting: boolean
  unknownBlockerCount: number
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

export type FocusCapacityStatus = 'light' | 'balanced' | 'heavy' | 'overloaded'

export type FocusNextActionItem = {
  item: FocusPrimaryItem
  reasons: string[]
}

export type FocusMitSuggestion = {
  item: FocusPrimaryItem
  reasons: string[]
}

export type FocusPlanningHints = {
  focusWithoutEstimateCount: number
  mitWithoutEstimateCount: number
  waitingWithoutFollowUpCount: number
  unknownBlockerTaskCount: number
  unknownBlockerReferenceCount: number
}

export type FocusDashboardData = {
  selectedScope: FocusDashboardFilters['scope']
  focusMode: FocusDashboardMode
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
  estimatedLoadTodayMinutes: number
  estimatedMitMinutes: number
  estimatedFocusMinutes: number
  capacityStatus: FocusCapacityStatus
  capacityMessage: string
  todayEstimatedMinutes: number
  mitEstimatedMinutes: number
  focusEstimatedMinutes: number
  withoutEstimateCount: number
  planningHints: FocusPlanningHints
  todayDailyNote: SearchRow | null
  mitIds: string[]
  mitItems: FocusPrimaryItem[]
  suggestedMitItems: FocusMitSuggestion[]
  overdueItems: FocusPrimaryItem[]
  blockedItems: FocusPrimaryItem[]
  waitingItems: FocusPrimaryItem[]
  followUpTodayItems: FocusPrimaryItem[]
  nextActionItems: FocusNextActionItem[]
  focusItems: FocusPrimaryItem[]
  candidateItems: FocusPrimaryItem[]
  primaryItems: FocusPrimaryItem[]
  notesToday: SearchRow[]
  recentNotes: SearchRow[]
  dailyTrailItems: FocusDailyTrailItem[]
}

const WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9_-]{2,}/g
const LETTER_PATTERN = /[a-z]/
const GENERIC_CONTEXT_WORDS = new Set([
  'task',
  'tasks',
  'todo',
  'todos',
  'note',
  'notes',
  'notiz',
  'notizen',
  'daily',
  'overview',
  'update',
  'status',
  'projekt',
  'project',
  'projekte',
  'projects',
  'thema',
  'themen',
  'topic',
  'topics',
  'arbeit',
  'offen',
  'open',
  'done',
  'inbox',
  'capture',
  'captures',
  'tag',
  'tags',
  'kunden',
  'customer',
  'customers',
])
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

type FocusScoreConfig = {
  taskBase: {
    priority: {
      high: number
      medium: number
      low: number
    }
    status: {
      inProgress: number
      open: number
      newTopic: number
      fallback: number
    }
    due: {
      overdue: number
      today: number
      tomorrow: number
      thisWeek: number
      later: number
    }
    recency: {
      today: number
      recent: number
      week: number
    }
    estimate: {
      quick: number
      short: number
      medium: number
      veryLargePenalty: number
    }
    nextActionBonus: number
    blockedPenalty: number
    blockedFollowUpPenalty: number
    waitingPenalty: number
    waitingFollowUpBonus: number
  }
  todoBase: {
    promoted: number
    inboxLike: number
    recency: {
      today: number
      recent: number
      week: number
    }
    linkBonus: number
  }
  modeAdjustments: Record<
    FocusDashboardMode,
    {
      mitBonus: number
      blockedPenalty: number
      unblockedBonus: number
      waitingPenalty: number
      waitingBonus: number
      followUpDueBonus: number
      nextActionBonus: number
      inProgressBonus: number
      quickEstimateBonus: number
      shortEstimateBonus: number
      mediumEstimateBonus: number
      largeEstimatePenalty: number
      overdueBonus: number
      todayBonus: number
      tomorrowBonus: number
      weekBonus: number
      taskBlockerBonus: number
      externalWaitingBonus: number
      contextPerHit: number
      contextCap: number
      originContextBonus: number
      relatedContextBonus: number
      tagContextBonus: number
      noContextPenalty: number
      neutralPenalty: number
    }
  >
  focusSplit: Record<
    FocusDashboardMode,
    {
      ratio: number
      min: number
      max: number
    }
  >
  nextAction: {
    maxItems: number
    mitBonus: number
    focusOriginBonus: number
    candidateOriginBonus: number
    overdueOriginBonus: number
    executionModeBonus: number
    planningModeBonus: number
    rescueModeBonus: number
    contextModeBonus: number
    blockedPenalty: number
    waitingWithoutFollowUpPenalty: number
    followUpDueBonus: number
    overdueBonus: number
    todayBonus: number
    inProgressBonus: number
    nextActionBonus: number
    quickEstimateBonus: number
    shortEstimateBonus: number
    mediumEstimateBonus: number
    largeEstimatePenalty: number
    unblockedBonus: number
  }
  mitSuggestion: {
    maxSuggestions: number
    highPriorityBonus: number
    mediumPriorityBonus: number
    overdueBonus: number
    todayBonus: number
    tomorrowBonus: number
    inProgressBonus: number
    nextActionBonus: number
    contextPerHit: number
    contextCap: number
    quickEstimateBonus: number
    shortEstimateBonus: number
    mediumEstimateBonus: number
    largeEstimateWithoutActionPenalty: number
    blockedPenalty: number
    waitingWithoutFollowUpPenalty: number
    focusOriginBonus: number
    candidateOriginBonus: number
    executionModeBonus: number
    planningModeBonus: number
    rescueModeBonus: number
    contextModeBonus: number
  }
  capacity: {
    lightMaxMinutes: number
    balancedMaxMinutes: number
    heavyMaxMinutes: number
    uncertaintyPerMissingEstimate: number
    blockedPenalty: number
    unknownBlockerPenalty: number
  }
}

// Centralized scoring configuration.
export const focusScoringConfig: FocusScoreConfig = {
  taskBase: {
    priority: { high: 55, medium: 34, low: 18 },
    status: { inProgress: 24, open: 15, newTopic: 11, fallback: 7 },
    due: { overdue: 35, today: 28, tomorrow: 20, thisWeek: 12, later: 6 },
    recency: { today: 8, recent: 5, week: 2 },
    estimate: { quick: 6, short: 4, medium: 2, veryLargePenalty: 2 },
    nextActionBonus: 4,
    blockedPenalty: 12,
    blockedFollowUpPenalty: 2,
    waitingPenalty: 4,
    waitingFollowUpBonus: 2,
  },
  todoBase: {
    promoted: 26,
    inboxLike: 34,
    recency: { today: 10, recent: 6, week: 3 },
    linkBonus: 4,
  },
  modeAdjustments: {
    execution: {
      mitBonus: 16,
      blockedPenalty: 12,
      unblockedBonus: 10,
      waitingPenalty: 8,
      waitingBonus: 0,
      followUpDueBonus: 0,
      nextActionBonus: 8,
      inProgressBonus: 7,
      quickEstimateBonus: 7,
      shortEstimateBonus: 5,
      mediumEstimateBonus: 2,
      largeEstimatePenalty: 2,
      overdueBonus: 9,
      todayBonus: 7,
      tomorrowBonus: 0,
      weekBonus: 0,
      taskBlockerBonus: 0,
      externalWaitingBonus: 0,
      contextPerHit: 0,
      contextCap: 0,
      originContextBonus: 0,
      relatedContextBonus: 0,
      tagContextBonus: 0,
      noContextPenalty: 0,
      neutralPenalty: 0,
    },
    planning: {
      mitBonus: 10,
      blockedPenalty: 3,
      unblockedBonus: 0,
      waitingPenalty: 0,
      waitingBonus: 2,
      followUpDueBonus: 6,
      nextActionBonus: 0,
      inProgressBonus: 0,
      quickEstimateBonus: 0,
      shortEstimateBonus: 0,
      mediumEstimateBonus: 4,
      largeEstimatePenalty: 0,
      overdueBonus: 7,
      todayBonus: 9,
      tomorrowBonus: 7,
      weekBonus: 5,
      taskBlockerBonus: 0,
      externalWaitingBonus: 0,
      contextPerHit: 0,
      contextCap: 0,
      originContextBonus: 0,
      relatedContextBonus: 0,
      tagContextBonus: 0,
      noContextPenalty: 0,
      neutralPenalty: 0,
    },
    rescue: {
      mitBonus: 0,
      blockedPenalty: 13,
      unblockedBonus: 0,
      waitingPenalty: 0,
      waitingBonus: 0,
      followUpDueBonus: 10,
      nextActionBonus: 0,
      inProgressBonus: 0,
      quickEstimateBonus: 0,
      shortEstimateBonus: 0,
      mediumEstimateBonus: 0,
      largeEstimatePenalty: 0,
      overdueBonus: 14,
      todayBonus: 0,
      tomorrowBonus: 0,
      weekBonus: 0,
      taskBlockerBonus: 7,
      externalWaitingBonus: 8,
      contextPerHit: 0,
      contextCap: 0,
      originContextBonus: 0,
      relatedContextBonus: 0,
      tagContextBonus: 0,
      noContextPenalty: 0,
      neutralPenalty: 5,
    },
    context: {
      mitBonus: 0,
      blockedPenalty: 0,
      unblockedBonus: 0,
      waitingPenalty: 0,
      waitingBonus: 0,
      followUpDueBonus: 0,
      nextActionBonus: 2,
      inProgressBonus: 0,
      quickEstimateBonus: 0,
      shortEstimateBonus: 0,
      mediumEstimateBonus: 0,
      largeEstimatePenalty: 0,
      overdueBonus: 0,
      todayBonus: 0,
      tomorrowBonus: 0,
      weekBonus: 0,
      taskBlockerBonus: 0,
      externalWaitingBonus: 0,
      contextPerHit: 3,
      contextCap: 20,
      originContextBonus: 6,
      relatedContextBonus: 7,
      tagContextBonus: 4,
      noContextPenalty: 4,
      neutralPenalty: 0,
    },
  },
  focusSplit: {
    execution: { ratio: 0.45, min: 5, max: 8 },
    planning: { ratio: 0.58, min: 6, max: 10 },
    rescue: { ratio: 0.5, min: 4, max: 7 },
    context: { ratio: 0.4, min: 3, max: 6 },
  },
  nextAction: {
    maxItems: 3,
    mitBonus: 14,
    focusOriginBonus: 8,
    candidateOriginBonus: 2,
    overdueOriginBonus: 5,
    executionModeBonus: 6,
    planningModeBonus: 3,
    rescueModeBonus: 2,
    contextModeBonus: 2,
    blockedPenalty: 100,
    waitingWithoutFollowUpPenalty: 20,
    followUpDueBonus: 6,
    overdueBonus: 11,
    todayBonus: 9,
    inProgressBonus: 6,
    nextActionBonus: 10,
    quickEstimateBonus: 7,
    shortEstimateBonus: 5,
    mediumEstimateBonus: 2,
    largeEstimatePenalty: 3,
    unblockedBonus: 4,
  },
  mitSuggestion: {
    maxSuggestions: 3,
    highPriorityBonus: 8,
    mediumPriorityBonus: 4,
    overdueBonus: 12,
    todayBonus: 10,
    tomorrowBonus: 5,
    inProgressBonus: 6,
    nextActionBonus: 7,
    contextPerHit: 2,
    contextCap: 10,
    quickEstimateBonus: 6,
    shortEstimateBonus: 4,
    mediumEstimateBonus: 2,
    largeEstimateWithoutActionPenalty: 6,
    blockedPenalty: 24,
    waitingWithoutFollowUpPenalty: 14,
    focusOriginBonus: 7,
    candidateOriginBonus: 2,
    executionModeBonus: 5,
    planningModeBonus: 4,
    rescueModeBonus: 1,
    contextModeBonus: 3,
  },
  capacity: {
    lightMaxMinutes: 150,
    balancedMaxMinutes: 280,
    heavyMaxMinutes: 420,
    uncertaintyPerMissingEstimate: 18,
    blockedPenalty: 8,
    unknownBlockerPenalty: 6,
  },
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
  return localCalendarDay(value)
}

function toCompletedDay(value: string | null | undefined): string {
  return localCalendarDay(value)
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
  return Array.from(
    new Set(
      matches.filter((word) => {
        const clean = word.trim()
        if (!clean) {
          return false
        }
        // Ignore tokens that are mostly structural/generic and tend to create noisy context matches.
        if (GENERIC_CONTEXT_WORDS.has(clean)) {
          return false
        }
        // Ignore number-only tokens (dates/ids) to avoid accidental broad matches.
        if (!LETTER_PATTERN.test(clean)) {
          return false
        }
        return true
      })
    )
  )
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
  return normalized.includes('/daily/') || /\/\d+_daily\//.test(normalized)
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

function toTaskQueryText(task: TaskRow, taskFeatures: TaskFeatureSettings): string {
  const parts: string[] = [task.title, task.id, task.status, task.priority, task.due_date || '']
  if (taskFeatures.taskTimeManagement) {
    parts.push(String(task.estimate_minutes ?? ''))
  }
  if (taskFeatures.advancedTaskHandling) {
    parts.push(...(task.blocked_by_ids || []))
    parts.push(task.waiting_for || '')
    parts.push(task.follow_up_date || '')
    parts.push(task.blocked_reason || '')
    parts.push(task.next_action_hint || '')
  }
  parts.push(...(task.tags || []))
  parts.push(...(task.related || []))
  parts.push(task.path || '')
  return parts.join(' ').toLowerCase()
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
  unknownBlockerCount: number
  hasTaskBlocker: boolean
  hasExternalWaiting: boolean
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

function toTaskExecutionSignals(
  task: TaskRow,
  taskStatusById: Map<string, string>,
  todayIso: string,
  taskFeatures: TaskFeatureSettings
): TaskExecutionSignals {
  const estimateMinutes = taskFeatures.taskTimeManagement ? normalizeEstimateMinutes(task.estimate_minutes) : null
  const blockedByIds = taskFeatures.advancedTaskHandling ? normalizeTaskIdList(task.blocked_by_ids) : []
  const waitingFor = taskFeatures.advancedTaskHandling ? normalizeOptionalText(task.waiting_for) : null
  const followUpDate = taskFeatures.advancedTaskHandling ? toTaskDueIso(task.follow_up_date || null) : null
  let unknownBlockerCount = 0
  let unresolvedDependencyCount = 0
  for (const blockerId of blockedByIds) {
    const blockerStatus = taskStatusById.get(blockerId)
    if (!blockerStatus) {
      // Unknown blocker ids are treated defensively as unresolved blockers.
      unknownBlockerCount += 1
      unresolvedDependencyCount += 1
      continue
    }
    if (normalizeTaskStatusValue(blockerStatus) !== 'done') {
      unresolvedDependencyCount += 1
    }
  }
  const blockedByDependencies = taskFeatures.advancedTaskHandling && unresolvedDependencyCount > 0
  const followUpToday = Boolean(followUpDate) && followUpDate === todayIso
  const normalizedStatus = normalizeTaskStatusValue(task.status)
  const hasExternalWaiting = taskFeatures.advancedTaskHandling && Boolean(waitingFor) && normalizedStatus !== 'done'
  const isBlocked = taskFeatures.advancedTaskHandling && normalizedStatus !== 'done' && (blockedByDependencies || hasExternalWaiting)

  return {
    estimateMinutes,
    waitingFor,
    followUpDate: followUpDate || null,
    blockedReason: taskFeatures.advancedTaskHandling ? normalizeOptionalText(task.blocked_reason) : null,
    nextActionHint: taskFeatures.advancedTaskHandling ? normalizeOptionalText(task.next_action_hint) : null,
    blockedByIds,
    unknownBlockerCount,
    hasTaskBlocker: blockedByDependencies,
    hasExternalWaiting,
    blockedByDependencies,
    followUpToday,
    isBlocked,
  }
}

function taskFocusScore(task: TaskRow, todayIso: string, signals: TaskExecutionSignals): number {
  const config = focusScoringConfig.taskBase
  const priority = normalizeTaskPriorityValue(task.priority)
  const status = normalizeTaskStatusValue(task.status)
  const dueBucket = toTaskDueBucket(task.due_date, todayIso)
  const dueIso = toTaskDueIso(task.due_date)
  let score = 0
  score += priority === 'high' ? config.priority.high : priority === 'medium' ? config.priority.medium : config.priority.low
  score += status === 'in_progress' ? config.status.inProgress : status === 'open' ? config.status.open : status === 'new_topic' ? config.status.newTopic : config.status.fallback
  score +=
    dueBucket === 'overdue'
      ? config.due.overdue
      : dueIso === todayIso
        ? config.due.today
        : dueBucket === 'tomorrow'
          ? config.due.tomorrow
          : dueBucket === 'this_week'
            ? config.due.thisWeek
            : config.due.later
  const updatedDay = toUpdatedDay(task.updated_at)
  const age = diffDays(todayIso, updatedDay)
  if (age <= 0) {
    score += config.recency.today
  } else if (age <= 2) {
    score += config.recency.recent
  } else if (age <= 6) {
    score += config.recency.week
  }

  if (signals.estimateMinutes !== null) {
    if (signals.estimateMinutes <= 15) {
      score += config.estimate.quick
    } else if (signals.estimateMinutes <= 30) {
      score += config.estimate.short
    } else if (signals.estimateMinutes <= 60) {
      score += config.estimate.medium
    } else if (signals.estimateMinutes >= 240) {
      score -= config.estimate.veryLargePenalty
    }
  }

  if (signals.nextActionHint) {
    score += config.nextActionBonus
  }

  if (signals.isBlocked) {
    // Blocked work should still stay visible, but be deprioritized for execution.
    score -= signals.followUpToday ? config.blockedFollowUpPenalty : config.blockedPenalty
  }
  if (signals.waitingFor && !signals.followUpToday) {
    score -= config.waitingPenalty
  }
  if (signals.waitingFor && signals.followUpToday) {
    score += config.waitingFollowUpBonus
  }

  return score
}

function todoFocusScore(todo: TodoRow, todayIso: string): number {
  const config = focusScoringConfig.todoBase
  let score = todo.promoted ? config.promoted : config.inboxLike
  const updatedDay = toUpdatedDay(todo.updated_at)
  const age = diffDays(todayIso, updatedDay)
  if (age <= 0) {
    score += config.recency.today
  } else if (age <= 2) {
    score += config.recency.recent
  } else if (age <= 6) {
    score += config.recency.week
  }
  if (todo.links.length > 0) {
    score += config.linkBonus
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
  const combined = [...dailyNotes].sort((left, right) => sortDailyTrailNotes(left, right))
  const seen = new Set<string>()
  const trail: FocusDailyTrailItem[] = []
  for (const note of combined) {
    if (!toDailyIsoCandidate(note)) {
      continue
    }
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
    if (trail.length >= Math.max(0, maxRecentItems)) {
      break
    }
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

function toTaskPrimaryItem(
  task: TaskRow,
  todayIso: string,
  taskStatusById: Map<string, string>,
  taskFeatures: TaskFeatureSettings
): FocusPrimaryItem {
  const normalizedStatus = normalizeTaskStatusValue(task.status)
  const signals = toTaskExecutionSignals(task, taskStatusById, todayIso, taskFeatures)
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
    hasTaskBlocker: signals.hasTaskBlocker,
    hasExternalWaiting: signals.hasExternalWaiting,
    unknownBlockerCount: signals.unknownBlockerCount,
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
    hasTaskBlocker: false,
    hasExternalWaiting: false,
    unknownBlockerCount: 0,
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

function buildContextBadgeMap(items: FocusPrimaryItem[], notes: SearchRow[]): Map<string, typeof EMPTY_CONTEXT_BADGES> {
  const map = new Map<string, typeof EMPTY_CONTEXT_BADGES>()
  for (const item of items) {
    if (map.has(item.key)) {
      continue
    }
    const hits = buildFocusContextHits(item, notes)
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
  taskStatusById: Map<string, string>,
  taskFeatures: TaskFeatureSettings
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
        resolved.push(toTaskPrimaryItem(task, todayIso, taskStatusById, taskFeatures))
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

function normalizeFocusMode(raw: unknown): FocusDashboardMode {
  return raw === 'execution' || raw === 'planning' || raw === 'rescue' || raw === 'context' ? raw : 'execution'
}

function normalizeTaskFeatureSettings(raw: TaskFeatureSettings | undefined): TaskFeatureSettings {
  const source = raw || DEFAULT_TASK_FEATURE_SETTINGS
  return {
    advancedTaskHandling: Boolean(source.advancedTaskHandling),
    taskTimeManagement: Boolean(source.taskTimeManagement),
  }
}

function hasFollowUpDueNow(item: FocusPrimaryItem, todayIso: string): boolean {
  if (!item.followUpDate || !isValidIsoDate(item.followUpDate)) {
    return false
  }
  return item.followUpDate <= todayIso
}

type FocusDueSignals = {
  dueIso: string | null
  dueDelta: number
  isOverdue: boolean
  dueToday: boolean
  dueTomorrow: boolean
  dueThisWeek: boolean
}

type FocusCandidateOrigin = 'mit' | 'focus' | 'candidate' | 'overdue'

function toDueSignals(item: FocusPrimaryItem, todayIso: string): FocusDueSignals {
  const dueIso = item.dueDate
  const dueDelta = dueIso && isValidIsoDate(dueIso) ? diffDays(dueIso, todayIso) : 999
  return {
    dueIso,
    dueDelta,
    isOverdue: typeof dueIso === 'string' && dueIso < todayIso,
    dueToday: typeof dueIso === 'string' && dueIso === todayIso,
    dueTomorrow: dueDelta === 1,
    dueThisWeek: dueDelta >= 0 && dueDelta <= 7,
  }
}

function isWaitingWithoutFollowUpDueNow(item: FocusPrimaryItem, todayIso: string): boolean {
  return Boolean(item.hasExternalWaiting) && !hasFollowUpDueNow(item, todayIso)
}

function toModeAdjustedScore(item: FocusPrimaryItem, mode: FocusDashboardMode, todayIso: string): number {
  const config = focusScoringConfig.modeAdjustments[mode]
  let score = item.score
  const dueSignals = toDueSignals(item, todayIso)
  const followUpDueNow = hasFollowUpDueNow(item, todayIso)
  const hasContext = item.contextBadgeCount > 0

  if (mode === 'execution') {
    if (item.isMit) {
      score += config.mitBonus
    }
    if (item.isBlocked) {
      score -= config.blockedPenalty
    } else {
      score += config.unblockedBonus
    }
    if (item.waitingFor && !followUpDueNow) {
      score -= config.waitingPenalty
    }
    if (item.nextActionHint) {
      score += config.nextActionBonus
    }
    if (item.status && normalizeTaskStatusValue(item.status) === 'in_progress') {
      score += config.inProgressBonus
    }
    if (item.estimateMinutes !== null) {
      if (item.estimateMinutes <= 15) {
        score += config.quickEstimateBonus
      } else if (item.estimateMinutes <= 30) {
        score += config.shortEstimateBonus
      } else if (item.estimateMinutes <= 60) {
        score += config.mediumEstimateBonus
      } else if (item.estimateMinutes > 120) {
        score -= config.largeEstimatePenalty
      }
    }
    if (dueSignals.isOverdue) {
      score += config.overdueBonus
    } else if (dueSignals.dueToday) {
      score += config.todayBonus
    }
    return score
  }

  if (mode === 'planning') {
    if (item.isMit) {
      score += config.mitBonus
    }
    if (dueSignals.isOverdue) {
      score += config.overdueBonus
    } else if (dueSignals.dueToday) {
      score += config.todayBonus
    } else if (dueSignals.dueTomorrow) {
      score += config.tomorrowBonus
    } else if (dueSignals.dueThisWeek) {
      score += config.weekBonus
    }
    if (item.estimateMinutes !== null) {
      score += config.mediumEstimateBonus
    }
    if (followUpDueNow) {
      score += config.followUpDueBonus
    } else if (item.waitingFor) {
      score += config.waitingBonus
    }
    if (item.isBlocked) {
      score -= config.blockedPenalty
    }
    return score
  }

  if (mode === 'rescue') {
    if (dueSignals.isOverdue) {
      score += config.overdueBonus
    }
    if (item.isBlocked) {
      score += config.blockedPenalty
    }
    if (item.hasTaskBlocker) {
      score += config.taskBlockerBonus
    }
    if (item.hasExternalWaiting) {
      score += config.externalWaitingBonus
    }
    if (followUpDueNow) {
      score += config.followUpDueBonus
    }
    if (!item.isBlocked && !dueSignals.isOverdue && !followUpDueNow) {
      score -= config.neutralPenalty
    }
    return score
  }

  // Context mode emphasizes context-rich items instead of pure urgency.
  score += Math.min(config.contextCap, item.contextBadgeCount * config.contextPerHit)
  if (item.hasOriginNote) {
    score += config.originContextBonus
  }
  if (item.hasRelatedContext) {
    score += config.relatedContextBonus
  }
  if (item.hasTagContext) {
    score += config.tagContextBonus
  }
  if (!hasContext) {
    score -= config.noContextPenalty
  }
  if (item.nextActionHint) {
    score += config.nextActionBonus
  }
  return score
}

function compareByMode(left: FocusPrimaryItem, right: FocusPrimaryItem, mode: FocusDashboardMode, todayIso: string): number {
  const leftScore = toModeAdjustedScore(left, mode, todayIso)
  const rightScore = toModeAdjustedScore(right, mode, todayIso)
  if (leftScore !== rightScore) {
    return rightScore - leftScore
  }
  return sortByRecency(left, right)
}

function toFocusSplitCount(maxItems: number, mode: FocusDashboardMode): number {
  const config = focusScoringConfig.focusSplit[mode]
  const heuristic = Math.round(maxItems * config.ratio)
  return Math.max(config.min, Math.min(config.max, heuristic))
}

function toModeSpecificBonus(mode: FocusDashboardMode, config: { executionModeBonus: number; planningModeBonus: number; rescueModeBonus: number; contextModeBonus: number }): number {
  if (mode === 'execution') {
    return config.executionModeBonus
  }
  if (mode === 'planning') {
    return config.planningModeBonus
  }
  if (mode === 'rescue') {
    return config.rescueModeBonus
  }
  return config.contextModeBonus
}

function toEstimateExecutionScore(minutes: number | null, config: { quickEstimateBonus: number; shortEstimateBonus: number; mediumEstimateBonus: number; largeEstimatePenalty: number }): number {
  if (minutes === null) {
    return 0
  }
  if (minutes <= 30) {
    return config.quickEstimateBonus
  }
  if (minutes <= 60) {
    return config.shortEstimateBonus
  }
  if (minutes <= 90) {
    return config.mediumEstimateBonus
  }
  if (minutes > 120) {
    return -config.largeEstimatePenalty
  }
  return 0
}

function toNextActionScore(item: FocusPrimaryItem, mode: FocusDashboardMode, todayIso: string, origin: FocusCandidateOrigin): number {
  const config = focusScoringConfig.nextAction
  const dueSignals = toDueSignals(item, todayIso)
  const followUpDueNow = hasFollowUpDueNow(item, todayIso)
  let score = toModeAdjustedScore(item, mode, todayIso)

  score += toModeSpecificBonus(mode, config)
  if (origin === 'focus') {
    score += config.focusOriginBonus
  } else if (origin === 'candidate') {
    score += config.candidateOriginBonus
  } else if (origin === 'overdue') {
    score += config.overdueOriginBonus
  }

  if (item.isMit) {
    score += config.mitBonus
  }
  if (item.isBlocked) {
    score -= config.blockedPenalty
  } else {
    score += config.unblockedBonus
  }
  if (isWaitingWithoutFollowUpDueNow(item, todayIso)) {
    score -= config.waitingWithoutFollowUpPenalty
  } else if (item.hasExternalWaiting && followUpDueNow) {
    score += config.followUpDueBonus
  }
  if (dueSignals.isOverdue) {
    score += config.overdueBonus
  } else if (dueSignals.dueToday) {
    score += config.todayBonus
  }
  if (item.status && normalizeTaskStatusValue(item.status) === 'in_progress') {
    score += config.inProgressBonus
  }
  if (item.nextActionHint) {
    score += config.nextActionBonus
  }
  score += toEstimateExecutionScore(item.estimateMinutes, config)
  return score
}

function toNextActionReasons(item: FocusPrimaryItem, todayIso: string): string[] {
  const dueSignals = toDueSignals(item, todayIso)
  const reasons: string[] = []
  if (item.isMit) {
    reasons.push('MIT')
  }
  if (dueSignals.isOverdue) {
    reasons.push('überfällig')
  } else if (dueSignals.dueToday) {
    reasons.push('heute fällig')
  } else if (hasFollowUpDueNow(item, todayIso) && item.hasExternalWaiting) {
    reasons.push('follow-up heute')
  }
  if (item.estimateMinutes !== null) {
    reasons.push(`${item.estimateMinutes}m`)
  }
  if (item.status && normalizeTaskStatusValue(item.status) === 'in_progress') {
    reasons.push('in Arbeit')
  }
  if (item.nextActionHint) {
    reasons.push('klarer Schritt')
  }
  if (!item.isBlocked && !isWaitingWithoutFollowUpDueNow(item, todayIso)) {
    reasons.push('unblockiert')
  }
  if (reasons.length === 0) {
    reasons.push('fokussiert')
  }
  return reasons.slice(0, 4)
}

function buildNextActionItems(args: {
  mitItems: FocusPrimaryItem[]
  focusItems: FocusPrimaryItem[]
  candidateItems: FocusPrimaryItem[]
  overdueItems: FocusPrimaryItem[]
  mode: FocusDashboardMode
  todayIso: string
}): FocusNextActionItem[] {
  const { mitItems, focusItems, candidateItems, overdueItems, mode, todayIso } = args
  const config = focusScoringConfig.nextAction
  const seen = new Set<string>()
  const scored: Array<{ item: FocusPrimaryItem; score: number; reasons: string[] }> = []
  const push = (items: FocusPrimaryItem[], origin: FocusCandidateOrigin) => {
    for (const item of items) {
      if (seen.has(item.key) || item.kind !== 'task' || item.isDone) {
        continue
      }
      seen.add(item.key)
      if (item.isBlocked || isWaitingWithoutFollowUpDueNow(item, todayIso)) {
        continue
      }
      scored.push({
        item,
        score: toNextActionScore(item, mode, todayIso, origin),
        reasons: toNextActionReasons(item, todayIso),
      })
    }
  }
  push(mitItems, 'mit')
  push(focusItems, 'focus')
  push(overdueItems, 'overdue')
  push(candidateItems, 'candidate')

  return scored
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return sortByRecency(left.item, right.item)
    })
    .slice(0, config.maxItems)
    .map((entry) => ({ item: entry.item, reasons: entry.reasons }))
}

function toMitSuggestionScore(item: FocusPrimaryItem, mode: FocusDashboardMode, todayIso: string, origin: FocusCandidateOrigin): number {
  const config = focusScoringConfig.mitSuggestion
  const dueSignals = toDueSignals(item, todayIso)
  let score = toModeAdjustedScore(item, mode, todayIso)
  if (origin === 'focus') {
    score += config.focusOriginBonus
  } else if (origin === 'candidate') {
    score += config.candidateOriginBonus
  }
  score += toModeSpecificBonus(mode, {
    executionModeBonus: config.executionModeBonus,
    planningModeBonus: config.planningModeBonus,
    rescueModeBonus: config.rescueModeBonus,
    contextModeBonus: config.contextModeBonus,
  })
  if (item.kind === 'task') {
    const priority = normalizeTaskPriorityValue(item.priority || 'medium')
    if (priority === 'high') {
      score += config.highPriorityBonus
    } else if (priority === 'medium') {
      score += config.mediumPriorityBonus
    }
    if (dueSignals.isOverdue) {
      score += config.overdueBonus
    } else if (dueSignals.dueToday) {
      score += config.todayBonus
    } else if (dueSignals.dueTomorrow) {
      score += config.tomorrowBonus
    }
    if (item.status && normalizeTaskStatusValue(item.status) === 'in_progress') {
      score += config.inProgressBonus
    }
    if (item.nextActionHint) {
      score += config.nextActionBonus
    }
    score += Math.min(config.contextCap, item.contextBadgeCount * config.contextPerHit)
    if (item.estimateMinutes !== null) {
      if (item.estimateMinutes <= 30) {
        score += config.quickEstimateBonus
      } else if (item.estimateMinutes <= 60) {
        score += config.shortEstimateBonus
      } else if (item.estimateMinutes <= 90) {
        score += config.mediumEstimateBonus
      } else if (item.estimateMinutes > 180 && !item.nextActionHint) {
        score -= config.largeEstimateWithoutActionPenalty
      }
    }
    if (item.isBlocked) {
      score -= config.blockedPenalty
    }
    if (isWaitingWithoutFollowUpDueNow(item, todayIso)) {
      score -= config.waitingWithoutFollowUpPenalty
    }
  }
  return score
}

function toMitSuggestionReasons(item: FocusPrimaryItem, todayIso: string, includeReasonHints: boolean): string[] {
  if (!includeReasonHints) {
    return []
  }
  const dueSignals = toDueSignals(item, todayIso)
  const reasons: string[] = []
  if (item.kind === 'task') {
    const priority = normalizeTaskPriorityValue(item.priority || 'medium')
    if (priority === 'high') {
      reasons.push('hohe Priorität')
    }
  }
  if (dueSignals.isOverdue) {
    reasons.push('überfällig')
  } else if (dueSignals.dueToday) {
    reasons.push('heute fällig')
  }
  if (item.estimateMinutes !== null) {
    reasons.push(`${item.estimateMinutes}m`)
  }
  if (item.nextActionHint) {
    reasons.push('klarer Schritt')
  }
  if (!item.isBlocked && !isWaitingWithoutFollowUpDueNow(item, todayIso)) {
    reasons.push('machbar')
  }
  if (reasons.length === 0) {
    reasons.push('fokusrelevant')
  }
  return reasons.slice(0, 3)
}

function buildSuggestedMitItems(args: {
  mitItems: FocusPrimaryItem[]
  focusItems: FocusPrimaryItem[]
  candidateItems: FocusPrimaryItem[]
  overdueItems: FocusPrimaryItem[]
  mode: FocusDashboardMode
  todayIso: string
  includeReasonHints: boolean
}): FocusMitSuggestion[] {
  const { mitItems, focusItems, candidateItems, overdueItems, mode, todayIso, includeReasonHints } = args
  const config = focusScoringConfig.mitSuggestion
  const remainingSlots = Math.max(0, MAX_MIT_ITEMS - mitItems.length)
  if (remainingSlots <= 0) {
    return []
  }
  const seen = new Set<string>(mitItems.map((item) => item.key))
  const scored: Array<{ item: FocusPrimaryItem; score: number; reasons: string[] }> = []
  const push = (items: FocusPrimaryItem[], origin: FocusCandidateOrigin) => {
    for (const item of items) {
      if (seen.has(item.key) || item.isDone || item.isBlocked || isWaitingWithoutFollowUpDueNow(item, todayIso)) {
        continue
      }
      seen.add(item.key)
      scored.push({
        item,
        score: toMitSuggestionScore(item, mode, todayIso, origin),
        reasons: toMitSuggestionReasons(item, todayIso, includeReasonHints),
      })
    }
  }
  push(overdueItems, 'overdue')
  push(focusItems, 'focus')
  push(candidateItems, 'candidate')

  return scored
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return sortByRecency(left.item, right.item)
    })
    .slice(0, Math.min(config.maxSuggestions, remainingSlots))
    .map((entry) => ({ item: entry.item, reasons: entry.reasons }))
}

function toPlanningHints(args: {
  mitItems: FocusPrimaryItem[]
  focusItems: FocusPrimaryItem[]
  blockingPool: FocusPrimaryItem[]
  taskFeatures: TaskFeatureSettings
}): FocusPlanningHints {
  const { mitItems, focusItems, blockingPool, taskFeatures } = args
  const waitingWithoutFollowUpCount = taskFeatures.advancedTaskHandling
    ? blockingPool.filter((item) => item.hasExternalWaiting && !item.followUpDate).length
    : 0
  const unknownBlockerItems = taskFeatures.advancedTaskHandling ? blockingPool.filter((item) => item.unknownBlockerCount > 0) : []
  return {
    focusWithoutEstimateCount: taskFeatures.taskTimeManagement ? countWithoutEstimate(focusItems) : 0,
    mitWithoutEstimateCount: taskFeatures.taskTimeManagement ? countWithoutEstimate(mitItems) : 0,
    waitingWithoutFollowUpCount,
    unknownBlockerTaskCount: unknownBlockerItems.length,
    unknownBlockerReferenceCount: unknownBlockerItems.reduce((sum, item) => sum + item.unknownBlockerCount, 0),
  }
}

function toCapacitySummary(args: {
  estimatedMitMinutes: number
  estimatedFocusMinutes: number
  withoutEstimateCount: number
  blockedTaskCount: number
  unknownBlockerReferenceCount: number
}): { estimatedLoadTodayMinutes: number; capacityStatus: FocusCapacityStatus; capacityMessage: string } {
  const { estimatedMitMinutes, estimatedFocusMinutes, withoutEstimateCount, blockedTaskCount, unknownBlockerReferenceCount } = args
  const config = focusScoringConfig.capacity
  const estimatedLoadTodayMinutes = Math.max(0, estimatedMitMinutes + estimatedFocusMinutes)
  // Missing estimates and blockers increase uncertainty in the plan.
  const uncertaintyLoad =
    withoutEstimateCount * config.uncertaintyPerMissingEstimate +
    blockedTaskCount * config.blockedPenalty +
    unknownBlockerReferenceCount * config.unknownBlockerPenalty
  const effectiveLoad = estimatedLoadTodayMinutes + uncertaintyLoad

  let capacityStatus: FocusCapacityStatus
  if (effectiveLoad <= config.lightMaxMinutes) {
    capacityStatus = 'light'
  } else if (effectiveLoad <= config.balancedMaxMinutes) {
    capacityStatus = 'balanced'
  } else if (effectiveLoad <= config.heavyMaxMinutes) {
    capacityStatus = 'heavy'
  } else {
    capacityStatus = 'overloaded'
  }

  const capacityMessage =
    capacityStatus === 'light'
      ? 'Heute gut machbar.'
      : capacityStatus === 'balanced'
        ? 'Heute gut ausbalanciert.'
        : capacityStatus === 'heavy'
          ? 'Heute eher voll.'
          : 'Heute überladen - Fokus schärfen.'
  return { estimatedLoadTodayMinutes, capacityStatus, capacityMessage }
}

function sumEstimatedMinutes(items: FocusPrimaryItem[]): number {
  let total = 0
  for (const item of items) {
    if (item.kind !== 'task' || item.estimateMinutes === null) {
      continue
    }
    total += item.estimateMinutes
  }
  return total
}

function countWithoutEstimate(items: FocusPrimaryItem[]): number {
  const seen = new Set<string>()
  let total = 0
  for (const item of items) {
    if (item.kind !== 'task' || item.isDone || seen.has(item.key)) {
      continue
    }
    seen.add(item.key)
    if (item.estimateMinutes === null) {
      total += 1
    }
  }
  return total
}

function dedupeFocusItems(items: FocusPrimaryItem[]): FocusPrimaryItem[] {
  const seen = new Set<string>()
  const deduped: FocusPrimaryItem[] = []
  for (const item of items) {
    if (seen.has(item.key)) {
      continue
    }
    seen.add(item.key)
    deduped.push(item)
  }
  return deduped
}

export function buildFocusDashboardData(args: {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  filters: FocusDashboardFilters
  todayIso: string
  mitIds: string[]
  focusStats?: FocusDashboardAggregateStats
  taskFeatureSettings?: TaskFeatureSettings
}): FocusDashboardData {
  const { tasks, todos, notes, filters, todayIso, mitIds } = args
  const taskFeatures = normalizeTaskFeatureSettings(args.taskFeatureSettings)
  const focusStats = args.focusStats
  const { includeTasks, includeTodos, includeNotes } = toSectionFlags(filters)
  const mode = normalizeFocusMode(filters.mode)
  const maxItems = normalizeMaxItems(filters.maxItems)
  const openTasks = tasks.filter((task) => normalizeTaskStatusValue(task.status) !== 'done')
  const openTodos = todos.filter((todo) => !todo.checked)
  const taskStatusById = new Map(tasks.map((task) => [task.id, task.status]))
  const taskMapForMit = new Map(tasks.map((task) => [task.id, task]))
  const todoMapForMit = new Map(todos.map((todo) => [todo.id, todo]))
  const normalizedMitIds = toNormalizedMitIds(mitIds, taskMapForMit, todoMapForMit)
  const mitItemsRaw = resolveMitItems(normalizedMitIds, taskMapForMit, todoMapForMit, todayIso, taskStatusById, taskFeatures)
  const mitKeySet = new Set(mitItemsRaw.map((item) => item.key))

  const filteredOpenTasks = includeTasks ? openTasks.filter((task) => textMatchesQuery(toTaskQueryText(task, taskFeatures), filters.query)) : []
  const blockingPoolRaw = filteredOpenTasks.map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById, taskFeatures))

  const overdueItemsRaw = includeTasks
    ? filteredOpenTasks
        .filter((task) => isOverdueTask(task, todayIso))
        .map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById, taskFeatures))
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

  const scopedTasks = includeTasks ? filteredOpenTasks.filter((task) => isTaskInScope(task, filters.scope, todayIso)) : []
  const scopedTodos = includeTodos
    ? openTodos
        .filter((todo) => isTodoInScope(todo, filters.scope, todayIso))
        .filter((todo) => textMatchesQuery(toTodoQueryText(todo), filters.query))
    : []
  const rankedPoolRaw = [
    ...scopedTasks.map((task) => toTaskPrimaryItem(task, todayIso, taskStatusById, taskFeatures)),
    ...scopedTodos.map((todo) => toTodoPrimaryItem(todo, todayIso)),
  ]

  const contextBadgeMap = buildContextBadgeMap(
    [...mitItemsRaw, ...overdueItemsRaw, ...blockingPoolRaw, ...rankedPoolRaw],
    notes
  )
  const applyItemDecorators = (item: FocusPrimaryItem): FocusPrimaryItem => withMitFlags(withContextBadges(item, contextBadgeMap), mitKeySet, normalizedMitIds.length)

  const rankedPool = rankedPoolRaw.map(applyItemDecorators).sort((left, right) => compareByMode(left, right, mode, todayIso))

  const remainingRanked = rankedPool.filter((item) => !mitKeySet.has(item.key) && !overdueKeySet.has(item.key))
  const moveBlockedToBack = mode === 'execution' || mode === 'planning'
  const stitchedRanked = moveBlockedToBack
    ? [
        ...remainingRanked.filter((item) => item.kind !== 'task' || !item.isBlocked || hasFollowUpDueNow(item, todayIso)),
        ...remainingRanked.filter((item) => item.kind === 'task' && item.isBlocked && !hasFollowUpDueNow(item, todayIso)),
      ]
    : remainingRanked

  const focusCount = Math.min(maxItems, toFocusSplitCount(maxItems, mode))
  const focusItems = stitchedRanked.slice(0, focusCount)
  const candidateItems = stitchedRanked.slice(focusItems.length, maxItems)
  const primaryItems = [...focusItems, ...candidateItems]

  const blockingPool = blockingPoolRaw.map(applyItemDecorators)
  const blockedItems = taskFeatures.advancedTaskHandling
    ? blockingPool
        .filter((item) => item.isBlocked)
        .sort((left, right) => {
          const leftFollowUpDueNow = hasFollowUpDueNow(left, todayIso)
          const rightFollowUpDueNow = hasFollowUpDueNow(right, todayIso)
          if (leftFollowUpDueNow !== rightFollowUpDueNow) {
            return leftFollowUpDueNow ? -1 : 1
          }
          return compareByMode(left, right, mode, todayIso)
        })
        .slice(0, MAX_BLOCKING_ITEMS)
    : []
  const waitingItems = taskFeatures.advancedTaskHandling
    ? blockingPool
        .filter((item) => item.hasExternalWaiting)
        .sort((left, right) => {
          const leftFollowUpDueNow = hasFollowUpDueNow(left, todayIso)
          const rightFollowUpDueNow = hasFollowUpDueNow(right, todayIso)
          if (leftFollowUpDueNow !== rightFollowUpDueNow) {
            return leftFollowUpDueNow ? -1 : 1
          }
          return compareByMode(left, right, mode, todayIso)
        })
        .slice(0, MAX_BLOCKING_ITEMS)
    : []
  const followUpTodayItems = taskFeatures.advancedTaskHandling
    ? waitingItems.filter((item) => item.followUpDate === todayIso).slice(0, MAX_BLOCKING_ITEMS)
    : []

  const mitItems = mitItemsRaw.map(applyItemDecorators)
  const overdueItems = overdueItemsRaw.map(applyItemDecorators)
  const nextActionItems = taskFeatures.advancedTaskHandling
    ? buildNextActionItems({
        mitItems,
        focusItems,
        candidateItems,
        overdueItems,
        mode,
        todayIso,
      })
    : []
  const suggestedMitItems = buildSuggestedMitItems({
    mitItems,
    focusItems,
    candidateItems,
    overdueItems,
    mode,
    todayIso,
    includeReasonHints: taskFeatures.advancedTaskHandling,
  })

  const dueTodayTaskCount = openTasks.filter((task) => toTaskDueIso(task.due_date) === todayIso).length
  const inProgressTaskCount = openTasks.filter((task) => normalizeTaskStatusValue(task.status) === 'in_progress').length
  const derivedBlockedTaskCount = blockingPool.filter((item) => item.isBlocked).length
  const derivedWaitingTaskCount = blockingPool.filter((item) => item.hasExternalWaiting).length
  const blockedTaskCount = taskFeatures.advancedTaskHandling ? (focusStats?.blockedCount ?? derivedBlockedTaskCount) : 0
  const waitingTaskCount = taskFeatures.advancedTaskHandling ? (focusStats?.waitingCount ?? derivedWaitingTaskCount) : 0
  const followUpTodayCount = blockingPool.filter((item) => item.hasExternalWaiting && item.followUpDate === todayIso).length

  const todayEstimatedMinutes = taskFeatures.taskTimeManagement ? sumEstimatedMinutes(dedupeFocusItems([...mitItems, ...overdueItems, ...focusItems])) : 0
  const mitEstimatedMinutes = taskFeatures.taskTimeManagement ? sumEstimatedMinutes(mitItems) : 0
  const focusEstimatedMinutes = taskFeatures.taskTimeManagement ? sumEstimatedMinutes(focusItems) : 0
  const withoutEstimateCount = taskFeatures.taskTimeManagement ? countWithoutEstimate([...mitItems, ...focusItems]) : 0
  const computedPlanningHints = toPlanningHints({ mitItems, focusItems, blockingPool, taskFeatures })
  const planningHints = taskFeatures.advancedTaskHandling
    ? {
        ...computedPlanningHints,
        waitingWithoutFollowUpCount: focusStats?.waitingWithoutFollowUpCount ?? computedPlanningHints.waitingWithoutFollowUpCount,
        unknownBlockerTaskCount: focusStats?.unknownBlockerTaskCount ?? computedPlanningHints.unknownBlockerTaskCount,
        unknownBlockerReferenceCount: focusStats?.unknownBlockerReferenceCount ?? computedPlanningHints.unknownBlockerReferenceCount,
      }
    : {
        focusWithoutEstimateCount: 0,
        mitWithoutEstimateCount: 0,
        waitingWithoutFollowUpCount: 0,
        unknownBlockerTaskCount: 0,
        unknownBlockerReferenceCount: 0,
      }
  const capacitySummary = taskFeatures.taskTimeManagement
    ? toCapacitySummary({
        estimatedMitMinutes: mitEstimatedMinutes,
        estimatedFocusMinutes: focusEstimatedMinutes,
        withoutEstimateCount,
        blockedTaskCount,
        unknownBlockerReferenceCount: taskFeatures.advancedTaskHandling ? planningHints.unknownBlockerReferenceCount : 0,
      })
    : {
        estimatedLoadTodayMinutes: 0,
        capacityStatus: 'light' as FocusCapacityStatus,
        capacityMessage: 'Zeitmanagement ist deaktiviert.',
      }

  const notesWithQuery = includeNotes ? notes.filter((note) => textMatchesQuery(toNoteSearchText(note), filters.query)) : []
  const notesToday = notesWithQuery
    .filter((note) => toUpdatedDay(note.updated_at) === todayIso)
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, maxItems)
  const recentNotes = notesWithQuery
    .filter((note) => matchesNoteScope(note, filters.scope, todayIso))
    .sort((left, right) => sortByRecency({ updatedAt: left.updated_at, title: left.title }, { updatedAt: right.updated_at, title: right.title }))
    .slice(0, Math.max(maxItems, 8))

  // Unknown completion history stays unknown; an edit is not a completion event.
  const doneTodayTasks = tasks.filter((task) => {
    if (normalizeTaskStatusValue(task.status) !== 'done') {
      return false
    }
    const completedDay = toCompletedDay(task.completed_at || null)
    return completedDay === todayIso
  }).length
  const doneTodayTodos = todos.filter((todo) => {
    if (!todo.checked) {
      return false
    }
    const completedDay = toCompletedDay(todo.completed_at || null)
    return completedDay === todayIso
  }).length
  const effectiveDoneTodayTasks = focusStats?.doneTodayTasks ?? doneTodayTasks
  const effectiveDoneTodayTodos = focusStats?.doneTodayTodos ?? doneTodayTodos
  const effectiveDoneToday = focusStats?.doneToday ?? effectiveDoneTodayTasks + effectiveDoneTodayTodos

  return {
    selectedScope: filters.scope,
    focusMode: mode,
    openTaskCount: openTasks.length,
    inProgressTaskCount,
    dueTodayTaskCount,
    openTodoCount: openTodos.length,
    notesTodayCount: notesToday.length,
    doneToday: effectiveDoneToday,
    doneTodayTasks: effectiveDoneTodayTasks,
    doneTodayTodos: effectiveDoneTodayTodos,
    blockedTaskCount,
    waitingTaskCount,
    followUpTodayCount: taskFeatures.advancedTaskHandling ? followUpTodayCount : 0,
    estimatedLoadTodayMinutes: capacitySummary.estimatedLoadTodayMinutes,
    estimatedMitMinutes: mitEstimatedMinutes,
    estimatedFocusMinutes: focusEstimatedMinutes,
    capacityStatus: capacitySummary.capacityStatus,
    capacityMessage: capacitySummary.capacityMessage,
    todayEstimatedMinutes,
    mitEstimatedMinutes,
    focusEstimatedMinutes,
    withoutEstimateCount,
    planningHints,
    todayDailyNote: includeNotes ? findDailyNote(notesWithQuery, todayIso) : null,
    mitIds: normalizedMitIds,
    mitItems,
    suggestedMitItems,
    overdueItems,
    blockedItems,
    waitingItems,
    followUpTodayItems,
    nextActionItems,
    focusItems,
    candidateItems,
    primaryItems,
    notesToday,
    recentNotes,
    dailyTrailItems: includeNotes ? toDailyTrailItems(notes, todayIso, 5) : [],
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

export function buildFocusContextHits(item: FocusPrimaryItem, notes: SearchRow[]): FocusContextHit[] {
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

    // Require at least one semantic match; recency alone should not create context hits.
    if (reasons.length === 0 || score <= 0) {
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

import {
  normalizeRelatedCandidate,
  normalizeTagCandidate,
  normalizeTaskPriorityValue,
  normalizeTaskStatusValue,
  type TaskDashboardFilters,
  type TaskDashboardGroupingMode,
  type TaskDueBucket,
  type TaskRow,
} from '../app/AppShared'
import type { TaskPriority, TaskStatus } from '../editor/noteDocument'

type TaskDashboardColumn = {
  key: string
  heading: string
}

export type TaskDashboardGroup = {
  key: string
  heading: string
  items: TaskRow[]
}

const STATUS_ORDER: TaskStatus[] = ['new_topic', 'open', 'in_progress', 'on_hold', 'done']
const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low']
const DUE_BUCKET_ORDER: TaskDueBucket[] = ['overdue', 'tomorrow', 'this_week', 'later', 'none']

const STATUS_LABELS: Record<TaskStatus, string> = {
  new_topic: 'New Topic',
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Done',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const DUE_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: 'Ueberfaellig',
  tomorrow: 'Morgen',
  this_week: 'Diese Woche',
  later: 'Spaeter',
  none: 'Ohne Faelligkeit',
}

export function toTaskDashboardTodayIso(baseDate?: Date): string {
  const now = baseDate ?? new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

export function toTaskDueIso(value: string | null): string {
  return (value || '').trim().slice(0, 10)
}

export function toTaskDueBucket(dueDate: string | null, todayIso: string): TaskDueBucket {
  const dueIso = toTaskDueIso(dueDate)
  if (!dueIso) {
    return 'none'
  }
  const due = new Date(`${dueIso}T00:00:00`)
  const today = new Date(`${todayIso}T00:00:00`)
  if (Number.isNaN(due.getTime()) || Number.isNaN(today.getTime())) {
    return 'none'
  }
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) {
    return 'overdue'
  }
  if (diffDays === 1) {
    return 'tomorrow'
  }
  if (diffDays <= 7) {
    return 'this_week'
  }
  return 'later'
}

export function taskDueBucketLabel(bucket: TaskDueBucket): string {
  return DUE_BUCKET_LABELS[bucket]
}

function taskDueBucketRank(bucket: TaskDueBucket): number {
  const index = DUE_BUCKET_ORDER.indexOf(bucket)
  return index >= 0 ? index : DUE_BUCKET_ORDER.length
}

function taskPriorityRank(priority: TaskPriority): number {
  const index = PRIORITY_ORDER.indexOf(priority)
  return index >= 0 ? index : PRIORITY_ORDER.length
}

function compareTaskRows(left: TaskRow, right: TaskRow, todayIso: string): number {
  const leftBucket = toTaskDueBucket(left.due_date, todayIso)
  const rightBucket = toTaskDueBucket(right.due_date, todayIso)
  const byBucket = taskDueBucketRank(leftBucket) - taskDueBucketRank(rightBucket)
  if (byBucket !== 0) {
    return byBucket
  }

  const byPriority = taskPriorityRank(normalizeTaskPriorityValue(left.priority)) - taskPriorityRank(normalizeTaskPriorityValue(right.priority))
  if (byPriority !== 0) {
    return byPriority
  }

  const leftDue = toTaskDueIso(left.due_date)
  const rightDue = toTaskDueIso(right.due_date)
  if (leftDue !== rightDue) {
    if (!leftDue) {
      return 1
    }
    if (!rightDue) {
      return -1
    }
    return leftDue.localeCompare(rightDue)
  }

  if (left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at)
  }
  return left.title.localeCompare(right.title, 'de', { sensitivity: 'base' })
}

function toTaskSearchText(task: TaskRow, todayIso: string): string {
  const status = normalizeTaskStatusValue(task.status)
  const priority = normalizeTaskPriorityValue(task.priority)
  const dueIso = toTaskDueIso(task.due_date)
  const dueBucket = toTaskDueBucket(task.due_date, todayIso)
  const tags = (task.tags || []).map((item) => normalizeTagCandidate(item)).filter(Boolean)
  const related = (task.related || []).map((item) => normalizeRelatedCandidate(item)).filter(Boolean)
  return [
    task.id,
    task.title,
    task.path || '',
    status,
    STATUS_LABELS[status],
    priority,
    PRIORITY_LABELS[priority],
    dueIso,
    taskDueBucketLabel(dueBucket),
    ...tags,
    ...related,
  ]
    .join(' ')
    .toLowerCase()
}

function toTaskTagKeys(task: TaskRow): string[] {
  return Array.from(new Set((task.tags || []).map((item) => normalizeTagCandidate(item)).filter(Boolean)))
}

function toTaskRelatedKeys(task: TaskRow): string[] {
  return Array.from(new Set((task.related || []).map((item) => normalizeRelatedCandidate(item)).filter(Boolean)))
}

export function filterTaskRows(tasks: TaskRow[], filters: TaskDashboardFilters, todayIso: string): TaskRow[] {
  const cleanQuery = filters.query.trim().toLowerCase()
  const selectedStatuses = new Set(filters.statuses)
  const selectedPriorities = new Set(filters.priorities)
  const selectedDueBuckets = new Set(filters.dueBuckets)
  const selectedTagGroups = new Set(filters.tagGroups.map((value) => value.toLowerCase()))
  const selectedTags = new Set(filters.tags.map((value) => normalizeTagCandidate(value)).filter(Boolean))
  const selectedRelated = new Set(filters.related.map((value) => normalizeRelatedCandidate(value)).filter(Boolean))
  return tasks
    .filter((task) => {
      const status = normalizeTaskStatusValue(task.status)
      if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) {
        return false
      }

      const priority = normalizeTaskPriorityValue(task.priority)
      if (selectedPriorities.size > 0 && !selectedPriorities.has(priority)) {
        return false
      }

      const dueBucket = toTaskDueBucket(task.due_date, todayIso)
      if (selectedDueBuckets.size > 0 && !selectedDueBuckets.has(dueBucket)) {
        return false
      }

      const taskTags = toTaskTagKeys(task)
      if (selectedTagGroups.size > 0) {
        const matchesGroup = taskTags.some((tagKey) => {
          const [group = ''] = tagKey.split(':', 1)
          return selectedTagGroups.has(group.toLowerCase())
        })
        if (!matchesGroup) {
          return false
        }
      }

      if (selectedTags.size > 0 && !taskTags.some((tagKey) => selectedTags.has(tagKey))) {
        return false
      }

      const taskRelated = toTaskRelatedKeys(task)
      if (selectedRelated.size > 0 && !taskRelated.some((relatedKey) => selectedRelated.has(relatedKey))) {
        return false
      }

      if (cleanQuery && !toTaskSearchText(task, todayIso).includes(cleanQuery)) {
        return false
      }
      return true
    })
    .sort((left, right) => compareTaskRows(left, right, todayIso))
}

function getStatusColumns(tasks: TaskRow[], filters: TaskDashboardFilters): TaskDashboardColumn[] {
  const known = new Set(tasks.map((task) => normalizeTaskStatusValue(task.status)))
  const selectedStatuses = new Set(filters.statuses)
  return STATUS_ORDER
    .filter((status) => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) {
        return false
      }
      return known.has(status)
    })
    .map((status) => ({
      key: status,
      heading: STATUS_LABELS[status],
    }))
}

function getPriorityColumns(filters: TaskDashboardFilters): TaskDashboardColumn[] {
  const selectedPriorities = new Set(filters.priorities)
  return PRIORITY_ORDER
    .filter((priority) => {
      if (selectedPriorities.size > 0 && !selectedPriorities.has(priority)) {
        return false
      }
      return true
    })
    .map((priority) => ({
      key: priority,
      heading: PRIORITY_LABELS[priority],
    }))
}

function getDueColumns(filters: TaskDashboardFilters): TaskDashboardColumn[] {
  const selectedDueBuckets = new Set(filters.dueBuckets)
  return DUE_BUCKET_ORDER
    .filter((bucket) => {
      if (selectedDueBuckets.size > 0 && !selectedDueBuckets.has(bucket)) {
        return false
      }
      return true
    })
    .map((bucket) => ({
      key: bucket,
      heading: taskDueBucketLabel(bucket),
    }))
}

function toGroupColumns(grouping: TaskDashboardGroupingMode, tasks: TaskRow[], filters: TaskDashboardFilters): TaskDashboardColumn[] {
  if (grouping === 'status') {
    return getStatusColumns(tasks, filters)
  }
  if (grouping === 'priority') {
    return getPriorityColumns(filters)
  }
  return getDueColumns(filters)
}

function toGroupKey(task: TaskRow, grouping: TaskDashboardGroupingMode, todayIso: string): string {
  if (grouping === 'status') {
    return normalizeTaskStatusValue(task.status)
  }
  if (grouping === 'priority') {
    return normalizeTaskPriorityValue(task.priority)
  }
  return toTaskDueBucket(task.due_date, todayIso)
}

export function groupTaskRows(
  tasks: TaskRow[],
  grouping: TaskDashboardGroupingMode,
  filters: TaskDashboardFilters,
  todayIso: string
): TaskDashboardGroup[] {
  const columns = toGroupColumns(grouping, tasks, filters)
  const groups = new Map<string, TaskDashboardGroup>()
  for (const column of columns) {
    groups.set(column.key, {
      key: column.key,
      heading: column.heading,
      items: [],
    })
  }

  for (const task of tasks) {
    const key = toGroupKey(task, grouping, todayIso)
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(task)
    }
  }

  return columns.map((column) => groups.get(column.key) || { key: column.key, heading: column.heading, items: [] })
}

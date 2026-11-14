export const TASK_STATUSES = ['new_topic', 'open', 'in_progress', 'on_hold', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'new_topic', label: 'Neues Thema' },
  { value: 'open', label: 'Offen' },
  { value: 'in_progress', label: 'In Arbeit' },
  { value: 'on_hold', label: 'Pausiert' },
  { value: 'done', label: 'Erledigt' },
]

export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Niedrig' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new_topic: 'Neues Thema',
  open: 'Offen',
  in_progress: 'In Arbeit',
  on_hold: 'Pausiert',
  done: 'Erledigt',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
}

export function normalizeTaskStatusValue(raw: string): TaskStatus {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[- ]+/g, '_') as TaskStatus
  return TASK_STATUS_OPTIONS.some((option) => option.value === clean) ? clean : 'open'
}

export function normalizeTaskPriorityValue(raw: string): TaskPriority {
  const clean = raw.trim().toLowerCase()
  if (clean === 'h' || clean === 'high') {
    return 'high'
  }
  if (clean === 'm' || clean === 'medium') {
    return 'medium'
  }
  if (clean === 'l' || clean === 'low') {
    return 'low'
  }
  return TASK_PRIORITY_OPTIONS.some((option) => option.value === (clean as TaskPriority))
    ? (clean as TaskPriority)
    : 'medium'
}

export function taskStatusLabel(raw: string): string {
  return TASK_STATUS_LABELS[normalizeTaskStatusValue(raw)]
}

export function taskStatusClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-badge status-${normalized}`
}

export function taskStatusDotClassName(raw: string): string {
  const normalized = normalizeTaskStatusValue(raw).replace(/_/g, '-')
  return `status-dot status-${normalized}`
}

export function taskStatusOptionLabel(value: TaskStatus): string {
  return TASK_STATUS_LABELS[value]
}

export function taskPriorityLabel(raw: string): string {
  return TASK_PRIORITY_LABELS[normalizeTaskPriorityValue(raw)]
}

export function taskPriorityDotClassName(raw: string): string {
  return `priority-dot priority-${normalizeTaskPriorityValue(raw)}`
}

export function taskPriorityOptionLabel(value: TaskPriority): string {
  return TASK_PRIORITY_LABELS[value]
}


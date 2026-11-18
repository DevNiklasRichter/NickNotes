import type { ReviewDashboardCompletedItem, ReviewDashboardSeriesPoint } from '../app/AppShared'

/** One chart column: a day, or a calendar week (Monday to Sunday) for long periods. */
export type ReviewBucket = {
  from: string
  to: string
  label: string
  newCount: number
  doneCount: number
  openTasks: number
  openTodos: number
}

export type ReviewCompletedDay = {
  day: string
  label: string
  items: ReviewDashboardCompletedItem[]
}

/** Periods longer than this are shown per calendar week so columns stay readable. */
export const REVIEW_WEEKLY_THRESHOLD_DAYS = 45

function parseIsoDay(dayIso: string): Date | null {
  const [year, month, day] = dayIso.split('-').map(Number)
  if (!year || !month || !day) {
    return null
  }
  return new Date(year, month - 1, day)
}

export function formatShortDay(dayIso: string): string {
  const [, month, day] = dayIso.split('-')
  return month && day ? `${day}.${month}.` : dayIso
}

export function formatWeekdayDay(dayIso: string): string {
  const parsed = parseIsoDay(dayIso)
  if (!parsed) {
    return dayIso
  }
  const weekday = parsed.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')
  return `${weekday}, ${formatShortDay(dayIso)}`
}

function thursdayOfWeek(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3 - ((date.getDay() + 6) % 7))
}

function isoWeekNumber(date: Date): number {
  const thursday = thursdayOfWeek(date)
  const firstThursday = thursdayOfWeek(new Date(thursday.getFullYear(), 0, 4))
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}

function weekKey(dayIso: string): string {
  const parsed = parseIsoDay(dayIso)
  if (!parsed) {
    return dayIso
  }
  const monday = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() - ((parsed.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`
}

export function buildReviewBuckets(series: ReviewDashboardSeriesPoint[]): ReviewBucket[] {
  const weekly = series.length > REVIEW_WEEKLY_THRESHOLD_DAYS
  const buckets: ReviewBucket[] = []
  let currentKey = ''
  for (const point of series) {
    const key = weekly ? weekKey(point.date) : point.date
    const newCount = point.new_tasks + point.new_todos
    const doneCount = point.completed_tasks + point.completed_todos
    const last = buckets[buckets.length - 1]
    if (last && key === currentKey) {
      last.to = point.date
      last.newCount += newCount
      last.doneCount += doneCount
      last.openTasks = point.open_tasks
      last.openTodos = point.open_todos
      continue
    }
    currentKey = key
    buckets.push({
      from: point.date,
      to: point.date,
      label: '',
      newCount,
      doneCount,
      openTasks: point.open_tasks,
      openTodos: point.open_todos,
    })
  }
  for (const bucket of buckets) {
    const parsed = parseIsoDay(bucket.from)
    bucket.label = weekly && parsed
      ? `KW ${isoWeekNumber(parsed)} (${formatShortDay(bucket.from)}–${formatShortDay(bucket.to)})`
      : formatWeekdayDay(bucket.from)
  }
  return buckets
}

export function groupCompletedByDay(items: ReviewDashboardCompletedItem[]): ReviewCompletedDay[] {
  const days: ReviewCompletedDay[] = []
  for (const item of items) {
    const day = item.date || item.completed_at.slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.day === day) {
      last.items.push(item)
    } else {
      days.push({ day, label: formatWeekdayDay(day), items: [item] })
    }
  }
  return days
}

export function formatSignedDelta(value: number): string {
  if (value > 0) {
    return `+${value}`
  }
  if (value < 0) {
    return `−${Math.abs(value)}`
  }
  return '±0'
}

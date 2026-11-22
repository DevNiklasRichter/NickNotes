/** Task reminders: frontmatter `remind_at`, local time written as `YYYY-MM-DD HH:MM` (see backend reminders.py). */

const REMIND_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

/** Default time of day when a reminder is set from the due date. */
export const DEFAULT_REMINDER_TIME = '09:00'

const pad = (value: number) => String(value).padStart(2, '0')

/** The reminder as a local Date, or null when it is missing or not a real point in time. */
export function parseRemindAt(raw: unknown): Date | null {
  const match = REMIND_AT_PATTERN.exec(String(raw ?? '').trim())
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (hour > 23 || minute > 59) return null
  const moment = new Date(year, month - 1, day, hour, minute)
  return moment.getFullYear() === year && moment.getMonth() === month - 1 && moment.getDate() === day ? moment : null
}

export function formatRemindAt(moment: Date): string {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())} ${pad(moment.getHours())}:${pad(moment.getMinutes())}`
}

/** Canonical frontmatter value, or '' when the value is no reminder. */
export function normalizeRemindAt(raw: unknown): string {
  const moment = parseRemindAt(raw)
  return moment ? formatRemindAt(moment) : ''
}

/** Value for `<input type="datetime-local">`. */
export function remindAtInputValue(raw: unknown): string {
  return normalizeRemindAt(raw).replace(' ', 'T')
}

/** The reminder on the due day at the default time; '' without a valid due date. */
export function remindAtForDueDate(dueDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? normalizeRemindAt(`${dueDate} ${DEFAULT_REMINDER_TIME}`) : ''
}

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
const startOfDay = (moment: Date) => new Date(moment.getFullYear(), moment.getMonth(), moment.getDate())

/** "heute 09:00", "morgen 18:30", "Mo., 23.11. 09:00" (year only when it differs). */
export function reminderLabel(raw: unknown, now: Date = new Date()): string {
  const moment = parseRemindAt(raw)
  if (!moment) return ''
  const time = `${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  const days = Math.round((startOfDay(moment).getTime() - startOfDay(now).getTime()) / 86_400_000)
  if (days === 0) return `heute ${time}`
  if (days === 1) return `morgen ${time}`
  if (days === -1) return `gestern ${time}`
  const weekday = WEEKDAYS[moment.getDay()]
  const year = moment.getFullYear() === now.getFullYear() ? '' : String(moment.getFullYear())
  return `${weekday}, ${pad(moment.getDate())}.${pad(moment.getMonth() + 1)}.${year} ${time}`
}

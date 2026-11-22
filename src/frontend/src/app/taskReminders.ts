import { parseRemindAt, reminderLabel } from '../editor/taskReminder'

/** One open task with a reminder, as `GET /tasks/reminders` lists it. */
export type ReminderItem = { id: string; title: string; path?: string | null; due_date?: string | null; remind_at: string }

/** What this device already showed: reminder keys with the time they were shown, and the last overview day. */
export type ReminderMemory = { shown: Record<string, number>; overviewDay: string }

export type ReminderNotice = { title: string; body: string; item: ReminderItem | null }

const KEEP_SHOWN_MS = 45 * 86_400_000
/** Later than this, a reminder counts as missed (the app was closed or the PC asleep). */
const MISSED_AFTER_MS = 15 * 60_000

export const emptyReminderMemory = (): ReminderMemory => ({ shown: {}, overviewDay: '' })

/** A changed time is a new reminder, so it fires again. */
export const reminderKey = (item: ReminderItem) => `${item.id}|${item.remind_at}`

export function dueReminders(items: ReminderItem[], memory: ReminderMemory, now: Date): ReminderItem[] {
  return items.filter((item) => {
    const moment = parseRemindAt(item.remind_at)
    return moment !== null && moment.getTime() <= now.getTime() && !(reminderKey(item) in memory.shown)
  })
}

/** Marks reminders as shown and forgets entries older than six weeks. */
export function rememberShown(memory: ReminderMemory, items: ReminderItem[], now: Date): ReminderMemory {
  const shown: Record<string, number> = {}
  for (const [key, at] of Object.entries(memory.shown)) {
    if (now.getTime() - at < KEEP_SHOWN_MS) shown[key] = at
  }
  for (const item of items) shown[reminderKey(item)] = now.getTime()
  return { ...memory, shown }
}

const pad = (value: number) => String(value).padStart(2, '0')
const localDay = (moment: Date) => `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`

function dueText(dueDate: string | null | undefined, now: Date): string {
  if (!dueDate) return ''
  const today = localDay(now)
  if (dueDate === today) return 'Heute fällig.'
  if (dueDate < today) return `Überfällig seit ${dueDate.slice(8, 10)}.${dueDate.slice(5, 7)}.`
  return `Fällig am ${dueDate.slice(8, 10)}.${dueDate.slice(5, 7)}.`
}

function titleList(titles: string[]): string {
  const shown = titles.slice(0, 3).join(' · ')
  return titles.length > 3 ? `${shown} und ${titles.length - 3} weitere` : shown
}

/** One notification for one or several due reminders; several at once are grouped. */
export function reminderNotice(items: ReminderItem[], now: Date): ReminderNotice | null {
  if (!items.length) return null
  if (items.length === 1) {
    const [item] = items
    const moment = parseRemindAt(item.remind_at)
    const missed = moment !== null && now.getTime() - moment.getTime() > MISSED_AFTER_MS
    const body = [missed ? `Verpasste Erinnerung von ${reminderLabel(item.remind_at, now)}.` : '', dueText(item.due_date, now)].filter(Boolean).join(' ')
    return { title: item.title || 'Erinnerung', body: body || 'Erinnerung', item }
  }
  return { title: `${items.length} Erinnerungen`, body: titleList(items.map((item) => item.title || 'Ohne Titel')), item: null }
}

/** Overview time "HH:MM" from the settings; '' means off. */
export function overviewDue(time: string, memory: ReminderMemory, now: Date): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match || memory.overviewDay === localDay(now)) return false
  return now.getHours() * 60 + now.getMinutes() >= Number(match[1]) * 60 + Number(match[2])
}

export const rememberOverview = (memory: ReminderMemory, now: Date): ReminderMemory => ({ ...memory, overviewDay: localDay(now) })

/** Morning overview of open tasks due today or earlier; null when nothing is due. */
export function overviewNotice(tasks: Array<{ title: string; status: string; due_date?: string | null }>, now: Date): ReminderNotice | null {
  const today = localDay(now)
  const open = tasks.filter((task) => task.status !== 'done' && task.due_date && task.due_date <= today)
  if (!open.length) return null
  const overdue = open.filter((task) => task.due_date! < today)
  const dueToday = open.length - overdue.length
  const parts = [dueToday ? `${dueToday} heute fällig` : '', overdue.length ? `${overdue.length} überfällig` : ''].filter(Boolean)
  const ordered = [...overdue, ...open.filter((task) => task.due_date === today)]
  return {
    title: open.length === 1 ? 'Heute: 1 Task' : `Heute: ${open.length} Tasks`,
    body: `${parts.join(', ')}: ${titleList(ordered.map((task) => task.title || 'Ohne Titel'))}`,
    item: null,
  }
}

export function readReminderMemory(storageKey: string): ReminderMemory {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as Partial<ReminderMemory> | null
    if (!raw || typeof raw !== 'object') return emptyReminderMemory()
    const shown = raw.shown && typeof raw.shown === 'object' ? Object.fromEntries(Object.entries(raw.shown).filter(([, at]) => typeof at === 'number')) : {}
    return { shown, overviewDay: typeof raw.overviewDay === 'string' ? raw.overviewDay : '' }
  } catch {
    return emptyReminderMemory()
  }
}

export function writeReminderMemory(storageKey: string, memory: ReminderMemory): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memory))
  } catch {
    // Without storage a reminder may show once more after a restart.
  }
}

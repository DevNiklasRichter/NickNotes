import { expect, test } from 'vitest'
import { dueReminders, emptyReminderMemory, overviewDue, overviewNotice, rememberOverview, rememberShown, reminderNotice, type ReminderItem } from './taskReminders'

const now = new Date(2026, 10, 20, 9, 0)
const item = (id: string, remind_at: string, title = id, due_date: string | null = null): ReminderItem => ({ id, title, remind_at, due_date })

test('a reached reminder shows once; a changed time shows again', () => {
  const items = [item('a', '2026-11-20 08:59'), item('b', '2026-11-20 09:01'), item('c', 'kaputt')]
  let memory = emptyReminderMemory()
  const due = dueReminders(items, memory, now)
  expect(due.map((entry) => entry.id)).toEqual(['a'])
  memory = rememberShown(memory, due, now)
  expect(dueReminders(items, memory, now)).toEqual([])
  expect(dueReminders([item('a', '2026-11-20 08:30')], memory, now).map((entry) => entry.id)).toEqual(['a'])
  // Old entries are forgotten after six weeks.
  const later = new Date(2027, 0, 15)
  expect(rememberShown(memory, [], later).shown).toEqual({})
})

test('one reminder names the task, a missed one says so, several are grouped', () => {
  expect(reminderNotice([], now)).toBeNull()
  expect(reminderNotice([item('a', '2026-11-20 09:00', 'Arzt anrufen', '2026-11-20')], now)).toMatchObject({ title: 'Arzt anrufen', body: 'Heute fällig.' })
  expect(reminderNotice([item('a', '2026-11-19 18:00', 'Bericht', '2026-11-19')], now)?.body).toBe('Verpasste Erinnerung von gestern 18:00. Überfällig seit 19.11.')
  const grouped = reminderNotice(['A', 'B', 'C', 'D'].map((title) => item(title, '2026-11-20 08:00', title)), now)
  expect(grouped).toEqual({ title: '4 Erinnerungen', body: 'A · B · C und 1 weitere', item: null })
})

test('the morning overview comes once a day after its time and only when something is due', () => {
  const memory = emptyReminderMemory()
  expect(overviewDue('', memory, now)).toBe(false)
  expect(overviewDue('09:30', memory, now)).toBe(false)
  expect(overviewDue('08:00', memory, now)).toBe(true)
  expect(overviewDue('08:00', rememberOverview(memory, now), now)).toBe(false)
  const tasks = [
    { title: 'Alt', status: 'open', due_date: '2026-11-18' },
    { title: 'Heute', status: 'open', due_date: '2026-11-20' },
    { title: 'Erledigt', status: 'done', due_date: '2026-11-20' },
    { title: 'Später', status: 'open', due_date: '2026-11-25' },
  ]
  expect(overviewNotice(tasks, now)).toEqual({ title: 'Heute: 2 Tasks', body: '1 heute fällig, 1 überfällig: Alt · Heute', item: null })
  expect(overviewNotice(tasks.slice(3), now)).toBeNull()
})

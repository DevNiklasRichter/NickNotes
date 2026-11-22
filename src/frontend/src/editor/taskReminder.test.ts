import { expect, test } from 'vitest'
import { normalizeRemindAt, parseRemindAt, reminderLabel, remindAtForDueDate, remindAtInputValue } from './taskReminder'

test('reminders are written in the format the backend reads', () => {
  expect(normalizeRemindAt('2026-11-21T09:05')).toBe('2026-11-21 09:05')
  expect(normalizeRemindAt('2026-11-21 9:05:59')).toBe('2026-11-21 09:05')
  expect(normalizeRemindAt('2026-02-30 09:00')).toBe('')
  expect(normalizeRemindAt('morgen')).toBe('')
  expect(parseRemindAt('2026-11-21 24:00')).toBeNull()
  expect(remindAtInputValue('2026-11-21 09:05')).toBe('2026-11-21T09:05')
  expect(remindAtForDueDate('2026-11-24')).toBe('2026-11-24 09:00')
  expect(remindAtForDueDate('')).toBe('')
})

test('labels are relative to today', () => {
  const now = new Date(2026, 10, 20, 12, 0)
  expect(reminderLabel('2026-11-20 18:30', now)).toBe('heute 18:30')
  expect(reminderLabel('2026-11-21 09:00', now)).toBe('morgen 09:00')
  expect(reminderLabel('2026-11-19 09:00', now)).toBe('gestern 09:00')
  expect(reminderLabel('2026-11-24 09:00', now)).toBe('Di., 24.11. 09:00')
  expect(reminderLabel('2027-01-05 09:00', now)).toBe('Di., 05.01.2027 09:00')
  expect(reminderLabel('', now)).toBe('')
})

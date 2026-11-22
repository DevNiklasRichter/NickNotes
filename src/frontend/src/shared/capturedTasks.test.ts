import { expect, test } from 'vitest'
import { capturedTasksNote } from './capturedTasks'

test('capture feedback names the due day and a repeat', () => {
  expect(capturedTasksNote([])).toBe('')
  expect(capturedTasksNote([{ dueDate: '2026-11-24' }])).toBe(' Task fällig am 24.11. angelegt.')
  expect(capturedTasksNote([{ dueDate: '2026-11-24', repeat: 'weekly' }])).toBe(' Wiederkehrende Task fällig am 24.11. angelegt (wöchentlich).')
  expect(capturedTasksNote([{ dueDate: '2026-11-24', remindAt: '2026-11-24 09:00' }])).toBe(' Task fällig am 24.11. angelegt, Erinnerung um 09:00.')
  expect(capturedTasksNote([{ dueDate: '2026-11-24', repeat: 'weekly', remindAt: '2026-11-24 18:30' }])).toBe(' Wiederkehrende Task fällig am 24.11. angelegt (wöchentlich), Erinnerung um 18:30.')
  expect(capturedTasksNote([{ dueDate: '2026-11-24' }, { dueDate: '2026-11-25', repeat: 'daily' }])).toBe(' 2 Tasks angelegt (fällig 24.11., 25.11.).')
})

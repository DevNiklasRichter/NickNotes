import { expect, test } from 'vitest'
import { capturedTasksNote } from './capturedTasks'

test('capture feedback names the due day and a repeat', () => {
  expect(capturedTasksNote([])).toBe('')
  expect(capturedTasksNote([{ dueDate: '2026-11-24' }])).toBe(' Task fällig am 24.11. angelegt.')
  expect(capturedTasksNote([{ dueDate: '2026-11-24', repeat: 'weekly' }])).toBe(' Wiederkehrende Task fällig am 24.11. angelegt (wöchentlich).')
  expect(capturedTasksNote([{ dueDate: '2026-11-24' }, { dueDate: '2026-11-25', repeat: 'daily' }])).toBe(' 2 Tasks angelegt (fällig 24.11., 25.11.).')
})

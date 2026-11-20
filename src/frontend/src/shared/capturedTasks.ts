import { repeatLabel } from '../editor/taskRepeat'

type CapturedTask = { dueDate: string; repeat?: string | null }

/** Feedback for tasks a capture created: " Task fällig am 24.11. angelegt (wöchentlich)." or empty. */
export function capturedTasksNote(tasks: CapturedTask[]): string {
  if (!tasks.length) return ''
  const due = tasks.map((task) => new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })).join(', ')
  if (tasks.length > 1) return ` ${tasks.length} Tasks angelegt (fällig ${due}).`
  const repeat = repeatLabel(tasks[0].repeat)
  return repeat ? ` Wiederkehrende Task fällig am ${due} angelegt (${repeat.toLowerCase()}).` : ` Task fällig am ${due} angelegt.`
}

import { repeatLabel } from '../editor/taskRepeat'
import { parseRemindAt } from '../editor/taskReminder'

type CapturedTask = { dueDate: string; repeat?: string | null; remindAt?: string | null }

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })

/** Feedback for tasks a capture created: " Task fällig am 24.11. angelegt (wöchentlich), Erinnerung um 09:00." or empty. */
export function capturedTasksNote(tasks: CapturedTask[]): string {
  if (!tasks.length) return ''
  const due = tasks.map((task) => dayLabel(task.dueDate)).join(', ')
  if (tasks.length > 1) return ` ${tasks.length} Tasks angelegt (fällig ${due}).`
  const repeat = repeatLabel(tasks[0].repeat)
  const reminder = parseRemindAt(tasks[0].remindAt)
  const at = reminder ? reminder.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''
  const sentence = repeat ? ` Wiederkehrende Task fällig am ${due} angelegt (${repeat.toLowerCase()})` : ` Task fällig am ${due} angelegt`
  return at ? `${sentence}, Erinnerung um ${at}.` : `${sentence}.`
}

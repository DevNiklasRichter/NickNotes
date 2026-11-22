import { useState } from 'react'
import { normalizeRemindAt, reminderLabel, remindAtForDueDate, remindAtInputValue } from './taskReminder'

type TaskReminderFieldProps = {
  remindAt: unknown
  dueDate: string
  onChange: (remindAt: string) => void
}

/** "Erinnerung": a Windows notification at this point in time while NickNotes runs. */
export function TaskReminderField({ remindAt, dueDate, onChange }: TaskReminderFieldProps) {
  const value = remindAtInputValue(remindAt)
  const unreadable = !value && String(remindAt ?? '').trim() !== ''
  const fromDue = remindAtForDueDate(dueDate)
  // Rendered time: good enough to tell a past reminder from an upcoming one.
  const [openedAt] = useState(() => Date.now())
  const past = value ? new Date(value).getTime() <= openedAt : false
  return (
    <>
      <span className="property-key">Erinnerung</span>
      <div className="property-value-stack">
        <div className="property-value-inline">
          <input
            className="property-date-input property-reminder-input"
            type="datetime-local"
            aria-label="Erinnerung"
            value={value}
            onChange={(event) => {
              const next = normalizeRemindAt(event.target.value)
              if (next || !event.target.value) onChange(next)
            }}
          />
          {value || unreadable ? (
            <button type="button" className="property-chip add" onClick={() => onChange('')}
              aria-label="Erinnerung entfernen" data-tooltip="Erinnerung entfernen">x</button>
          ) : fromDue ? (
            <button type="button" className="property-chip add" onClick={() => onChange(fromDue)}
              data-tooltip="Am Fälligkeitstag um 09:00 erinnern">Fällig 09:00</button>
          ) : null}
        </div>
        {unreadable ? <span className="property-inline-error" role="alert">Unbekannte Zeitangabe: {String(remindAt)}</span> : null}
        {value ? <span className="property-hint">{past ? `War ${reminderLabel(value)}` : `Meldet sich ${reminderLabel(value)}`}, solange NickNotes läuft.</span> : null}
      </div>
    </>
  )
}

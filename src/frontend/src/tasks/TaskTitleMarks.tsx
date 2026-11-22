import { repeatLabel } from '../editor/taskRepeat'
import { reminderLabel } from '../editor/taskReminder'
import { LucideNamedIcon } from '../icons/lucideCatalog'

function TitleMark({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="task-title-mark" role="img" aria-label={label} data-tooltip={label}>
      <LucideNamedIcon name={icon} size={12} />
    </span>
  )
}

/** Small symbols next to a task title: repeats, has a reminder. Nothing when neither applies. */
export function TaskTitleMarks({ repeat, remindAt }: { repeat: unknown; remindAt?: unknown }) {
  const repeats = repeatLabel(repeat)
  const reminder = reminderLabel(remindAt)
  return (
    <>
      {repeats ? <TitleMark icon="Repeat" label={`Wiederholt sich: ${repeats}`} /> : null}
      {reminder ? <TitleMark icon="Bell" label={`Erinnerung ${reminder}`} /> : null}
    </>
  )
}

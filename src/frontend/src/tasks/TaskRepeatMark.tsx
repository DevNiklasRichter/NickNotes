import { repeatLabel } from '../editor/taskRepeat'
import { LucideNamedIcon } from '../icons/lucideCatalog'

/** Small repeat symbol next to a task title; nothing when the task does not repeat. */
export function TaskRepeatMark({ repeat }: { repeat: unknown }) {
  const label = repeatLabel(repeat)
  if (!label) return null
  return (
    <span className="task-repeat-mark" role="img" aria-label={`Wiederholt sich: ${label}`} data-tooltip={`Wiederholt sich: ${label}`}>
      <LucideNamedIcon name="Repeat" size={12} />
    </span>
  )
}

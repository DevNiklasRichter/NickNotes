import type { OperatorNotification } from '../app/AppShared'
import type {ReactNode} from 'react'

type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

type StatusBarProps = {
  progress?: ReactNode
  prefs: StatusBarPrefs
  notification: OperatorNotification | null
  noteBaseName: string
  counts: {
    notes: number
    openTasks: number
  }
  dueTodayCount: number
}

export function StatusBar({ progress, prefs, notification, noteBaseName, counts, dueTodayCount }: StatusBarProps) {
  const statusClass =
    notification?.severity === 'warn'
      ? 'warn'
      : notification?.severity === 'critical'
        ? 'critical'
        : notification?.severity === 'error'
          ? 'error'
          : notification?.severity === 'info'
            ? 'info'
            : ''
  const statusText = notification ? notification.message : ''

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        {progress}
        {prefs.showStateMessage ? (
          <span role="status" aria-live="polite" className={`status-item${statusClass ? ` ${statusClass}` : ''}`}>{statusText}</span>
        ) : (
          <span className="status-item">&nbsp;</span>
        )}
      </div>
      <div className="status-bar-right">
        {prefs.showTotalNotes ? <span className="status-item">Notizen: {counts.notes}</span> : null}
        {prefs.showOpenTasks ? <span className="status-item">Tasks offen: {counts.openTasks}</span> : null}
        {prefs.showDueToday ? <span className="status-item">Heute faellig: {dueTodayCount}</span> : null}
        {prefs.showNoteBaseName ? <span className="status-item">NoteBase: {noteBaseName}</span> : null}
      </div>
    </footer>
  )
}

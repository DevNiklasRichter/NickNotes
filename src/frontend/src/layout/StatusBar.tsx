type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

type StatusBarProps = {
  prefs: StatusBarPrefs
  message: string
  error: string
  noteBaseName: string
  counts: {
    notes: number
    openTasks: number
  }
  dueTodayCount: number
}

export function StatusBar({ prefs, message, error, noteBaseName, counts, dueTodayCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        {prefs.showStateMessage ? (
          <span className={`status-item ${error ? 'error' : ''}`}>{error || message}</span>
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


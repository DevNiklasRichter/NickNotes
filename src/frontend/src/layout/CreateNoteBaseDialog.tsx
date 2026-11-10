import {useId} from 'react'
import {createPortal} from 'react-dom'
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus'
import './CreateNoteBaseDialog.css'

export function CreateNoteBaseDialog({displayName, name, parentPath, pending, error, suspended,
  onDisplayNameChange, onNameChange, onParentPathChange, onChooseDirectory, onSubmit, onClose}: {
  displayName: string
  name: string
  parentPath: string
  pending: boolean
  error: string
  suspended: boolean
  onDisplayNameChange: (value: string) => void
  onNameChange: (value: string) => void
  onParentPathChange: (value: string) => void
  onChooseDirectory: () => Promise<void>
  onSubmit: () => Promise<void>
  onClose: () => void
}) {
  const id = useId()
  const root = useDialogFocus({active: !suspended, busy: pending, fallback: () => document.querySelector<HTMLElement>('.activity-rail button')})
  const close = () => {if (!pending && !suspended) onClose()}
  return createPortal(<div className={`modal-overlay create-notebase-overlay${suspended ? ' is-suspended' : ''}`} inert={suspended || undefined} aria-hidden={suspended || undefined}
    onMouseDown={event => {if (event.target === event.currentTarget) close()}}>
    <div className="create-notebase-modal" ref={root} role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={pending || undefined} tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') {event.preventDefault(); close(); return}
        trapDialogTab(event)
      }}>
      <header className="sidebar-header-row"><h3 id={`${id}-title`}>Neue NoteBase erstellen</h3></header>
      <p className="muted-copy" id={`${id}-description`}>Lege Name, Speicherort und Anrede für die neue NoteBase fest.</p>
      {error ? <p className="create-notebase-error" role="alert">{error}</p> : null}
      <form onSubmit={event => {event.preventDefault(); if (!pending) void onSubmit()}}>
        <fieldset className="create-notebase-form" disabled={pending}>
          <label className="create-notebase-label" htmlFor={`${id}-display-name`}>Anrede</label>
          <input id={`${id}-display-name`} value={displayName} onChange={event => onDisplayNameChange(event.target.value)} placeholder="z. B. Nick" />
          <label className="create-notebase-label" htmlFor={`${id}-name`}>NoteBase-Name</label>
          <input id={`${id}-name`} required value={name} onChange={event => onNameChange(event.target.value)} placeholder="z. B. Meine NoteBase" />
          <label className="create-notebase-label" htmlFor={`${id}-path`}>Speicherort</label>
          <div className="create-notebase-path-row">
            <input id={`${id}-path`} required value={parentPath} onChange={event => onParentPathChange(event.target.value)} placeholder="Übergeordneter Ordner" />
            <button type="button" onClick={() => {void onChooseDirectory()}}>Ordner wählen</button>
          </div>
          <div className="create-notebase-modal-actions">
            <button type="button" onClick={close}>Abbrechen</button>
            <button type="submit" className="primary">{pending ? 'Bitte warten …' : 'NoteBase erstellen'}</button>
          </div>
        </fieldset>
      </form>
      {pending ? <p className="muted-copy" role="status">Vorgang läuft. Bitte warte auf den Abschluss.</p> : null}
    </div>
  </div>, document.body)
}

import {useId} from 'react'
import type {CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import type {TagMatchCandidate} from '../app/tagMatchWorkflowState'
import {LucideNamedIcon} from '../icons/lucideCatalog'
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus'
import './TagMatchDialog.css'

export function TagMatchDialog({loading, applying, error, status, needsRescan, match, position, total,
  onClose, onSearch, onMove, onSkip, onApply, onApplyTag, onApplyAll}: {
  loading: boolean
  applying: boolean
  error: string
  status: string
  needsRescan: boolean
  match: TagMatchCandidate | null
  position: number
  total: number
  onClose: () => void
  onSearch: () => Promise<void>
  onMove: (direction: 1 | -1) => void
  onSkip: () => void
  onApply: () => void
  onApplyTag: () => void
  onApplyAll: () => void
}) {
  const id = useId()
  const root = useDialogFocus({busy: applying || loading})
  const close = () => {if (!applying) onClose()}
  const preview = (mode: 'before' | 'after') => match && <section>
    <h4 id={`${id}-${mode}`}>{mode === 'before' ? 'Vorher' : 'Nachher'}</h4>
    <div className="tag-match-editor-preview" role="region" aria-labelledby={`${id}-${mode}`} tabIndex={0}>
      <span className="tag-match-context">{match.before}</span>
      {mode === 'before' ? <mark className="tag-match-highlight">{match.matchedText}</mark>
        : <span className="cm-md-inline-tag-chip tag-match-chip" style={{'--cm-md-tag-color': match.groupColor} as CSSProperties}
          title={`${match.groupDisplayName} / ${match.tagDisplayName}`}>{match.tagDisplayName}</span>}
      <span className="tag-match-context">{match.after}</span>
    </div>
  </section>
  return createPortal(<div className="modal-overlay tag-match-overlay"
    onMouseDown={event => {if (event.target === event.currentTarget) close()}}>
    <div className="tag-match-modal" ref={root} role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={loading || applying || undefined} tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') {event.preventDefault(); close(); return}
        trapDialogTab(event)
        if (!loading && !applying && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
          && !(event.target instanceof Element && event.target.closest('.tag-match-editor-preview'))
          && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault(); onMove(event.key === 'ArrowLeft' ? -1 : 1)
        }
      }}>
      <header className="tag-match-header">
        <h3 id={`${id}-title`}>Tag-Fundstellen prüfen</h3>
        <div className="tag-match-header-actions">
          <button type="button" onClick={() => {void onSearch()}} disabled={loading || applying}
            title="Neuer Prüfdurchlauf, einschließlich zuvor übersprungener Fundstellen">Erneut suchen</button>
          <button type="button" className="icon-button compact muted" onClick={close} disabled={applying}
            aria-label="Tag-Prüfung schließen" title="Schließen (Esc)"><LucideNamedIcon name="X" size={14}/></button>
        </div>
      </header>
      <p className="muted-copy" id={`${id}-description`}>Prüfe Textstellen vor dem Ersetzen durch Tagreferenzen. Überspringen gilt für diesen Prüfdurchlauf.</p>
      {error ? <p className="tag-match-error" role="alert">{error}</p> : null}
      <p className="tag-match-status" role="status" aria-live="polite">{loading ? 'NoteBase wird durchsucht …' : applying ? 'Fundstellen werden übernommen. Bitte warten …' : status}</p>
      {loading ? <div className="tag-match-empty">Suche läuft … Du kannst die Suche mit Esc abbrechen.</div> : match ? <>
        <div className="tag-match-summary-row">
          <span aria-live="polite">Treffer {Math.min(position, total)} von {total}</span>
          <span>{match.groupDisplayName} / {match.tagDisplayName}</span>
        </div>
        <p className="tag-match-location">{match.relativePath} · Zeile {match.line}</p>
        <div className="tag-match-compare-grid">{preview('before')}{preview('after')}</div>
        <footer className="tag-match-actions">
          <div className="tag-match-nav-actions">
            <button type="button" aria-label="Vorherige Fundstelle" title="Vorherige Fundstelle (←)" onClick={() => onMove(-1)} disabled={applying || total <= 1}><LucideNamedIcon name="ChevronLeft" size={14}/></button>
            <button type="button" aria-label="Nächste Fundstelle" title="Nächste Fundstelle (→)" onClick={() => onMove(1)} disabled={applying || total <= 1}><LucideNamedIcon name="ChevronRight" size={14}/></button>
          </div>
          <div className="tag-match-apply-actions">
            <button type="button" onClick={onSkip} disabled={applying}>Überspringen</button>
            <button type="button" onClick={onApplyTag} disabled={applying || needsRescan}>Diesen Tag überall</button>
            <button type="button" onClick={onApplyAll} disabled={applying || needsRescan}>Alle übernehmen</button>
            <button type="button" className="primary" onClick={onApply} disabled={applying || needsRescan}>Übernehmen</button>
          </div>
        </footer>
      </> : <div className="tag-match-empty">
        <p>{error ? 'Keine Vorschau verfügbar. Bitte erneut suchen.' : 'Keine Fundstellen mehr offen.'}</p>
        <button type="button" onClick={close} disabled={applying}>Fertig</button>
      </div>}
    </div>
  </div>, document.body)
}

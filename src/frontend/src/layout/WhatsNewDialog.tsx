import {useEffect, useRef, useState} from 'react'
import {bundledNotes, SEEN_VERSION_KEY} from '../app/releaseNotes'
import {ReleaseNotes} from './ReleaseNotes'
import './UpdateDialog.css'

/** Opens once after an update with the changelog of the new version; "Hilfe → Was ist neu" opens it any time. */
export function WhatsNewDialog({open, onOpen, onClose}:{open:boolean; onOpen:()=>void; onClose:()=>void}) {
  const [version, setVersion] = useState('')
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const openOnce = useRef(onOpen)
  useEffect(() => { openOnce.current = onOpen })
  useEffect(() => {
    let active = true
    void window.nicknotes?.getUpdateState?.().then(state => {
      const current = state.currentVersion
      if (!active || !current) return
      setVersion(current)
      let seen:string|null = null
      try { seen = window.localStorage.getItem(SEEN_VERSION_KEY); window.localStorage.setItem(SEEN_VERSION_KEY, current) } catch { return }
      // A first installation stays quiet; only a version change since the last start is news.
      if (seen && seen !== current && bundledNotes(current)) openOnce.current()
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement|null
    close.current?.focus()
    // The dialog may open during startup, while other surfaces still take focus; a modal keeps it.
    const keep = (event:FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node)) close.current?.focus()
    }
    document.addEventListener('focusin', keep)
    return () => {
      document.removeEventListener('focusin', keep)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  if (!open) return null
  const notes = bundledNotes(version)
  return <div className="modal-overlay update-overlay" onClick={onClose}><div ref={dialog} className="command-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="whats-new-heading" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
  }}>
    <div className="command-dialog-header"><h2 id="whats-new-heading">{version ? `Neu in NickNotes ${version}` : 'Neu in NickNotes'}</h2><button ref={close} onClick={onClose} aria-label="Was ist neu schließen">✕</button></div>
    {notes ? <ReleaseNotes text={notes}/> : <p>Für diese Version sind keine Hinweise hinterlegt.</p>}
    <div className="update-actions">
      <button onClick={() => void window.nicknotes?.openExternalUrl?.('https://github.com/DevNiklasRichter/NickNotes/releases')}>Alle Versionen auf GitHub</button>
    </div>
  </div></div>
}

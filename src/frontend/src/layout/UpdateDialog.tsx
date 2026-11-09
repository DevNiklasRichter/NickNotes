import {useEffect,useRef,useState} from 'react'
import type {UpdateState} from '../app/updateTypes'
import './UpdateDialog.css'

export function UpdateDialog({open,onOpen,onClose}:{open:boolean;onOpen:()=>void;onClose:()=>void}) {
  const [state,setState]=useState<UpdateState>({phase:'disabled',currentVersion:'',message:'Updateinformationen werden geladen …'})
  const [busy,setBusy]=useState(false)
  const close=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    let active=true
    const receive=(value:UpdateState)=>{if(active)setState(value)}
    const unsubscribe=window.nicknotes?.onUpdateState?.(receive)
    void window.nicknotes?.getUpdateState?.().then(receive).catch(()=>receive({phase:'error',currentVersion:'',message:'Updateinformationen sind gerade nicht verfügbar.'}))
    return()=>{active=false;unsubscribe?.()}
  },[])
  useEffect(()=>{
    if(!open)return
    const previous=document.activeElement as HTMLElement|null
    close.current?.focus()
    void window.nicknotes?.checkForUpdates?.().then(setState).catch(()=>setState(previous=>({...previous,phase:'error',message:'Die Updateprüfung konnte nicht abgeschlossen werden.'})))
    return()=>previous?.isConnected?previous.focus():undefined
  },[open])
  if(!open)return ['available','downloaded'].includes(state.phase)?<button className="update-badge" onClick={onOpen}>{state.phase==='downloaded'?'Update installieren':`Update ${state.version} verfügbar`}</button>:null
  const run=async(action:(()=>Promise<UpdateState>)|undefined)=>{
    if(!action||busy)return
    setBusy(true)
    try{setState(await action())}catch{setState(previous=>({...previous,phase:'error',message:'Die Updateaktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.'}))}finally{setBusy(false)}
  }
  return <div className="modal-overlay update-overlay" onClick={onClose}><div className="command-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="updates-heading" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    if(event.key==='Escape'){event.stopPropagation();onClose()}
    if(event.key==='Tab'){
      const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus()}
      else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus()}
    }
  }}>
    <div className="command-dialog-header"><h2 id="updates-heading">NickNotes aktualisieren</h2><button ref={close} onClick={onClose} aria-label="Updatefenster schließen">✕</button></div>
    <p>Installierte Version: <strong>{state.currentVersion||'Entwicklung'}</strong></p>
    <p role={state.phase==='error'?'alert':'status'}>{state.message}</p>
    {state.phase==='downloading'&&<progress aria-label="Update-Download" max={100} value={state.percent??0}/>}
    <div className="update-actions">
      {['idle','current','error'].includes(state.phase)&&<button disabled={busy} onClick={()=>void run(window.nicknotes?.checkForUpdates)}>Nach Updates suchen</button>}
      {state.phase==='available'&&<button disabled={busy} onClick={()=>void run(window.nicknotes?.downloadUpdate)}>Update herunterladen</button>}
      {state.phase==='downloaded'&&<button disabled={busy} onClick={()=>void run(window.nicknotes?.installUpdate)}>Neu starten und installieren</button>}
      <button onClick={()=>void window.nicknotes?.openExternalUrl?.('https://github.com/DevNiklasRichter/NickNotes/releases')}>Releases auf GitHub</button>
    </div>
    <p className="muted-copy">Freigegebene stabile Versionen werden automatisch geprüft. Installation erst nach deiner Zustimmung; ungespeicherte Änderungen werden vorher abgefragt.</p>
  </div></div>
}

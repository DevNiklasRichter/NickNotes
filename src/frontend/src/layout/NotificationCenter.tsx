import {useState} from 'react'
import type {OperatorNotification} from '../app/AppShared'
import {LucideNamedIcon} from '../icons/lucideCatalog'
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus'
import './NotificationCenter.css'

const labels = {info:'Information', warn:'Hinweis', error:'Fehler', critical:'Kritischer Fehler'}
function NotificationDialog({items,onDismiss,onClose}:{items:OperatorNotification[];onDismiss:(id:number)=>void;onClose:()=>void}) {
  const root=useDialogFocus()
  return <div className="modal-overlay" onClick={onClose}><div className="notification-dialog" ref={root} role="dialog" aria-modal="true" aria-labelledby="notification-heading" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    trapDialogTab(event)
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose()}
  }}>
    <header><h2 id="notification-heading">Meldungen</h2><button aria-label="Meldungen schließen" onClick={onClose}><LucideNamedIcon name="X" size={16}/></button></header>
    <p>Hinweise verschwinden von selbst. Fehler bleiben hier, bis du sie bestätigst. Wiederhole fehlgeschlagene Aktionen bewusst am ursprünglichen Vorgang; deine Entwürfe bleiben erhalten.</p>
    {items.length===0?<p>Keine offenen Meldungen.</p>:<ul>{items.slice().reverse().map(item=><li key={item.id} className={item.severity}>
      <strong>{labels[item.severity]}</strong><p>{item.message}</p>{item.severity==='info'||item.severity==='warn'?null:<button onClick={event=>{
        // Keep focus on an available control after removing its own row.
        event.currentTarget.closest('.notification-dialog')?.querySelector<HTMLButtonElement>('header button')?.focus()
        onDismiss(item.id)
      }}>Bestätigen</button>}
    </li>)}</ul>}
  </div></div>
}

export function NotificationCenter({items,onDismiss}:{items:OperatorNotification[];onDismiss:(id:number)=>void}) {
  const [open,setOpen]=useState(false)
  const errors=items.filter(item=>item.severity==='error'||item.severity==='critical')
  const persistent=errors.slice().reverse().find(item=>item.severity==='critical')??errors.at(-1)
  return <>
    <button className={`notification-trigger${persistent?' has-error':''}`} aria-label={`Meldungen${errors.length?` (${errors.length} Fehler)`:''}`} aria-haspopup="dialog" onClick={()=>setOpen(true)} data-tooltip="Meldungen anzeigen">
      <LucideNamedIcon name={persistent?'AlertCircle':'Info'} size={16}/>{errors.length?<span>{errors.length}</span>:null}
    </button>
    {persistent&&!open?<aside className="notification-attention" role="alert" key={persistent.id}>
      <LucideNamedIcon name="AlertCircle" size={18}/><span>{persistent.message}</span><button onClick={()=>setOpen(true)}>Details</button><button aria-label="Fehler bestätigen" onClick={()=>onDismiss(persistent.id)}><LucideNamedIcon name="X" size={16}/></button>
    </aside>:null}
    {open?<NotificationDialog items={items} onDismiss={onDismiss} onClose={()=>setOpen(false)}/>:null}
  </>
}

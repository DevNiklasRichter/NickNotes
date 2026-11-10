import {Fragment, useEffect, useState, type KeyboardEvent} from 'react'
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus'
import {apiRequest} from '../app/apiClient'
import {COMMAND_GROUPS, COMMANDS, shortcutLabel} from '../app/commands'
import type {SearchRow} from '../app/AppShared'

function dialogKeys(event:KeyboardEvent<HTMLDivElement>,close:()=>void) {
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
  trapDialogTab(event)
}

export function QuickOpenDialog({backendUrl,vaultPath,onClose,onOpen}:{backendUrl:string;vaultPath:string;onClose:()=>void;onOpen:(path:string,title:string)=>Promise<void>}) {
  const root=useDialogFocus()
  const [query,setQuery]=useState('')
  const [items,setItems]=useState<SearchRow[]>([])
  const [selected,setSelected]=useState(0)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    const timer=window.setTimeout(()=>{
      void apiRequest<{items:SearchRow[]}>(backendUrl,`/search?query=${encodeURIComponent(query)}&limit=50`,{signal:controller.signal})
        .then(result=>{if(!controller.signal.aborted){setItems(result.items);setSelected(0);setError('')}})
        .catch(caught=>{if(!controller.signal.aborted)setError(String(caught))})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    },150)
    return()=>{window.clearTimeout(timer);controller.abort()}
  },[backendUrl,query])
  const pick=(item:SearchRow)=>{onClose();void onOpen(item.path,item.title)}
  return <div className="modal-overlay" onClick={onClose}><div ref={root} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-open-heading" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    dialogKeys(event,onClose)
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowUp'?-1:1)+items.length)%Math.max(1,items.length))}
    if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();if(!loading&&items[selected])pick(items[selected])}
  }}>
    <div className="command-dialog-header"><h2 id="quick-open-heading">Notiz öffnen</h2><button onClick={onClose} aria-label="Notizsuche schließen">✕</button></div>
    <input aria-label="Notiz suchen" placeholder="Titel oder Inhalt durchsuchen …" value={query} onChange={event=>{setLoading(true);setQuery(event.target.value)}} role="combobox" aria-expanded="true" aria-controls="quick-open-results" aria-activedescendant={items[selected]?`quick-open-${selected}`:undefined} aria-autocomplete="list"/>
    {loading?<p role="status">Suche läuft …</p>:error?<p role="alert">{error}</p>:items.length===0?<p role="status">Keine passenden Notizen gefunden.</p>:null}
    <div className="quick-open-results" role="listbox" id="quick-open-results" aria-label="Gefundene Notizen">{!loading&&items.map((item,index)=><button key={item.path} id={`quick-open-${index}`} role="option" aria-selected={selected===index} onPointerEnter={()=>setSelected(index)} onClick={()=>pick(item)}><strong>{item.title}</strong><small>{item.path.replaceAll('\\','/').replace(vaultPath.replaceAll('\\','/')+'/','')}</small></button>)}</div>
    <p className="muted-copy">↑ ↓ auswählen · Eingabe öffnen · Esc schließen · maximal 50 Treffer</p>
  </div></div>
}

export function ShortcutHelpDialog({onClose}:{onClose:()=>void}) {
  const root=useDialogFocus()
  const [filter,setFilter]=useState('')
  const commands=COMMANDS.filter(command=>(command.label+' '+shortcutLabel(command.id)).toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  return <div className="modal-overlay" onClick={onClose}><div ref={root} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-heading" onClick={event=>event.stopPropagation()} onKeyDown={event=>dialogKeys(event,onClose)}>
    <div className="command-dialog-header"><h2 id="shortcut-heading">Tastenkürzel und Bedienung</h2><button onClick={onClose} aria-label="Tastenkürzel schließen">✕</button></div>
    <p>Menüs mit F10 oder Alt+D (Datei), Alt+B (Bearbeiten), Alt+A (Ansicht) und Alt+H (Hilfe) öffnen. Pfeiltasten navigieren, Esc schließt. Ansichten sind Tabs im Arbeitsbereich; das App-Fenster bleibt beim Schließen von Ansichten geöffnet.</p>
    <input aria-label="Tastenkürzel filtern" placeholder="Befehl oder Tastenkürzel …" value={filter} onChange={event=>setFilter(event.target.value)}/>
    <div className="shortcut-reference">{COMMAND_GROUPS.map(group=><Fragment key={group}>{commands.some(command=>command.group===group)&&<h3>{group}</h3>}{commands.filter(command=>command.group===group).map(command=><Fragment key={command.id}><span>{command.label}</span><kbd>{shortcutLabel(command.id)||'Über das Menü'}</kbd></Fragment>)}</Fragment>)}</div>
    <p className="muted-copy">Ungespeicherte Änderungen werden vor dem Schließen abgefragt. Datei löschen verlangt eine Bestätigung. Normale Textkürzel wirken im gerade fokussierten Eingabefeld.</p>
  </div></div>
}

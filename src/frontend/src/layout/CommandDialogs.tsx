import {Fragment, useEffect, useId, useRef, useState, type KeyboardEvent} from 'react'
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus'
import {apiRequest, connectionEpoch} from '../app/apiClient'
import {COMMAND_GROUPS, COMMANDS, commandForKey, shortcutLabel, type AppCommand, type CommandId} from '../app/commands'
import {normalizeFilePathKey, type SearchRow} from '../app/AppShared'
import {LucideNamedIcon} from '../icons/lucideCatalog'
import './CommandDialogs.css'

function dialogKeys(event:KeyboardEvent<HTMLDivElement>,close:()=>void) {
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
  trapDialogTab(event)
}

export type QuickOpenNote = Pick<SearchRow, 'path' | 'title'>
type SearchOption = {kind:'note'; note:QuickOpenNote; label:string; detail:string} | {kind:'command'; command:AppCommand; label:string; detail:string}
type SearchResult = {key:string; items:SearchRow[]; error:string}

export function QuickOpenDialog({backendUrl,vaultPath,initialQuery,openedNotes,commands,onClose,onOpen,onExecute}:{
  backendUrl:string;vaultPath:string;initialQuery:string;openedNotes:QuickOpenNote[];commands:AppCommand[]
  onClose:()=>void;onOpen:(path:string,title:string)=>Promise<void>;onExecute:(id:CommandId)=>void
}) {
  const root=useDialogFocus()
  const field=useRef<HTMLInputElement>(null)
  const id=useId()
  const [query,setQuery]=useState(initialQuery)
  const [result,setResult]=useState<SearchResult|null>(null)
  const [selected,setSelected]=useState(0)
  const [retry,setRetry]=useState(0)
  const [announcement,setAnnouncement]=useState('')
  const commandMode=query.trimStart().startsWith('>')
  const search=commandMode?query.trimStart().slice(1).trim():query.trim()
  const epoch=connectionEpoch()
  const requestKey=JSON.stringify([backendUrl,vaultPath,search,retry,epoch])
  const current=result?.key===requestKey?result:null
  const loading=!commandMode&&Boolean(vaultPath)&&!current
  const error=!commandMode?current?.error:undefined
  useEffect(()=>{
    if(commandMode||!vaultPath)return
    const controller=new AbortController()
    const timer=window.setTimeout(()=>{
      void apiRequest<{items:SearchRow[]}>(backendUrl,`/search?query=${encodeURIComponent(search)}&limit=50`,{signal:controller.signal})
        .then(value=>{if(!controller.signal.aborted&&connectionEpoch()===epoch)setResult({key:requestKey,items:value.items,error:''})})
        .catch(caught=>{if(!controller.signal.aborted&&connectionEpoch()===epoch)setResult({key:requestKey,items:[],error:String(caught)})})
    },150)
    return()=>{window.clearTimeout(timer);controller.abort()}
  },[backendUrl,vaultPath,search,requestKey,commandMode,epoch])
  const pathLabel=(path:string)=>path.replaceAll('\\','/').replace(vaultPath.replaceAll('\\','/')+'/','')
  const noteOption=(note:QuickOpenNote):SearchOption=>({kind:'note',note,label:note.title,detail:pathLabel(note.path)})
  const groups:{label:string;items:SearchOption[]}[]=commandMode?COMMAND_GROUPS.map(group=>({label:group,items:commands
    .filter(command=>command.group===group&&search.toLocaleLowerCase().split(/\s+/).every(word=>(command.label+' '+command.group+' '+shortcutLabel(command.id)).toLocaleLowerCase().includes(word)))
    .map(command=>({kind:'command' as const,command,label:command.label,detail:command.enabled?'':command.disabledReason||'Der Befehl ist hier nicht verfügbar.'}))})):[
      {label:'Geöffnete Notizen',items:search?[]:openedNotes.map(noteOption)},
      {label:'Notizen in der NoteBase',items:(current?.items??[]).filter(note=>search||!openedNotes.some(open=>normalizeFilePathKey(open.path)===normalizeFilePathKey(note.path))).map(noteOption)},
    ]
  const options=groups.flatMap(group=>group.items)
  const index=Math.min(selected,Math.max(0,options.length-1))
  const activeId=options[index]?`${id}-option-${index}`:undefined
  useEffect(()=>{if(activeId)document.getElementById(activeId)?.scrollIntoView({block:'nearest'})},[activeId])
  const changeQuery=(value:string)=>{setQuery(value);setSelected(0);setAnnouncement('')}
  const mode=(asCommand:boolean)=>{changeQuery(asCommand?'>'+search:search);field.current?.focus()}
  const pick=(option:SearchOption)=>{
    if(connectionEpoch()!==epoch)return
    if(option.kind==='command') {
      if(!option.command.enabled){setAnnouncement(option.detail);field.current?.focus();return}
      onExecute(option.command.id)
    } else {onClose();void onOpen(option.note.path,option.note.title)}
  }
  let optionIndex=0
  return <div className="modal-overlay" onClick={onClose}><div ref={root} className="command-dialog quick-open-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return
    const shortcut=commandForKey(event.nativeEvent)
    if(shortcut?.id==='commandPalette'||shortcut?.id==='openNote'){event.preventDefault();mode(shortcut.id==='commandPalette');return}
    dialogKeys(event,onClose)
    if(event.defaultPrevented)return
    if(event.target instanceof HTMLInputElement){
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelected((index+(event.key==='ArrowUp'?-1:1)+options.length)%Math.max(1,options.length))}
      if(event.key==='Enter'){event.preventDefault();if(options[index])pick(options[index])}
    }
  }}>
    <div className="command-dialog-header"><h2 id={`${id}-heading`}>Notizen und Befehle</h2><button className="icon-button compact" onClick={onClose} aria-label={commandMode?'Befehlssuche schließen':'Notizsuche schließen'}><LucideNamedIcon name="X" size={14}/></button></div>
    <input ref={field} aria-label={commandMode?'Befehl suchen':'Notiz suchen'} placeholder="Titel oder Inhalt · > für Befehle" value={query} onChange={event=>changeQuery(event.target.value)} role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={activeId} aria-describedby={`${id}-help`} aria-autocomplete="list"/>
    <div className="quick-open-modes" role="group" aria-label="Suchbereich">
      <button type="button" aria-pressed={!commandMode} onClick={()=>mode(false)}>Notizen <kbd>{shortcutLabel('openNote')}</kbd></button>
      <button type="button" aria-pressed={commandMode} onClick={()=>mode(true)}>Befehle <kbd>{shortcutLabel('commandPalette')}</kbd></button>
    </div>
    {loading?<p role="status" className="quick-open-status">Suche läuft …</p>:null}
    {error?<div className="quick-open-error"><p role="alert">{error}</p><button onClick={()=>{setSelected(0);setRetry(value=>value+1)}}>Erneut suchen</button></div>:null}
    {!commandMode&&!vaultPath?<p role="status">Öffne eine NoteBase, um Notizen zu suchen. App-Befehle sind bereits verfügbar.</p>:!loading&&!error&&options.length===0?<p role="status">{commandMode?'Keine passenden Befehle gefunden.':'Keine passenden Notizen gefunden.'}</p>:null}
    <div className="quick-open-results" role="listbox" id={`${id}-results`} aria-label={commandMode?'Gefundene Befehle':'Gefundene Notizen'}>{groups.filter(group=>group.items.length).map(group=><div key={group.label} role="group" aria-label={group.label}>
      <h3 className="quick-open-group-heading" aria-hidden="true">{group.label}</h3>
      {group.items.map(option=>{const rowIndex=optionIndex++;const disabled=option.kind==='command'&&!option.command.enabled;return <button type="button" key={option.kind==='note'?option.note.path:option.command.id} id={`${id}-option-${rowIndex}`} role="option" tabIndex={-1} aria-selected={index===rowIndex} aria-disabled={disabled||undefined} onMouseDown={event=>event.preventDefault()} onPointerEnter={()=>setSelected(rowIndex)} onClick={()=>pick(option)}>
        <LucideNamedIcon name={option.kind==='note'?'FileText':'Command'} size={16} className="quick-open-option-icon"/>
        <span className="quick-open-option-copy"><strong>{option.label}</strong>{option.detail?<small>{option.detail}</small>:null}</span>
        {option.kind==='command'?<kbd>{shortcutLabel(option.command.id)}</kbd>:null}
      </button>})}
    </div>)}</div>
    {announcement?<p role="status" className="quick-open-status">{announcement}</p>:null}
    <p className="muted-copy" id={`${id}-help`}>↑ ↓ auswählen · Eingabe {commandMode?'ausführen':'öffnen'} · Esc schließen · {commandMode?'ohne > Notizen suchen':'mit > Befehle suchen · maximal 50 Suchtreffer'}</p>
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

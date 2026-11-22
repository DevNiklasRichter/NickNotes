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

export type TemplateRow = {name:string; kind:string; daily:boolean}

/** "Neu aus Vorlage": pick a template from `.system/templates`; deleting asks a second click. */
export function TemplatePickerDialog({backendUrl,onClose,onPick,onError}:{
  backendUrl:string;onClose:()=>void;onPick:(template:TemplateRow)=>void;onError:(message:string)=>void
}) {
  const root=useDialogFocus()
  const id=useId()
  const [items,setItems]=useState<TemplateRow[]|null>(null)
  const [filter,setFilter]=useState('')
  const [selected,setSelected]=useState(0)
  const [confirmDelete,setConfirmDelete]=useState('')
  const field=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    const controller=new AbortController()
    void apiRequest<{items:TemplateRow[]}>(backendUrl,'/templates',{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setItems(value.items)})
      .catch(caught=>{if(!controller.signal.aborted){setItems([]);onError(String(caught))}})
    return()=>controller.abort()
  },[backendUrl,onError])
  const words=filter.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const options=(items??[]).filter(item=>words.every(word=>item.name.toLocaleLowerCase().includes(word)))
  const index=Math.min(selected,Math.max(0,options.length-1))
  const activeId=options[index]?`${id}-option-${index}`:undefined
  const remove=async(template:TemplateRow)=>{
    if(confirmDelete!==template.name){setConfirmDelete(template.name);return}
    try{
      const value=await apiRequest<{items:TemplateRow[]}>(backendUrl,'/templates/delete',{method:'POST',body:JSON.stringify({name:template.name})})
      setItems(value.items);setConfirmDelete('')
      field.current?.focus()  // the deleted row took the focused button with it
    }catch(caught){onError(String(caught))}
  }
  const detail=(item:TemplateRow)=>confirmDelete===item.name?'Zum Löschen noch einmal auf den Papierkorb klicken.':`${item.kind==='task'?'Task':'Notiz'}${item.daily?' · gilt für neue Tagesnotizen':''}`
  return <div className="modal-overlay" onClick={onClose}><div ref={root} className="command-dialog quick-open-dialog template-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return
    dialogKeys(event,onClose)
    if(event.defaultPrevented||!(event.target instanceof HTMLInputElement))return
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setConfirmDelete('');setSelected((index+(event.key==='ArrowUp'?-1:1)+options.length)%Math.max(1,options.length))}
    if(event.key==='Enter'){event.preventDefault();if(options[index])onPick(options[index])}
  }}>
    <div className="command-dialog-header"><h2 id={`${id}-heading`}>Neu aus Vorlage</h2><button className="icon-button compact" onClick={onClose} aria-label="Vorlagenauswahl schließen"><LucideNamedIcon name="X" size={14}/></button></div>
    <input ref={field} aria-label="Vorlage suchen" placeholder="Vorlage …" value={filter} onChange={event=>{setFilter(event.target.value);setSelected(0);setConfirmDelete('')}} role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={activeId} autoFocus/>
    {items===null?<p role="status" className="quick-open-status">Vorlagen werden geladen …</p>
      :items.length===0?<p role="status">Noch keine Vorlagen. Öffne eine Notiz oder Task und wähle „Datei → Als Vorlage speichern“. Aus einer Tagesnotiz wird die Vorlage für neue Tagesnotizen.</p>
      :options.length===0?<p role="status">Keine passende Vorlage.</p>:null}
    <div className="quick-open-results" role="listbox" id={`${id}-results`} aria-label="Vorlagen">{options.map((item,rowIndex)=><div key={item.name} className="template-picker-row">
      <button type="button" id={`${id}-option-${rowIndex}`} role="option" tabIndex={-1} aria-selected={index===rowIndex} onMouseDown={event=>event.preventDefault()} onPointerEnter={()=>setSelected(rowIndex)} onClick={()=>onPick(item)}>
        <LucideNamedIcon name={item.kind==='task'?'CheckSquare':'FileText'} size={16} className="quick-open-option-icon"/>
        <span className="quick-open-option-copy"><strong>{item.name}</strong><small>{detail(item)}</small></span>
      </button>
      <button type="button" className={`icon-button compact${confirmDelete===item.name?' danger':''}`} aria-label={confirmDelete===item.name?`Vorlage „${item.name}“ wirklich löschen`:`Vorlage „${item.name}“ löschen`} data-tooltip={confirmDelete===item.name?'Wirklich löschen':'Vorlage löschen'} onClick={()=>void remove(item)}><LucideNamedIcon name="Trash2" size={14}/></button>
    </div>)}</div>
    <p className="muted-copy">Platzhalter in Vorlagen: {'{{titel}}'}, {'{{datum}}'}, {'{{wochentag}}'}, {'{{uhrzeit}}'}. Vorlagen liegen in der NoteBase unter .system/templates.</p>
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

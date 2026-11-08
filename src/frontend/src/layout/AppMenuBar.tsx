import {useCallback, useEffect, useEffectEvent, useRef, useState} from 'react'
import {COMMAND_GROUPS, commandForKey, shortcutLabel, type AppCommand, type CommandId} from '../app/commands'
import './AppMenuBar.css'

export function AppMenuBar({commands,execute}:{commands:AppCommand[];execute:(id:CommandId)=>void}) {
  const [open,setOpen]=useState<number|null>(null)
  const root=useRef<HTMLDivElement>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  const openMenu=useCallback((index:number)=>{
    if(!root.current?.contains(document.activeElement))previousFocus.current=document.activeElement as HTMLElement
    setOpen(index)
  },[])
  useEffect(()=>{
    if(open!==null)root.current?.querySelector<HTMLButtonElement>('[role="menu"] [role^="menuitem"]:not(:disabled)')?.focus()
  },[open])
  const globalKey=useEffectEvent((event:KeyboardEvent)=>{
    if(event.isComposing||document.querySelector('.modal-overlay'))return
    const altIndex=event.altKey&&!event.ctrlKey&&!event.metaKey?['d','b','a','h'].indexOf(event.key.toLowerCase()):-1
    if(altIndex>=0){event.preventDefault();openMenu(altIndex)}
    else if(event.key==='F10'){
      event.preventDefault()
      if(open!==null){setOpen(null);previousFocus.current?.focus()}
      else {previousFocus.current=document.activeElement as HTMLElement;root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus()}
    } else {
      const command=commandForKey(event)
      if(!command)return
      if(open!==null&&command.native&&command.id!=='quit'){
        event.preventDefault();previousFocus.current?.focus();execute(command.id)
      }
      setOpen(null)
    }
  })
  useEffect(()=>{
    const pointer=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(null)}
    const key=(event:KeyboardEvent)=>globalKey(event)
    document.addEventListener('pointerdown',pointer)
    window.addEventListener('keydown',key)
    return()=>{document.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key)}
  },[])
  return <div className="app-menu-bar" ref={root} role="menubar" aria-label="Hauptmenü" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(null);previousFocus.current?.focus();return}
    if(event.key==='Tab'){setOpen(null);return}
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('[aria-haspopup]')]
      const index=open??Math.max(0,buttons.indexOf(document.activeElement as HTMLButtonElement))
      const next=(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length
      if(open!==null)openMenu(next);else buttons[next]?.focus()
    }
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&open!==null){
      event.preventDefault();const items=[...root.current!.querySelectorAll<HTMLButtonElement>('[role="menu"] [role^="menuitem"]:not(:disabled)')]
      const index=items.indexOf(document.activeElement as HTMLButtonElement)
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length
      items[next]?.focus()
    }
  }}>
    {COMMAND_GROUPS.map((group,index)=><div className="app-menu-root" key={group}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open===index} aria-controls={open===index?`app-menu-${index}`:undefined} onPointerDown={event=>event.preventDefault()} onClick={()=>open===index?setOpen(null):openMenu(index)} onPointerEnter={()=>{if(open!==null&&open!==index)openMenu(index)}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();openMenu(index)}}}>{group}</button>
      {open===index&&<div className="app-menu-dropdown" id={`app-menu-${index}`} role="menu" aria-label={group}>
        {commands.filter(command=>command.group===group).map(command=><button key={command.id} data-command={command.id} role={command.checked===undefined?'menuitem':'menuitemcheckbox'} aria-checked={command.checked} disabled={!command.enabled} onClick={()=>{setOpen(null);previousFocus.current?.focus();execute(command.id)}}>
          <span className="app-menu-check" aria-hidden="true">{command.checked?'✓':''}</span><span>{command.label}</span><kbd>{shortcutLabel(command.id)}</kbd>
        </button>)}
      </div>}
    </div>)}
  </div>
}

import {useEffect, useEffectEvent, useRef} from 'react'
import {commandForKey, type AppCommand, type CommandId} from './commands'

export function useAppCommands(commands:AppCommand[], onError:(message:string)=>void, settingsOpen:boolean) {
  const running=useRef(new Set<CommandId>())
  const execute=(id:CommandId) => {
    const command=commands.find(item=>item.id===id)
    if(!command?.enabled||running.current.has(id))return
    running.current.add(id)
    try {
      Promise.resolve(command.run()).catch(error=>onError(String(error))).finally(()=>running.current.delete(id))
    } catch(error) {running.current.delete(id);onError(String(error))}
  }
  const keydown=useEffectEvent((event:KeyboardEvent)=>{
    if(event.defaultPrevented||event.isComposing||event.repeat||event.getModifierState('AltGraph'))return
    const command=commandForKey(event)
    if(!command||command.native)return // Let the focused editor/input handle normal text editing.
    event.preventDefault()
    if(document.querySelector('.modal-overlay') && !(settingsOpen&&command.id==='save'))return
    execute(command.id)
  })
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>keydown(event)
    window.addEventListener('keydown',listener,true)
    return()=>window.removeEventListener('keydown',listener,true)
  },[])
  return execute
}

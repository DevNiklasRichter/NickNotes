import {useEffect, useEffectEvent, useMemo} from 'react'
import {commandForKey, type AppCommand, type CommandId} from './commands'
import {connectionEpoch} from './apiClient'

/** Preserve save requests and their targets; never replay them in another NoteBase. */
export function createCommandRunner(onError:(message:string)=>void) {
  const running=new Set<CommandId>()
  let saveQueue=Promise.resolve()
  let generation=0
  return {
    execute(command:AppCommand|undefined):Promise<void> {
      if(!command?.enabled)return Promise.resolve()
      const requestedGeneration=generation,requestedEpoch=connectionEpoch()
      const invoke=async()=>{
        if(generation!==requestedGeneration||connectionEpoch()!==requestedEpoch)return
        try {await command.run()}
        catch(error) {
          if(generation===requestedGeneration&&connectionEpoch()===requestedEpoch)onError(String(error))
        }
      }
      if(command.id==='save'||command.id==='saveAll'){
        saveQueue=saveQueue.then(invoke)
        return saveQueue
      }
      if(running.has(command.id))return Promise.resolve()
      running.add(command.id)
      return invoke().finally(()=>running.delete(command.id))
    },
    cancelPending(){generation++},
  }
}

export function useAppCommands(commands:AppCommand[], onError:(message:string)=>void, settingsOpen:boolean) {
  const runner=useMemo(()=>createCommandRunner(onError),[onError])
  const execute=(id:CommandId)=>runner.execute(commands.find(item=>item.id===id))
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
    return()=>{window.removeEventListener('keydown',listener,true);runner.cancelPending()}
  },[runner])
  return execute
}

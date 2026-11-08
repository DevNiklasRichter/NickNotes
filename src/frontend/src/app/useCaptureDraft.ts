import {useEffect,useRef,useState} from 'react'

/** Pending capture only: normal notes/tasks still use the shared Markdown backend. */
export function useCaptureDraft(onError:(message:string)=>void) {
  const [text,setText]=useState(()=> (document.getElementById('startup-draft') as HTMLTextAreaElement|null)?.value??'')
  const [active,setActive]=useState(()=>Boolean(document.getElementById('startup')?.hidden))
  const lastError=useRef('')
  useEffect(()=>{
    const receive=(event:Event)=>setText((event as CustomEvent<string>).detail)
    const activate=()=>setActive(true)
    window.addEventListener('nicknotes:startup-draft',receive)
    window.addEventListener('nicknotes:startup-complete',activate)
    return()=>{window.removeEventListener('nicknotes:startup-draft',receive);window.removeEventListener('nicknotes:startup-complete',activate)}
  },[])
  useEffect(()=>{
    if(!active)return
    // Keep the plain fallback current if React later crashes after a successful start.
    const fallback=document.getElementById('startup-draft') as HTMLTextAreaElement|null
    if(fallback)fallback.value=text
    void window.nicknotes?.writeCaptureDraft?.(text).catch(error=>{
      const message='Schnellerfassungsentwurf konnte nicht lokal gesichert werden: '+String(error)
      if(lastError.current!==message){lastError.current=message;onError(message)}
    })
  },[text,onError,active])
  return [text,setText] as const
}

import {useEffect,useState} from 'react'

/** Short saves stay quiet; a pending save never implies a completed write. */
export function SaveProgress({pending}:{pending:boolean}) {
  const [visible,setVisible]=useState(false)
  useEffect(()=>{
    if(!pending)return
    const timer=window.setTimeout(()=>setVisible(true),400)
    return()=>{window.clearTimeout(timer);setVisible(false)}
  },[pending])
  return <span className="save-progress" role="status" aria-live="polite">{pending&&visible?'Wird gespeichert …':''}</span>
}

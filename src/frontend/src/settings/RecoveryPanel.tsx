import {useEffect, useState} from 'react'
import {apiRequest} from '../app/apiClient'
type Recovery = {id:string; operation:string; paths:string[]; manifest:string}
export function RecoveryPanel({backendUrl}: {backendUrl:string}) {
 const [items,setItems]=useState<Recovery[]>([])
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 useEffect(() => {
   const controller=new AbortController()
   void apiRequest<{items:Recovery[]}>(backendUrl,'/recovery',{signal:controller.signal}).then(result=>setItems(result.items)).catch(error=>{if(!controller.signal.aborted)setMessage(String(error))})
   return ()=>controller.abort()
 },[backendUrl])
 async function resolve(item:Recovery,action:'restore'|'keep') {
   if(!window.confirm(action==='restore' ? 'Den Stand vor dieser unterbrochenen Aenderung wiederherstellen? Der aktuelle Stand wird vorher gesichert.' : 'Den aktuellen Dateistand beibehalten und die unterbrochene Aenderung abschliessen?'))return
   setBusy(true)
   try {
     await apiRequest(backendUrl,`/recovery/${item.id}`,{method:'POST',body:JSON.stringify({action})})
     setItems(previous=>previous.filter(value=>value.id!==item.id));setMessage('Aenderung aufgeloest. Die Sicherheitskopien bleiben erhalten.')
   } catch(error){setMessage(String(error))} finally {setBusy(false)}
 }
 if(!items.length&&!message)return null
 return <section className="settings-block"><h4>Unterbrochene Aenderungen pruefen</h4><p>Neue Schreibvorgaenge warten, bis du den Dateistand geprueft hast. Die aufgelisteten Dateien und Sicherheitskopien bleiben lokal.</p>{items.map(item=><div key={item.id}><strong>{item.operation}</strong><details><summary>{item.paths.length} betroffene Dateien</summary><ul>{item.paths.slice(0,100).map(path=><li key={path}>{path}</li>)}</ul><p>Journal: {item.manifest}</p></details><button type="button" disabled={busy} onClick={()=>void resolve(item,'restore')}>Vorherigen Stand wiederherstellen</button><button type="button" disabled={busy} onClick={()=>void resolve(item,'keep')}>Aktuellen Stand beibehalten</button></div>)}{message&&<p role="status">{message}</p>}</section>
}

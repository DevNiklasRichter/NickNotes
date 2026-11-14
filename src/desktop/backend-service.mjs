import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {Worker} from 'node:worker_threads'

// Same folder the backend uses (local_data.user_data_path): one service per Windows user.
export function serviceDataDir(){
  return process.env.NICKNOTES_USER_DATA||path.join(process.env.LOCALAPPDATA||os.homedir(),'NickNotes')
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function waitFor(check,timeout,message){
  const deadline=Date.now()+timeout
  while(Date.now()<deadline){
    const result=await check()
    if(result)return result
    await pause(150)
  }
  throw new Error(message)
}

/** Attach to the per-user NickNotes service or start it; the app never owns a private backend. */
export function createBackendService({executable,args,cwd,version,port,inheritOutput=false}){
  const infoPath=()=>path.join(serviceDataDir(),'service.json')
  const read=async()=>{try{return JSON.parse(await fs.promises.readFile(infoPath(),'utf8'))}catch{return null}}
  const call=async(info,method,route,body)=>{
    const response=await fetch(`http://127.0.0.1:${info.port}${route}`,{method,signal:AbortSignal.timeout(3000),
      headers:{Authorization:`Bearer ${info.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    if(!response.ok)throw new Error(`Der lokale Dienst antwortet mit ${response.status}.`)
    return response.json()
  }
  const alive=async info=>{
    if(!info?.token||!info.port)return false
    try{await call(info,'GET','/service');return true}catch{return false}
  }
  const spawnDetached=extra=>new Promise((resolve,reject)=>{
    // Windows may stall synchronously inside spawn while checking a fresh executable; keep it off the UI thread.
    const worker=new Worker(new URL('./backend-worker.mjs',import.meta.url),{workerData:{executable,args:[...args,'--service',...extra],cwd,inheritOutput}})
    worker.once('message',message=>message.event==='spawned'?resolve(message.pid):reject(new Error(message.message)))
    worker.once('error',reject)
  })
  const stop=async info=>{
    if(!await alive(info))return
    try{await call(info,'POST','/service/shutdown',{})}catch{ /* It may already be gone. */ }
    await waitFor(async()=>!await alive(info),6500,'Der lokale Dienst lässt sich nicht beenden.').catch(()=>{})
  }
  return {
    /** ownerPid: the service ends with this process; null keeps it reachable for agents. */
    async ensure(ownerPid){
      const current=await read()
      if(await alive(current)){
        if(current.version===version&&current.port===port){
          await call(current,'POST','/service/owner',{pid:ownerPid??null})
          return current
        }
        await stop(current)  // left over from another version
      }
      await spawnDetached(ownerPid?['--owner-pid',String(ownerPid)]:[])
      return waitFor(async()=>{const next=await read();return await alive(next)?next:null},45000,
        `Der lokale Dienst antwortet nicht. Möglicherweise ist Port ${port} belegt.`)
    },
    async setOwner(ownerPid){
      const current=await read()
      if(await alive(current))await call(current,'POST','/service/owner',{pid:ownerPid??null})
    },
    async stop(){await stop(await read())},
  }
}

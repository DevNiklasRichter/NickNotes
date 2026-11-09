import {parentPort,workerData} from 'node:worker_threads'
import {spawn} from 'node:child_process'

// Windows may synchronously stall inside spawn while checking a fresh executable.
// Keep that work and the owned control pipe away from Electron's UI thread.
let child,killTimer
parentPort.on('message',message=>{
  if(message!=='stop')return
  try{child?.stdin.write(JSON.stringify({command:'shutdown'})+'\n')}catch{ /* Exit is reported below. */ }
  killTimer=setTimeout(()=>child?.kill(),5000)
})
try{
  child=spawn(workerData.executable,workerData.args,{
    cwd:workerData.cwd,windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,NICKNOTES_DESKTOP_BOOT:'1',PYTHONUNBUFFERED:'1'},
  })
  parentPort.postMessage({event:'spawned',pid:child.pid})
  child.stdin.on('error',()=>{})
  child.stdin.write(JSON.stringify(workerData.boot)+'\n')
  child.stderr.on('data',data=>process.stderr.write(data))
  let pending=''
  child.stdout.on('data',data=>{
    pending+=data.toString()
    let index
    while((index=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,index);pending=pending.slice(index+1)
      try{if(JSON.parse(line).event==='ready')parentPort.postMessage({event:'ready'})}catch{ /* Only readiness belongs on the control channel. */ }
    }
  })
  child.once('error',error=>{
    parentPort.postMessage({event:'error',message:error.message});parentPort.close()
  })
  child.once('exit',code=>{
    clearTimeout(killTimer);parentPort.postMessage({event:'exit',code});parentPort.close()
  })
}catch(error){parentPort.postMessage({event:'error',message:error.message});parentPort.close()}

import {parentPort,workerData} from 'node:worker_threads'
import {spawn} from 'node:child_process'

// Starts the per-user service detached from the app and reports its pid; the worker then ends.
try{
  const child=spawn(workerData.executable,workerData.args,{
    cwd:workerData.cwd,detached:true,windowsHide:true,
    stdio:workerData.inheritOutput?['ignore','inherit','inherit']:'ignore',
    env:{...process.env,PYTHONUNBUFFERED:'1'},
  })
  child.once('error',error=>parentPort.postMessage({event:'error',message:error.message}))
  child.once('spawn',()=>{parentPort.postMessage({event:'spawned',pid:child.pid});child.unref()})
}catch(error){parentPort.postMessage({event:'error',message:error.message})}

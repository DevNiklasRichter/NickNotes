import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {once} from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

test('backend worker owns readiness, boot pipe and graceful shutdown',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nicknotes-worker-'))
  const script=path.join(directory,'backend.cjs')
  fs.writeFileSync(script,`const rl=require('node:readline').createInterface({input:process.stdin});let boot=false;rl.on('line',line=>{const data=JSON.parse(line);if(!boot){if(data.token!=='synthetic-token')process.exit(2);boot=true;console.log(JSON.stringify({event:'ready'}))}else if(data.command==='shutdown')process.exit(0)});rl.on('close',()=>process.exit(0));`)
  const worker=new Worker(new URL('../src/desktop/backend-worker.mjs',import.meta.url),{workerData:{executable:process.execPath,args:[script],cwd:directory,boot:{token:'synthetic-token'}}})
  t.after(()=>worker.terminate())
  const events=[]
  await new Promise((resolve,reject)=>{
    worker.on('message',message=>{events.push(message);if(message.event==='ready')resolve();if(message.event==='error')reject(new Error(message.message))})
    worker.once('error',reject)
  })
  assert.ok(events.some(event=>event.event==='spawned'&&event.pid>0))
  const exited=once(worker,'exit');worker.postMessage('stop')
  assert.deepEqual(await exited,[0]);assert.ok(events.some(event=>event.event==='exit'&&event.code===0))
})
test('backend worker reports a missing executable without retaining the control channel',async t=>{
  const worker=new Worker(new URL('../src/desktop/backend-worker.mjs',import.meta.url),{workerData:{executable:path.join(os.tmpdir(),'nicknotes-missing-executable','absent.exe'),args:[],cwd:os.tmpdir(),boot:{}}})
  t.after(()=>worker.terminate())
  const messages=[];worker.on('message',message=>messages.push(message))
  const [code]=await once(worker,'exit')
  assert.equal(code,0);assert.ok(messages.some(message=>message.event==='error'&&message.message.includes('ENOENT')))
})

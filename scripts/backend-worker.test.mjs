import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {once} from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// A stand-in for `nicknotes-backend --service`: announces itself in service.json and obeys the control routes.
const FAKE_SERVICE=`
const http=require('node:http'),fs=require('node:fs'),path=require('node:path')
const dir=process.env.NICKNOTES_USER_DATA,port=Number(process.env.NICKNOTES_PORT),version=process.env.FAKE_VERSION
const owner=process.argv.includes('--owner-pid')?Number(process.argv[process.argv.indexOf('--owner-pid')+1]):null
fs.appendFileSync(path.join(dir,'spawns.log'),version+'\\n')
const state={ownerPid:owner}
const server=http.createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer token-'+version){res.writeHead(401);return res.end()}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    if(req.url==='/service/owner')state.ownerPid=JSON.parse(body).pid
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({version,...state}))
    if(req.url==='/service/shutdown'){fs.rmSync(path.join(dir,'service.json'),{force:true});server.close();setTimeout(()=>process.exit(0),50)}
  })
})
server.listen(port,'127.0.0.1',()=>fs.writeFileSync(path.join(dir,'service.json'),JSON.stringify({port,pid:process.pid,token:'token-'+version,version})))
setTimeout(()=>process.exit(0),20000)
`

test('worker starts the service detached and reports its pid',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nicknotes-worker-'))
  const script=path.join(directory,'child.cjs');fs.writeFileSync(script,'setTimeout(()=>{},200)')
  const worker=new Worker(new URL('../src/desktop/backend-worker.mjs',import.meta.url),{workerData:{executable:process.execPath,args:[script],cwd:directory}})
  t.after(()=>worker.terminate())
  const [message]=await once(worker,'message')
  assert.equal(message.event,'spawned');assert.ok(message.pid>0)
})

test('worker reports a missing executable',async t=>{
  const worker=new Worker(new URL('../src/desktop/backend-worker.mjs',import.meta.url),{workerData:{executable:path.join(os.tmpdir(),'nicknotes-missing-executable','absent.exe'),args:[],cwd:os.tmpdir()}})
  t.after(()=>worker.terminate())
  const [message]=await once(worker,'message')
  assert.equal(message.event,'error');assert.match(message.message,/ENOENT/)
})

test('the app attaches to a running service, replaces another version and stops it on request',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nicknotes-service-'))
  const script=path.join(directory,'service.cjs');fs.writeFileSync(script,FAKE_SERVICE)
  const port=18000+Math.floor(Math.random()*1000)
  Object.assign(process.env,{NICKNOTES_USER_DATA:directory,NICKNOTES_PORT:String(port)})
  const {createBackendService}=await import('../src/desktop/backend-service.mjs')
  const service=version=>{process.env.FAKE_VERSION=version;return createBackendService({executable:process.execPath,args:[script],cwd:directory,version,port})}
  const spawns=()=>fs.readFileSync(path.join(directory,'spawns.log'),'utf8').trim().split('\n')

  const first=await service('1.0').ensure(process.pid)
  assert.equal(first.version,'1.0')
  await service('1.0').ensure(null)  // second app start: attach, no new process, owner released
  assert.deepEqual(spawns(),['1.0'])
  const reply=await fetch(`http://127.0.0.1:${port}/service`,{headers:{Authorization:'Bearer token-1.0'}}).then(response=>response.json())
  assert.equal(reply.ownerPid,null)

  const updated=await service('2.0').ensure(process.pid)  // after an update the old service gives way
  assert.equal(updated.version,'2.0');assert.deepEqual(spawns(),['1.0','2.0'])
  await service('2.0').stop()
  assert.ok(!fs.existsSync(path.join(directory,'service.json')))
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {CaptureDraftStore} from '../src/desktop/capture-draft-store.mjs'

const root=path.resolve(import.meta.dirname,'../.tmp')
await fs.mkdir(root,{recursive:true})
async function profile(t) {
  const directory=await fs.mkdtemp(path.join(root,'draft-test-'))
  t.after(async()=>{
    if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe cleanup path')
    await fs.rm(directory,{recursive:true,force:true})
  })
  return directory
}
test('rapid writes keep the latest Unicode draft across restarts; empty capture removes it',async t=>{
  const directory=await profile(t),store=new CaptureDraftStore(directory)
  assert.equal(await store.load(),'')
  await Promise.all(Array.from({length:150},(_,i)=>store.set(`Gedanke ${i}: Grüße 📝`)))
  await store.flush()
  const restarted=new CaptureDraftStore(directory)
  assert.equal(await restarted.load(),'Gedanke 149: Grüße 📝')
  await restarted.set('')
  assert.equal(await new CaptureDraftStore(directory).load(),'')
  await assert.rejects(fs.stat(store.file),{code:'ENOENT'})
})
test('oversized input cannot replace an existing draft',async t=>{
  const directory=await profile(t),store=new CaptureDraftStore(directory)
  await store.set('Original')
  await assert.rejects(store.set('ü'.repeat(3*1024*1024)),/5 MB/)
  assert.equal(await new CaptureDraftStore(directory).load(),'Original')
})
test('disk failure rejects without an endless retry and can be retried after repair',async t=>{
  const directory=await profile(t),store=new CaptureDraftStore(directory)
  await fs.mkdir(store.file)
  await assert.rejects(store.set('Pending after error'))
  assert.equal(store.current,'Pending after error')
  await fs.rmdir(store.file)
  await store.flush()
  assert.equal(await new CaptureDraftStore(directory).load(),'Pending after error')
})

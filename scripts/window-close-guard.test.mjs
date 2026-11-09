import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createWindowCloseGuard} from '../src/desktop/window-close-guard.mjs'

function setup(t,choice=2){
  const win=new EventEmitter(),sent=[],errors=[],prompts=[]
  win.destroyed=false;win.enabled=true
  win.isDestroyed=()=>win.destroyed
  win.setEnabled=value=>{win.enabled=value}
  win.webContents={send:(channel,payload)=>sent.push({channel,...payload})}
  win.close=()=>{
    let prevented=false
    win.emit('close',{preventDefault(){prevented=true}})
    if(!prevented){win.destroyed=true;win.emit('closed')}
  }
  const dialog={
    showMessageBoxSync:(_win,options)=>{prompts.push(options);return typeof choice==='function'?choice():choice},
    showErrorBox:(_title,message)=>errors.push(message),
  }
  const guard=createWindowCloseGuard(win,dialog)
  t.after(()=>guard.dispose())
  const check=dirty=>{
    const request=sent.at(-1)
    assert.equal(request.channel,'app:request-close-state')
    guard.receiveState({requestId:request.requestId,hasUnsavedChanges:dirty})
    return request.requestId
  }
  return {win,guard,sent,errors,prompts,check}
}

test('the early capture screen can close without a renderer handshake',t=>{
  const {win,sent}=setup(t)
  win.close();assert.equal(win.destroyed,true);assert.deepEqual(sent,[])
})
test('stale clean status does not bypass the current renderer draft check',t=>{
  const {win,guard,check,prompts}=setup(t)
  guard.setReady(true);guard.setDirty(false);win.close()
  assert.equal(win.enabled,false);assert.equal(win.destroyed,false)
  check(true)
  assert.equal(prompts.length,1);assert.equal(win.enabled,true);assert.equal(win.destroyed,false)
})
test('a current clean response closes even when the cached flag is dirty',t=>{
  const {win,guard,check,prompts}=setup(t)
  guard.setReady(true);guard.setDirty(true);win.close();check(false)
  assert.equal(win.destroyed,true);assert.equal(prompts.length,0)
})
test('save waits for its matching successful response and blocks duplicate close',t=>{
  const {win,guard,check,sent}=setup(t,0)
  guard.setReady(true);win.close();const requestId=check(true)
  assert.equal(win.enabled,false);assert.equal(sent.at(-1).channel,'app:request-save-before-close')
  win.close();assert.equal(sent.length,2)
  guard.receiveSaveResult({requestId:requestId+1,ok:true})
  assert.equal(win.destroyed,false)
  guard.receiveSaveResult({requestId,ok:false})
  assert.equal(win.enabled,true);assert.equal(win.destroyed,false)
  win.close();const nextId=check(true)
  guard.receiveSaveResult({requestId,ok:true});assert.equal(win.destroyed,false)
  guard.receiveSaveResult({requestId:nextId,ok:true});assert.equal(win.destroyed,true)
})
test('only an explicit discard closes without saving a dirty draft',t=>{
  const {win,guard,check,sent}=setup(t,1)
  guard.setReady(true);win.close();check(true)
  assert.equal(win.destroyed,true)
  assert.equal(sent.some(item=>item.channel==='app:request-save-before-close'),false)
})
test('a missing check response restores input and a late answer cannot close',t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const {win,guard,sent,errors}=setup(t)
  guard.setReady(true);win.close();const {requestId}=sent.at(-1)
  t.mock.timers.tick(10_000)
  assert.equal(win.enabled,true);assert.equal(win.destroyed,false);assert.equal(errors.length,1)
  guard.receiveState({requestId,hasUnsavedChanges:false});assert.equal(win.destroyed,false)
  win.close()
  guard.receiveState({requestId,hasUnsavedChanges:false});assert.equal(win.destroyed,false)
})
test('a missing save response restores input and late success cannot close',t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const {win,guard,check,errors}=setup(t,0)
  guard.setReady(true);win.close();const requestId=check(true)
  t.mock.timers.tick(120_000)
  assert.equal(win.enabled,true);assert.equal(win.destroyed,false);assert.equal(errors.length,1)
  guard.receiveSaveResult({requestId,ok:true});assert.equal(win.destroyed,false)
})
test('a native dialog failure leaves the window usable',t=>{
  const {win,guard,check,errors}=setup(t,()=>{throw new Error('dialog failure')})
  guard.setReady(true);win.close();check(true)
  assert.equal(win.enabled,true);assert.equal(win.destroyed,false);assert.equal(errors.length,1)
})

test('an update action waits for draft save approval and leaves closing to the updater',async t=>{
  const {win,guard,check}=setup(t,0)
  guard.setReady(true)
  let installed=false
  const approved=guard.requestClose(()=>{installed=true})
  const requestId=check(true)
  assert.equal(installed,false);assert.equal(win.enabled,false)
  guard.receiveSaveResult({requestId,ok:true})
  assert.equal(await approved,true);assert.equal(installed,true);assert.equal(win.destroyed,false)
  win.close();assert.equal(win.destroyed,true)
})
test('cancel and failed update restart never grant later close permission',async t=>{
  const {win,guard,check}=setup(t,2)
  guard.setReady(true)
  const canceled=guard.requestClose(()=>assert.fail('must not install'));check(true)
  assert.equal(await canceled,false);assert.equal(win.enabled,true)
  const failed=guard.requestClose(()=>{throw new Error('installer unavailable')});check(false)
  assert.equal(await failed,false);assert.equal(win.enabled,true);assert.equal(win.destroyed,false)
  win.close();assert.equal(win.destroyed,false)
})

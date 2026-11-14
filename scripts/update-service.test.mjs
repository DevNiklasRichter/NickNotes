import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createUpdateService,releaseNotesText} from '../src/desktop/update-service.mjs'

function setup(t,{enabled=true,next='2.2.0',prepareInstall=async install=>{install();return true}}={}){
  const updater=new EventEmitter(),calls={loads:0,checks:0,downloads:0,installs:0},states=[]
  updater.checkForUpdates=async()=>{calls.checks++;updater.emit(next?'update-available':'update-not-available',{version:next,releaseNotes:'<h3>Neu</h3><ul><li>Graph &amp; Suche</li></ul>'})}
  updater.downloadUpdate=async()=>{calls.downloads++;updater.emit('download-progress',{percent:50});updater.emit('update-downloaded',{version:next})}
  updater.quitAndInstall=(silent,run)=>{assert.equal(silent,false);assert.equal(run,true);calls.installs++}
  const service=createUpdateService({version:'2.1.0',enabled,loadUpdater:async()=>{calls.loads++;return updater},notify:state=>states.push(state),prepareInstall})
  t.after(()=>service.dispose())
  return {service,updater,calls,states}
}
test('unsigned candidates do not import, check, download or install updates',async t=>{
  const {service,calls}=setup(t,{enabled:false})
  service.start();await service.check();await service.download();await service.install()
  assert.deepEqual(calls,{loads:0,checks:0,downloads:0,installs:0});assert.equal(service.getState().phase,'disabled')
})
test('checking never downloads or installs; each action requires its preceding state',async t=>{
  const {service,calls,updater,states}=setup(t)
  await service.download();await service.install();assert.equal(calls.loads,0)
  assert.equal((await service.check()).phase,'available');assert.equal(service.getState().notes,'### Neu\n- Graph & Suche')
  assert.equal(calls.downloads,0);assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false)
  assert.equal(updater.allowPrerelease,false);assert.equal(updater.allowDowngrade,false)
  assert.equal((await service.download()).phase,'downloaded');assert.ok(states.some(state=>state.percent===50))
  assert.equal(calls.installs,0);await service.install();assert.equal(calls.installs,1)
})
for(const next of ['2.2.0-rc.1','2.0.0','2.1.0','invalid'])test('rejects unsuitable offered version '+next,async t=>{
  const {service,calls}=setup(t,{next})
  assert.equal((await service.check()).phase,'error');await service.download();await service.install()
  assert.equal(calls.downloads,0);assert.equal(calls.installs,0)
})
test('an offline check leaves an explicit retry and can recover',async t=>{
  const {service,updater}=setup(t,{next:null})
  const check=updater.checkForUpdates
  updater.checkForUpdates=async()=>{throw new Error('offline')}
  assert.equal((await service.check()).phase,'error')
  updater.checkForUpdates=check
  assert.equal((await service.check()).phase,'current')
})
test('a failed hash or signature check cannot reach installation',async t=>{
  const {service,updater,calls}=setup(t)
  await service.check()
  updater.downloadUpdate=async()=>{throw new Error('ERR_UPDATER_INVALID_SIGNATURE')}
  assert.equal((await service.download()).phase,'error');await service.install();assert.equal(calls.installs,0)
})
test('canceling draft save keeps the downloaded update and never runs installer',async t=>{
  const {service,calls}=setup(t,{prepareInstall:async()=>false})
  await service.check();await service.download()
  assert.equal((await service.install()).phase,'downloaded');assert.equal(calls.installs,0)
})
test('a failed save never runs installer',async t=>{
  const {service,calls}=setup(t,{prepareInstall:async()=>{throw new Error('save failed')}})
  await service.check();await service.download()
  assert.equal((await service.install()).phase,'error');assert.equal(calls.installs,0)
})
test('installation remains pending until the close guard grants approval',async t=>{
  let approve
  const gate=new Promise(resolve=>approve=resolve)
  const {service,calls}=setup(t,{prepareInstall:async install=>{await gate;install();return true}})
  await service.check();await service.download()
  const installing=service.install();await new Promise(setImmediate)
  assert.equal(calls.installs,0)
  await service.install();assert.equal(calls.installs,0)
  approve();await installing;assert.equal(calls.installs,1)
})
test('automatic checks wait until after startup and stop when disposed',async t=>{
  const {service,calls}=setup(t,{next:null})
  await service.check()
  t.mock.timers.enable({apis:['setTimeout','setInterval']})
  service.start();service.start();t.mock.timers.tick(29_999);assert.equal(calls.checks,1)
  t.mock.timers.tick(1);await new Promise(setImmediate);assert.equal(calls.checks,2)
  service.dispose();t.mock.timers.tick(4*60*60*1000);await new Promise(setImmediate);assert.equal(calls.checks,2)
})
test('release notes keep the changelog part of the GitHub release body as plain lines',()=>{
  const body='<h3>Neu</h3>\n<ul>\n<li>Termine mit <code>@morgen</code></li>\n</ul>\n<p>Zeile eins<br>Zeile zwei</p>\n<hr>\n<p>Windows x64 · MIT</p>'
  assert.equal(releaseNotesText(body),'### Neu\n- Termine mit @morgen\nZeile eins\nZeile zwei')
  assert.equal(releaseNotesText([{version:'2.2.0',note:'<p>&lt;b&gt; bleibt Text</p>'}]),'<b> bleibt Text')
  assert.equal(releaseNotesText(undefined),'')
})

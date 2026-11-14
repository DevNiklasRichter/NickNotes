/** Real development-renderer regression, isolated from the user's profile and notes. */
import {_electron as electron,expect} from '@playwright/test'
import electronBinary from 'electron'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {isViteReady} from './vite-readiness.mjs'

const root=path.resolve(import.meta.dirname,'..')
const scratch=fs.mkdtempSync(path.join(root,'.tmp','commands-smoke-'))
const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
let viteLog='';vite.stdout.on('data',data=>viteLog+=data);vite.stderr.on('data',data=>viteLog+=data)
let app,page
const errors=[],requests=[]
const saveTrace=[],saveIds=new WeakMap()
let nextSaveId=0
async function launch(){
  app=await electron.launch({executablePath:electronBinary,args:[root],cwd:root,env:{...process.env,NICKNOTES_USER_DATA:path.join(scratch,'profile'),NICKNOTES_PORT:'18767'},timeout:90_000})
  page=await app.firstWindow();page.setDefaultTimeout(15000)
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',req=>{
    if(req.url().startsWith('http://127.0.0.1:18767'))requests.push({path:new URL(req.url()).pathname,method:req.method()})
    if(req.method()==='POST'&&req.url().endsWith('/notes/save')){
      const payload=req.postDataJSON(),id=++nextSaveId;saveIds.set(req,id)
      saveTrace.push({id,event:'request',path:payload.path,expectedRevision:payload.expectedRevision,tail:payload.content.slice(-160)})
    }
  })
  page.on('response',response=>{
    const id=saveIds.get(response.request());if(!id)return
    void response.json().then(value=>saveTrace.push({id,event:'response',status:response.status(),path:value.path,revision:value.revision,error:value.error})).catch(()=>{})
  })
  await expect(page.getByRole('menubar')).toBeVisible({timeout:60000})
}
async function request(endpoint,body){
  return page.evaluate(async({endpoint,body})=>{
    const base=await window.nicknotes.getBackendUrl(),token=await window.nicknotes.getBackendToken()
    const response=await fetch(base+endpoint,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
    if(!response.ok)throw new Error(`${response.status}: ${await response.text()}`)
    return response.json()
  },{endpoint,body})
}
async function menu(group,id){
  await page.getByRole('menubar').getByRole('menuitem',{name:group,exact:true}).click()
  await page.locator(`[role="menu"] [data-command="${id}"]`).click()
}
async function verifyUpdateUi(){
  // Test-only IPC responses: exercise download/progress/restart controls without
  // a signing identity, a public release or launching any installer.
  await app.evaluate(({app,ipcMain,BrowserWindow})=>{
    let state={phase:'available',currentVersion:app.getVersion(),version:'2.2.0',message:'NickNotes 2.2.0 ist verfügbar.'}
    const emit=patch=>{state={...state,...patch};BrowserWindow.getAllWindows()[0].webContents.send('updates:state',state);return state}
    for(const channel of ['updates:check','updates:download','updates:install'])ipcMain.removeHandler(channel)
    ipcMain.handle('updates:check',()=>state)
    ipcMain.handle('updates:download',async()=>{
      emit({phase:'downloading',percent:50,message:'Update wird heruntergeladen …'})
      await new Promise(resolve=>globalThis.__finishTestUpdateDownload=resolve)
      return emit({phase:'downloaded',percent:100,message:'NickNotes 2.2.0 ist bereit zur Installation.'})
    })
    ipcMain.handle('updates:install',()=>emit({phase:'downloaded',message:'Installation abgebrochen. Dein Update bleibt heruntergeladen.'}))
    globalThis.__resetTestUpdate=()=>emit({phase:'disabled',version:undefined,message:'Updates sind in dieser unsignierten Testversion deaktiviert.'})
  })
  await menu('Hilfe','updates')
  await page.getByRole('button',{name:'Update herunterladen',exact:true}).click()
  await expect(page.getByRole('progressbar',{name:'Update-Download'})).toHaveAttribute('value','50')
  await app.evaluate(()=>globalThis.__finishTestUpdateDownload())
  await expect(page.getByRole('button',{name:'Neu starten und installieren',exact:true})).toBeEnabled()
  await page.screenshot({path:path.join(root,'.tmp/updates-downloaded.png')})
  await page.getByRole('button',{name:'Neu starten und installieren',exact:true}).click()
  await expect(page.getByText('Installation abgebrochen. Dein Update bleibt heruntergeladen.',{exact:true})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Update installieren',exact:true})).toBeVisible()
  await app.evaluate(()=>globalThis.__resetTestUpdate())
  await expect(page.getByRole('button',{name:'Update installieren',exact:true})).toHaveCount(0)
}
async function bodyEditor(title){
  // A backend search can see a newly created file before its editor has loaded.
  // Wait for the requested document, rather than typing into the previous tab.
  if(title)await expect(page.locator('.note-title-input').first()).toHaveValue(title)
  const editor=page.locator('.note-body-editor .cm-content').first()
  await expect(editor).toBeVisible()
  return editor
}
async function verifyQueuedSaves(editor){
  const document=page.locator('.note-editor-shell')
  const notePath=await document.getAttribute('data-note-path')
  assert.ok(notePath)
  let firstSaved,secondSaved,releaseFirst,releaseSecond,routeError
  let saveRequests=0
  const firstGate=new Promise(resolve=>releaseFirst=resolve)
  const secondGate=new Promise(resolve=>releaseSecond=resolve)
  const holdSave=async route=>{
    if(route.request().postDataJSON().path!==notePath){await route.continue();return}
    const requestNumber=++saveRequests
    try{
      const response=await route.fetch()
      assert.equal(response.status(),200)
      const saved=await response.json()
      if(requestNumber===1){firstSaved=saved;await firstGate}
      else if(requestNumber===2){secondSaved=saved;await secondGate}
      await route.fulfill({response})
    }catch(error){routeError=String(error);await route.abort().catch(()=>{})}
  }
  await page.route('**/notes/save',holdSave)
  try{
    // Start with the first save in the scenario, independent of previous commands.
    await page.keyboard.press('Control+s')
    await expect.poll(()=>({requests:saveRequests,revision:firstSaved?.revision,error:routeError}),{
      timeout:15000,message:'The initial save must reach the backend',
    }).toMatchObject({requests:1,revision:expect.any(String),error:undefined})
    assert.ok(fs.readFileSync(notePath,'utf8').includes('Saved immediately after typing.'))
    await page.keyboard.type(' Queued save request')
    await page.keyboard.press('Control+s')
    assert.equal(saveRequests,1,'Concurrent save requests must wait for the first save')
    releaseFirst()
    await expect.poll(()=>({requests:saveRequests,revision:secondSaved?.revision,error:routeError}),{
      timeout:15000,message:'The queued second save must reach the backend',
    }).toMatchObject({requests:2,revision:expect.any(String),error:undefined})
    assert.ok(fs.readFileSync(notePath,'utf8').includes('Queued save request'))
    await page.keyboard.type(' Keep this draft')
    await expect(editor).toContainText('Keep this draft')
    releaseSecond()
    await expect(document).toHaveAttribute('data-note-revision',secondSaved.revision)
  }finally{
    releaseFirst();releaseSecond()
    await page.unroute('**/notes/save',holdSave)
  }
  assert.ok(!fs.readFileSync(notePath,'utf8').includes('Keep this draft'))
  await expect(editor).toContainText('Keep this draft')
  await page.keyboard.press('Control+w')
  await expect(page.getByText('Was soll passieren?',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click()
  await expect(editor).toContainText('Keep this draft')
  // The toolbar shares the save queue with keyboard and menu commands.
  await page.getByRole('button',{name:'Speichern',exact:true}).click()
  await expect.poll(()=>fs.readFileSync(notePath,'utf8')).toContain('Keep this draft')
}
async function verifyEditorValueSync(){
  const fixtureUrl='/@fs/'+path.join(root,'scripts/fixtures/editor-value-sync.tsx').replaceAll('\\','/')
  const dispose=await page.evaluateHandle(async url=>(await import(url)).mountEditorValueSyncFixture(),fixtureUrl)
  try{
    const fixture=page.getByTestId('editor-value-sync-fixture')
    const editor=fixture.locator('.cm-content')
    await editor.click()
    let text=''
    for(let index=0;index<20;index++){
      const character=String.fromCharCode(97+index)
      text+=character
      await page.keyboard.type(character)
      await expect(fixture.getByTestId('pending-echo-count')).toHaveText(String(index+1))
    }
    await expect(editor).toHaveText(text)
    // Even after the frame buffer drained, save/close need a synchronous snapshot.
    await fixture.getByRole('button',{name:'Flush editor snapshot',exact:true}).click()
    await expect(fixture.getByTestId('pending-echo-count')).toHaveText('21')
    await fixture.getByRole('button',{name:'Apply oldest echo',exact:true}).click()
    await expect(fixture.getByTestId('parent-editor-value')).toHaveText('a')
    await expect(editor).toHaveText(text)
    await fixture.getByRole('button',{name:'Apply latest echo',exact:true}).click()
    await expect(fixture.getByTestId('parent-editor-value')).toHaveText(text)
    await expect(editor).toHaveText(text)
    await fixture.getByRole('button',{name:'Replace externally',exact:true}).click()
    await expect(editor).toHaveText('External replacement')
    await fixture.getByRole('button',{name:'Use old text externally',exact:true}).click()
    await expect(editor).toHaveText('a')
  }finally{
    await page.evaluate(dispose=>dispose(),dispose)
    await dispose.dispose()
  }
}
async function verifyNativeClose(){
  await menu('Datei','newNote')
  const editor=await bodyEditor('Neue Notiz')
  await editor.fill('Stored native-close baseline')
  const saveResponse=page.waitForResponse(response=>response.url().endsWith('/notes/save'))
  await page.keyboard.press('Control+s')
  const saved=await (await saveResponse).json()
  await expect(page.locator('.note-editor-shell')).toHaveAttribute('data-note-revision',saved.revision)
  await expect(page.locator('.tab-dirty-dot')).toHaveCount(0)
  // Keep the last input in CodeMirror's frame buffer and deliberately stale the
  // main-process flag. Only a synchronous renderer snapshot can protect it.
  const restoreRaf=await page.evaluateHandle(()=>{
    const original=window.requestAnimationFrame
    window.requestAnimationFrame=()=>999999
    return original
  })
  try{
    await page.keyboard.press('Alt+q')
    await page.locator('.capture-markdown-editor .cm-content').fill('Buffered capture at native close')
    await editor.click();await page.keyboard.press('Control+End')
    await page.keyboard.type(' Unsaved native close')
    await page.evaluate(async()=>{window.nicknotes.setUnsavedChanges(false);await window.nicknotes.getBackendUrl()})
    await app.evaluate(({dialog})=>{
      globalThis.__nativeClosePrompts=0
      dialog.showMessageBoxSync=()=>{globalThis.__nativeClosePrompts++;return 2}
    })
    let closed=false;page.on('close',()=>closed=true)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
    await expect.poll(async()=>closed?'closed':app.evaluate(()=>globalThis.__nativeClosePrompts),{timeout:15000}).toBe(1)
  }finally{
    await page.evaluate(original=>{window.requestAnimationFrame=original},restoreRaf)
    await restoreRaf.dispose()
  }
  await expect(editor).toContainText('Unsaved native close')
  assert.ok(!fs.readFileSync(saved.path,'utf8').includes('Unsaved native close'))
  assert.ok(fs.readFileSync(path.join(scratch,'profile/capture-draft.md'),'utf8').includes('Buffered capture at native close'))
  await page.keyboard.press('F9');await expect(page.locator('.workbench-shell')).toHaveClass(/is-writing/)
  await expect(page.locator('.capture-workspace-panel')).toBeHidden()
  // Hold the save response: the native window must stay open without accepting
  // more user input until the acknowledged Markdown save has completed.
  let savedBeforeClose,releaseSave,routeError
  const saveGate=new Promise(resolve=>releaseSave=resolve)
  const holdSave=async route=>{
    try{
      const response=await route.fetch()
      assert.equal(response.status(),200)
      savedBeforeClose=await response.json()
      await saveGate
      await route.fulfill({response})
    }catch(error){routeError=String(error);await route.abort().catch(()=>{})}
  }
  await page.route('**/notes/save',holdSave)
  try{
    await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>0})
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
    await expect.poll(()=>({revision:savedBeforeClose?.revision,error:routeError}),{timeout:15000}).toMatchObject({revision:expect.any(String),error:undefined})
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isEnabled()),false)
    assert.ok(fs.readFileSync(saved.path,'utf8').includes('Unsaved native close'))
    const electronProcess=app.process()
    const appClosed=app.waitForEvent('close',{timeout:45000})
    releaseSave()
    await appClosed
    app=null
    assert.equal(electronProcess.exitCode,0)
    assert.ok(fs.readFileSync(path.join(scratch,'profile/capture-draft.md'),'utf8').includes('Buffered capture at native close'))
  }finally{
    releaseSave()
    if(!page.isClosed())await page.unroute('**/notes/save',holdSave)
  }
}
try{
  for(let attempt=0;attempt<100;attempt++){
    if(vite.exitCode!==null)throw new Error('Owned Vite process failed: '+viteLog)
    if(isViteReady(viteLog))break
    await new Promise(resolve=>setTimeout(resolve,150))
    if(attempt===99)throw new Error('Vite startup timed out: '+viteLog)
  }
  await launch()
  assert.equal(new URL(page.url()).origin,'http://localhost:5173')
  await menu('Hilfe','updates')
  await expect(page.getByRole('heading',{name:'NickNotes aktualisieren'})).toBeVisible()
  await expect(page.getByText('Installierte Version:',{exact:false})).toContainText(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version)
  await expect(page.getByText('Updates sind in dieser unsignierten Testversion deaktiviert.',{exact:true})).toBeVisible()
  await page.screenshot({path:path.join(root,'.tmp/updates-candidate.png')})
  await page.keyboard.press('Escape')
  await verifyUpdateUi()
  await page.getByRole('menubar').getByRole('menuitem',{name:'Datei',exact:true}).click()
  await expect(page.locator('[data-command="settings"]')).toBeDisabled()
  await page.keyboard.press('Escape');await page.keyboard.press('F1')
  await expect(page.getByRole('heading',{name:'Tastenkürzel und Bedienung'})).toBeVisible()
  await page.keyboard.press('Escape')
  await request('/notebase/create',{parentPath:scratch,name:'Vault'})
  await page.reload();await page.locator('.activity-rail').waitFor()
  await page.waitForTimeout(2200)
  requests.length=0
  await page.waitForTimeout(8500)
  const idleRequests=[...requests]
  assert.equal(idleRequests.filter(req=>req.method==='POST').length,0,JSON.stringify(idleRequests))
  assert.ok(idleRequests.length<=6,'Request loop: '+JSON.stringify(idleRequests))
  await page.keyboard.press('Control+n')
  const first=await bodyEditor('Neue Notiz')
  await expect(first).toBeFocused();await page.keyboard.type('Saved immediately after typing.')
  await verifyQueuedSaves(first)
  await expect.poll(async()=>JSON.stringify(await request('/search?query=immediately'))).toContain('Neue Notiz')
  const firstNote=(await request('/search?query=immediately')).items.find(item=>item.title==='Neue Notiz')
  assert.ok(fs.readFileSync(firstNote.path,'utf8').includes('Saved immediately after typing.'))
  await expect(page.getByRole('button',{name:'Speichern',exact:true})).toHaveAttribute('data-tooltip',/Strg\+S/)
  await page.keyboard.press('Control+Shift+n')
  await expect.poll(async()=>JSON.stringify(await request('/tasks?include_done=true'))).toContain('Neuer Task')
  await expect(await bodyEditor('Neuer Task')).toBeFocused();await page.keyboard.type('Task draft for save all')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async()=>JSON.stringify(await request('/search?query=Task%20draft'))).toContain('Neuer Task')
  // Ctrl+O uses a keyboard-navigable note picker.
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('immediately')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0)
  await bodyEditor('Neue Notiz')
  // Palette editing restores the original native input before trusted edit IPC.
  const titleField=page.getByRole('textbox',{name:'Notiztitel',exact:true}).first()
  const beforeNativeTitle=fs.readFileSync(firstNote.path,'utf8')
  for(const entry of ['keyboard','pointer']){
    await titleField.focus();await titleField.press('End')
    if(entry==='keyboard')await page.keyboard.press('Control+p')
    else await page.getByRole('button',{name:'Notizen und Befehle suchen',exact:true}).click()
    const appCommand=page.getByRole('combobox',{name:entry==='keyboard'?'Befehl suchen':'Notiz suchen',exact:true})
    await expect(appCommand).toBeFocused();await appCommand.fill('>Alles auswählen');await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(titleField).toBeFocused()
    await expect.poll(()=>titleField.evaluate(field=>field.selectionStart===0&&field.selectionEnd===field.value.length)).toBe(true)
  }
  // Menu editing uses CodeMirror history, including the last buffered keystroke.
  await (await bodyEditor()).click();await page.keyboard.press('Control+End');await page.keyboard.type(' undo-marker')
  assert.equal(fs.readFileSync(firstNote.path,'utf8'),beforeNativeTitle,'Focusing and leaving an unchanged title must never mutate Markdown')
  await menu('Bearbeiten','undo')
  await expect(await bodyEditor()).not.toContainText('undo-marker')
  await menu('Bearbeiten','redo')
  await expect(await bodyEditor()).toContainText('undo-marker')
  await menu('Datei','saveAll')
  // Two independently dirty documents must both reach Markdown, including the hidden tab.
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('Neuer Task')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await (await bodyEditor('Neuer Task')).click();await page.keyboard.press('Control+End');await page.keyboard.type(' multi-task-marker')
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('Neue Notiz')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await (await bodyEditor('Neue Notiz')).click();await page.keyboard.press('Control+End');await page.keyboard.type(' multi-note-marker')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async()=>JSON.stringify(await request('/search?query=multi-task-marker'))).toContain('Neuer Task')
  await expect.poll(()=>fs.readFileSync(firstNote.path,'utf8')).toContain('multi-note-marker')
  await menu('Ansicht','split')
  await expect(page.locator('.editor-workspace-split')).toBeVisible()
  await page.keyboard.press('Control+2')
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id'))).toBe('right')
  await page.keyboard.press('F6')
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id'))).toBe('left')
  await page.keyboard.press('F8');await expect(page.locator('.editor-workspace-split')).toHaveCount(0)
  await page.keyboard.press('F8');await expect(page.locator('.editor-workspace-split')).toBeVisible()
  await page.keyboard.press('Control+1')
  await page.keyboard.press('Control+Shift+Space')
  await expect(page.locator('.capture-workspace-panel')).toBeHidden()
  await page.keyboard.press('Alt+q')
  await expect(page.locator('.capture-markdown-editor .cm-content')).toBeFocused()
  // Closing immediately after typing must flush the editor before checking dirty state.
  await page.keyboard.press('Control+1')
  const dirtyEditor=await bodyEditor('Neue Notiz')
  const leftDocument=page.locator('[data-pane-id="left"] .note-editor-shell')
  await expect(leftDocument).toHaveAttribute('data-note-path',firstNote.path)
  await dirtyEditor.click();await page.keyboard.type(' Close cancellation draft')
  await page.keyboard.press('Control+w')
  await expect(page.getByText('Was soll passieren?',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click()
  await expect(await bodyEditor()).toContainText('Close cancellation draft')
  await page.keyboard.press('Control+s')
  await expect.poll(()=>fs.readFileSync(firstNote.path,'utf8')).toContain('Close cancellation draft')
  await menu('Ansicht','closeOthers')
  await expect(page.locator('.tab-open')).toHaveCount(1)
  // A canceled command must be reusable even when zero-delay timers are throttled.
  const originalTimeout=await page.evaluateHandle(()=>{
    const original=window.setTimeout
    window.setTimeout=(callback,delay,...args)=>original.call(window,callback,delay===0?15000:delay,...args)
    return original
  })
  await page.keyboard.press('Control+Shift+Delete')
  await expect(page.getByRole('heading',{name:'Datei löschen',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click()
  await expect(page.locator('.tag-action-modal')).toHaveCount(0)
  assert.ok(fs.existsSync(firstNote.path))
  await page.keyboard.press('Control+Shift+Delete')
  await expect(page.getByRole('heading',{name:'Datei löschen',exact:true})).toBeVisible()
  await page.evaluate(original=>{window.setTimeout=original},originalTimeout)
  await originalTimeout.dispose()
  await page.getByRole('button',{name:'Datei löschen',exact:true}).click()
  await expect.poll(()=>fs.existsSync(firstNote.path)).toBe(false)
  await page.keyboard.press('Alt+3')
  await expect(page.locator('.task-canvas')).toBeVisible()
  await page.keyboard.press('F1');await expect(page.getByRole('heading',{name:'Tastenkürzel und Bedienung'})).toBeVisible()
  await page.screenshot({path:path.join(root,'.tmp/commands-help.png')})
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+a');await expect(page.getByRole('menu',{name:'Ansicht'})).toBeVisible()
  await page.screenshot({path:path.join(root,'.tmp/commands-menu.png')})
  await page.keyboard.press('Escape')
  await menu('Ansicht','closeAll')
  await expect(page.getByText('Keine Notiz geöffnet').first()).toBeVisible()
  await page.evaluate(()=>window.nicknotes.setUnsavedChanges(false))
  await app.close();app=null
  await launch()
  await expect(page.locator('.activity-rail')).toBeVisible({timeout:45000})
  await page.waitForTimeout(2200);requests.length=0
  await page.waitForTimeout(8500)
  const restartIdleRequests=[...requests]
  assert.equal(restartIdleRequests.filter(req=>req.method==='POST').length,0,JSON.stringify(restartIdleRequests))
  assert.ok(restartIdleRequests.length<=6,'Restart request loop: '+JSON.stringify(restartIdleRequests))
  await verifyEditorValueSync()
  await verifyNativeClose()
  assert.deepEqual(errors,[])
  const report={developmentOrigin:new URL(page.url()).origin,idleRequests,restartIdleRequests,automaticReopen:true,newNote:true,newTask:true,immediateSave:true,queuedSaveExecuted:true,saveAll:true,quickOpen:true,menuUndoRedo:true,split:true,capture:true,typingDuringSavePreserved:true,dirtyCloseCanceled:true,deleteCanceled:true,deleteReopenedWithThrottledTimers:true,deleteConfirmed:true,closeOthers:true,closeAll:true,keyboardMenu:true,help:true,delayedEditorEchoesPreserved:true,externalEditorReplacement:true,nativeCloseBufferedDraftProtected:true,nativeCloseSaveBeforeExit:true,pageErrors:errors}
  report.paletteNativeInputFocus=true;report.nativeCloseInWritingMode=true;report.saveTrace=saveTrace
  fs.writeFileSync(path.join(root,'.tmp/commands-smoke-result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}catch(error){
  if(page)await page.screenshot({path:path.join(root,'.tmp/commands-failure.png')}).catch(()=>{})
  const ui=page?await page.evaluate(()=>[...document.querySelectorAll('.note-editor-shell')].map(node=>({path:node.getAttribute('data-note-path'),revision:node.getAttribute('data-note-revision'),body:node.querySelector('.cm-content')?.textContent}))).catch(()=>null):null
  const failure=path.join(scratch,'failure.json')
  fs.writeFileSync(failure,JSON.stringify({failure:String(error),saveTrace,ui,pageErrors:errors},null,2));console.log(JSON.stringify({failureReport:failure}))
  throw error
}finally{
  if(app){await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1}).catch(()=>{});await app.close()}
  if(vite.exitCode===null)vite.kill()
}

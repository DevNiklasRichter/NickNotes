/** Real development-renderer regression, isolated from the user's profile and notes. */
import {_electron as electron,expect} from '@playwright/test'
import electronBinary from 'electron'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=path.resolve(import.meta.dirname,'..')
const scratch=fs.mkdtempSync(path.join(root,'.tmp','commands-smoke-'))
const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
let viteLog='';vite.stdout.on('data',data=>viteLog+=data);vite.stderr.on('data',data=>viteLog+=data)
let app,page
const errors=[],requests=[]
async function launch(){
  app=await electron.launch({executablePath:electronBinary,args:[root],cwd:root,env:{...process.env,NICKNOTES_USER_DATA:path.join(scratch,'profile'),NICKNOTES_PORT:'18767'},timeout:90_000})
  page=await app.firstWindow();page.setDefaultTimeout(15000)
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',req=>{if(req.url().startsWith('http://127.0.0.1:18767'))requests.push({path:new URL(req.url()).pathname,method:req.method()})})
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
async function bodyEditor(){const editor=page.locator('.note-body-editor .cm-content').first();await expect(editor).toBeVisible();return editor}
try{
  for(let attempt=0;attempt<100;attempt++){
    if(vite.exitCode!==null)throw new Error('Owned Vite process failed: '+viteLog)
    if(viteLog.includes('Local:'))break
    await new Promise(resolve=>setTimeout(resolve,150))
    if(attempt===99)throw new Error('Vite startup timed out: '+viteLog)
  }
  await launch()
  assert.equal(new URL(page.url()).origin,'http://localhost:5173')
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
  const first=await bodyEditor()
  await expect(first).toBeFocused();await page.keyboard.type('Saved immediately after typing.')
  await page.keyboard.press('Control+s')
  await expect.poll(async()=>JSON.stringify(await request('/search?query=immediately'))).toContain('Neue Notiz')
  const firstNote=(await request('/search?query=immediately')).items.find(item=>item.title==='Neue Notiz')
  assert.ok(fs.readFileSync(firstNote.path,'utf8').includes('Saved immediately after typing.'))
  await expect(page.getByRole('button',{name:'Speichern',exact:true})).toHaveAttribute('title',/Strg\+S/)
  await page.keyboard.press('Control+Shift+n')
  await expect.poll(async()=>JSON.stringify(await request('/tasks?include_done=true'))).toContain('Neuer Task')
  await expect(await bodyEditor()).toBeFocused();await page.keyboard.type('Task draft for save all')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async()=>JSON.stringify(await request('/search?query=Task%20draft'))).toContain('Neuer Task')
  // Ctrl+O uses a keyboard-navigable note picker.
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('immediately')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0)
  // Menu editing uses CodeMirror history, including the last buffered keystroke.
  await (await bodyEditor()).click();await page.keyboard.press('Control+End');await page.keyboard.type(' undo-marker')
  await menu('Bearbeiten','undo')
  await expect(await bodyEditor()).not.toContainText('undo-marker')
  await menu('Bearbeiten','redo')
  await expect(await bodyEditor()).toContainText('undo-marker')
  await menu('Datei','saveAll')
  // Two independently dirty documents must both reach Markdown, including the hidden tab.
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('Neuer Task')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await (await bodyEditor()).click();await page.keyboard.press('Control+End');await page.keyboard.type(' multi-task-marker')
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox',{name:'Notiz suchen'}).fill('Neue Notiz')
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter');await (await bodyEditor()).click();await page.keyboard.press('Control+End');await page.keyboard.type(' multi-note-marker')
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
  // A dirty close is cancelable and never closes the application.
  await page.keyboard.press('Control+1');await (await bodyEditor()).click();await page.keyboard.type(' Keep this draft')
  await page.keyboard.press('Control+w')
  await expect(page.getByText('Was soll passieren?',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click()
  await expect(await bodyEditor()).toContainText('Keep this draft')
  await page.keyboard.press('Control+s')
  await menu('Ansicht','closeOthers')
  await expect(page.locator('.tab-open')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+Delete')
  await expect(page.getByText('Datei löschen',{exact:true}).first()).toBeVisible()
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click()
  assert.ok(fs.existsSync(firstNote.path))
  await page.keyboard.press('Control+Shift+Delete')
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
  await expect(page.getByText('Keine Notiz geoeffnet').first()).toBeVisible()
  await page.evaluate(()=>window.nicknotes.setUnsavedChanges(false))
  await app.close();app=null
  await launch()
  await expect(page.locator('.activity-rail')).toBeVisible({timeout:45000})
  await page.waitForTimeout(2200);requests.length=0
  await page.waitForTimeout(8500)
  const restartIdleRequests=[...requests]
  assert.equal(restartIdleRequests.filter(req=>req.method==='POST').length,0,JSON.stringify(restartIdleRequests))
  assert.ok(restartIdleRequests.length<=6,'Restart request loop: '+JSON.stringify(restartIdleRequests))
  assert.deepEqual(errors,[])
  const report={developmentOrigin:new URL(page.url()).origin,idleRequests,restartIdleRequests,automaticReopen:true,newNote:true,newTask:true,immediateSave:true,saveAll:true,quickOpen:true,menuUndoRedo:true,split:true,capture:true,dirtyCloseCanceled:true,deleteCanceled:true,deleteConfirmed:true,closeOthers:true,closeAll:true,keyboardMenu:true,help:true,pageErrors:errors}
  fs.writeFileSync(path.join(root,'.tmp/commands-smoke-result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}catch(error){
  if(page)await page.screenshot({path:path.join(root,'.tmp/commands-failure.png')}).catch(()=>{})
  throw error
}finally{
  if(app){if(page)await page.evaluate(()=>window.nicknotes?.setUnsavedChanges?.(false)).catch(()=>{});await app.close()}
  if(vite.exitCode===null)vite.kill()
}

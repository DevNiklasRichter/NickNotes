import {_electron as electron,expect} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const root=path.resolve(import.meta.dirname,'..')
const scratch=fs.mkdtempSync(path.join(root,'.tmp','desktop-smoke-'))
const profile=path.join(scratch,'profile'),foreign=path.join(scratch,'foreign-cwd')
fs.mkdirSync(profile);fs.mkdirSync(foreign)
const executablePath=process.argv[2]||path.join(root,'dist/installers/win-unpacked/NickNotes.exe')
const python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')
let app,page
const errors=[]
async function launch(){
 const started=performance.now()
 app=await electron.launch({executablePath,cwd:foreign,env:{...process.env,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32'),NICKNOTES_USER_DATA:profile,NICKNOTES_PORT:'18765'},timeout:90_000})
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))
 await page.waitForFunction(()=>document.getElementById('root')?.textContent?.includes('NoteBase'),{timeout:60_000})
 return Math.round(performance.now()-started)
}
async function request(endpoint,body,method){
 return page.evaluate(async ({endpoint,body,method})=>{
  const base=await window.nicknotes.getBackendUrl(),token=await window.nicknotes.getBackendToken()
  const response=await fetch(base+endpoint,{method:method||(body?'POST':'GET'),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  const data=await response.json()
  if(!response.ok)throw new Error(`${response.status}: ${JSON.stringify(data)}`)
  return data
 },{endpoint,body,method})
}
function sdk(token,write=true){
 const result=spawnSync(python,[path.join(root,'scripts/smoke-mcp-client.py')],{cwd:foreign,input:JSON.stringify({url:'http://127.0.0.1:18765/mcp/',token,write}),encoding:'utf8',timeout:90000,windowsHide:true})
 assert.equal(result.status,0,(result.stderr||result.error?.message||'MCP client failed').replaceAll(token,'<redacted>'))
 return JSON.parse(result.stdout.trim().split('\n').at(-1))
}
try {
 const coldReadyMs=await launch()
 const health=await request('/health');assert.equal(health.capabilities.contractVersion,'2.0.0')
 const vault=await request('/notebase/create',{parentPath:scratch,name:'Vault'})
 const note=await request('/note-groups/add-note',{groupKey:'',title:'Smoke Note',noteType:'note'})
 const document=await request('/notes/content?path='+encodeURIComponent(note.notePath))
 await request('/notes/save',{path:note.notePath,content:document.content+'\nInstalled backend works.',expectedRevision:document.revision})
 const unauthorized=await page.evaluate(async()=>{const base=await window.nicknotes.getBackendUrl();return (await fetch(base+'/state')).status})
 assert.equal(unauthorized,401)
 await page.reload();await page.locator('.activity-rail').waitFor()
 await page.getByTitle('Notizen',{exact:true}).click()
 if(!await page.locator('.left-sidebar').isVisible())await page.getByTitle('Notizen',{exact:true}).click()
 const row=page.locator('.explorer-row').filter({hasText:/Smoke[ _]Note/}).first()
 await row.dblclick()
 await page.locator('.cm-content').first().waitFor()
 await page.locator('.cm-content').first().click()
 await page.keyboard.press('Control+A');await page.keyboard.type('Edited through the real desktop editor.\n- [ ] UI todo')
 await page.keyboard.press('Control+S')
 await expect.poll(()=>fs.readFileSync(note.notePath,'utf8'),{timeout:15000}).toContain('Edited through the real desktop editor.')
 // Preserve a draft while an external editor changes the same source file.
 await page.locator('.cm-content').first().click();await page.keyboard.press('Control+End');await page.keyboard.type('\nUnsaved draft remains.')
 fs.appendFileSync(note.notePath,'\nExternal file change.\n')
 await expect(page.getByRole('alert').filter({hasText:'Dein Entwurf bleibt erhalten'})).toBeVisible({timeout:20000})
 await expect(page.locator('.cm-content').first()).toContainText('Unsaved draft remains.')
 await page.keyboard.press('Control+S')
 await new Promise(resolve=>setTimeout(resolve,600))
 assert.ok(!fs.readFileSync(note.notePath,'utf8').includes('Unsaved draft remains.'))
 await page.screenshot({path:path.join(root,'.tmp/desktop-draft-conflict.png')})
 // One write grant exercised using the actual official SDK transport.
 const grant=await request('/agents',{name:'SDK smoke',write:true})
 const client=sdk(grant.token)
 await page.getByRole('button',{name:'Einstellungen',exact:true}).click()
 await page.getByRole('button').filter({hasText:'Agent-Verbindungen'}).click()
 await expect(page.getByText('Externe Agenten verbinden',{exact:true})).toBeVisible()
 await page.screenshot({path:path.join(root,'.tmp/desktop-agents.png')})
 await page.getByRole('button',{name:'Darstellung',exact:true}).click()
 await page.getByRole('combobox').first().selectOption('dark')
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
 await page.screenshot({path:path.join(root,'.tmp/desktop-dark.png')})
 await page.getByRole('combobox').first().selectOption('light')
 await expect(page.locator('html')).toHaveAttribute('data-theme','light')
 const saveSettings=page.getByRole('dialog').getByRole('button',{name:'Speichern',exact:true})
 if(await saveSettings.isEnabled()){await saveSettings.click();await expect(saveSettings).toBeDisabled()}
 await page.getByRole('button',{name:'Einstellungen schliessen'}).click()
 // Exercise the existing dashboards and split layout through their visible controls.
 const dashboards=[['Todos','.todo-canvas'],['Tasks','.task-canvas'],['Focus','.focus-canvas'],['Review','.review-canvas'],['Graph','.graph-editor-canvas-shell']]
 for(const [title,selector] of dashboards){
  await page.locator('.activity-rail').getByTitle(title,{exact:true}).click()
  await page.locator('.left-sidebar .todo-open-dashboard-button').click()
  await expect(page.locator(selector).first()).toBeVisible({timeout:15000})
 }
 await page.getByTitle('Split an',{exact:true}).click()
 await expect(page.getByTitle('Split aus',{exact:true})).toBeVisible()
 await page.getByTitle('Split aus',{exact:true}).click()
 await page.screenshot({path:path.join(root,'.tmp/desktop-graph.png')})
 // Discard only this synthetic fixture draft when closing the isolated test process.
 await page.evaluate(()=>window.nicknotes.setUnsavedChanges(false))
 await app.close();app=null
 const warmReadyMs=await launch()
 await request('/notebase/open',{path:vault.noteBasePath})
 const restartedClient=sdk(grant.token)
 const remaining=await request('/search?query=SDK')
 assert.equal(remaining.items.filter(item=>item.title==='SDK Task').length,1)
 assert.equal(remaining.items.filter(item=>item.title==='SDK Note').length,1)
 await request('/agents/'+grant.id,undefined,'DELETE')
 const revoked=await page.evaluate(async token=>{const base=await window.nicknotes.getBackendUrl();return(await fetch(base+'/mcp/',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'})).status},grant.token)
 assert.equal(revoked,401)
 assert.deepEqual(errors,[])
 const report={version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,executablePath,coldReadyMs,warmReadyMs,vault:vault.noteBasePath,profile,foreignWorkingDirectory:foreign,developerToolsInRuntimePath:false,uiEditSaved:true,dirtyDraftPreserved:true,externalRevisionConflict:true,dashboardsOpened:dashboards.map(([name])=>name),splitLayout:true,themeSwitch:true,unauthorized,revoked,mcp:client,mcpAfterRestart:restartedClient,pageErrors:errors}
 fs.writeFileSync(path.join(root,'.tmp/desktop-smoke-result.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
}catch(error){
 if(page)await page.screenshot({path:path.join(root,'.tmp/desktop-smoke-failure.png')}).catch(()=>{})
 throw error
}finally{
 if(app){if(page)await page.evaluate(()=>window.nicknotes?.setUnsavedChanges?.(false)).catch(()=>{});await app.close()}
}

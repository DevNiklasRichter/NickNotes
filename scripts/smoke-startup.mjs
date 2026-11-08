/** Real npm launcher with a fresh Vite cache and an isolated profile/NoteBase. */
import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const expect=baseExpect.configure({timeout:30000})
const scratch=fs.mkdtempSync(path.join(root,'.tmp','startup-smoke-'))
const profile=path.join(scratch,'profile')
if(!process.env.npm_execpath)throw new Error('Use npm run smoke:startup')
let log='',browser,page
const errors=[]
const started=performance.now()
const startedWall=Date.now()
const child=spawn(process.execPath,[process.env.npm_execpath,'run','dev'],{cwd:root,windowsHide:true,env:{...process.env,NICKNOTES_USER_DATA:profile,NICKNOTES_VITE_CACHE_DIR:path.join(scratch,'vite-cache'),NICKNOTES_PORT:'18769',NICKNOTES_STARTUP_DIAGNOSTICS:'1'},stdio:['ignore','pipe','pipe']})
child.stdout.on('data',data=>{log+=data;fs.writeFileSync(path.join(scratch,'launcher.log'),log)})
child.stderr.on('data',data=>{log+=data;fs.writeFileSync(path.join(scratch,'launcher.log'),log)})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const draftFile=path.join(profile,'capture-draft.md')
const readDraft=()=>fs.existsSync(draftFile)?fs.readFileSync(draftFile,'utf8'):''
async function request(endpoint,body){
  return page.evaluate(async({endpoint,body})=>{
    const base=await window.nicknotes.getBackendUrl(),token=await window.nicknotes.getBackendToken()
    const response=await fetch(base+endpoint,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
    if(!response.ok)throw new Error(`${response.status}: ${await response.text()}`)
    return response.json()
  },{endpoint,body})
}
try{
  const portFile=path.join(profile,'DevToolsActivePort')
  for(let attempt=0;!fs.existsSync(portFile);attempt++){
    if(child.exitCode!==null||attempt>600)throw new Error('Launcher failed or timed out:\n'+log)
    await pause(100)
  }
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0]
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context=browser.contexts()[0]
  page=context.pages()[0]??await context.waitForEvent('page',{timeout:60000})
  page.setDefaultTimeout(30000)
  page.on('pageerror',error=>errors.push(error.message))
  await expect(page.getByRole('menubar')).toBeVisible({timeout:60000})
  const coldMarks=[...log.matchAll(/\[startup\] (\{[^\r\n]+\})/g)].map(match=>JSON.parse(match[1]))
  for(const event of ['window-created','quick-entry-ready','ui-rendered','backend-ready'])assert.ok(coldMarks.some(mark=>mark.event===event),`Missing startup mark: ${event}`)
  assert.deepEqual(errors,[])
  assert.ok(!log.includes('Failed to fetch'),log)

  // Block the heavy UI deliberately: the small entry must remain writable on its own.
  let releaseModule
  const moduleGate=new Promise(resolve=>releaseModule=resolve)
  const blockModule=async route=>{await moduleGate;await route.continue()}
  await context.route('**/src/mountApp.tsx*',blockModule)
  await page.reload({waitUntil:'domcontentloaded'})
  const early=page.locator('#startup-draft')
  await expect(early).toBeEditable()
  const marker='Startup handoff survives 📝'
  await early.fill(marker)
  await expect.poll(readDraft).toBe(marker)
  await page.screenshot({path:path.join(root,'.tmp/startup-early-entry.png')})
  releaseModule()
  await expect(page.getByRole('menubar')).toBeVisible()
  await expect(page.locator('[data-launch-capture]')).toHaveValue(marker)
  await context.unroute('**/src/mountApp.tsx*',blockModule)

  // A missing application module must show an actionable error, never a blank page.
  const brokenModule=route=>route.abort('failed')
  await context.route('**/src/mountApp.tsx*',brokenModule)
  await page.reload({waitUntil:'domcontentloaded'})
  await expect(page.locator('#startup-error')).toBeVisible()
  await expect(early).toHaveValue(marker)
  await early.fill(marker+' retry')
  await expect.poll(readDraft).toBe(marker+' retry')
  await page.screenshot({path:path.join(root,'.tmp/startup-recoverable-error.png')})
  await context.unroute('**/src/mountApp.tsx*',brokenModule)
  await page.getByRole('button',{name:'Erneut laden'}).click()
  await expect(page.getByRole('menubar')).toBeVisible()
  await expect(page.locator('[data-launch-capture]')).toHaveValue(marker+' retry')

  const brokenRender=route=>route.fulfill({status:200,contentType:'text/javascript',body:'export default function App(){throw new Error("Simulated React render failure")} '})
  await context.route('**/src/App.tsx*',brokenRender)
  await page.reload({waitUntil:'domcontentloaded'})
  await expect(page.locator('#startup-error')).toBeVisible()
  await expect(page.locator('#startup-error-detail')).toContainText('Simulated React render failure')
  await expect(early).toHaveValue(marker+' retry')
  await context.unroute('**/src/App.tsx*',brokenRender)
  await page.getByRole('button',{name:'Erneut laden'}).click()
  await expect(page.getByRole('menubar')).toBeVisible()

  // Existing capture service owns the actual NoteBase write and clears the pending file.
  await request('/notebase/create',{parentPath:scratch,name:'Vault'})
  await page.reload()
  const capture=page.locator('.capture-markdown-editor .cm-content')
  await expect(capture).toContainText(marker+' retry')
  await expect(capture).toBeFocused()
  await page.getByRole('button',{name:'Senden',exact:true}).click()
  await expect.poll(async()=>JSON.stringify(await request('/search?query=Startup%20handoff'))).toContain('Startup handoff')
  await expect.poll(readDraft).toBe('')
  const files=fs.readdirSync(path.join(scratch,'Vault/daily'),{recursive:true}).filter(file=>String(file).endsWith('.md'))
  assert.ok(files.some(file=>fs.readFileSync(path.join(scratch,'Vault/daily',String(file)),'utf8').includes(marker+' retry')))
  assert.deepEqual(errors,[])
  const result={scratch,coldViteCache:true,coldMarks:coldMarks.map(mark=>({...mark,fromNpmLaunchMs:mark.wallTime-startedWall})),elapsedMs:Math.round(performance.now()-started),url:page.url(),earlyDraftWhileUiBlocked:true,draftHandoff:true,moduleFailureVisible:true,reactRenderFailureVisible:true,retryPreservesDraft:true,captureReachesMarkdown:true,pendingFileCleared:true,errors}
  await page.screenshot({path:path.join(root,'.tmp/startup-smoke.png')})
  fs.writeFileSync(path.join(root,'.tmp/startup-smoke-result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
  console.log('Launcher log:\n'+log)
}catch(error){
  console.error(log)
  if(page)await page.screenshot({path:path.join(root,'.tmp/startup-failure.png')}).catch(()=>{})
  throw error
}finally{
  if(page)await page.evaluate(async()=>{window.nicknotes?.setUnsavedChanges?.(false);await window.nicknotes?.windowAction?.('close')}).catch(()=>{})
  if(browser)await browser.close().catch(()=>{})
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(5000)])
  if(child.exitCode===null)child.kill()
}

/** Measure the actual packaged process without Playwright/CDP attaching to the renderer. */
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=path.resolve(import.meta.dirname,'..')
const executable=path.resolve(process.argv[2]||path.join(root,'dist/installers/win-unpacked/NickNotes.exe'))
const launchArgs=process.argv.slice(3)
if(process.platform!=='win32')throw new Error('This measurement closes the owned Windows window through CloseMainWindow.')
const scratch=fs.mkdtempSync(path.join(root,'.tmp','startup-timing-'))
const profile=path.join(scratch,'profile'),foreign=path.join(scratch,'foreign-cwd')
fs.mkdirSync(profile);fs.mkdirSync(foreign)
const metricsFile=path.join(profile,'startup-metrics.jsonl')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function measure(){
  fs.rmSync(metricsFile,{force:true})
  const started=Date.now()
  const child=spawn(executable,launchArgs,{cwd:foreign,windowsHide:false,env:{...process.env,PATH:path.join(process.env.SystemRoot||'C:/Windows','System32'),NICKNOTES_USER_DATA:profile,NICKNOTES_PORT:'18771',NICKNOTES_STARTUP_DIAGNOSTICS:'1'},stdio:['ignore','pipe','pipe']})
  let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data)
  let metrics=[]
  try {
    for(let attempt=0;attempt<600;attempt++){
      if(child.exitCode!==null)throw new Error('App exited during startup: '+log)
      if(fs.existsSync(metricsFile)){
        const lines=fs.readFileSync(metricsFile,'utf8').split('\n').slice(0,-1)
        metrics=lines.map(line=>JSON.parse(line))
        if(['quick-entry-enabled','ui-rendered','backend-ready'].every(event=>metrics.some(mark=>mark.event===event)))break
      }
      await pause(100)
    }
    for(const event of ['quick-entry-enabled','ui-rendered','backend-ready'])assert.ok(metrics.some(mark=>mark.event===event),'Startup timed out before '+event+': '+log)
    assert.ok(!log.includes('[renderer]'),log)
    return metrics.map(mark=>({...mark,fromProcessLaunchMs:mark.wallTime-started}))
  } finally {
    if(child.exitCode===null){
      const close=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null`],{windowsHide:true,stdio:'ignore'})
      await new Promise(resolve=>close.once('exit',resolve))
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(10000)])
      if(child.exitCode===null)child.kill()
    }
    fs.appendFileSync(path.join(scratch,'launcher.log'),log)
  }
}
const result={executable,launchArgs,profile,automationAttached:false,firstProfile:await measure(),sameProfileRestart:await measure()}
result.paintObserved={firstProfile:result.firstProfile.some(mark=>mark.event==='quick-entry-ready'),sameProfileRestart:result.sameProfileRestart.some(mark=>mark.event==='quick-entry-ready')}
fs.writeFileSync(path.join(root,launchArgs.length?'.tmp/startup-comparison-result.json':'.tmp/startup-timing-result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))

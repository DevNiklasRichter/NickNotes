/** Real Electron/NSIS download and signature gates against a local synthetic feed; never installs. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {spawn} from 'node:child_process'
import electron from 'electron'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const root=path.resolve(import.meta.dirname,'..')
fs.mkdirSync(path.join(root,'.tmp'),{recursive:true})
const scratch=fs.mkdtempSync(path.join(root,'.tmp','update-smoke-'))
const payload=Buffer.from('Synthetic non-executable update fixture. This must never be installed.')
const digest=crypto.createHash('sha512').update(payload).digest('base64')
let downloads=0
const server=http.createServer((req,res)=>{
  const mode=req.url.startsWith('/corrupt/')?'corrupt':'unsigned'
  if(req.url.includes('latest.yml')){
    res.setHeader('Content-Type','text/yaml')
    res.end(`version: 2.2.0\nfiles:\n  - url: fixture.exe\n    size: ${payload.length}\n    sha512: ${mode==='corrupt'?Buffer.alloc(64).toString('base64'):digest}\npath: fixture.exe\nsha512: ${digest}\nreleaseDate: '2026-11-09T00:00:00.000Z'\n`)
  }else if(req.url.endsWith('/fixture.exe')){downloads++;res.setHeader('Content-Length',payload.length);res.end(payload)}
  else {res.statusCode=404;res.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`
const appDirectory=path.join(scratch,'app');fs.mkdirSync(appDirectory)
fs.writeFileSync(path.join(appDirectory,'package.json'),JSON.stringify({name:'nicknotes-update-smoke',version:'2.1.0',main:'main.cjs'}))
fs.writeFileSync(path.join(appDirectory,'dev-app-update.yml'),'publisherName: Synthetic NickNotes Publisher\nupdaterCacheDirName: nicknotes-update-smoke\n')
fs.writeFileSync(path.join(appDirectory,'main.cjs'),`
const {app}=require('electron'),assert=require('node:assert/strict');
const {NsisUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});
app.setPath('userData',${JSON.stringify(path.join(scratch,'profile'))});
const deadline=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
  const {verifyInstallerSignature}=await import(${JSON.stringify(pathToFileURL(path.join(root,'src/desktop/verify-installer.mjs')).href)});
  const results=[];
  for(const mode of ['corrupt','unsigned']){
    const updater=new NsisUpdater({provider:'generic',url:${JSON.stringify(base)}+'/'+mode+'/'});
    updater.forceDevUpdateConfig=true;updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.disableDifferentialDownload=true;updater.disableWebInstaller=true;
    updater.logger={info(){},warn(){},error(){},debug(){}};
    updater.verifyUpdateCodeSignature=(publishers,file)=>verifyInstallerSignature(file,publishers[0]);
    let downloaded=false;updater.on('update-downloaded',()=>downloaded=true);
    const result=await updater.checkForUpdates();assert.equal(result.updateInfo.version,'2.2.0');
    let failure;try{await updater.downloadUpdate()}catch(error){failure=error}
    assert.ok(failure,'A corrupt or unsigned installer must be rejected');assert.equal(downloaded,false);
    if(mode==='unsigned')assert.equal(failure.code,'ERR_UPDATER_INVALID_SIGNATURE');
    else assert.match(failure.message,/sha512 checksum mismatch/i);
    results.push({mode,rejected:true,downloaded:false,errorCode:failure.code??'checksum mismatch'});
  }
  console.log('UPDATE_RESULT '+JSON.stringify(results));clearTimeout(deadline);app.quit();
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
`)
let child,log='',timer
try{
  child=spawn(electron,[appDirectory],{cwd:root,windowsHide:true,env:{...process.env,LOCALAPPDATA:path.join(scratch,'cache')},stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data)
  timer=setTimeout(()=>child.kill(),90000)
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0,log)
  assert.equal(downloads,2,'Both fixtures must reach the real downloader')
  const result=JSON.parse(log.split('\n').find(line=>line.startsWith('UPDATE_RESULT ')).slice(14))
  fs.writeFileSync(path.join(root,'.tmp/update-smoke-result.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
}finally{clearTimeout(timer);if(child&&child.exitCode===null)child.kill();await new Promise(resolve=>server.close(resolve))}

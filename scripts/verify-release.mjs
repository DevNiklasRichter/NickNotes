import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'
import {extractFile} from '@electron/asar'
import {releaseFiles,validateRelease} from './release-policy.mjs'

/** Read-only gate on the final signed bytes, usable on the signing laptop and in CI. */
export function verifyRelease(root){
  const files=releaseFiles(root),version=files.pkg.version
  const notes=validateRelease({...files,tag:'v'+version})
  const directory=path.join(root,'dist/installers'),appDir=path.join(directory,'win-unpacked')
  const installer=`NickNotes-Setup-${version}-x64.exe`
  const feed=parse(fs.readFileSync(path.join(directory,'latest.yml'),'utf8'))
  if(feed.version!==version)throw new Error('Update feed version mismatch.')
  const entry=feed.files?.find(file=>file.url===installer)
  if(!entry||entry.sha512!==crypto.createHash('sha512').update(fs.readFileSync(path.join(directory,installer))).digest('base64'))throw new Error('Update checksum does not match the signed installer.')
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'package-manifest.json'),'utf8'))
  if(manifest.version!==version)throw new Error('Recreate the package manifest after signing.')
  const packaged=JSON.parse(extractFile(path.join(appDir,'resources/app.asar'),'package.json').toString())
  if(packaged.version!==version||packaged.license!=='MIT')throw new Error('Packaged metadata mismatch.')
  const config=JSON.parse(extractFile(path.join(appDir,'resources/app.asar'),path.join('desktop','release-config.json')).toString())
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'})
  const tag=spawnSync('git',['rev-parse',`v${version}^{commit}`],{cwd:root,encoding:'utf8'})
  const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})
  if(head.status!==0||tag.status!==0||head.stdout.trim()!==tag.stdout.trim()||config.sourceCommit!==head.stdout.trim()||status.status!==0||status.stdout.trim())throw new Error('Release assets must match the clean tagged source commit.')
  for(const file of manifest.files){
    const absolute=path.resolve(appDir,file.path)
    if(!absolute.startsWith(appDir+path.sep)||!file.sha256||file.sha256!==crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'))throw new Error('Installed payload differs from the final manifest: '+file.path)
  }
  const updateConfig=parse(fs.readFileSync(path.join(appDir,'resources/app-update.yml'),'utf8'))
  const publishers=Array.isArray(updateConfig.publisherName)?updateConfig.publisherName:[updateConfig.publisherName]
  if(!config.updatesEnabled||!config.publisherName||publishers.length!==1||publishers[0]!==config.publisherName)throw new Error('Signed update configuration is missing.')
  const signedFiles=[path.join(directory,installer),path.join(appDir,'NickNotes.exe'),path.join(appDir,'resources/backend/nicknotes-backend.exe')]
  if(updateConfig.private===true||updateConfig.token||updateConfig.requestHeaders)throw new Error('Public update configuration must not include credentials or a private feed.')
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
  const env={...process.env,NICKNOTES_EXPECTED_PUBLISHER:config.publisherName,NICKNOTES_SIGNED_FILES:JSON.stringify(signedFiles)}
  for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key]
  const check=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',fs.readFileSync(path.join(root,'src/desktop/verify-signatures.ps1'),'utf8')],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:60000})
  if(check.status!==0)throw new Error('Signature verification failed: '+check.stdout+check.stderr)
  const assets=[installer,installer+'.blockmap','latest.yml','package-manifest.json','SHA256SUMS.txt','LICENSE','THIRD_PARTY_NOTICES.txt']
  const required=new Set(assets.filter(name=>name!=='SHA256SUMS.txt'))
  for(const line of fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)){
    const match=/^([a-f0-9]{64})  ([^/\\]+)$/.exec(line)
    if(!match||!required.has(match[2])||crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,match[2]))).digest('hex')!==match[1])throw new Error('Release checksums do not match final files.')
    required.delete(match[2])
  }
  if(required.size)throw new Error('Missing checksums: '+[...required].join(', '))
  return {version,notes,directory,assets}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Verified signed stable release '+verifyRelease(path.resolve(import.meta.dirname,'..')).version)

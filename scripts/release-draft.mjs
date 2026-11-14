import path from 'node:path'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import {releaseFiles,validateRelease} from './release-policy.mjs'
import {verifyRelease} from './verify-release.mjs'
const root=path.resolve(import.meta.dirname,'..'),repo='DevNiklasRichter/NickNotes'
const files=releaseFiles(root),tag=process.env.RELEASE_TAG??'v'+files.pkg.version
const notes=validateRelease({...files,tag})
function gh(args,allowFailure=false){
  const result=spawnSync('gh',args,{cwd:root,encoding:'utf8',windowsHide:true})
  if(result.error)throw new Error('GitHub CLI (gh) is required on the release laptop.')
  if(result.status!==0&&!allowFailure)throw new Error(result.stderr)
  return result
}
const existing=gh(['release','view',tag,'--repo',repo,'--json','isDraft,tagName'],true)
if(existing.status===0&&!JSON.parse(existing.stdout).isDraft)throw new Error('A published release is immutable here; create a new version.')
fs.mkdirSync(path.join(root,'.tmp'),{recursive:true})
const scratch=fs.mkdtempSync(path.join(root,'.tmp','release-notes-')),bodyFile=path.join(scratch,'notes.md')
if(process.argv.includes('--prepare')){
  fs.writeFileSync(bodyFile,'Dieser Entwurf ist noch nicht zur Veröffentlichung bereit. Signierung auf dem Release-Laptop und manuelle Windows-Abnahme stehen aus.\n\n'+notes)
  if(existing.status!==0)gh(['release','create',tag,'--repo',repo,'--verify-tag','--draft','--title','NickNotes '+files.pkg.version,'--notes-file',bodyFile])
  console.log('Release draft prepared without public download assets. Sign and verify on the release laptop before attaching assets.')
}else if(process.argv.includes('--upload')){
  const result=verifyRelease(root)
  if(existing.status!==0)throw new Error('First push the stable tag and wait for its successful Windows CI and release draft.')
  const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim()
  const runs=JSON.parse(gh(['run','list','--repo',repo,'--workflow','windows.yml','--commit',revision,'--json','conclusion,headBranch']).stdout)
  if(!runs.some(run=>run.conclusion==='success'&&run.headBranch===tag))throw new Error('The tagged commit needs a successful Windows CI run before attaching release assets.')
  // Everything after the rule is download information; the app shows only the part above it.
  fs.writeFileSync(bodyFile,result.notes+'\n\n---\n\nWindows x64 · MIT · signierter Offline-Installer. Automatische Updates für veröffentlichte stabile Versionen.\n')
  gh(['release','upload',tag,...result.assets.map(name=>path.join(result.directory,name)),'--repo',repo,'--clobber'])
  gh(['release','edit',tag,'--repo',repo,'--notes-file',bodyFile])
  console.log('Signed assets attached to draft. Finish the Windows acceptance, then explicitly Publish in GitHub.')
}else throw new Error('Use --prepare (CI) or --upload (signing laptop). Publishing is deliberately manual.')

import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {releaseFiles,validateRelease} from './release-policy.mjs'
const root=path.resolve(import.meta.dirname,'..')
const files=releaseFiles(root)
validateRelease({...files,tag:'v'+files.pkg.version})
const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})
if(status.status!==0||status.stdout.trim())throw new Error('A signed release must be built from a clean tagged checkout.')
const tagged=spawnSync('git',['rev-parse',`v${files.pkg.version}^{commit}`],{cwd:root,encoding:'utf8'})
const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'})
if(tagged.status!==0||tagged.stdout.trim()!==head.stdout.trim())throw new Error('Check out the exact stable release tag before signing.')
if(!process.env.NICKNOTES_PUBLISHER_NAME)throw new Error('Set NICKNOTES_PUBLISHER_NAME on the signing laptop to the certificate Common Name.')
if(!process.env.npm_execpath)throw new Error('Run npm run package:release')
const env={...process.env,NICKNOTES_RELEASE_BUILD:'1'}
for(const script of ['build','build:backend','stage:app']){
  const result=spawnSync(process.execPath,[process.env.npm_execpath,'run',script],{cwd:root,env,stdio:'inherit',windowsHide:true})
  if(result.status!==0)process.exit(result.status??1)
}
const result=spawnSync(process.execPath,[path.join(root,'node_modules/electron-builder/cli.js'),'--win','--config','electron-builder.release.cjs','--publish','never'],{cwd:root,env,stdio:'inherit',windowsHide:true})
process.exit(result.status??1)

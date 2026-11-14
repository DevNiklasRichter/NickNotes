import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

export function ciScope(files,{full=false}={}){
  if(full)return {code:true,package:true}
  const code=files.some(file=>file==='CHANGELOG.md'||!file.startsWith('doc/')&&!(file.indexOf('/')<0&&/\.md$/i.test(file)))
  const packageChanged=files.some(file=>!/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(file)&&!file.startsWith('src/backend/tests/')&&/^(src\/|build\/|CHANGELOG\.md$|requirements[^/]*|package(?:-lock)?\.json$|electron-builder|vite\.config|tsconfig|\.github\/workflows\/|scripts\/(?:build-|stage-|before-pack|desktop-dependencies|package-|verify-package|smoke-desktop|candidate-checksums|release-))/.test(file))
  return {code,package:code&&packageChanged}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const base=process.env.CI_BASE_SHA
  let files=[],full=process.env.GITHUB_EVENT_NAME==='workflow_dispatch'||process.env.GITHUB_REF_TYPE==='tag'||!base||/^0+$/.test(base)
  if(!full){
    if(!/^[a-f0-9]{40}$/.test(base))throw new Error('Invalid CI base revision')
    const diff=spawnSync('git',['diff','--name-only',base,'HEAD','--'],{encoding:'utf8',windowsHide:true})
    if(diff.status!==0)full=true
    else files=diff.stdout.trim().split(/\r?\n/).filter(Boolean)
  }
  const scope=ciScope(files,{full})
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(scope).map(([key,value])=>`${key}=${value}\n`).join(''))
  console.log(JSON.stringify(scope))
}

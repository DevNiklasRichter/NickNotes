/** Turns the unreleased changelog into the section of the next version and sets that version everywhere. */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import semver from 'semver'

export function prepareChangelog(text,version,date){
  const lines=text.split(/\r?\n/)
  const start=lines.indexOf('## [Unreleased]')
  if(start<0)throw new Error('CHANGELOG.md needs a "## [Unreleased]" section.')
  if(lines.some(line=>line===`## [${version}]`||line.startsWith(`## [${version}] - `)))throw new Error(`CHANGELOG.md already has a section for ${version}.`)
  const next=lines.findIndex((line,index)=>index>start&&line.startsWith('## '))
  const body=lines.slice(start+1,next<0?undefined:next).join('\n').trim()
  if(!body)throw new Error('Nothing to release: the unreleased section is empty.')
  return [...lines.slice(0,start+1),'',`## [${version}] - ${date}`,'',body,'',...(next<0?[]:lines.slice(next))].join('\n').replace(/\n{3,}/g,'\n\n').replace(/\n*$/,'\n')
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(import.meta.dirname,'..')
  if(!process.env.npm_execpath)throw new Error('Run npm run release:prepare -- <version>')
  const version=process.argv[2]
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
  if(!semver.valid(version)||semver.valid(version)!==version)throw new Error('Usage: npm run release:prepare -- <x.y.z or x.y.z-rc.n>')
  if(!semver.gt(version,pkg.version))throw new Error(`${version} must be newer than ${pkg.version}.`)
  const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})
  if(status.status!==0||status.stdout.trim())throw new Error('Commit or stash local changes first.')
  const changelogPath=path.join(root,'CHANGELOG.md')
  const date=new Date().toISOString().slice(0,10)
  fs.writeFileSync(changelogPath,prepareChangelog(fs.readFileSync(changelogPath,'utf8'),version,date))
  const npm=spawnSync(process.execPath,[process.env.npm_execpath,'version',version,'--no-git-tag-version'],{cwd:root,stdio:'inherit',windowsHide:true})
  if(npm.status!==0)process.exit(npm.status??1)
  console.log(`\nVersion ${version} prepared. Read the new changelog section once more, then:\n`
    +`  git switch -c release/${version} && git commit -am "release: ${version}"  → PR, green CI, merge\n`
    +`  git switch main && git pull && git tag v${version} && git push origin v${version}\n`
    +'The tag starts the release CI, which checks everything and creates the GitHub release draft.')
}

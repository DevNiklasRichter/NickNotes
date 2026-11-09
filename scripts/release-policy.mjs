import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import semver from 'semver'

export function validateRelease({pkg,lock,tag,license,notes}){
  if(semver.valid(pkg.version)!==pkg.version||semver.prerelease(pkg.version))throw new Error('A release needs a stable x.y.z version, not a release candidate.')
  if(tag!=='v'+pkg.version)throw new Error('Release tag and package version do not match.')
  if(lock.version!==pkg.version||lock.packages[''].version!==pkg.version)throw new Error('Package lock version mismatch.')
  if(pkg.license!=='MIT'||!license.includes('MIT License'))throw new Error('The selected MIT license must be included.')
  const heading=`## [${pkg.version}]`
  const lines=notes.split(/\r?\n/)
  const start=lines.findIndex(line=>line===heading||line.startsWith(heading+' - '))
  if(start<0)throw new Error('Add release notes under '+heading+' before tagging.')
  const section=lines.slice(start+1)
  const next=section.findIndex(line=>line.startsWith('## '))
  const releaseNotes=section.slice(0,next<0?undefined:next).join('\n').trim()
  if(!releaseNotes)throw new Error('Release notes must not be empty.')
  return releaseNotes
}
export function releaseFiles(root){
  return {pkg:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),lock:JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')),license:fs.readFileSync(path.join(root,'LICENSE'),'utf8'),notes:fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8')}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(import.meta.dirname,'..')
  validateRelease({...releaseFiles(root),tag:process.env.RELEASE_TAG})
  console.log('Stable version, tag, license and release notes match.')
}

import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {listPackage} from '@electron/asar'
const root=path.resolve(import.meta.dirname,'..')
const base=path.join(root,'dist/installers/win-unpacked')
const asar=path.join(base,'resources/app.asar')
const files=listPackage(asar).map(file=>file.replaceAll('\\','/').replace(/^\//,''))
const roots=new Set(['desktop','frontend','package.json','THIRD_PARTY_NOTICES.txt'])
for(const file of files){assert.ok(roots.has(file.split('/')[0]),`Unexpected app payload: ${file}`);assert.ok(!/notebase|node_modules|\.venv|\/tests\//i.test(file),`Private/development payload: ${file}`)}
assert.ok(files.includes('desktop/main.mjs'));assert.ok(files.includes('frontend/index.html'));assert.ok(files.includes('THIRD_PARTY_NOTICES.txt'))
function walk(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(folder,entry.name)):[path.join(folder,entry.name)])}
const installed=walk(base).map(file=>({path:path.relative(base,file).replaceAll('\\','/'),bytes:fs.statSync(file).size}))
for(const file of installed)assert.ok(!/(^|\/)(\.venv|node_modules|__pycache__|tests)(\/|$)|asterion/i.test(file.path),`Unexpected installed file: ${file.path}`)
assert.ok(installed.some(file=>file.path==='resources/backend/nicknotes-backend.exe'))
const manifest={version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,fileCount:installed.length,installedBytes:installed.reduce((sum,file)=>sum+file.bytes,0),asarFiles:files.length,largestFiles:[...installed].sort((a,b)=>b.bytes-a.bytes).slice(0,12),files:installed}
const installer=path.join(root,'dist/installers',`NickNotes-Setup-${manifest.version}-x64.exe`)
manifest.installerBytes=fs.existsSync(installer)?fs.statSync(installer).size:null
manifest.budgets={installerBytes:200*1024*1024,installedBytes:500*1024*1024}
manifest.budgetWarnings=[]
for(const [metric,budget] of Object.entries(manifest.budgets))if(manifest[metric]>budget)manifest.budgetWarnings.push(`${metric}: ${manifest[metric]} exceeds investigation threshold ${budget}`)
for(const warning of manifest.budgetWarnings)console.warn(warning)
fs.writeFileSync(path.join(root,'dist/installers/package-manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({version:manifest.version,fileCount:manifest.fileCount,installedBytes:manifest.installedBytes,installerBytes:manifest.installerBytes,asarFiles:manifest.asarFiles,budgetWarnings:manifest.budgetWarnings}))

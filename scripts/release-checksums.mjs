import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {parse} from 'yaml'
const root=path.resolve(import.meta.dirname,'..')
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
const directory=path.join(root,'dist/installers')
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.txt'])fs.copyFileSync(path.join(root,'dist/app',name),path.join(directory,name))
const installer=`NickNotes-Setup-${version}-x64.exe`
if(parse(fs.readFileSync(path.join(directory,'latest.yml'),'utf8')).version!==version)throw new Error('Regenerate update metadata for this package version before checksumming.')
const names=[installer,installer+'.blockmap','package-manifest.json','LICENSE','THIRD_PARTY_NOTICES.txt','latest.yml']
const lines=names.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}  ${name}`)
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n')
console.log(lines.join('\n'))

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const root=path.resolve(import.meta.dirname,'..')
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
const directory=path.join(root,'dist/installers')
const names=[`NickNotes-Setup-${version}-x64.exe`,'package-manifest.json']
const lines=names.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}  ${name}`)
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n')
console.log(lines.join('\n'))

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const target = path.resolve(root, 'dist/app')
if (!target.startsWith(path.resolve(root, 'dist') + path.sep)) throw new Error('Unsafe staging path')
fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.cpSync(path.join(root, 'dist/frontend'), path.join(target, 'frontend'), { recursive: true })
fs.cpSync(path.join(root, 'src/desktop'), path.join(target, 'desktop'), { recursive: true })
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version,
  description: 'Lokale Markdown NoteBase mit Wissensgraph und MCP', author: 'NickNotes',
  license: 'UNLICENSED', dependencies: {}, type: 'module', main: 'desktop/main.mjs',
}, null, 2))
console.log('Staged runtime files only:', target)

const notices = ['NickNotes dependency notices. NickNotes itself has no public redistribution license yet.\n']
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative || entry.dev || !relative.includes('node_modules/')) continue
  const directory = path.join(root, relative)
  const metadata = JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'))
  notices.push(`\n--- ${metadata.name} ${metadata.version} ---\nLicense: ${metadata.license ?? 'See package license'}\n`)
  for(const file of fs.readdirSync(directory)) {
    if(/^(license|copying|notice)(\.|$)/i.test(file) && fs.statSync(path.join(directory,file)).isFile()) notices.push(fs.readFileSync(path.join(directory,file),'utf8'))
  }
}
notices.push(fs.readFileSync(path.join(root,'dist/PYTHON_NOTICES.txt'),'utf8'))
fs.writeFileSync(path.join(target,'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))

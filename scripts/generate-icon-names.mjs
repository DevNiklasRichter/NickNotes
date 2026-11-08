import fs from 'node:fs/promises'
import * as Lucide from 'lucide-react'
const names=Object.keys(Lucide).filter(name=>/^[A-Z]/.test(name)&&!name.endsWith('Icon')&&!['Icon','LucideProvider'].includes(name)).sort()
const content='// Names only; components are loaded when selected.\nexport const LUCIDE_ICON_NAMES = '+JSON.stringify(names)+' as const\n'
const target=new URL('../src/frontend/src/icons/lucideNames.generated.ts',import.meta.url)
if(process.argv.includes('--check')){
 const existing=await fs.readFile(target,'utf8')
 if(existing.replaceAll('\r\n','\n')!==content)throw new Error('Icon name drift: run npm run icons:generate')
}else await fs.writeFile(target,content)

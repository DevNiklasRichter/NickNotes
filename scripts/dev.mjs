import {spawn} from 'node:child_process'
import path from 'node:path'
import electron from 'electron'
const root=path.resolve(import.meta.dirname,'..')
const children=new Set()
let stopping=false
function run(binary,args) {
 const child=spawn(binary,args,{cwd:root,stdio:'inherit',windowsHide:true})
 children.add(child)
 child.on('exit',()=>{children.delete(child);stop()})
 child.on('error',error=>{console.error(error);stop()})
 return child
}
function stop() {
 if(stopping)return
 stopping=true
 for(const child of children)child.kill()
}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
const vite=run(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--strictPort'])
for(let attempt=0;attempt<100&&!stopping;attempt++) {
 try {
  const response=await fetch('http://localhost:5173',{signal:AbortSignal.timeout(500)})
  if(response.ok){run(electron,['.']);break}
 } catch { /* Wait only for the Vite process owned by this command. */ }
 await new Promise(resolve=>setTimeout(resolve,150))
 if(attempt===99){console.error('Vite did not become ready.');stop();process.exitCode=1}
}
if(vite.exitCode!==null)process.exitCode=1

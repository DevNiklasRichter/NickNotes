import {spawn} from 'node:child_process'
import path from 'node:path'
import electron from 'electron'
const root=path.resolve(import.meta.dirname,'..')
const children=new Set()
let stopping=false
function run(binary,args,options={}) {
 const child=spawn(binary,args,{cwd:root,stdio:'inherit',windowsHide:true,...options})
 children.add(child)
 child.on('exit',code=>{children.delete(child);if(!stopping&&code)process.exitCode=code;stop()})
 child.on('error',error=>{console.error(error);stop()})
 return child
}
function stop() {
 if(stopping)return
 stopping=true
 for(const child of children)child.kill()
}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
const vite=run(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--strictPort'],{stdio:['ignore','pipe','pipe']})
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Der eigene Vite-Prozess wurde nicht rechtzeitig bereit.')),30000)
  let output=''
  vite.stdout.on('data',data=>{
   process.stdout.write(data)
   output=(output+data.toString()).replace(/\u001b\[[0-9;]*m/g,'').slice(-8000)
   if(output.includes('Local:')&&output.includes('http://localhost:5173/')){clearTimeout(timer);resolve()}
  })
  vite.stderr.on('data',data=>process.stderr.write(data))
  vite.once('error',error=>{clearTimeout(timer);reject(error)})
  vite.once('exit',()=>{clearTimeout(timer);reject(new Error('Vite wurde vor dem App-Start beendet. Ist Port 5173 bereits belegt?'))})
 })
 if(!stopping)run(electron,['.'],{windowsHide:false})
} catch(error) {console.error(String(error));process.exitCode=1;stop()}

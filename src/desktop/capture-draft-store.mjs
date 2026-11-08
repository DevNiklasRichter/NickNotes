import fs from 'node:fs/promises'
import path from 'node:path'

/** One pending Markdown capture, independent of backend readiness; never a NoteBase writer. */
export class CaptureDraftStore {
  constructor(profile) { this.file=path.join(profile,'capture-draft.md');this.current='';this.pending=undefined;this.writing=null }
  async load() {
    try {
      const stat=await fs.stat(this.file)
      if(stat.size>5*1024*1024)throw new Error('Der lokale Schnellerfassungsentwurf ist größer als 5 MB.')
      this.current=await fs.readFile(this.file,'utf8')
    } catch(error) { if(error.code!=='ENOENT')throw error }
    return this.current
  }
  set(text) {
    if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>5*1024*1024)return Promise.reject(new Error('Der Entwurf darf höchstens 5 MB enthalten.'))
    if(text===this.current&&this.pending===undefined&&!this.writing)return Promise.resolve()
    this.current=text;this.pending=text
    return this.flush()
  }
  flush() {
    if(this.writing)return this.writing
    if(this.pending===undefined)return Promise.resolve()
    this.writing=this.drain().then(()=>{this.writing=null;if(this.pending!==undefined)return this.flush()},error=>{this.writing=null;throw error})
    return this.writing
  }
  async drain() {
    while(this.pending!==undefined){
      const text=this.pending;this.pending=undefined
      try {
        if(text){
          await fs.mkdir(path.dirname(this.file),{recursive:true})
          const temporary=this.file+'.tmp'
          await fs.writeFile(temporary,text,'utf8')
          for(let attempt=0;;attempt++){
            try {await fs.rename(temporary,this.file);break}
            catch(error){if(attempt===4||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)))}
          }
        } else await fs.rm(this.file,{force:true})
      } catch(error){if(this.pending===undefined)this.pending=text;throw error}
    }
  }
}

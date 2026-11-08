import {stripVTControlCharacters} from 'node:util'

/** Match the owned Vite process's local URL, independent of terminal formatting. */
export function isViteReady(output,url='http://localhost:5173/') {
  return stripVTControlCharacters(output).split(/\r?\n/).some(line=>{
    const match=line.match(/\bLocal:\s+(\S+)/)
    return match?.[1]===url
  })
}

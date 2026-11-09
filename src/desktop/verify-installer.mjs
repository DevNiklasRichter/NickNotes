import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

/** Fail closed, including unavailable PowerShell, timeout and untrusted/incorrect publishers. */
export function verifyInstallerSignature(file,publisher){
  return new Promise(resolve=>{
    // PowerShell cannot read an app.asar virtual path. Read our fixed script via
    // Electron's filesystem and pass data only through environment variables.
    const script=fs.readFileSync(fileURLToPath(new URL('./verify-signatures.ps1',import.meta.url)),'utf8')
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
    const env={...process.env,NICKNOTES_EXPECTED_PUBLISHER:publisher,NICKNOTES_SIGNED_FILES:JSON.stringify([file])}
    // A PowerShell 7 launcher's module path is incompatible with Windows PowerShell 5.
    for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key]
    execFile(powershell,['-NoProfile','-NonInteractive','-Command',script],{
      env,
      timeout:20_000,windowsHide:true,
    },(error,_stdout,stderr)=>{
      if(!error){resolve(null);return}
      console.warn('[updates] Signaturprüfung fehlgeschlagen:',String(stderr||error.message))
      resolve(stderr?.includes('Missing valid timestamped signature')?'Windows meldet keine gültige zeitgestempelte Signatur.':stderr?.includes('Unexpected publisher')?'Die Signatur stammt von einem anderen Herausgeber.':'Die Windows-Signaturprüfung konnte nicht abgeschlossen werden.')
    })
  })
}

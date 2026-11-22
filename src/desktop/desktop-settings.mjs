import fs from 'node:fs/promises'
import path from 'node:path'

/** Global shortcuts offered for quick capture; none of them is used inside the app. */
export const CAPTURE_SHORTCUTS = Object.freeze([
  {value:'CommandOrControl+Alt+N',label:'Strg+Alt+N'},
  {value:'CommandOrControl+Alt+Space',label:'Strg+Alt+Leertaste'},
  {value:'CommandOrControl+Shift+Alt+N',label:'Strg+Umschalt+Alt+N'},
])
/** Times offered for the morning overview of due tasks; '' means off. */
export const OVERVIEW_TIMES = Object.freeze(['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00'])
export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({captureShortcut:CAPTURE_SHORTCUTS[0].value,keepInTray:false,dailyOverview:''})

export function shortcutLabel(value){
  return CAPTURE_SHORTCUTS.find(item=>item.value===value)?.label??''
}

/** Unknown or damaged values fall back to the defaults; an empty shortcut means "off". */
export function normalizeDesktopSettings(value){
  const raw=value&&typeof value==='object'?value:{}
  const known=raw.captureShortcut===''||CAPTURE_SHORTCUTS.some(item=>item.value===raw.captureShortcut)
  return {
    captureShortcut:known?raw.captureShortcut:DEFAULT_DESKTOP_SETTINGS.captureShortcut,
    keepInTray:raw.keepInTray===true,
    dailyOverview:OVERVIEW_TIMES.includes(raw.dailyOverview)?raw.dailyOverview:'',
  }
}

/** Device-local desktop preferences (not part of a NoteBase). */
export class DesktopSettingsStore {
  constructor(profile){this.file=path.join(profile,'desktop-settings.json');this.current={...DEFAULT_DESKTOP_SETTINGS}}
  async load(){
    try{this.current=normalizeDesktopSettings(JSON.parse(await fs.readFile(this.file,'utf8')))}
    catch(error){if(error.code!=='ENOENT')console.warn('[desktop-settings] Einstellungen unlesbar, Standard wird verwendet:',String(error))}
    return this.current
  }
  async update(patch){
    const next=normalizeDesktopSettings({...this.current,...(patch&&typeof patch==='object'?patch:{})})
    await fs.mkdir(path.dirname(this.file),{recursive:true})
    const temporary=this.file+'.tmp'
    await fs.writeFile(temporary,JSON.stringify(next,null,2),'utf8')
    await fs.rename(temporary,this.file)
    this.current=next
    return next
  }
}

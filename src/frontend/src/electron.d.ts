export {}

import type {UpdateState} from './app/updateTypes'

/** Login autostart of the local service; only the installed Windows app offers it. */
type BackgroundService = {available:boolean; enabled:boolean}

/** Device-local desktop integration: global capture shortcut, tray behaviour, morning overview. */
export type DesktopSettings = {
  captureShortcut:string
  keepInTray:boolean
  /** "HH:MM" of the morning overview of due tasks; '' is off. */
  dailyOverview:string
  shortcutRegistered:boolean
  shortcuts:Array<{value:string;label:string}>
  overviewTimes:string[]
}

type DesktopSettingsPatch = Partial<Pick<DesktopSettings,'captureShortcut'|'keepInTray'|'dailyOverview'>>

declare global {
  interface Window {
    nicknotesStartup?: {deferUi:(callback:()=>void)=>void;mount:(callback:(ready:()=>void,failed:(error:unknown)=>void)=>void)=>void}
    nicknotes?: {
      startupTheme?:'light'|'dark'
      startupMark?:(event:'quick-entry-enabled'|'quick-entry-ready'|'ui-rendered'|'workspace-ready')=>void
      getBackendStatus?:()=>Promise<{phase:'starting'|'ready'|'error';message:string}>
      getBackgroundService?:()=>Promise<BackgroundService>
      setBackgroundService?:(enabled:boolean)=>Promise<BackgroundService>
      onBackendStatus?:(handler:(status:{phase:'starting'|'ready'|'error';message:string})=>void)=>()=>void
      readCaptureDraft?:()=>Promise<string>
      writeCaptureDraft?:(text:string)=>Promise<void>
      getDesktopSettings?:()=>Promise<DesktopSettings>
      setDesktopSettings?:(patch:DesktopSettingsPatch)=>Promise<DesktopSettings>
      onAppCommand?:(handler:(command:string)=>void)=>()=>void
      quickCapture?: {
        readDraft:()=>Promise<string>
        writeDraft:(text:string)=>Promise<void>
        hide:()=>Promise<void>
        onShown:(handler:(payload:{theme:'light'|'dark'})=>void)=>()=>void
      }
      getUpdateState?:()=>Promise<UpdateState>
      checkForUpdates?:()=>Promise<UpdateState>
      downloadUpdate?:()=>Promise<UpdateState>
      installUpdate?:()=>Promise<UpdateState>
      onUpdateState?:(handler:(state:UpdateState)=>void)=>()=>void
      selectDirectory?: () => Promise<string | null>
      selectImportSources?: () => Promise<string[]>
      getBackendUrl?: () => Promise<string>
      getBackendToken?: () => Promise<string>
      windowAction?: (action:'close'|'fullscreen'|'show') => Promise<void>
      editText?: (action:'undo'|'redo'|'cut'|'copy'|'paste'|'selectAll') => Promise<void>
      openExternalUrl?: (url: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      openPathInFileExplorer?: (path: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      setWindowTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>
      setUnsavedChanges?: (hasUnsavedChanges: boolean) => void
      setCloseGuardReady?: (ready:boolean) => void
      onRequestCloseState?: (handler:(requestId:number)=>void) => ()=>void
      respondCloseState?: (requestId:number,hasUnsavedChanges:boolean) => void
      onRequestSaveBeforeClose?: (handler: (requestId:number) => void) => (() => void) | void
      respondSaveBeforeClose?: (requestId:number,ok: boolean) => void
    }
  }
}

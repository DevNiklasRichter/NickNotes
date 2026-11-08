export {}

declare global {
  interface Window {
    nicknotesStartup?: {mount:(callback:(ready:()=>void,failed:(error:unknown)=>void)=>void)=>void}
    nicknotes?: {
      startupTheme?:'light'|'dark'
      startupMark?:(event:'quick-entry-ready'|'ui-rendered'|'workspace-ready')=>void
      getBackendStatus?:()=>Promise<{phase:'starting'|'ready'|'error';message:string}>
      onBackendStatus?:(handler:(status:{phase:'starting'|'ready'|'error';message:string})=>void)=>()=>void
      readCaptureDraft?:()=>Promise<string>
      writeCaptureDraft?:(text:string)=>Promise<void>
      selectDirectory?: () => Promise<string | null>
      selectImportSources?: () => Promise<string[]>
      getBackendUrl?: () => Promise<string>
      getBackendToken?: () => Promise<string>
      windowAction?: (action:'close'|'fullscreen') => Promise<void>
      editText?: (action:'undo'|'redo'|'cut'|'copy'|'paste'|'selectAll') => Promise<void>
      openExternalUrl?: (url: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      openPathInFileExplorer?: (path: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      setWindowTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>
      setUnsavedChanges?: (hasUnsavedChanges: boolean) => void
      onRequestSaveBeforeClose?: (handler: () => void) => (() => void) | void
      respondSaveBeforeClose?: (ok: boolean) => void
    }
  }
}

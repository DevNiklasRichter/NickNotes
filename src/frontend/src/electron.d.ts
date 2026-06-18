export {}

declare global {
  interface Window {
    nicknotes?: {
      selectDirectory?: () => Promise<string | null>
      selectImportSources?: () => Promise<string[]>
      getBackendUrl?: () => Promise<string>
      openExternalUrl?: (url: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      openPathInFileExplorer?: (path: string) => Promise<{ ok: boolean; code?: string; message?: string }>
      setWindowTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>
      setUnsavedChanges?: (hasUnsavedChanges: boolean) => void
      onRequestSaveBeforeClose?: (handler: () => void) => (() => void) | void
      respondSaveBeforeClose?: (ok: boolean) => void
    }
  }
}

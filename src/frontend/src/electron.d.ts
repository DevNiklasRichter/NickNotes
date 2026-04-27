export {}

declare global {
  interface Window {
    nicknotes?: {
      selectDirectory?: () => Promise<string | null>
      getBackendUrl?: () => Promise<string>
      openExternalUrl?: (url: string) => Promise<{ ok: boolean }>
      setWindowTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>
      setUnsavedChanges?: (hasUnsavedChanges: boolean) => void
      onRequestSaveBeforeClose?: (handler: () => void) => (() => void) | void
      respondSaveBeforeClose?: (ok: boolean) => void
    }
  }
}

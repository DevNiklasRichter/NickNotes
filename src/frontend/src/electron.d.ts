export {}

declare global {
  interface Window {
    nicknotes?: {
      selectDirectory?: () => Promise<string | null>
      getBackendUrl?: () => Promise<string>
      setWindowTheme?: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>
    }
  }
}

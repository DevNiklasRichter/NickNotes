export {}

declare global {
  interface Window {
    nicknotes?: {
      selectDirectory?: () => Promise<string | null>
      getBackendUrl?: () => Promise<string>
    }
  }
}

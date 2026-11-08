const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nicknotes', {
  startupTheme: process.argv.find(value=>value.startsWith('--nicknotes-theme='))?.split('=')[1] || 'light',
  startupMark: (event) => ipcRenderer.send('startup:mark',event),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectImportSources: () => ipcRenderer.invoke('dialog:selectImportSources'),
  getBackendUrl: () => ipcRenderer.invoke('backend:url'),
  getBackendToken: () => ipcRenderer.invoke('backend:token'),
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  readCaptureDraft: () => ipcRenderer.invoke('capture:draft-read'),
  writeCaptureDraft: (text) => ipcRenderer.invoke('capture:draft-write',text),
  onBackendStatus: (handler) => {
    const listener=(_event,status)=>handler(status)
    ipcRenderer.on('backend:status-changed',listener)
    return()=>ipcRenderer.removeListener('backend:status-changed',listener)
  },
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  editText: (action) => ipcRenderer.invoke('editor:action', action),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPathInFileExplorer: (path) => ipcRenderer.invoke('shell:openPathInFileExplorer', path),
  setWindowTheme: (theme) => ipcRenderer.invoke('window:set-theme', theme),
  setUnsavedChanges: (hasUnsavedChanges) => ipcRenderer.send('app:set-unsaved', Boolean(hasUnsavedChanges)),
  onRequestSaveBeforeClose: (handler) => {
    if (typeof handler !== 'function') {
      return () => {}
    }
    const listener = () => {
      handler()
    }
    ipcRenderer.on('app:request-save-before-close', listener)
    return () => {
      ipcRenderer.removeListener('app:request-save-before-close', listener)
    }
  },
  respondSaveBeforeClose: (ok) => ipcRenderer.send('app:save-before-close-result', { ok: Boolean(ok) }),
})

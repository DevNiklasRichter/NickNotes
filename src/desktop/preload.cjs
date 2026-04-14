const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nicknotes', {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  getBackendUrl: () => ipcRenderer.invoke('backend:url'),
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

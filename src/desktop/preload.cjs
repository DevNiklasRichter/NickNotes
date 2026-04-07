const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nicknotes', {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  getBackendUrl: () => ipcRenderer.invoke('backend:url'),
  setWindowTheme: (theme) => ipcRenderer.invoke('window:set-theme', theme),
})

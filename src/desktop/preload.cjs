const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nicknotes', {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  getBackendUrl: () => ipcRenderer.invoke('backend:url'),
})

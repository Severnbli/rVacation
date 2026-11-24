const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  getConnection: () => ipcRenderer.invoke('connection:get'),
  connect: value => ipcRenderer.invoke('connection:set', value),
  getRecords: () => ipcRenderer.invoke('records:get'),
  change: command => ipcRenderer.invoke('records:change', command),
  openWorkers: () => ipcRenderer.invoke('workers:file'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: fn => ipcRenderer.on('update:state', (_event, state) => fn(state)),
})

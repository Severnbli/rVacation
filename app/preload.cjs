const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  getRecords: () => ipcRenderer.invoke('records:get'),
  change: command => ipcRenderer.invoke('records:change', command),
  importDatabase: () => ipcRenderer.invoke('records:import'),
  openDataFolder: () => ipcRenderer.invoke('records:folder'),
  openWorkers: () => ipcRenderer.invoke('workers:file'),
  listHolidayFiles: () => ipcRenderer.invoke('holidays:list'),
  readHolidayFile: name => ipcRenderer.invoke('holidays:read', name),
  openRepository: () => ipcRenderer.invoke('app:repository'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: fn => ipcRenderer.on('update:state', (_event, state) => fn(state)),
})

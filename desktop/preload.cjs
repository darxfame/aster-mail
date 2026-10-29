const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aster', {
  invoke: (operation, data = {}) => ipcRenderer.invoke('aster', operation, data),
  onNavigate: callback => ipcRenderer.on('aster-navigate', (_event, data) => callback(data)),
  onUpdate: callback => ipcRenderer.on('aster-update', (_event, data) => callback(data)),
  onMailAlerts: callback => ipcRenderer.on('aster-mail-alerts', (_event, data) => callback(data)),
  onSound: callback => ipcRenderer.on('aster-sound', (_event, kind) => callback(kind)),
});

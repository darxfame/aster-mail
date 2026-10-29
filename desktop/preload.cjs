const { contextBridge, ipcRenderer } = require('electron');
let unsavedChanges = false;
window.addEventListener('beforeunload', event => {
  if (unsavedChanges) { event.preventDefault(); event.returnValue = ''; }
});
contextBridge.exposeInMainWorld('aster', {
  setUnsavedChanges: value => {
    unsavedChanges = value === true;
    ipcRenderer.send('aster-unsaved-changes', unsavedChanges);
  },
  invoke: (operation, data = {}) => ipcRenderer.invoke('aster', operation, data),
  onNavigate: callback => ipcRenderer.on('aster-navigate', (_event, data) => callback(data)),
  onUpdate: callback => ipcRenderer.on('aster-update', (_event, data) => callback(data)),
  onInbox: callback => ipcRenderer.on('aster-inbox', (_event, data) => callback(data)),
  onMailAlerts: callback => ipcRenderer.on('aster-mail-alerts', (_event, data) => callback(data)),
  onSound: callback => ipcRenderer.on('aster-sound', (_event, kind) => callback(kind)),
});

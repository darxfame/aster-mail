const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('asterWidget', {
  state: () => ipcRenderer.invoke('aster-widget', 'state', {}),
  action: (action, id) => ipcRenderer.invoke('aster-widget', action, { id }),
  onUpdate: callback => ipcRenderer.on('aster-widget-update', (_event, state) => callback(state)),
});

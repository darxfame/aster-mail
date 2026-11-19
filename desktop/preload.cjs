const { contextBridge, ipcRenderer } = require('electron');
let unsavedChanges = false;
window.addEventListener('beforeunload', event => {
  if (unsavedChanges) { event.preventDefault(); event.returnValue = ''; }
});
contextBridge.exposeInMainWorld('aster', {
  platform: process.platform,
  setUnsavedChanges: value => {
    unsavedChanges = value === true;
    ipcRenderer.send('aster-unsaved-changes', unsavedChanges);
  },
  invoke: (operation, data = {}) => ipcRenderer.invoke('aster', operation, data),
  onThemeChanged: callback => ipcRenderer.on('aster-theme-changed', (_event, disabledId) => callback(disabledId)),
  onComposeSaved: callback => ipcRenderer.on('aster-compose-saved', () => callback()),
  onModuleAction: callback => ipcRenderer.on('aster-module-action', (_event, data) => callback(data)),
  onNavigate: callback => ipcRenderer.on('aster-navigate', (_event, data) => callback(data)),
  onUpdate: callback => ipcRenderer.on('aster-update', (_event, data) => callback(data)),
  onWaitingReplies: callback => ipcRenderer.on('aster-waiting-replies', (_event, data) => callback(data)),
  onInbox: callback => ipcRenderer.on('aster-inbox', (_event, data) => callback(data)),
  onMailboxChanged: callback => ipcRenderer.on('aster-mailbox-changed', (_event, data) => callback(data)),
  onCalendarChanged: callback => ipcRenderer.on('aster-calendar-changed', (_event, data) => callback(data)),
  onMcpAccountRetired: callback => ipcRenderer.on('aster-mcp-account-retired', (_event, data) => callback(data)),
  onMcpHelp: callback => ipcRenderer.on('aster-mcp-help', () => callback()),
  onMcpState: callback => ipcRenderer.on('aster-mcp-state', () => callback()),
  onMcpRendererRequest: callback => {
    ipcRenderer.on('aster-mcp-renderer-request', async (event, request) => {
      const [port] = event.ports;
      if (!port) return;
      try { port.postMessage({ ok: true, value: await callback(request) }); }
      catch (error) { port.postMessage({ ok: false, error: error.message }); }
      finally { port.close(); }
    });
  },
  onConnection: callback => ipcRenderer.on('aster-connection', (_event, data) => callback(data)),
  onMailAlerts: callback => ipcRenderer.on('aster-mail-alerts', (_event, data) => callback(data)),
  onPrivacy: callback => ipcRenderer.on('aster-privacy', (_event, data) => callback(data)),
  onSound: callback => ipcRenderer.on('aster-sound', (_event, kind) => callback(kind)),
});

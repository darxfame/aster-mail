const { contextBridge, ipcRenderer } = require('electron');
let handler;
function bounded(value) { const json = JSON.stringify(value); if (!json || json.length > 65536) throw new Error('Module message too large'); return JSON.parse(json); }
async function call(method, input = {}) {
  if (typeof method !== 'string' || method.length > 80) throw new Error('Invalid module method');
  const result = await ipcRenderer.invoke('aster-module-api', method, bounded(input));
  return bounded(result);
}
ipcRenderer.on('aster-module-command', async (_event, request) => {
  try {
    if (!handler) throw new Error('Module is not ready');
    const value = await handler(request.command, request.input, request.context);
    ipcRenderer.send('aster-module-reply', { id: request.id, value: bounded(value === undefined ? null : value) });
  } catch { ipcRenderer.send('aster-module-reply', { id: request.id, error: true }); }
});
contextBridge.exposeInMainWorld('asterModuleTransport', {
  call,
  command: (command, input = {}) => call('command', { command, input }),
  onCommand: callback => { if (typeof callback === 'function') handler = callback; },
  ready: () => call('ready', {}),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('aster-module-event', listener); return () => ipcRenderer.removeListener('aster-module-event', listener); },
});

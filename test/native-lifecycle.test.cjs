const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
function guards(overrides = {}) {
  const context = vm.createContext({ unsavedChanges: false, resettingLocalData: false, client: null, connection: null, window: {}, accountEpoch: 0, localStore: { clear: async () => {} }, dialog: {}, ...overrides });
  vm.runInContext(source.slice(source.indexOf('function confirmDiscardChanges()'), source.indexOf('\nfunction reveal(')), context);
  return context;
}
test('native discard prompt preserves edits on cancel and requires an explicit destructive choice', () => {
  let answer = 0, prompts = 0;
  const context = guards({ unsavedChanges: true, dialog: { showMessageBoxSync(_window, options) { prompts++; assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); return answer; } } });
  assert.equal(context.confirmDiscardChanges(), false); assert.equal(context.unsavedChanges, true);
  answer = 1;
  assert.equal(context.confirmDiscardChanges(), true); assert.equal(context.unsavedChanges, false);
  assert.equal(context.confirmDiscardChanges(), true); assert.equal(prompts, 2);
});
test('preload blocks any unload only while the renderer has unsaved edits', () => {
  const listeners = {}, sent = []; let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { bridge = value; } }, ipcRenderer: { send: (...args) => sent.push(args) } }),
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
  });
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  listeners.beforeunload(event); assert.equal(prevented, 0);
  bridge.setUnsavedChanges(true); listeners.beforeunload(event); assert.equal(prevented, 1); assert.equal(event.returnValue, '');
  bridge.setUnsavedChanges(false); listeners.beforeunload(event); assert.equal(prevented, 1);
  assert.deepEqual(sent, [['aster-unsaved-changes', true], ['aster-unsaved-changes', false]]);
});
test('cancelled Quit keeps account requests alive and an accepted Quit aborts them', () => {
  let beforeQuit, answer = 0, aborted = 0, prevented = 0;
  const context = guards({ unsavedChanges: true, quitting: false, connection: { controller: { abort() { aborted++; } } }, dialog: { showMessageBoxSync: () => answer }, app: { on(name, callback) { if (name === 'before-quit') beforeQuit = callback; } } });
  vm.runInContext(source.slice(source.indexOf("app.on('before-quit'")), context);
  beforeQuit({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(aborted, 0); assert.equal(context.quitting, false);
  answer = 1; beforeQuit({ preventDefault() { assert.fail('Accepted quit must proceed'); } });
  assert.equal(aborted, 1); assert.equal(context.quitting, true);
});
test('pre-login recovery never clears without confirmation and blocks concurrent authentication', async () => {
  let cleared = 0, answer = 0, finish;
  const context = guards({ dialog: { showMessageBox: async () => ({ response: answer }) }, localStore: { clear: async () => { cleared++; await new Promise(resolve => { finish = resolve; }); } } });
  assert.equal(await context.resetLocalData(), false); assert.equal(cleared, 0); assert.equal(context.resettingLocalData, false);
  answer = 1; const resetting = context.resetLocalData(); await Promise.resolve(); await Promise.resolve();
  assert.equal(context.resettingLocalData, true);
  await assert.rejects(context.resetLocalData(), /завершите подключение/);
  vm.runInContext(source.slice(source.indexOf('async function connect('), source.indexOf('\nconst methods =')), context);
  await assert.rejects(context.connect({}, false), /сброса локальных данных/);
  finish(); assert.equal(await resetting, true); assert.equal(cleared, 1); assert.equal(context.accountEpoch, 1); assert.equal(context.resettingLocalData, false);
  context.connection = {}; await assert.rejects(context.resetLocalData(), /завершите подключение/); assert.equal(cleared, 1);
});
test('window initial size and minimum fit the display work area in logical pixels', () => {
  let options;
  const context = vm.createContext({ screen: { getPrimaryDisplay: () => ({ workArea: { width: 960, height: 640 } }) }, BrowserWindow: function (value) { options = value; this.loadFile = () => {}; this.on = () => {}; this.webContents = { setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } }; }, path, __dirname: path.join(__dirname, '../desktop'), page: 'index.html' });
  const start = source.indexOf('  createWindow = () => {'), end = source.indexOf("  ipcMain.on('aster-unsaved-changes'", start);
  vm.runInContext(source.slice(start, end), context); context.createWindow();
  assert.equal(options.width, 960); assert.equal(options.height, 640); assert.equal(options.minWidth, 960); assert.equal(options.minHeight, 640);
});

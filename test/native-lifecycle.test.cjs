const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
function guards(overrides = {}) {
  const context = vm.createContext({ tr: value => value, activeServerWrites: 0, unsavedChanges: false, moduleHost: undefined, moduleProfile: { clear: async () => {}, retire() {} }, resettingLocalData: false, attachmentPreviews: undefined, composeWindows: undefined, client: null, connection: null, window: {}, accountEpoch: 0, localStore: { clear: async () => {} }, attachmentFiles: { clear: async () => {}, clearSync() {} }, attachmentCleanupError: '', dialog: {}, ...overrides });
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
    process: { platform: 'darwin' },
  });
  assert.equal(bridge.platform, 'darwin');
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
test('normal and update quits block active writes and preserve detached editors and locked attachments on cancellation', () => {
  let cleared = 0, confirmed = 0, destroyed = 0, answer = 0;
  const entry = { busy: true };
  const context = guards({ activeServerWrites: 1, composeWindows: { entries: new Map([[1, entry]]), confirmAll() { confirmed++; return true; }, destroyAll() { destroyed++; } },
    attachmentFiles: { clearSync() { cleared++; throw new Error('Locked'); } }, dialog: { showMessageBoxSync: () => answer } });
  assert.equal(context.confirmQuit(), false); assert.equal(confirmed, 0); assert.equal(cleared, 0);
  context.activeServerWrites = 0;
  assert.equal(context.confirmQuit(), false); assert.equal(confirmed, 0);
  entry.busy = false;
  assert.equal(context.confirmQuit(), false); assert.equal(confirmed, 1); assert.equal(destroyed, 0);
  answer = 1;
  assert.equal(context.confirmQuit(), true); assert.equal(destroyed, 0);
  context.retireForQuit(); assert.equal(destroyed, 1); assert.equal(context.quitting, true);
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
for (const platform of ['darwin', 'win32']) test(`window fits the display and uses platform-appropriate chrome on ${platform}`, () => {
  let options;
  const context = vm.createContext({ windowsChrome: theme => require('../desktop/window-chrome.cjs').windowsChrome(theme, platform), notificationSettings: { theme: 'light' }, process: { platform }, tr: value => value, screen: { getPrimaryDisplay: () => ({ workArea: { width: 960, height: 640 } }) }, BrowserWindow: function (value) { options = value; this.loadFile = () => {}; this.on = () => {}; this.webContents = { setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } }; }, path, __dirname: path.join(__dirname, '../desktop'), page: 'index.html' });
  const start = source.indexOf('  createWindow = () => {'), end = source.indexOf("  ipcMain.on('aster-unsaved-changes'", start);
  vm.runInContext(source.slice(start, end), context); context.createWindow();
  assert.equal(options.width, 960); assert.equal(options.height, 640); assert.equal(options.minWidth, 760); assert.equal(options.minHeight, 540);
  assert.equal(options.titleBarStyle, platform === 'darwin' ? 'hiddenInset' : 'hidden');
  assert.equal(options.trafficLightPosition?.x, platform === 'darwin' ? 22 : undefined);
  assert.equal(options.trafficLightPosition?.y, platform === 'darwin' ? 12 : undefined);
});

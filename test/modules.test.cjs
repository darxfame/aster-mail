const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const M = require('../desktop/modules.cjs');
const example = require('../examples/modules/sandbox-demo/module.json');
test('module API rejects unsupported contracts, paths, origins and privilege declarations', () => {
  assert.equal(M.manifest(example).type, 'hybrid');
  for (const change of [{ apiVersion: 2 }, { main: '../outside.js' }, { permissions: ['sendMail'] }, { networkOrigins: ['http://example.test'] }, { main: '/absolute.js' }, { nodeIntegration: true }, { id: '../escape' }, { views: [{ id: 'bad', title: 'Bad', file: '../bad.html', slot: 'panel' }] }]) assert.throws(() => M.manifest({ ...example, ...change }));
  assert.throws(() => M.recordDirectory('/test', { id: '../x', version: '1.0.0', digest: 'a'.repeat(64) }));
  assert.throws(() => M.bounded({ text: 'x'.repeat(65536) }));
});
test('installation snapshots self-contained resources, rejects symlinks and detects changed code', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-modules-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  await M.installPackage(directory, bundle);
  const record = { id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest };
  const installed = M.recordDirectory(directory, record);
  assert.equal((await M.readPackage(installed)).digest, bundle.digest);
  await fs.appendFile(path.join(installed, 'main.js'), '\n// changed');
  assert.notEqual((await M.readPackage(installed)).digest, bundle.digest);
  await fs.unlink(path.join(installed, 'panel.css'));
  await fs.symlink(path.join(installed, 'main.js'), path.join(installed, 'panel.css'));
  await assert.rejects(M.readPackage(installed));
});
test('module network broker isolates credentials, refuses undeclared destinations and never retries writes', async () => {
  let options, request;
  const net = { request(value) { options = value; request = Object.assign(new EventEmitter(), { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end() {}, abort() { this.aborted = true; } }); return request; } };
  const definition = { permissions: ['network'], networkOrigins: ['https://video.example.test'] }, isolatedSession = {};
  assert.throws(() => M.requestJSON(net, isolatedSession, definition, { url: 'https://elsewhere.example.test' }, new AbortController().signal));
  assert.throws(() => M.requestJSON(net, isolatedSession, definition, { url: 'http://video.example.test' }, new AbortController().signal));
  const pending = M.requestJSON(net, isolatedSession, definition, { url: 'https://video.example.test/room', method: 'POST', bearer: 'fictional' }, new AbortController().signal);
  assert.equal(options.session, isolatedSession); assert.equal(options.credentials, 'omit'); assert.equal(options.useSessionCookies, false);
  assert.equal(request.headers.Authorization, 'Bearer fictional');
  request.emit('close');
  const response = Object.assign(new EventEmitter(), { statusCode: 200 }); request.emit('response', response); response.emit('data', Buffer.from('{"ok":true}')); response.emit('end');
  assert.deepEqual(await pending, { ok: true });
  const redirected = M.requestJSON(net, isolatedSession, definition, { url: 'https://video.example.test/room', method: 'POST' }, new AbortController().signal);
  request.emit('redirect', 302, 'GET', 'https://elsewhere.example.test');
  await assert.rejects(redirected, /неизвестен/); assert.equal(request.aborted, true);
  const controller = new AbortController();
  const abandoned = M.requestJSON(net, isolatedSession, definition, { url: 'https://video.example.test/room' }, controller.signal); controller.abort();
  await assert.rejects(abandoned, /неизвестен/);
});
test('module host rejects foreign frames, retired accounts and undeclared host methods', async () => {
  const { ModuleHost } = require('../desktop/module-host.cjs');
  const ipcMain = { handle() {}, on() {} }, active = { sessionId: 'one', signal: new AbortController().signal, records: [] };
  let current = active, sdkCalls = 0;
  const host = new ModuleHost({ electron: { ipcMain }, scope: () => current, sdk: () => { sdkCalls++; }, save: async () => {} });
  const sender = { mainFrame: {} }, entry = { sessionId: 'one', retired: false, calls: 0, bundle: { manifest: M.manifest(example) } };
  host.senders.set(sender, { entry, role: 'view' });
  await assert.rejects(host.receive({ sender, senderFrame: {} }, 'storage.get', {}), /Untrusted/);
  await assert.rejects(host.receive({ sender, senderFrame: sender.mainFrame }, 'mail.send', {}), /разрешений/);
  await assert.rejects(host.receive({ sender, senderFrame: sender.mainFrame }, 'calendar.list', {}), /разрешений/);
  assert.equal(sdkCalls, 0);
  current = { ...active, sessionId: 'two' };
  await assert.rejects(host.receive({ sender, senderFrame: sender.mainFrame }, 'storage.get', {}), /Сессия/);
});
test('module event delivery cannot turn a successful Exchange write into an error or replay it', async () => {
  const vm = require('node:vm'), source = await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  let writes = 0, polls = 0;
  const client = { createEvent: async () => { writes++; return { id: 'fictional-meeting' }; } };
  const context = vm.createContext({ tr: value => value, activeClient: client, client, operation: 'createEvent', data: {}, composeEntry: null, moduleHost: { publish() { throw new Error('Broken module'); } }, pollNotifications() { polls++; } });
  const body = source.slice(source.indexOf('      const value = await activeClient[operation]'), source.indexOf('\n    } catch (error) { return { ok: false, error: errorMessage(error, { operation, debug: debugErrors })'));
  const result = await vm.runInContext(`(async () => {${body}})()`, context);
  assert.equal(result.ok, true); assert.equal(result.value.id, 'fictional-meeting'); assert.equal(writes, 1); assert.equal(polls, 1);
});
test('module preload bounds messages before IPC and never exposes generic IPC or host errors', async () => {
  const vm = require('node:vm'), listeners = {}, sent = [];
  let api;
  const context = vm.createContext({ window: {}, require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { context.window.asterModuleTransport = value; } }, ipcRenderer: {
    on(name, callback) { listeners[name] = callback; }, removeListener() {},
    async invoke(...args) { sent.push(args); return { ok: false, error: 'Rejected', code: 'permission-denied' }; }, send(...args) { sent.push(args); },
  } }) });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../desktop/module-preload.cjs'), 'utf8'), context);
  vm.runInContext(await fs.readFile(path.join(__dirname, '../src/module-bridge.js'), 'utf8'), context); api = context.window.asterModule;
  await assert.rejects(api.call('storage.set', { text: 'x'.repeat(70000) }), /too large/); assert.equal(sent.length, 0);
  await assert.rejects(api.call('calendar.list'), { code: 'permission-denied' }); assert.equal(sent.length, 1);
  assert.equal(api.invoke, undefined); assert.equal(api.send, undefined);
  api.onCommand(async () => ({ text: 'x'.repeat(70000) }));
  await listeners['aster-module-command']({}, { id: 'one', command: 'oversized' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), ['aster-module-reply', { id: 'one', error: true }]);
});
test('module draft suggestions ignore old accounts and editors, preserve existing content on cancel and never submit', async () => {
  const vm = require('node:vm'), source = await fs.readFile(path.join(__dirname, '../src/modules-ui.js'), 'utf8');
  const form = { dataset: { moduleEditor: 'editor-one' }, elements: { location: { value: 'Existing location' } } };
  let dirty = 0, confirm = false, opens = 0;
  const context = vm.createContext({ tr: value => value, connectedModules: [{ id: 'example', enabled: true }], state: { account: { sessionId: 'one' } },
    modalBusy: false, confirmDiscardChanges: () => true, eventModal() { opens++; }, confirm: () => confirm, document: { querySelector: () => form }, markModalDirty() { dirty++; } });
  vm.runInContext(source.slice(source.indexOf('function receiveModuleAction('), source.indexOf('async function syncModuleMounts(')), context);
  const data = { sessionId: 'one', id: 'example', method: 'meeting.patchDraft', editorId: 'editor-one', input: { location: 'New location' } };
  context.receiveModuleAction({ ...data, sessionId: 'old' }); context.receiveModuleAction({ ...data, editorId: 'old' }); context.receiveModuleAction(data);
  assert.equal(form.elements.location.value, 'Existing location'); assert.equal(dirty, 0);
  confirm = true; context.receiveModuleAction(data); assert.equal(form.elements.location.value, 'New location'); assert.equal(dirty, 1);
  context.modalBusy = true; context.receiveModuleAction({ ...data, method: 'meeting.openDraft' }); assert.equal(opens, 0);
  form.dataset.editing = 'true'; context.receiveModuleAction({ ...data, input: { location: 'Must not edit a saved event' } }); assert.equal(form.elements.location.value, 'New location');
});
test('detached composers never invoke module UI IPC in their background timer', async () => {
  const vm = require('node:vm'); let calls = 0;
  const context = vm.createContext({ setInterval() {}, isComposeWindow: true, state: { account: { sessionId: 'compose' } }, window: { aster: {} }, api: async () => { calls++; } });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../src/modules-ui.js'), 'utf8'), context);
  await context.syncModuleMounts(); context.unmountModuleViews(); assert.equal(calls, 0);
});
test('a module enable overtaken by an account switch cannot stop a new account module or save settings', async () => {
  const { ModuleHost } = require('../desktop/module-host.cjs');
  const record = { id: 'example', version: '1.0.0', digest: 'a'.repeat(64), enabled: false, data: {} };
  let active = { sessionId: 'one', signal: new AbortController().signal, records: [record] }, stops = 0, saves = 0;
  const host = new ModuleHost({ electron: { ipcMain: { handle() {}, on() {} } }, scope: () => active, save: async () => { saves++; } });
  host.bundle = async () => { active = { ...active, sessionId: 'two' }; return {}; };
  host.stop = () => { stops++; };
  await assert.rejects(host.configure('example', true), /Сессия/); assert.equal(stops, 0); assert.equal(saves, 0); assert.equal(record.enabled, false);
});
test('module storage is namespaced and secrets never enter the catalog', async () => {
  const { ModuleHost } = require('../desktop/module-host.cjs');
  const record = id => ({ id, version: '1.0.0', digest: 'a'.repeat(64), enabled: true, data: { secret: `${id}-private-key` } });
  const active = { sessionId: 'one', signal: new AbortController().signal, records: [record('first'), record('second')] };
  const host = new ModuleHost({ electron: { ipcMain: { handle() {}, on() {} } }, scope: () => active, save: async value => { active.records = value; } });
  host.bundle = async record => ({ manifest: { ...example, id: record.id }, digest: record.digest });
  const sender = { mainFrame: {} }, entry = { id: 'first', sessionId: 'one', calls: 0, bundle: { manifest: { ...example, id: 'first' } } };
  host.senders.set(sender, { entry, role: 'view' });
  const event = { sender, senderFrame: sender.mainFrame };
  assert.deepEqual(await host.receive(event, 'storage.get', {}), { secret: 'first-private-key' });
  await host.receive(event, 'storage.set', { id: 'second', data: 'attempted overwrite' });
  assert.equal(active.records[1].data.secret, 'second-private-key');
  assert.doesNotMatch(JSON.stringify(await host.catalog()), /private-key|attempted overwrite/);
});
test('a delayed renderer crash from an old module instance cannot stop its replacement', () => {
  const { ModuleHost } = require('../desktop/module-host.cjs');
  const host = new ModuleHost({ electron: { ipcMain: { handle() {}, on() {} } }, scope: () => null });
  const old = { id: 'example', retired: true }, replacement = { id: 'example' };
  const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, setWebRTCIPHandlingPolicy() {} });
  let stopped = 0; host.stop = () => { stopped++; };
  host.entries.set('example', replacement); host.protect(contents, old, 'runtime'); contents.emit('render-process-gone');
  assert.equal(stopped, 0); assert.equal(host.entries.get('example'), replacement);
});

test('prepared packages are reused without replacement on Windows and corrupted copies remain rejected', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-modules-reuse-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  await M.installPackage(directory, bundle);
  const installed = M.recordDirectory(directory, { id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest });
  // Windows returns EPERM when rename targets an existing package directory.
  const denied = Object.assign(new Error('Fictional Windows rename denial'), { code: 'EPERM' });
  const rename = t.mock.method(fs, 'rename', async () => { throw denied; });
  await M.installPackage(directory, bundle);
  assert.equal(rename.mock.callCount(), 0);
  assert.equal((await M.readPackage(installed)).digest, bundle.digest);
  await fs.appendFile(path.join(installed, 'main.js'), '\n// changed');
  await assert.rejects(M.installPackage(directory, bundle));
  assert.equal(rename.mock.callCount(), 0);
  await assert.rejects(M.installPackage(path.join(directory, 'new'), bundle), error => error === denied);
  t.mock.restoreAll();
  const concurrent = path.join(directory, 'concurrent');
  await Promise.all([M.installPackage(concurrent, bundle), M.installPackage(concurrent, bundle)]);
  assert.equal((await M.readPackage(M.recordDirectory(concurrent, { id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest }))).digest, bundle.digest);
});

test('module proxy setup waits for Chromium configuration and rejects direct or fallback routes', async () => {
  const { ModuleHost } = require('../desktop/module-host.cjs');
  const host = new ModuleHost({ electron: { ipcMain: { handle() {}, on() {} } }, scope: () => null });
  host.denyProxy = async () => 12345;
  for (const route of ['PROXY 127.0.0.1:12345', 'DIRECT', '', 'PROXY 127.0.0.1:12345; DIRECT']) {
    const calls = [];
    const isolated = {
      async setProxy(config) { assert.equal(config.mode, 'fixed_servers'); assert.equal(config.proxyBypassRules, '<-loopback>'); calls.push('set'); },
      async forceReloadProxyConfig() { calls.push('reload'); },
      async resolveProxy() { assert.deepEqual(calls, ['set', 'reload']); return route; }
    };
    if (route === 'PROXY 127.0.0.1:12345') await host.configureProxy(isolated);
    else await assert.rejects(host.configureProxy(isolated), /Module proxy policy unavailable/);
  }
});

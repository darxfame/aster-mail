const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const M = require('../desktop/modules.cjs');
const { ModuleProfile } = require('../desktop/module-profile.cjs');
const { ModuleHost } = require('../desktop/module-host.cjs');
// Fictional encryption adapter: LocalStore's actual safeStorage integration has separate checks.
const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).toString('base64'), decryptString: value => Buffer.from(value.toString(), 'base64').toString() };

test('installed packages expose settings without Exchange and keep their own encrypted profile across sessions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-module-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packages = path.join(root, 'packages'), directory = path.join(root, 'profile');
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  await M.installPackage(packages, bundle);
  const profile = new ModuleProfile(directory, packages, encryption, () => [{ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, enabled: true, data: { preference: 'legacy-service-setting' } }]); await profile.initialize();
  const host = new ModuleHost({ directory: packages, electron: { ipcMain: { handle() {}, on() {} } }, scope: () => profile.scope(), save: (records, sessionId) => profile.save(records, sessionId) });
  const [item] = await host.catalog();
  assert.equal(item.id, bundle.manifest.id); assert.equal(item.enabled, true); assert.ok(item.views.some(view => view.slot === 'panel'));
  assert.equal(profile.scope().records[0].data.preference, 'legacy-service-setting');
  assert.ok(!JSON.stringify(item).includes('legacy-service-setting'));
  const session = profile.scope();
  await host.update(records => { records[0].data = { token: 'fictional-service-token' }; });
  assert.ok(!(await fs.readFile(path.join(directory, 'local-data.enc'), 'utf8')).includes('fictional-service-token'));
  profile.retire(); assert.equal(session.signal.aborted, true); assert.notEqual(profile.scope().sessionId, session.sessionId);
  await assert.rejects(profile.save([], session.sessionId), /Сессия/);
  const restored = new ModuleProfile(directory, packages, encryption); await restored.initialize();
  assert.equal(restored.scope().records[0].data.token, 'fictional-service-token');
  await restored.clear();
  const empty = new ModuleProfile(directory, packages, encryption); await empty.initialize();
  assert.deepEqual(empty.scope().records, []); // Leftover package copies must not undo an explicit reset.
});

test('empty module browsing needs no encryption prompt; invalid legacy packages never run', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-module-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packages = path.join(root, 'packages'), profile = new ModuleProfile(path.join(root, 'profile'), packages, { isEncryptionAvailable() { assert.fail('No secrets or writes before installation'); } });
  await profile.initialize(); assert.deepEqual(profile.scope().records, []);
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  await M.installPackage(packages, bundle);
  await fs.appendFile(path.join(M.recordDirectory(packages, { id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest }), 'main.js'), '// tampered');
  const invalid = new ModuleProfile(path.join(root, 'invalid-profile'), packages, encryption); await invalid.initialize();
  assert.deepEqual(invalid.scope().records, []);
});

test('removing and reinstalling a module cannot resurrect its server, secrets or legacy settings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-module-remove-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  const packages = path.join(root, 'packages'), directory = path.join(root, 'profile');
  const legacy = () => [{ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, enabled: true, data: { server: 'https://service.example.test', apiKey: 'fictional-key' } }];
  await M.installPackage(packages, bundle);
  const profile = new ModuleProfile(directory, packages, encryption, legacy); await profile.initialize();
  const makeHost = profile => new ModuleHost({ directory: packages, electron: { ipcMain: { handle() {}, on() {} } }, scope: () => profile.scope(), save: (records, sessionId) => profile.save(records, sessionId) });
  await makeHost(profile).remove(bundle.manifest.id);
  const restored = new ModuleProfile(directory, packages, encryption, legacy); await restored.initialize();
  assert.deepEqual(restored.scope().records, []);
  await makeHost(restored).install(bundle, true);
  assert.deepEqual(restored.scope().records[0].data, {}); assert.equal(restored.scope().records[0].auth, undefined);
});

test('standalone modules get UI context but cannot call Exchange SDK operations before login', async () => {
  const vm = require('node:vm'), source = await fs.readFile(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf('      const active = client;', source.indexOf('    sdk: async'));
  const end = source.indexOf("      throw new Error('Unsupported module API');", start) + "      throw new Error('Unsupported module API');".length;
  const sent = [], entry = { id: 'fictional', sessionId: 'module-profile', bundle: { manifest: { views: [{ id: 'settings' }] } } };
  const context = vm.createContext({ entry, client: null, input: { view: 'settings' }, context: {}, moduleHost: { current() {} }, tr: value => value, i18n: { language: 'ru' }, notificationSettings: {}, window: { webContents: { send: (...args) => sent.push(args) } }, require: name => name === '../src/time.js' ? require('../src/time.js') : M });
  for (const method of ['calendar.list', 'meeting.openDraft', 'meeting.getDraft', 'meeting.patchDraft']) {
    context.method = method; await assert.rejects(vm.runInContext(`(async()=>{${source.slice(start, end)}})()`, context), /подключите аккаунт/);
  }
  context.method = 'ui.openView'; await vm.runInContext(`(async()=>{${source.slice(start, end)}})()`, context);
  assert.equal(sent[0][1].sessionId, 'module-profile');
});

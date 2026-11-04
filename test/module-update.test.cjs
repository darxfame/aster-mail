const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const M = require('../desktop/modules.cjs');
const Settings = require('../desktop/module-settings.cjs');
const { ModuleHost } = require('../desktop/module-host.cjs');
const example = require('../examples/modules/sandbox-demo/module.json');
test('settings migrations preserve values, defaults and pending writes without mutating their input', () => {
  const definition = { settingsVersion: 3, settingsMigrations: [
    { from: 1, to: 2, operations: [{ op: 'rename', from: ['apiKey'], path: ['credentials', 'token'] }] },
    { from: 2, to: 3, operations: [{ op: 'setDefault', path: ['appearance', 'theme'], value: 'light' }] },
  ] }; Settings.validate(definition);
  const original = { apiKey: 'fictional-secret', server: 'https://workspace.example.test', pending: { status: 'unknown' }, appearance: { theme: 'dark' } };
  const next = Settings.migrate(original, 1, definition);
  assert.equal(next.credentials.token, 'fictional-secret'); assert.equal(next.appearance.theme, 'dark'); assert.equal(next.pending.status, 'unknown'); assert.equal(original.apiKey, 'fictional-secret');
  assert.equal(Settings.migrate({ apiKey: 'fictional' }, 1, definition).appearance.theme, 'light');
  for (const bad of [{ settingsVersion: 0 }, { settingsVersion: 2, settingsMigrations: [{ from: 1, to: 2, operations: [{ op: 'rename', from: ['a'], path: ['a', 'b'] }] }] }, { settingsVersion: 2, settingsMigrations: [{ from: 1, to: 2, operations: [{ op: 'setDefault', path: ['constructor'], value: {} }] }] }]) assert.throws(() => Settings.validate(bad));
  assert.throws(() => Settings.migrate({ apiKey: 'old', credentials: { token: 'existing' } }, 1, definition));
  assert.throws(() => Settings.migrate(original, 1, { settingsVersion: 2 }));
  assert.throws(() => Settings.migrate(original, 4, definition));
});
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-module-update-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const initial = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  let active = { sessionId: 'one', signal: new AbortController().signal, records: [] }, failSave = false, confirmation = 1, prompts = 0;
  const host = new ModuleHost({ directory, electron: { ipcMain: { handle() {}, on() {} }, dialog: { async showMessageBox() { prompts++; return { response: confirmation }; } } }, scope: () => active, save: async value => { if (failSave) throw new Error('Fictional disk failure'); active.records = value; } });
  const bundle = (version, extra = {}) => { const files = new Map(initial.files); files.set('module.json', Buffer.from(JSON.stringify({ ...example, version, ...extra }))); return M.fromFiles(files); };
  await host.install(bundle('1.0.0'), false);
  await host.update(records => { records[0].data = { apiKey: 'fictional', server: 'https://example.test', pending: { status: 'unknown' } }; });
  return { host, bundle, records: () => active.records, fail(value) { failSave = value; }, answer(value) { confirmation = value; }, prompts: () => prompts, switch() { active = { ...active, sessionId: 'two', records: [] }; } };
}
test('module update retains settings, disabled state and uncertain writes; migration and save failures retain the old record', async t => {
  const f = await fixture(t), original = structuredClone(f.records()[0]);
  await f.host.install(f.bundle('1.0.1'), true);
  assert.equal(f.records()[0].version, '1.0.1'); assert.equal(f.records()[0].enabled, false); assert.deepEqual(f.records()[0].data, original.data);
  await f.host.install(f.bundle('1.0.2', { settingsVersion: 2, settingsMigrations: [{ from: 1, to: 2, operations: [{ op: 'rename', from: ['apiKey'], path: ['token'] }] }] }));
  assert.equal(f.records()[0].data.token, 'fictional'); assert.equal(f.records()[0].data.pending.status, 'unknown');
  const saved = structuredClone(f.records()[0]);
  await assert.rejects(f.host.install(f.bundle('1.0.3', { settingsVersion: 3 }))); assert.deepEqual(f.records()[0], saved);
  f.fail(true); await assert.rejects(f.host.install(f.bundle('1.0.3', { settingsVersion: 2 })), /disk/); assert.deepEqual(f.records()[0], saved);
  await assert.rejects(f.host.install(f.bundle('1.0.1'))); assert.deepEqual(f.records()[0], saved);
});
test('updates request changed capabilities, preserve data on refusal and never write across account retirement', async t => {
  const f = await fixture(t), before = structuredClone(f.records()[0]);
  const next = f.bundle('1.0.1', { permissions: [...example.permissions, 'network'], networkOrigins: ['https://service.example.test'] });
  f.answer(0); assert.equal(await f.host.install(next), false); assert.deepEqual(f.records()[0], before); assert.equal(f.prompts(), 1);
  const originalBundle = f.host.bundle.bind(f.host);
  f.host.bundle = async record => { const value = await originalBundle(record); f.switch(); return value; };
  await assert.rejects(f.host.install(next), /Сессия/); assert.equal(f.records().length, 0);
});

test('replacement of an obsolete or corrupt package retains encrypted account settings after explicit consent', async t => {
  const f = await fixture(t), original = structuredClone(f.records()[0]);
  await fs.appendFile(path.join(M.recordDirectory(f.host.directory, original), 'main.js'), '\n// damaged legacy copy');
  await f.host.install(f.bundle('1.0.1'));
  assert.equal(f.prompts(), 1); assert.equal(f.records()[0].version, '1.0.1'); assert.deepEqual(f.records()[0].data, original.data);
});

test('a corrupt cached replacement cannot commit new metadata or migrate existing settings', async t => {
  const f = await fixture(t), original = structuredClone(f.records()[0]), next = f.bundle('1.0.1');
  await M.installPackage(f.host.directory, next);
  const replacement = M.recordDirectory(f.host.directory, { id: next.manifest.id, version: next.manifest.version, digest: next.digest });
  await fs.appendFile(path.join(replacement, 'main.js'), '\n// corrupt cached package');
  await assert.rejects(f.host.install(next)); assert.deepEqual(f.records()[0], original);
});

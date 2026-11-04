const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../desktop/module-catalog.cjs');
const M = require('../desktop/modules.cjs');
const revision = 'a'.repeat(40), commit = 'b'.repeat(40);
async function fixture() {
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  const item = { manifest: bundle.manifest, description: 'Fictional approved module', commit, directory: 'example', digest: bundle.digest };
  const calls = [];
  const read = async (url, limit) => {
    calls.push(url);
    let value;
    if (url.endsWith('/commits/main')) value = Buffer.from(JSON.stringify({ sha: revision }));
    else if (url.endsWith('/catalog.json')) { assert.ok(url.includes(`/${revision}/`)); value = Buffer.from(JSON.stringify({ catalogVersion: 1, modules: [item] })); }
    else if (url.endsWith(`/commits/${commit}`)) value = Buffer.from(JSON.stringify({ sha: commit }));
    else { assert.ok(url.startsWith(`https://raw.githubusercontent.com/darxfame/aster-mail-modules/${commit}/example/`)); value = bundle.files.get(url.split('/example/')[1]); }
    assert.ok(value.length <= limit); return value;
  };
  return { bundle, item, calls, read };
}
test('author catalog pins its own revision and accepts only explicit reviewed package metadata', async () => {
  const f = await fixture(), catalog = await C.list(f.read, new AbortController().signal);
  assert.equal(catalog.revision, revision); assert.equal(catalog.modules[0].digest, f.bundle.digest);
  assert.equal(f.calls.length, 2);
  for (const patch of [{ commit: 'main' }, { directory: '../escape' }, { digest: 'unverified' }, { repository: 'https://github.com/other/repo' }, { manifest: { ...f.item.manifest, permissions: ['sendMail'] } }]) assert.throws(() => C.parse({ catalogVersion: 1, modules: [{ ...f.item, ...patch }] }));
  assert.throws(() => C.parse({ catalogVersion: 1, modules: [f.item, f.item] }));
  assert.deepEqual(C.parse({ catalogVersion: 1, modules: [] }), []);
});
test('one explicit approved Connect installs and enables exactly the displayed package without extra grants', async () => {
  const f = await fixture(); let installs = 0;
  await C.install({ id: f.item.manifest.id, digest: f.item.digest, revision }, f.read, new AbortController().signal,
    { async install(bundle, enabled) { installs++; assert.equal(enabled, true); assert.equal(bundle.digest, f.bundle.digest); assert.equal(bundle.source.repository, C.repository); assert.equal(bundle.source.commit, commit); } }, () => {});
  assert.equal(installs, 1);
});
test('stale approval, changed permissions, changed bytes and retired accounts never install', async () => {
  for (const kind of ['stale', 'permission', 'bytes', 'retired', 'cancelled']) {
    const f = await fixture(); let installs = 0, checks = 0;
    if (kind === 'permission') f.item.manifest.permissions = [];
    const controller = new AbortController();
    const read = async (...args) => { const bytes = await f.read(...args); if (kind === 'cancelled') controller.abort(); return kind === 'bytes' && args[0].endsWith('/main.js') ? Buffer.from('// changed') : bytes; };
    await assert.rejects(C.install({ id: f.item.manifest.id, digest: f.item.digest, revision: kind === 'stale' ? commit : revision }, read, controller.signal,
      { async install() { installs++; } }, () => { if (kind === 'retired' && ++checks > 1) throw new Error('retired account'); }));
    assert.equal(installs, 0, kind);
  }
});

test('missing catalog is unpublished, network failures are errors and changed approval cannot be bypassed', async () => {
  const f = await fixture();
  const missing = await C.list(async (...args) => { if (args[0].endsWith('/catalog.json')) throw Object.assign(new Error('not found'), { status: 404 }); return f.read(...args); }, new AbortController().signal);
  assert.equal(missing.published, false); assert.deepEqual(missing.modules, []);
  await assert.rejects(C.list(async () => { throw new Error('offline'); }, new AbortController().signal), /offline/);
  // Metadata formatting is not a permission change; actual package bytes still have to match.
  f.item.manifest = Object.fromEntries(Object.entries(f.item.manifest).reverse());
  let installed = false;
  await C.install({ id: f.item.manifest.id, digest: f.item.digest, revision }, f.read, new AbortController().signal, { async install() { installed = true; } }, () => {});
  assert.equal(installed, true);
});

test('public catalog IPC is available before login while install operations stay account-scoped', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (operation === 'moduleAuthorCatalog')");
  const end = source.indexOf("      const activeClient = client;", start);
  const context = vm.createContext({ operation: 'moduleAuthorCatalog', event: { sender: {} }, net: {}, session: {}, path, app: { getPath: () => '/fictional' }, tr: value => value,
    require: name => { assert.equal(name, './module-catalog.cjs'); return { browse: async () => ({ modules: [] }) }; } });
  Object.defineProperty(context, 'client', { get() { throw new Error('Account accessed'); } });
  const value = await vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
  assert.equal(value.ok, true);
  for (const operation of ['moduleImportGitHub', 'moduleConfigure']) {
    const denied = vm.createContext({ operation, client: null, tr: value => value });
    await assert.rejects(vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, denied), /OWA/);
  }
});

test('desktop catalog displays package cards without an account and in demo, without reading account modules', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), f = await fixture();
  const source = fs.readFileSync(require.resolve('../src/modules-ui.js'), 'utf8');
  for (const demo of [false, true]) {
    const calls = [], container = { isConnected: true };
    const context = vm.createContext({ modalBusy: false, confirmDiscardChanges: () => true, modal() {}, tr: value => value, esc: value => String(value), modulePermissionNames: () => ({}),
      state: { account: null, demo }, window: { aster: {} }, document: { querySelector: () => container }, api: async operation => { calls.push(operation); assert.equal(operation, 'moduleAuthorCatalog'); return { revision, modules: [f.item] }; } });
    vm.runInContext(source.slice(source.indexOf('async function moduleAuthorCatalog()'), source.indexOf('async function connectApprovedModule(')), context);
    await context.moduleAuthorCatalog();
    assert.deepEqual(calls, ['moduleAuthorCatalog']);
    assert.match(container.innerHTML, /Fictional approved module/);
    assert.doesNotMatch(container.innerHTML, /data-action="module-approved-connect"[^>]*disabled/);
    assert.match(container.innerHTML, /<details><summary>Разрешения и сведения о модуле/);
  }
});

test('published flat catalog validates pinned manifests and cannot install unsupported features or permissions', async () => {
  const f = await fixture(), definition = JSON.parse(f.bundle.files.get('module.json'));
  const entry = { id: definition.id, name: definition.name, version: definition.version, permissions: definition.permissions, networkOrigins: definition.networkOrigins || [], networkHeaders: definition.networkHeaders || [], source: { repository: C.repository, commit, directory: 'example' }, sha256: f.bundle.digest, host: { apiVersion: 1, features: [] } };
  const read = async (...args) => args[0].endsWith('/catalog.json') ? Buffer.from(JSON.stringify({ schemaVersion: 1, modules: [entry] })) : f.read(...args);
  const catalog = await C.list(read, new AbortController().signal); assert.equal(catalog.modules[0].compatible, true);
  let installed = 0;
  await C.install({ id: entry.id, digest: entry.sha256, revision }, read, new AbortController().signal, { async install() { installed++; } }, () => {});
  assert.equal(installed, 1);
  entry.host.features = ['unsupported.provider-adapter'];
  assert.equal((await C.list(read, new AbortController().signal)).modules[0].compatible, false);
  await assert.rejects(C.install({ id: entry.id, digest: entry.sha256, revision }, read, new AbortController().signal, { async install() { assert.fail('Unsupported feature installed'); } }, () => {}));
});


test('preparing an approved package persists only verified code, and detects tampering after restart', async t => {
  const fs = require('node:fs/promises'), os = require('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-prepare-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const f = await fixture(); let approvals = 0;
  assert.equal(await C.prepared(root, f.item), false);
  await C.install({ id: f.item.manifest.id, digest: f.item.digest, revision }, f.read, new AbortController().signal,
    { async install(bundle) { approvals++; await C.prepare(root, bundle, () => {}); } }, () => {});
  assert.equal(approvals, 1);
  assert.equal(await C.prepared(root, f.item), true);
  assert.equal(await C.prepared(root, { ...f.item, digest: 'c'.repeat(64) }), false);
  await fs.appendFile(path.join(M.recordDirectory(root, { id: f.item.manifest.id, version: f.item.manifest.version, digest: f.item.digest }), 'main.js'), '// changed');
  assert.equal(await C.prepared(root, f.item), false);
  await assert.rejects(C.prepare(root, f.bundle, () => { throw new Error('retired'); }), /retired/);
});

test('approved install IPC prepares before login, grants only the matching account and rejects scope changes', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { EventEmitter } = require('node:events');
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (operation === 'moduleInstallApproved')");
  const end = source.indexOf("      if (!client) throw", start);
  for (const scenario of ['prepare', 'account', 'stale', 'signed-out', 'changed', 'reset']) {
    const sender = new EventEmitter(); sender.isDestroyed = () => false;
    const active = ['account', 'stale'].includes(scenario) ? { syncId: 'current' } : null;
    const calls = [], isolated = { closeAllConnections: async () => {}, clearStorageData: async () => {} };
    let context;
    context = vm.createContext({ operation: 'moduleInstallApproved', client: active, accountEpoch: 1, resettingLocalData: scenario === 'reset',
      connection: active ? { controller: new AbortController() } : null, event: { sender },
      data: { sessionId: scenario === 'account' ? 'current' : ['stale', 'signed-out'].includes(scenario) ? 'retired' : undefined },
      AbortController, tr: value => value, net: {}, crypto: { randomUUID: () => 'fictional' }, session: { fromPartition: () => isolated },
      require: name => name === './module-github.cjs' ? { getBytes() {} } : { async install(_data, _read, _signal, host, guard) {
        if (scenario === 'changed') context.accountEpoch++;
        guard(); await host.install({ manifest: {} }); guard();
      } },
      installModuleBundle: async (_bundle, guard, approved, prepare) => { guard(); calls.push({ approved, prepare }); } });
    const run = () => vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
    if (['prepare', 'account'].includes(scenario)) {
      assert.equal((await run()).ok, true);
      assert.deepEqual(calls, [{ approved: true, prepare: scenario === 'prepare' }]);
    } else { await assert.rejects(run(), /Сессия/); assert.deepEqual(calls, []); }
    assert.equal(sender.listenerCount('destroyed'), 0);
  }
});

test('native confirmation cancellation never prepares a package or enables an account module', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), f = await fixture();
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf('async function installModuleBundle('), end = source.indexOf('const methods =', start);
  const context = vm.createContext({ tr: value => value, window: {}, dialog: { showMessageBox: async () => ({ response: 0 }) },
    moduleHost: { install: () => assert.fail('Cancelled account install') }, require: name => { assert.equal(name, './modules.cjs'); return M; } });
  vm.runInContext(source.slice(start, end), context);
  for (const prepare of [false, true]) await context.installModuleBundle(f.bundle, () => {}, true, prepare);
});

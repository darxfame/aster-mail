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

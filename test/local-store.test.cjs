const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { LocalStore } = require('../desktop/local-store.cjs');

// Use authenticated encryption to exercise the store without touching the system keychain.
function encryption() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
async function setup(t, provider = encryption()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: new LocalStore(directory, provider), provider };
}
const guard = () => {};
test('preferences and credentials are encrypted, scoped to the account and removed on logout', async t => {
  const { store, directory, provider } = await setup(t);
  await store.load('https://mail.example.com|alice');
  const values = { 'aster-signature': 'Confidential signature', 'aster-colleagues': '[{"email":"private@example.com"}]' };
  await store.save({ values, notifications: { preview: false } }, guard);
  await store.saveCredentials({ username: 'alice', password: 'fictional-secret' }, guard);
  for (const name of await fs.readdir(directory)) {
    const bytes = await fs.readFile(path.join(directory, name));
    assert.doesNotMatch(bytes.toString(), /Confidential|private@example.com|fictional-secret|alice/);
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(directory, name))).mode & 0o777, 0o600);
  }
  const restored = new LocalStore(directory, provider);
  assert.deepEqual((await restored.load('https://mail.example.com|alice')).values, values);
  assert.deepEqual(await restored.load('https://mail.example.com|bob'), {});
  await store.clear(); assert.deepEqual(await fs.readdir(directory), []);
});
test('unavailable or plaintext key providers never write local secrets', async t => {
  const { directory } = await setup(t);
  for (const platform of ['win32', 'linux']) {
    const store = new LocalStore(directory, { isEncryptionAvailable: () => platform === 'linux', getSelectedStorageBackend: () => 'basic_text' }, platform);
    await store.load('account');
    await assert.rejects(store.save({ values: { 'aster-signature': 'secret' } }, guard), /хранилище/);
    await assert.rejects(store.saveCredentials({ password: 'secret' }, guard), /хранилище/);
  }
  assert.deepEqual(await fs.readdir(directory), []);
});
test('queued stale saves cannot recreate deleted data or leak into another account', async t => {
  const { store, directory } = await setup(t);
  await store.load('alice'); let active = true;
  const pending = store.save({ values: { 'aster-signature': 'alice secret' } }, () => { if (!active) throw new Error('Session closed'); });
  active = false;
  const clear = store.clear();
  await assert.rejects(pending, /Session closed/); await clear;
  assert.deepEqual(await fs.readdir(directory), []);
  await store.load('bob'); await store.save({ values: { 'aster-signature': 'bob' } }, guard);
  assert.equal(store.data.values['aster-signature'], 'bob');
});
test('tampered ciphertext fails closed without replacing it with plaintext', async t => {
  const { store, directory } = await setup(t);
  await store.load('alice'); await store.save({ values: { 'aster-signature': 'secret' } }, guard);
  const file = path.join(directory, 'local-data.enc'), bytes = await fs.readFile(file); bytes[bytes.length - 1] ^= 1; await fs.writeFile(file, bytes);
  await assert.rejects(store.load('alice'));
  assert.deepEqual(store.data, {});
});

test('cancellation during an atomic save removes its temporary ciphertext and logout removes crash leftovers', async t => {
  const { store, directory } = await setup(t);
  await store.load('alice'); let checks = 0;
  await assert.rejects(store.save({ values: { 'aster-signature': 'secret' } }, () => { if (++checks === 4) throw new Error('Session closed during write'); }), /Session closed/);
  assert.deepEqual(await fs.readdir(directory), []);
  await fs.writeFile(path.join(directory, 'local-data.enc.1234-abcd.tmp'), 'old encrypted bytes');
  await fs.writeFile(path.join(directory, 'unrelated.txt'), 'keep');
  await store.clear(); assert.deepEqual(await fs.readdir(directory), ['unrelated.txt']);
});

test('failed logout removal leaves a durable revocation that prevents restore after restart', async t => {
  const { store, directory, provider } = await setup(t);
  await store.saveCredentials({ username: 'alice', password: 'fictional' }, guard);
  const original = fs.rm;
  fs.rm = async (file, options) => {
    if (file === path.join(directory, 'account.enc')) throw Object.assign(new Error('locked'), { code: 'EACCES' });
    return original(file, options);
  };
  try { await assert.rejects(store.clear(), /автовход заблокирован/); }
  finally { fs.rm = original; }
  const restarted = new LocalStore(directory, provider);
  assert.equal(await restarted.loadCredentials(), null);
  assert.ok(await fs.stat(path.join(directory, 'account.enc')));
  await restarted.saveCredentials({ username: 'bob', password: 'different' }, guard);
  assert.equal((await restarted.loadCredentials()).username, 'bob');
  await restarted.clear(); assert.equal(await restarted.loadCredentials(), null);
});

test('a marker write failure cannot silently report successful deletion when secrets also remain', async t => {
  const { store, directory, provider } = await setup(t);
  await store.saveCredentials({ username: 'alice', password: 'fictional' }, guard);
  const write = fs.writeFile, remove = fs.rm;
  fs.writeFile = async (file, ...args) => { if (file === path.join(directory, 'logout.pending')) throw new Error('read-only volume'); return write(file, ...args); };
  fs.rm = async (file, ...args) => { if (file === path.join(directory, 'account.enc')) throw new Error('read-only volume'); return remove(file, ...args); };
  try { await assert.rejects(store.clear(), /не удалось.*заблокировать автовход/i); }
  finally { fs.writeFile = write; fs.rm = remove; }
  // Total storage failure cannot persist revocation: it must require explicit remediation.
  assert.equal((await new LocalStore(directory, provider).loadCredentials()).username, 'alice');
});

test('directory enumeration failure still persists revocation before any restore', async t => {
  const { store, directory, provider } = await setup(t);
  await store.saveCredentials({ username: 'alice', password: 'fictional' }, guard);
  const original = fs.readdir;
  fs.readdir = async (file, ...args) => { if (file === directory) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return original(file, ...args); };
  try { await assert.rejects(store.clear(), /Автовход заблокирован/); }
  finally { fs.readdir = original; }
  assert.equal(await new LocalStore(directory, provider).loadCredentials(), null);
  assert.ok(await fs.stat(path.join(directory, 'account.enc')));
});

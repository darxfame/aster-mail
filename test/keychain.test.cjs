const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { KeychainEncryption } = require('../desktop/keychain.cjs');

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-broker-'));
  const file = path.join(directory, 'frozen-helper'); await fs.writeFile(file, 'fictional frozen executable');
  const manifest = { protocol: 1, sha256: crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') };
  let launches = 0, legacyReads = 0;
  const child = new EventEmitter(), key = crypto.randomBytes(32);
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => { child.killed = true; };
  child.stdin.on('data', frame => {
    if (child.stall) return;
    const request = JSON.parse(frame.toString()); let result;
    try {
      if (request.operation === 'ping') result = '1';
      else if (request.operation === 'encrypt') {
        const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        const bytes = Buffer.concat([cipher.update(Buffer.from(request.data, 'base64')), cipher.final()]);
        result = Buffer.concat([Buffer.from('ASTK1'), nonce, bytes, cipher.getAuthTag()]).toString('base64');
      } else {
        const data = Buffer.from(request.data, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(5, 17));
        decipher.setAuthTag(data.subarray(-16));
        result = Buffer.concat([decipher.update(data.subarray(17, -16)), decipher.final()]).toString('base64');
      }
      child.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
    } catch { child.stdout.write(JSON.stringify({ id: request.id, ok: false }) + '\n'); }
  });
  const encryption = new KeychainEncryption({ file, manifest, legacy: { isEncryptionAvailable: () => true, decryptString: () => { legacyReads++; return 'legacy fictional value'; } },
    launch(_file, args, config) { launches++; assert.deepEqual(args, []); assert.deepEqual(config.env, { PATH: '/usr/bin:/bin' }); process.nextTick(() => child.emit('spawn')); return child; }, ...options });
  t.after(async () => { encryption.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { encryption, child, file, launches: () => launches, legacyReads: () => legacyReads };
}
test('only the frozen binary runs; ciphertext uses authenticated encryption and never falls back after corruption', async t => {
  const f = await fixture(t);
  assert.equal(await f.encryption.isEncryptionAvailable(), true);
  const bytes = await f.encryption.encryptString('fictional secret');
  assert.equal(bytes.includes(Buffer.from('fictional secret')), false);
  assert.equal(await f.encryption.decryptString(bytes), 'fictional secret');
  assert.notDeepEqual(bytes, await f.encryption.encryptString('fictional secret'));
  const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(f.encryption.decryptString(damaged)); assert.equal(f.legacyReads(), 0);
  assert.equal(await f.encryption.decryptString(Buffer.from('old-format')), 'legacy fictional value');
  assert.equal(f.legacyReads(), 1); assert.equal(f.launches(), 1);
  f.encryption.close(); await assert.rejects(f.encryption.decryptString(bytes));
});
test('helper tampering, oversized input, a crash and malformed replies fail closed', async t => {
  const tampered = await fixture(t); await fs.writeFile(tampered.file, 'changed executable');
  assert.equal(await tampered.encryption.isEncryptionAvailable(), false); assert.equal(tampered.launches(), 0);
  const oversized = await fixture(t); await assert.rejects(oversized.encryption.encryptString('x'.repeat(1024 * 1024 + 1))); assert.equal(oversized.launches(), 0);
  for (const mode of ['exit', 'invalid', 'timeout']) {
    const f = await fixture(t, { timeout: 15 });
    assert.equal(await f.encryption.isEncryptionAvailable(), true); f.child.stall = true;
    const pending = f.encryption.encryptString('fictional');
    await new Promise(resolve => setImmediate(resolve));
    if (mode === 'exit') f.child.emit('exit', 77);
    if (mode === 'invalid') f.child.stdout.write('{bad json}\n');
    await assert.rejects(pending); assert.equal(f.child.killed, true); assert.equal(f.encryption.pending.size, 0);
  }
});
test('legacy availability refusal is remembered without letting one corrupt file disable healthy legacy files', async t => {
  let availabilityChecks = 0;
  const refused = await fixture(t, { legacy: { isEncryptionAvailable() { availabilityChecks++; return false; }, decryptString() { assert.fail('Unavailable legacy key'); } } });
  for (let i = 0; i < 2; i++) await assert.rejects(refused.encryption.decryptString(Buffer.from('old')));
  assert.equal(availabilityChecks, 1);
  const available = await fixture(t, { legacy: { isEncryptionAvailable: () => true, decryptString(bytes) { if (bytes.toString() === 'damaged') throw new Error('Corrupt ciphertext'); return 'healthy'; } } });
  await assert.rejects(available.encryption.decryptString(Buffer.from('damaged')));
  assert.equal(await available.encryption.decryptString(Buffer.from('intact')), 'healthy');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { markUntrusted, writeAttachment } = require('../desktop/attachment-trust.cjs');

test('Windows provenance is written and read back before payload writing; non-Windows requires no ADS', async () => {
  const calls = [], zone = '[ZoneTransfer]\r\nZoneId=3\r\n';
  const io = { async writeFile(file, data) { calls.push({ file, data }); }, async readFile() { return zone; } };
  await markUntrusted('C:\\Downloads\\report.doc', 'win32', io);
  assert.deepEqual(calls, [{ file: 'C:\\Downloads\\report.doc:Zone.Identifier', data: zone }]);
  await markUntrusted('/tmp/report.doc', 'darwin', { writeFile() { assert.fail('ADS is Windows-only'); } });
  await assert.rejects(markUntrusted('file', 'win32', { async writeFile() {}, async readFile() { return ''; } }), /отметку безопасности/);
});

test('marking failure preserves an existing Save As target without creating staging copies', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-trust-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'report.doc'); await fs.writeFile(file, 'old content');
  await assert.rejects(writeAttachment(file, Buffer.from('new content'), { mark: async () => { throw new Error('No ADS support'); } }), /No ADS support/);
  assert.equal(await fs.readFile(file, 'utf8'), 'old content'); assert.deepEqual(await fs.readdir(directory), ['report.doc']);
  let marked = false;
  await writeAttachment(file, Buffer.from('new content'), { mark: async target => { assert.equal(target, file); assert.equal(await fs.readFile(file, 'utf8'), 'old content'); marked = true; } });
  assert.equal(marked, true); assert.equal(await fs.readFile(file, 'utf8'), 'new content');
});

test('logout during provenance marking never writes a late payload', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-trust-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let active = true;
  await assert.rejects(writeAttachment(path.join(directory, 'late.doc'), Buffer.from('private'), { assertActive() { if (!active) throw new Error('Session expired'); }, mark: async () => { active = false; } }), /Session expired/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('native Windows NTFS retains Zone.Identifier on the published attachment', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-native-zone-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'report.doc'); await writeAttachment(file, Buffer.from('fictional'));
  assert.match(await fs.readFile(`${file}:Zone.Identifier`, 'utf8'), /ZoneId=3/);
});

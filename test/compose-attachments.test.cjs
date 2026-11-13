const test = require('node:test');
const assert = require('node:assert/strict');
const { preview, localFile, resolve } = require('../desktop/compose-attachments.cjs');
const { allowed } = require('../desktop/compose-windows.cjs');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
test('local image preview checks actual raster bytes, MIME and decoded size', () => {
  const file = localFile({ name: 'fictional.png', type: 'image/png', content: png });
  assert.equal(preview(file).decodedBytes, 4);
  assert.throws(() => preview({ ...file, type: 'image/jpeg' }), /совпадает/);
  assert.throws(() => preview({ name: 'active.svg', type: 'image/svg+xml', bytes: Buffer.from('<svg onload="evil()"/>') }), /формат/);
  assert.throws(() => localFile({ name: 'bad', content: 'invalid!' }));
  const huge = Buffer.from(file.bytes); huge.writeUInt32BE(10000, 16);
  assert.throws(() => preview({ ...file, bytes: huge }), /лимит/);
});
test('text stays plain and bounded; PDF and Office are opened explicitly outside the renderer', () => {
  const result = preview({ name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('<script>never execute</script>') });
  assert.equal(result.kind, 'text'); assert.match(result.text, /<script>/);
  assert.equal(preview({ name: 'large.log', bytes: Buffer.alloc(150000, 65) }).text.length, 100000);
  assert.equal(preview({ name: 'large.log', bytes: Buffer.alloc(150000, 65) }).truncated, true);
  assert.deepEqual(preview({ name: 'file.pdf', bytes: Buffer.from('fictional') }), { kind: 'pdf' });
  for (const name of ['file.docx', 'file.html']) assert.deepEqual(preview({ name, bytes: Buffer.from('fictional') }), { kind: 'external' });
});
test('server previews require current membership and drop data after account retirement', async () => {
  let active = true, loaded = 0;
  const client = { message: async () => ({ attachments: [{ id: 'file', name: 'notes.txt', size: 4 }] }), attachment: async () => { loaded++; return Buffer.from('text'); } };
  const context = { client, sources: new Set(['draft']), assertActive() { if (!active) throw new Error('retired'); } };
  await assert.rejects(resolve({ source: { id: 'other' }, id: 'file' }, context), /принадлежит/);
  await assert.rejects(resolve({ source: { id: 'draft' }, id: 'other' }, context), /не найдено/);
  assert.equal(loaded, 0);
  assert.equal((await resolve({ source: { id: 'draft' }, id: 'file' }, context)).bytes.toString(), 'text');
  client.attachment = async () => { active = false; return Buffer.from('late'); };
  await assert.rejects(resolve({ source: { id: 'draft' }, id: 'file' }, context), /retired/);
  assert.ok(allowed.has('composeAttachment')); assert.ok(!allowed.has('openAttachment'));
});
test('closing a compose preview during a server read prevents a late external open through IPC', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const { AttachmentPreviews } = require('../desktop/attachment-previews.cjs');
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const block = source.slice(source.indexOf("      if (operation === 'composeAttachment')"), source.indexOf("      if (!client) throw", source.indexOf("      if (operation === 'composeAttachment')")));
  const sender = { isDestroyed: () => false }, previews = new AttachmentPreviews({});
  let finish, opened = 0;
  const entry = { attachmentSources: new Set(['draft']), demo: false };
  const context = vm.createContext({ tr: value => value, accountEpoch: 1, client: { syncId: 'account', message: () => new Promise(resolve => { finish = resolve; }), attachment: async () => Buffer.from('text') },
    composeWindows: { entries: new Map([[sender, entry]]) }, attachmentPreviews: previews,
    attachmentFiles: { open: async () => { opened++; } }, require: () => require('../desktop/compose-attachments.cjs') });
  const run = vm.runInContext(`(async function(operation, data, event, composeEntry) { ${block} })`, context);
  const reading = run('composeAttachment', { action: 'open', source: { id: 'draft' }, id: 'file', sessionId: 'account' }, { sender }, entry);
  await Promise.resolve();
  await run('composeAttachment', { action: 'close', sessionId: 'account' }, { sender }, entry);
  finish({ attachments: [{ id: 'file', name: 'notes.txt', size: 4 }] });
  await assert.rejects(reading, /закрыт/); assert.equal(opened, 0);
});
test('meeting attachments use fresh calendar membership and preserve session and compose boundaries', async () => {
  let active = true, reads = 0, downloads = 0;
  const source = { id: 'meeting', changeKey: 'version', kind: 'event' };
  const attachment = { id: 'file', name: 'agenda.txt', size: 4, type: 'text/plain' };
  const client = {
    eventDetails: async ref => { assert.deepEqual(ref, { id: 'meeting', changeKey: 'version' }); reads++; return { attachments: [attachment] }; },
    message: async () => { throw new Error('Must read the calendar item'); },
    attachment: async () => { downloads++; return Buffer.from('text'); },
  };
  const context = { client, sources: new Set(['meeting']), allowEvents: true, assertActive() { if (!active) throw new Error('retired'); } };
  assert.equal((await resolve({ source, id: 'file' }, context)).bytes.toString(), 'text');
  await assert.rejects(resolve({ source, id: 'file' }, { ...context, allowEvents: false }), /тип/);
  await assert.rejects(resolve({ source: { ...source, kind: 'unknown' }, id: 'file' }, context), /тип/);
  await assert.rejects(resolve({ source, id: 'missing' }, context), /во встрече/);
  attachment.size = 21 * 1024 * 1024;
  await assert.rejects(resolve({ source, id: 'file' }, context), /слишком большое/);
  assert.equal(downloads, 1);
  attachment.size = 4;
  client.attachment = async () => { active = false; return Buffer.from('late'); };
  await assert.rejects(resolve({ source, id: 'file' }, context), /retired/);
  assert.equal(reads, 4);
});

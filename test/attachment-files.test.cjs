const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AttachmentFiles, safeName } = require('../desktop/attachment-files.cjs');

test('explicit opens use unique private files, preserve extensions and clear copies on logout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-attachment-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const opened = [], directory = path.join(root, 'opened');
  const files = new AttachmentFiles(directory, async file => { opened.push(file); assert.equal((await fs.readFile(file)).toString(), 'fictional file'); return ''; });
  for (let i = 0; i < 2; i++) await files.open({ name: '..\\folder/report.pdf', load: async () => Buffer.from('fictional file'), assertActive() {} });
  assert.equal(path.basename(opened[0]), 'report.pdf'); assert.notEqual(opened[0], opened[1]);
  if (process.platform !== 'win32') assert.equal((await fs.stat(opened[0])).mode & 0o777, 0o600);
  assert.equal(safeName('C:\\unsafe\\CON.txt'), '_CON.txt');
  await files.clear(); await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});

test('unsupported types, expired accounts and open failures never leave usable copies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-attachment-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = new AttachmentFiles(path.join(root, 'opened'), async () => 'No associated application');
  for (const name of ['run.exe', 'run.cmd', 'run.ps1', 'page.html', 'vector.svg', 'macro.docm', 'app.app']) {
    await assert.rejects(files.open({ name, load() { assert.fail('Blocked file must not download'); }, assertActive() {} }), /только сохранить/);
  }
  await assert.rejects(files.open({ name: 'report.pdf', load: async () => Buffer.from('test'), assertActive() { throw new Error('Session expired'); } }), /Session expired/);
  await assert.rejects(fs.stat(files.directory), { code: 'ENOENT' });
  await assert.rejects(files.open({ name: 'report.pdf', load: async () => Buffer.from('test'), assertActive() {} }), /Не удалось открыть/);
  assert.deepEqual(await fs.readdir(files.directory), []);
});

test('logout overtaking a read prevents writing and opening a late attachment', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-attachment-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let finish;
  const files = new AttachmentFiles(path.join(root, 'opened'), () => assert.fail('A retired read must not open'));
  const pending = files.open({ name: 'report.pdf', load: () => new Promise(resolve => { finish = resolve; }), assertActive() {} });
  await files.clear(); finish(Buffer.from('late payload'));
  await assert.rejects(pending, /Сессия аккаунта завершена/);
  await assert.rejects(fs.stat(files.directory), { code: 'ENOENT' });
});

test('opening through IPC uses current message metadata and rejects an unrelated attachment', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (operation === 'openAttachment')");
  const branch = source.slice(start, source.indexOf("      if (operation === 'attachment')", start));
  const activeClient = {
    async message(data) { assert.equal(data.id, 'mail'); assert.equal(data.refresh, true); return { attachments: [{ id: 'file', name: 'server-name.pdf' }] }; },
    async attachment(id) { assert.equal(id, 'file'); return Buffer.from('fictional'); },
  };
  let opens = 0;
  const context = vm.createContext({ operation: 'openAttachment', activeClient, client: activeClient,
    data: { id: 'file', name: 'untrusted.exe', ref: { id: 'mail' } },
    attachmentFiles: { async open({ name, load, assertActive }) { opens++; assert.equal(name, 'server-name.pdf'); assertActive(); await load(); return true; } },
  });
  vm.runInContext(`async function invoke() { ${branch} }`, context);
  assert.equal((await context.invoke()).ok, true);
  context.data.id = 'unrelated';
  await assert.rejects(context.invoke(), /Вложение не найдено/);
  assert.equal(opens, 1);
  context.data.id = 'file'; context.client = {};
  await assert.rejects(context.invoke(), /Сессия аккаунта завершена/);
  assert.equal(opens, 1);
});

test('locked temporary files report cleanup failures and still count against retention limits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-attachment-limit-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.now(), launches = 0;
  const files = new AttachmentFiles(path.join(root, 'opened'), async () => { launches++; return ''; }, { now: () => now, maxFiles: 1, maxBytes: 32, maxAge: 1000 });
  const open = () => files.open({ name: 'report.pdf', load: async () => Buffer.from('test'), assertActive() {} });
  await open(); await assert.rejects(open(), /Лимит/); assert.equal(launches, 1);
  const original = fs.rm;
  fs.rm = async (file, options) => { if (file.startsWith(files.directory)) throw new Error('locked'); return original(file, options); };
  try {
    await assert.rejects(files.clear(), /Не удалось удалить/);
    now += 2000; await assert.rejects(open(), /Не удалось удалить/);
    assert.equal((await files.retained()).length, 1); assert.equal(launches, 1);
  } finally { fs.rm = original; }
  await files.cleanupExpired(); assert.equal((await files.retained()).length, 0);
  await open(); assert.equal(launches, 2);
});

test('concurrent opens respect the shared byte limit and trust failures never launch', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-attachment-race-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let launches = 0;
  const files = new AttachmentFiles(path.join(root, 'opened'), async () => { launches++; return ''; }, { maxBytes: 6 });
  const args = { name: 'report.pdf', load: async () => Buffer.from('four'), assertActive() {} };
  const results = await Promise.allSettled([files.open(args), files.open(args)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(launches, 1);
  await files.clear();
  const blocked = new AttachmentFiles(files.directory, () => assert.fail('Unmarked file launched'), { write: async () => { throw new Error('Zone denied'); } });
  await assert.rejects(blocked.open(args), /Zone denied/); assert.deepEqual(await fs.readdir(files.directory), []);
});

test('Save As IPC also goes through the shared trust writer and session guard', async () => {
  const vm = require('node:vm'), source = await fs.readFile(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (operation === 'attachment')"), branch = source.slice(start, source.indexOf("      if (operation === 'clearMailCache')", start));
  const activeClient = { attachment: async () => Buffer.from('fictional') }; let writes = 0;
  const context = vm.createContext({ operation: 'attachment', data: { id: 'file', name: 'report.doc' }, activeClient, client: activeClient, window: {}, safeName,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: 'chosen.doc' }) },
    writeAttachment: async (file, bytes, { assertActive }) => { writes++; assert.equal(file, 'chosen.doc'); assert.equal(bytes.toString(), 'fictional'); assertActive(); },
  });
  vm.runInContext(`async function invoke() { ${branch} }`, context);
  assert.equal((await context.invoke()).value, true); assert.equal(writes, 1);
  context.client = {};
  await assert.rejects(context.invoke(), /Сессия аккаунта завершена/); assert.equal(writes, 1);
});

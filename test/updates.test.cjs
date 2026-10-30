const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Updates, newer, releaseInfo, allowedURL, request, apiURL } = require('../desktop/updates.cjs');
const payload = Buffer.from('fictional installer bytes');
function release(number = '0.1.9', target = 'mac-arm64.dmg') {
  const name = `Aster-Mail-${number}-${target}`;
  return { tag_name: `v${number}`, draft: false, prerelease: false, body: 'Release notes', assets: [{ name, state: 'uploaded', size: payload.length, digest: `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`, browser_download_url: `https://github.com/darxfame/aster-mail/releases/download/v${number}/${name}` }] };
}
async function fixture(t, fetch) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-updates-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const opened = [], changes = [];
  const updater = new Updates({ directory, installed: '0.1.8', platform: 'darwin', arch: 'arm64', fetch: fetch || (async url => url === apiURL ? new Response(JSON.stringify(release())) : new Response(payload)), changed: value => changes.push(value), open: async file => { opened.push(file); return ''; } });
  await updater.initialize();
  return { updater, directory, opened, changes };
}
test('stable numeric versions never downgrade or accept prereleases', () => {
  assert.equal(newer('0.1.10', '0.1.9'), true);
  assert.equal(newer('1.0.0', '0.99.99'), true);
  assert.equal(newer('0.1.8', '0.1.8'), false);
  assert.equal(newer('0.1.7', '0.1.8'), false);
  for (const value of ['0.1.9-beta.1', '01.2.3', '1.2', '1.2.3/../../', '99999999999999999999.1.1']) assert.throws(() => newer(value, '0.1.8'));
  assert.equal(releaseInfo(release('0.1.8'), '0.1.9', 'darwin', 'arm64'), null);
});
test('only exact public installer names, repository, stable version and digest accepted', () => {
  assert.equal(releaseInfo(release(), '0.1.8', 'darwin', 'arm64').version, '0.1.9');
  assert.match(releaseInfo(release('0.1.9', 'windows-x64.exe'), '0.1.8', 'win32', 'x64').name, /windows-x64.exe$/);
  for (const mutate of [r => r.draft = true, r => r.prerelease = true, r => r.assets[0].size = 600 * 1024 * 1024, r => r.assets[0].size = 0, r => delete r.assets[0].digest, r => r.assets[0].digest = 'sha256:bad', r => r.assets[0].state = 'new', r => r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('darxfame', 'other'), r => r.assets[0].name = '../evil.dmg']) {
    const value = release(); mutate(value); assert.throws(() => releaseInfo(value, '0.1.8', 'darwin', 'arm64'));
  }
  assert.throws(() => releaseInfo(release(), '0.1.8', 'darwin', 'x64'));
});
test('downloads use isolated credential-free requests and reject unsafe redirects', async () => {
  for (const url of ['http://github.com/a', 'https://github.com.evil.test/', 'https://user:secret@github.com/', 'file:///tmp/file', 'https://github.com:444/']) assert.equal(allowedURL(url), false);
  const calls = [];
  await request(async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file' } }) : new Response(payload); }, 'https://github.com/file');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  await assert.rejects(request(async () => new Response(null, { status: 302, headers: { location: 'http://github.com/file' } }), 'https://github.com/file'), /адрес/);
  await assert.rejects(request(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }), 'https://github.com/file'), /адрес/);
});
test('check, stream, verify and explicitly open installer; persist preference', async t => {
  const { updater, directory, opened, changes } = await fixture(t);
  await updater.check(); assert.equal(updater.state.status, 'available');
  await updater.download(); assert.equal(updater.state.status, 'ready'); assert.equal(opened.length, 0);
  assert.deepEqual(await fs.readFile(path.join(directory, updater.state.available.name)), payload);
  assert.equal(changes.some(value => value.status === 'downloading'), true);
  await updater.check(); assert.equal(updater.state.status, 'ready');
  await updater.openInstaller(); assert.equal(opened.length, 1);
  await updater.preferences(false);
  const restored = new Updates({ directory, installed: '0.1.8' }); await restored.initialize(); assert.equal(restored.state.autoCheck, false);
  await assert.rejects(updater.preferences('false'));
});
test('tampered cached installer cannot be launched', async t => {
  const { updater, directory, opened } = await fixture(t); await updater.check(); await updater.download();
  await fs.writeFile(path.join(directory, updater.state.available.name), Buffer.alloc(payload.length));
  await assert.rejects(updater.openInstaller(), /изменён/); assert.equal(opened.length, 0);
});
test('size mismatch, corrupt data and network interruption leave no partial file; retry works', async t => {
  for (const response of [() => new Response(Buffer.alloc(payload.length)), () => new Response(payload.subarray(1)), () => new Response(Buffer.alloc(payload.length + 1)), () => new Response(payload, { headers: { 'content-length': '999' } }), () => { throw new Error('offline'); }]) {
    const { updater, directory, opened } = await fixture(t, async url => url === apiURL ? new Response(JSON.stringify(release())) : response());
    await updater.check(); await updater.download();
    assert.equal(updater.state.status, 'available'); assert.ok(updater.state.error); assert.deepEqual(await fs.readdir(directory), []); assert.equal(opened.length, 0);
    updater.fetch = async () => new Response(payload); await updater.download(); assert.equal(updater.state.status, 'ready');
  }
});
test('failed checks preserve known available update and suppress concurrent checks', async t => {
  const { updater } = await fixture(t); await updater.check();
  updater.fetch = async () => { throw new Error('offline'); };
  await updater.check(); assert.equal(updater.state.available.version, '0.1.9'); assert.equal(updater.state.error, 'offline');
  updater.busy = true; const snapshot = await updater.check(); assert.equal(snapshot.status, 'available');
});
test('multi-chunk streams preserve bytes and an interrupted stream is cleaned up', async t => {
  let chunks = [payload.subarray(0, 4), payload.subarray(4, 12), payload.subarray(12)];
  const { updater, directory } = await fixture(t, async url => url === apiURL ? new Response(JSON.stringify(release())) : new Response(new ReadableStream({ pull(controller) { chunks.length ? controller.enqueue(chunks.shift()) : controller.close(); } })));
  await updater.check(); await updater.download(); assert.equal(updater.state.status, 'ready');
  assert.deepEqual(await fs.readFile(path.join(directory, updater.state.available.name)), payload);
  updater.fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.error(new Error('connection reset')); } }));
  await updater.download(); assert.equal(updater.state.status, 'available'); assert.match(updater.state.error, /connection reset/);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.part')), false);
});
test('a symlink cannot be opened as a verified installer', async t => {
  const { updater, directory, opened } = await fixture(t); await updater.check(); await updater.download();
  const file = path.join(directory, updater.state.available.name), other = path.join(directory, 'other');
  await fs.rename(file, other);
  try { await fs.symlink(other, file); } catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation not permitted on this Windows runner'); return; } throw error; }
  await assert.rejects(updater.openInstaller(), /изменён/); assert.equal(opened.length, 0);
});
test('automatic checks start immediately, retry network failure after a minute and keep the six-hour success interval', async t => {
  let requests = 0;
  const { updater } = await fixture(t, async () => {
    requests++;
    if (requests === 1) throw new Error('Offline');
    return new Response(JSON.stringify(release()));
  });
  const now = Date.now();
  await updater.checkAutomatically(now); assert.equal(requests, 1); assert.match(updater.state.error, /Offline/);
  await updater.checkAutomatically(now + 59999); assert.equal(requests, 1);
  await updater.checkAutomatically(now + 60000); assert.equal(requests, 2); assert.equal(updater.state.status, 'available');
  await updater.checkAutomatically(now + 120000); assert.equal(requests, 2);
  await updater.checkAutomatically(now + 6 * 60 * 60000 + 1000); assert.equal(requests, 3);
  await updater.preferences(false);
  await updater.checkAutomatically(now + 12 * 60 * 60000); assert.equal(requests, 3);
});

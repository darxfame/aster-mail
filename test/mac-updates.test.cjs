const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { MacUpdates, applicationPath } = require('../desktop/mac-updates.cjs');
const signature = 'designated => identifier "app.astermail.desktop" and certificate leaf = H"94449af39dabd49526a09ae19047190ec2d165e8"';

test('native handoff exposes only the verified handle on a private loopback URL and cancellation suppresses restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-mac-handoff-'));
  const file = path.join(directory, 'update.zip');
  await fs.writeFile(file, 'verified zip fixture');
  const handle = await fs.open(file, 'r');
  t.after(async () => { await handle.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const native = new EventEmitter(), calls = [], controller = new AbortController();
  let feed, restarts = 0, fetches;
  native.setFeedURL = options => { feed = options.url; };
  native.checkForUpdates = () => { fetches = (async () => {
    try {
      const url = new URL(feed); assert.equal(url.hostname, '127.0.0.1');
      assert.equal((await fetch(new URL('/unknown', feed))).status, 404);
      assert.equal((await fetch(feed, { method: 'POST' })).status, 403);
      const response = await fetch(feed), metadata = await response.json();
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(new URL(metadata.url).origin, url.origin);
      assert.equal(await (await fetch(metadata.url)).text(), 'verified zip fixture');
      controller.abort(); native.emit('update-downloaded');
    } catch (error) { native.emit('error', error); }
  })(); };
  const updater = new MacUpdates({ autoUpdater: native, appPath: '/fictional/Aster.app', restart: () => { restarts++; }, run: async (command, args) => { calls.push({ command, args }); return { stdout: signature, stderr: 'Executable=/fictional/Aster.app' }; } });
  await assert.rejects(updater.install(handle, { version: '0.2.9', size: 20, sha256: 'fixture-digest' }, controller.signal));
  await fetches;
  assert.equal(restarts, 0); assert.equal(updater.staged, 'fixture-digest');
  assert.deepEqual(calls[0], { command: '/usr/bin/codesign', args: ['--verify', '--deep', '--strict', '/fictional/Aster.app'] });
  assert.equal(updater.pending, false);
  await updater.install(handle, { sha256: 'fixture-digest' }, new AbortController().signal);
  assert.equal(restarts, 1);
  await assert.rejects(updater.install(handle, { sha256: 'other-digest' }, new AbortController().signal), /Перезапустите/);
  assert.equal(restarts, 1);
  native.emit('error', new Error('Late native error')); // No unhandled EventEmitter error.
  assert.equal(applicationPath('/Applications/Aster Mail.app/Contents/Resources'), '/Applications/Aster Mail.app');
});

test('invalid installed signatures, missing updates and native preparation errors never restart', async () => {
  for (const failure of ['invalid', 'ad-hoc', 'missing', 'native', 'timeout']) {
    const native = new EventEmitter();
    native.setFeedURL = () => {};
    native.checkForUpdates = () => {
      if (failure === 'missing') native.emit('update-not-available');
      if (failure === 'native') native.emit('error', new Error('Signature mismatch'));
    };
    const updater = new MacUpdates({ autoUpdater: native, appPath: '/fixture.app', timeout: 10,
      restart: () => assert.fail('Must not restart'),
      run: async () => { if (failure === 'invalid') throw new Error('Invalid signature'); return { stderr: failure === 'ad-hoc' ? 'designated => cdhash H"bad"' : signature }; },
    });
    await assert.rejects(updater.install({}, { sha256: 'fixture' }, new AbortController().signal));
    assert.equal(updater.pending || false, false);
    assert.equal(updater.staged, undefined);
    assert.equal(native.listenerCount('update-downloaded'), 1);
    if (failure === 'timeout') {
      assert.equal(updater.timedOut, true);
      native.emit('update-downloaded'); assert.equal(updater.staged, 'fixture');
    }
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WindowsUpdates } = require('../desktop/windows-updates.cjs');

test('Windows restart waits for spawn, uses NSIS update flags without a shell and never retries launch failure', async () => {
  const events = [], child = new EventEmitter(); child.unref = () => events.push('unref');
  const updater = new WindowsUpdates({ prepare: () => { events.push('prepare'); return true; }, quit: () => events.push('quit'), cancelled: () => events.push('cancelled'),
    launch(file, args, options) {
      events.push('launch'); assert.equal(file, 'C:\\fictional folder\\verified.exe');
      assert.deepEqual(args, ['--updated', '/S', '--force-run']);
      assert.deepEqual(options, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
      return child;
    },
  });
  const installing = updater.install('C:\\fictional folder\\verified.exe', new AbortController().signal);
  assert.deepEqual(events, ['prepare', 'launch']);
  child.emit('spawn'); await installing;
  assert.deepEqual(events, ['prepare', 'launch', 'unref', 'quit']);
  events.length = 0;
  const failed = updater.install('C:\\fictional folder\\verified.exe', new AbortController().signal);
  child.emit('error', new Error('EACCES')); await assert.rejects(failed, /EACCES/);
  assert.deepEqual(events, ['prepare', 'launch', 'cancelled']);
});

test('cancelled guards and a closed update dialog never spawn an installer or quit', async () => {
  const updater = new WindowsUpdates({ prepare: () => false, launch: () => assert.fail('No launch'), quit: () => assert.fail('No quit'), cancelled: () => assert.fail('Nothing was committed') });
  await updater.install('fictional.exe', new AbortController().signal);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(updater.install('fictional.exe', controller.signal));
  const failure = new WindowsUpdates({ prepare: () => true, launch() { throw new Error('ENOENT'); }, quit: () => assert.fail('No quit'), cancelled() { this.restored = true; } });
  await assert.rejects(failure.install('fictional.exe', new AbortController().signal), /ENOENT/);
  assert.equal(failure.restored, true);
});

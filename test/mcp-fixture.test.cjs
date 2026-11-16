const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/test-mcp-ui.cjs'), 'utf8');
async function cleanup({ platform = 'win32', failure, result = 0, clipboardFailure = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    child: { kill: () => calls.push('kill') }, clipboardBackup: 'fictional clipboard', profile: 'fictional-profile',
    clipboard: { async writeText(text) { assert.equal(text, 'fictional clipboard'); calls.push('clipboard'); if (clipboardFailure) throw new Error('Clipboard unavailable'); } },
    app: { removeAllListeners(name) { assert.equal(name, 'window-all-closed'); calls.push('disable quit guards'); }, exit: code => calls.push(['exit', code]) },
    BrowserWindow: { getAllWindows: () => [{ destroy: () => calls.push('destroy window') }] },
    fs: { async rm(directory, options) { assert.equal(directory, 'fictional-profile'); assert.equal(options.maxRetries, 3); calls.push('remove profile'); if (failure) throw Object.assign(new Error('Cleanup failure'), { code: failure }); } },
    process: { platform }, console: { error: () => calls.push('error'), warn: () => calls.push('warning') },
  });
  vm.runInContext(source.slice(source.indexOf('async function finish('), source.indexOf('async function waitFor(')), context);
  await context.finish(result, result ? new Error('Fixture assertion failed') : undefined);
  return calls;
}
test('native MCP fixture closes its windows and exits successfully even with known Windows profile locks', async () => {
  assert.deepEqual(await cleanup(), ['kill', 'clipboard', 'disable quit guards', 'destroy window', 'remove profile', ['exit', 0]]);
  for (const failure of ['EPERM', 'EBUSY', 'ENOTEMPTY']) {
    const calls = await cleanup({ failure });
    assert.deepEqual(calls.at(-1), ['exit', 0]); assert.ok(calls.includes('warning'));
    assert.ok(calls.indexOf('destroy window') < calls.indexOf('remove profile'));
  }
});
test('cleanup cannot hide a failed MCP assertion or leave Electron running after an unexpected error', async () => {
  assert.deepEqual((await cleanup({ failure: 'EBUSY', result: 1 })).at(-1), ['exit', 1]);
  assert.deepEqual((await cleanup({ failure: 'EACCES' })).at(-1), ['exit', 1]);
  assert.deepEqual((await cleanup({ platform: 'darwin', failure: 'EBUSY' })).at(-1), ['exit', 1]);
  assert.deepEqual((await cleanup({ clipboardFailure: true })).at(-1), ['exit', 1]);
});

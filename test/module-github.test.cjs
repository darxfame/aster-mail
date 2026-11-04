const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const G = require('../desktop/module-github.cjs');
const M = require('../desktop/modules.cjs');
const commit = 'a'.repeat(40);
test('GitHub installation accepts canonical public repository URLs and rejects ambiguous or unsafe sources', () => {
  assert.deepEqual(G.location({ url: 'https://github.com/example/module.git', ref: 'feature/panels', directory: 'dist/module' }), { owner: 'example', repo: 'module', ref: 'feature/panels', directory: 'dist/module', repository: 'https://github.com/example/module' });
  for (const url of ['http://github.com/example/module', 'https://evil.test/example/module', 'https://github.com@example.test/example/module', 'https://github.com/example/module/tree/main', 'https://github.com/example/module?token=secret']) assert.throws(() => G.location({ url }));
  assert.throws(() => G.location({ url: 'https://github.com/example/module', directory: '../outside' }));
  assert.throws(() => G.location({ url: 'https://github.com/example/module', ref: '../outside' }));
});
test('GitHub download pins every declared file to one immutable commit and matches the local package digest', async () => {
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  const calls = [];
  const loaded = await G.load({ url: 'https://github.com/example/module', ref: 'main', directory: 'dist/module' }, async (url, limit) => {
    calls.push(url);
    if (url.includes('api.github.com')) return Buffer.from(JSON.stringify({ sha: commit }));
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/example/module/${commit}/dist/module/`));
    const name = url.split('/dist/module/')[1]; assert.ok(bundle.files.has(name)); assert.ok(bundle.files.get(name).length <= limit);
    return bundle.files.get(name);
  }, new AbortController().signal);
  assert.equal(loaded.digest, bundle.digest); assert.equal(calls.length, bundle.files.size + 1);
  assert.equal(loaded.source.commit, commit); assert.equal(loaded.source.repository, 'https://github.com/example/module');
});
test('cancelled, oversized or unpinned GitHub downloads never complete an installable package', async () => {
  const input = { url: 'https://github.com/example/module' };
  await assert.rejects(G.load(input, async () => Buffer.from('{"sha":"main"}'), new AbortController().signal));
  await assert.rejects(G.load(input, async (_url, limit) => Buffer.alloc(limit + 1), new AbortController().signal), /размер/);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(G.load(input, async () => { calls++; controller.abort(); return Buffer.from(JSON.stringify({ sha: commit })); }, controller.signal), /отменена/);
  assert.equal(calls, 1);
});
test('GitHub transport has no account credentials, refuses redirects and honors actual Electron close order', async () => {
  let request, options;
  const net = { request(value) { options = value; request = Object.assign(new EventEmitter(), { setHeader() {}, end() {}, abort() { this.aborted = true; } }); return request; } };
  const session = {}, signal = new AbortController().signal;
  const pending = G.getBytes(net, session, 'https://raw.githubusercontent.com/example/module/main/module.json', 100, signal);
  assert.equal(options.session, session); assert.equal(options.credentials, 'omit'); assert.equal(options.useSessionCookies, false);
  request.emit('login', {}, (...credentials) => assert.equal(credentials.length, 0)); request.emit('close');
  const response = Object.assign(new EventEmitter(), { statusCode: 200 }); request.emit('response', response); response.emit('data', Buffer.from('{}')); response.emit('end'); assert.equal((await pending).toString(), '{}');
  const redirected = G.getBytes(net, session, 'https://api.github.com/repos/example/module/commits/HEAD', 100, signal);
  request.emit('redirect', 302, 'GET', 'https://evil.test'); await assert.rejects(redirected, /Перенаправление/); assert.equal(request.aborted, true);
  assert.throws(() => G.getBytes(net, session, 'https://evil.test/code', 100, signal));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const M = require('../desktop/modules.cjs');
const A = require('../desktop/module-auth.cjs');
const { ModuleHost } = require('../desktop/module-host.cjs');
const base = require('../examples/modules/sandbox-demo/module.json');
function definition(scheme = 'aster-fixture-meeting') {
  return M.manifest({ ...base, permissions: [...base.permissions, 'network', 'meeting.launch', 'auth.session'], networkOrigins: ['https://rooms.example.test'], meetingLinks: { scheme, origins: ['https://rooms.example.test'] }, authentication: { type: 'browser-token', origins: ['https://rooms.example.test'], identityOrigins: ['https://identity.example.test'], capture: { storage: 'localStorage', key: 'login', tokenPath: ['session', 'access'], expiresAtPath: ['session', 'until'], rejectPath: ['guest'] }, authorization: { scheme: 'Session' } } });
}
test('SDK declares service-neutral login and app routing with no executable code in the manifest', () => {
  const d = definition(); assert.equal(d.authentication.type, 'browser-token');
  assert.equal(M.meetingTarget(d, 'https://rooms.example.test/room/abc'), 'aster-fixture-meeting://rooms.example.test/room/abc');
  for (const value of ['https://foreign.example.test/room', 'https://rooms.example.test/', 'https://rooms.example.test/../admin', 'file:///tmp/room', 'https://rooms.example.test/room#script', 'https://user:secret@rooms.example.test/room']) assert.equal(M.meetingTarget(d, value), null);
  for (const scheme of ['file', 'javascript', 'ms-excel', 'shell', 'https', 'vscode', '../evil']) assert.throws(() => definition(scheme));
  for (const patch of [{ type: 'vendor-session' }, { capture: { ...d.authentication.capture, tokenPath: ['constructor'] } }, { capture: { ...d.authentication.capture, script: 'arbitrary()' } }, { authorization: { scheme: 'Bearer\r\nInjected' } }, { origins: ['https://undeclared.example.test'] }, { path: '//evil.test' }]) assert.throws(() => M.manifest({ ...d, authentication: { ...d.authentication, ...patch } }));
});
test('host extracts only declared JSON token fields and never returns expired or anonymous sessions', () => {
  const d = definition(), expiresAt = new Date(Date.now() + 3600000).toISOString();
  for (const storage of ['localStorage', 'sessionStorage']) {
    const code = A.sessionScript({ ...d.authentication.capture, storage });
    const result = vm.runInNewContext(code, { window: { [storage]: { getItem(key) { assert.equal(key, 'login'); return JSON.stringify({ session: { access: 'fictional-token', until: expiresAt } }); } } } });
    assert.deepEqual(A.sessionValue(result, 'https://rooms.example.test'), { origin: 'https://rooms.example.test', token: 'fictional-token', expiresAt });
    assert.equal(vm.runInNewContext(code, { window: { [storage]: { getItem: () => JSON.stringify({ guest: true, session: { access: 'fictional', until: expiresAt } }) } } }), null);
  }
  assert.equal(A.sessionValue({ token: 'expired', expiresAt: '2000-01-01' }, 'https://rooms.example.test'), null);
  assert.equal(A.allowedNavigation('https://identity.example.test/login', d.authentication.identityOrigins), true);
  assert.equal(A.allowedNavigation('https://foreign.example.test', d.authentication.identityOrigins), false);
});
test('network broker uses the declared authentication scheme only in its isolated session', async () => {
  let request, options;
  const net = { request(value) { options = value; return request = Object.assign(new EventEmitter(), { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() {}, abort() {} }); } };
  for (const scheme of ['Bearer', 'Session']) {
    const d = definition(); d.authentication.authorization.scheme = scheme; const isolated = {};
    const pending = M.requestJSON(net, isolated, d, { url: 'https://rooms.example.test/room' }, new AbortController().signal, 'fictional-token');
    assert.equal(request.headers.Authorization, `${scheme} fictional-token`); assert.equal(options.session, isolated); assert.equal(options.credentials, 'omit');
    const response = Object.assign(new EventEmitter(), { statusCode: 200 }); request.emit('response', response); response.emit('data', Buffer.from('{}')); response.emit('end'); await pending;
  }
});

test('a separate sign-in start origin must already be declared and does not change the capture origin', () => {
  const d = definition();
  const next = M.manifest({ ...d, authentication: { ...d.authentication, startOrigin: 'https://identity.example.test' } });
  assert.equal(next.authentication.startOrigin, 'https://identity.example.test');
  assert.deepEqual(next.authentication.origins, d.authentication.origins);
  for (const startOrigin of ['http://identity.example.test', 'https://foreign.example.test', 'https://identity.example.test/path']) assert.throws(() => M.manifest({ ...d, authentication: { ...d.authentication, startOrigin } }));
});

test('corporate identity redirects allow HTTPS only and never grant broker access to the identity provider', async () => {
  const d = definition(); d.authentication.identityRedirects = true;
  const enabled = M.manifest(d);
  assert.match(M.permissionSummary(enabled.permissions, enabled.authentication), /Переходы в корпоративную систему входа/);
  assert.equal(A.allowedNavigation('https://company-idp.example.test/sso', [], false), false);
  assert.equal(A.allowedNavigation('https://company-idp.example.test/sso', [], true), true);
  for (const url of ['http://company-idp.example.test', 'https://user:secret@company-idp.example.test', 'file:///tmp/secret', 'javascript:alert(1)', 'ktalk://room', 'data:text/html,test']) assert.equal(A.allowedNavigation(url, [], true), false);
  for (const identityRedirects of [1, 'true', null]) assert.throws(() => M.manifest({ ...d, authentication: { ...d.authentication, identityRedirects } }));
  assert.throws(() => M.requestJSON({ request() { assert.fail('IdP must not receive broker requests'); } }, {}, enabled, { url: 'https://company-idp.example.test/data' }, new AbortController().signal));
  assert.deepEqual(enabled.networkOrigins, d.networkOrigins);
});
test('app join preserves normal HTTPS, handles only matching enabled routes and rejects stale grants', async () => {
  const d = definition(), opened = [], record = { id: d.id, enabled: true, digest: 'a' }, route = { ...d, ...record, error: false };
  let current = true, records = [record];
  const host = { current: () => { if (!current) throw new Error('retired'); return { sessionId: 'test' }; }, catalog: async () => [route], records: () => records, electron: { app: { getApplicationNameForProtocol: async () => 'Fictional Meeting App' }, dialog: { showMessageBox: async () => assert.fail('An explicit Join click already authorizes the configured application') }, shell: { openExternal: async url => opened.push(url) } } };
  await ModuleHost.prototype.openMeeting.call(host, 'https://unmatched.example.test/room'); assert.equal(opened.pop(), 'https://unmatched.example.test/room');
  await ModuleHost.prototype.openMeeting.call(host, 'https://rooms.example.test/room'); assert.equal(opened.pop(), 'aster-fixture-meeting://rooms.example.test/room');
  host.electron.app.getApplicationNameForProtocol = async () => '';
  await assert.rejects(ModuleHost.prototype.openMeeting.call(host, 'https://rooms.example.test/room'), /не установлено/); assert.equal(opened.length, 0);
  host.electron.app.getApplicationNameForProtocol = async () => 'Fictional Meeting App'; records = []; await assert.rejects(ModuleHost.prototype.openMeeting.call(host, 'https://rooms.example.test/room')); assert.equal(opened.length, 0);
  current = false; await assert.rejects(ModuleHost.prototype.openMeeting.call(host, 'https://rooms.example.test/room'));
});

test('optional origin grants are exact, account-scoped and cannot widen domain or move credentials', async () => {
  const d = definition(); d.optionalOrigins = [{ domain: 'example.test', includeSubdomains: true }];
  assert.equal(M.optionalOriginMatches(d, 'https://diy.example.test'), true);
  for (const url of ['http://diy.example.test', 'https://diy.example.test.evil.test', 'https://notexample.test', 'https://diy.example.test/path', 'https://diy.example.test:8443', 'https://user@diy.example.test']) assert.equal(M.optionalOriginMatches(d, url), false, url);
  assert.equal(d.networkOrigins.includes('https://diy.example.test'), false);
  const effective = M.effectiveManifest(d, ['https://diy.example.test']);
  assert.ok(effective.networkOrigins.includes('https://diy.example.test'));
  assert.ok(effective.authentication.origins.includes('https://diy.example.test'));
  assert.ok(effective.meetingLinks.origins.includes('https://diy.example.test'));
  assert.equal(d.networkOrigins.includes('https://diy.example.test'), false);
  assert.throws(() => M.effectiveManifest(d, ['https://foreign.invalid']));
  const active = { sessionId: 'one', signal: new AbortController().signal, records: [{ id: d.id, version: d.version, digest: 'a'.repeat(64), enabled: true, data: {} }] };
  let response = 0, prompts = 0;
  const host = new ModuleHost({ electron: { ipcMain: { handle() {}, on() {} }, dialog: { async showMessageBox(options) { prompts++; assert.match(options.detail, /https:\/\/diy.example.test/); return { response }; } } }, scope: () => active, save: async value => { active.records = value; } });
  const sender = { mainFrame: {} }, entry = { id: d.id, sessionId: 'one', retired: false, context: {}, calls: 0, bundle: { manifest: d } };
  host.senders.set(sender, { entry, role: 'view' });
  const event = { sender, senderFrame: sender.mainFrame };
  assert.equal((await host.receive(event, 'network.requestOrigin', { origin: 'https://diy.example.test' })).granted, false);
  assert.equal(active.records[0].originGrants, undefined);
  response = 1; await host.receive(event, 'network.requestOrigin', { origin: 'https://diy.example.test' });
  assert.deepEqual(active.records[0].originGrants, ['https://diy.example.test']);
  await host.receive(event, 'network.requestOrigin', { origin: 'https://diy.example.test' }); assert.equal(prompts, 2);
  await assert.rejects(host.receive(event, 'network.requestOrigin', { origin: 'https://foreign.invalid' }));
  active.records[0].auth = { origin: 'https://rooms.example.test', token: 'fictional', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await assert.rejects(host.receive(event, 'network.request', { url: 'https://diy.example.test/room', auth: 'session' }));
  active.sessionId = 'retired'; await assert.rejects(host.receive(event, 'network.requestOrigin', { origin: 'https://new.example.test' }));
});

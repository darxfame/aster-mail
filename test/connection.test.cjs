const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const P = require('../desktop/protocol.cjs');
const json = () => ({ status: 200, text: JSON.stringify({ Body: { ResponseCode: 'NoError' } }) });
function setup(transport) {
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'fictional', password: 'fictional' }, transport, async () => 'fresh');
  client.canary = 'old';
  const states = []; client.onConnectionState = value => states.push(value);
  return { client, states };
}

test('a later poll reconnects after network loss without replaying the failed request', async () => {
  let calls = 0;
  const { client, states } = setup(async () => { if (++calls === 1) throw Object.assign(new Error('Offline'), { connectionError: true }); return json(); });
  await assert.rejects(client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
  assert.equal(calls, 1);
  await client.call('GetFolder', P.request('GetFolder', {}));
  assert.deepEqual(states, ['reconnecting', 'connected']); assert.equal(calls, 2);
});

test('expired and HTML login sessions authenticate once and resume reads automatically', async () => {
  for (const expired of [{ status: 440, text: '' }, { status: 200, text: '<!doctype html><html>Login</html>' }]) {
    const calls = [];
    const { client, states } = setup(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/owa/')) return { status: 200, text: '' };
      return calls.length === 1 ? expired : json();
    });
    await client.call('GetFolder', P.request('GetFolder', {}));
    assert.equal(calls.length, 3); assert.equal(client.canary, 'fresh');
    assert.equal(states[0], 'reconnecting'); assert.equal(states.at(-1), 'connected');
  }
});

test('mutations never replay or authenticate after an expired response, even with retry requested', async () => {
  for (const action of ['CreateItem', 'UpdateItem', 'MoveItem', 'DeleteItem', 'SendItem']) {
    let calls = 0;
    const { client } = setup(async () => { calls++; return { status: 440, text: '' }; });
    await assert.rejects(client.call(action, P.request(action, {}), { retry: true }), /не повторялась/);
    assert.equal(calls, 1, action);
  }
});

test('a rejected login stops automatic credential attempts; temporary gateway failures remain recoverable', async () => {
  let calls = 0;
  const { client, states } = setup(async url => { calls++; return url.endsWith('/owa/') ? { status: 401, text: '' } : { status: 440, text: '' }; });
  await assert.rejects(client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
  const attempted = calls;
  await assert.rejects(client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
  assert.equal(calls, attempted); assert.equal(states.at(-1), 'auth-required');
  const gateway = setup(async () => ({ status: 503, text: '' }));
  await assert.rejects(gateway.client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
  assert.deepEqual(gateway.states, ['reconnecting']);
});

test('connection indicator rejects old accounts, suppresses only connection banners and preserves open forms', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const indicator = { dataset: {}, setAttribute() {} }, modal = { open: true }, banner = { hidden: true }, status = {};
  let loads = 0;
  const context = vm.createContext({ errorText: require('../src/errors.js').message, tr: value => value, state: { account: { sessionId: 'current' }, generation: 2, recoverView: 2 }, connectionState: { status: 'connected' },
    $: selector => ({ '#connection': indicator, '#modal': modal, '#error': banner, '#status': status })[selector],
    loadView: () => { loads++; }, openMessage: () => assert.fail('No read may replace an open form'),
  });
  vm.runInContext(source.slice(source.indexOf('function showError('), source.indexOf('function modal(')), context);
  context.receiveConnection({ sessionId: 'old', status: 'reconnecting' });
  assert.equal(context.connectionState.status, 'connected');
  context.showError(Object.assign(new Error('Offline'), { connectionError: true }));
  assert.equal(banner.hidden, true); assert.equal(indicator.dataset.state, 'reconnecting');
  context.receiveConnection({ sessionId: 'current', status: 'connected' }); assert.equal(loads, 0);
  modal.open = false; context.resumeConnectionReads(); assert.equal(loads, 1);
  context.state.recoverMessage = { id: 'mail', generation: 2 }; context.state.selected = { id: 'mail' };
  context.openMessage = (id, generation, options) => { assert.equal(id, 'mail'); assert.equal(generation, 2); assert.equal(options.markRead, false); };
  context.resumeConnectionReads(); assert.equal(context.state.recoverMessage, null);
  context.showError(new Error('Permission denied')); assert.equal(banner.hidden, false);
});
test('HTTP 500 and a truncated JSON response recover on a later poll without replaying the read', async () => {
  for (const failure of [{ status: 500, text: 'temporary gateway error' }, { status: 200, text: '{"Body":' }]) {
    let calls = 0;
    const { client, states } = setup(async () => ++calls === 1 ? failure : json());
    await assert.rejects(client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
    assert.equal(calls, 1); assert.notEqual(client.authRejected, true);
    await client.call('GetFolder', P.request('GetFolder', {}));
    assert.deepEqual(states, ['reconnecting', 'connected']); assert.equal(calls, 2);
  }
});
test('a gateway failure after login does not permanently reject credentials or repeat the login POST', async () => {
  let gets = 0, posts = 0;
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'fictional', password: 'fictional' }, async (url, options) => {
    if (url.includes('/service.svc')) return json();
    if (options.method === 'POST') { posts++; return { status: 200, text: '' }; }
    gets++;
    if (gets === 1) return { status: 200, text: '<form action="/owa/auth.owa"></form>' };
    if (gets === 2) return { status: 503, text: '<html>Gateway unavailable</html>' };
    return { status: 200, text: '"canary":"restored-token"' };
  }, async () => null);
  await assert.rejects(client.call('GetFolder', P.request('GetFolder', {})), { connectionError: true });
  assert.notEqual(client.authRejected, true); assert.equal(posts, 1);
  await client.call('GetFolder', P.request('GetFolder', {}));
  assert.equal(client.canary, 'restored-token'); assert.equal(posts, 1);
});
test('each inbox poll reasserts healthy state after a late foreground failure, even without a health transition', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const renderer = fs.readFileSync(require.resolve('../src/app.js'), 'utf8'), main = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const nodes = { '#connection': { dataset: {}, setAttribute() {} }, '#modal': { open: false }, '#error': { hidden: true }, '#status': {} };
  let loads = 0;
  const r = vm.createContext({ tr: value => value, state: { account: { sessionId: 'current' }, generation: 2, recoverView: 2 }, connectionState: { status: 'connected' },
    $: key => nodes[key], loadView: () => { loads++; }, errorText: value => value.message });
  vm.runInContext(renderer.slice(renderer.indexOf('function showError('), renderer.indexOf('function modal(')), r);
  r.showError(Object.assign(new Error('late network failure'), { connectionError: true }));
  assert.equal(r.connectionState.status, 'reconnecting');
  const client = { syncId: 'current', mailCache: { generation: 0 }, messages: async options => { assert.equal(options.refresh, true); return { items: [] }; }, inboxStatus: async () => null };
  const c = vm.createContext({ tr: value => value, client, connection: { client, health: 'connected' }, mailPolling: false, notificationSettings: { mail: false }, tracker: { newMail: () => [] },
    window: { isDestroyed: () => false, webContents: { send(channel, value) { if (channel === 'aster-connection') r.receiveConnection(value); } } } });
  vm.runInContext(main.slice(main.indexOf('function publishConnectionHealth('), main.indexOf('\nconst page =')), c);
  await c.pollMail(); assert.equal(r.connectionState.status, 'connected'); assert.equal(loads, 1);
  await c.pollMail(); assert.equal(loads, 1); assert.equal(nodes['#error'].hidden, true);
});

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
  const context = vm.createContext({ state: { account: { sessionId: 'current' }, generation: 2, recoverView: 2 }, connectionState: { status: 'connected' },
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

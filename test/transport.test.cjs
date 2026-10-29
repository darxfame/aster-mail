const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTransport } = require('../desktop/transport.cjs');
function setup() {
  const calls = [];
  const net = { request(options) {
    const req = new EventEmitter();
    Object.assign(req, { setHeader() {}, write() {}, end() {}, abort() { req.aborted = true; }, followRedirect() { req.followed = true; } });
    calls.push({ options, req }); return req;
  } };
  const credentials = { server: 'https://mail.example.com', username: 'alice', password: 'fictional' }, session = { account: 'alice' }, controller = new AbortController();
  return { calls, controller, credentials, transport: createTransport(net, credentials, session, controller.signal), net };
}
test('account transports bind credentials and sessions and cancel every outstanding request on logout', async () => {
  const { calls, controller, transport, net } = setup();
  const request = transport('https://mail.example.com/EWS/Exchange.asmx', { method: 'POST' });
  const second = transport('https://mail.example.com/owa/');
  createTransport(net, { server: 'https://mail.example.com', username: 'bob', password: 'other' }, { account: 'bob' }, new AbortController().signal);
  let login;
  calls[0].req.emit('login', { host: 'mail.example.com' }, (...args) => { login = args; });
  assert.deepEqual(login, ['alice', 'fictional']); assert.equal(calls[0].options.session.account, 'alice');
  controller.abort();
  await assert.rejects(request, /неизвестен/); await assert.rejects(second, /неизвестен/);
  assert.equal(calls.every(call => call.req.aborted), true);
  await assert.rejects(transport('https://mail.example.com/owa/'), /завершена/); assert.equal(calls.length, 2);
  calls[0].req.emit('login', { host: 'mail.example.com' }, (...args) => { assert.equal(args.length, 0); });
});
test('cross-origin requests, redirects and proxy credential challenges are blocked', async () => {
  const { calls, controller, transport } = setup();
  await assert.rejects(transport('http://mail.example.com/owa/')); assert.equal(calls.length, 0);
  const pending = transport('https://mail.example.com/owa/');
  calls[0].req.emit('login', { host: 'mail.example.com', isProxy: true }, (...args) => assert.equal(args.length, 0));
  calls[0].req.emit('redirect', 302, 'GET', 'https://evil.example/');
  await assert.rejects(pending, /другой сервер/); assert.equal(calls[0].req.followed, undefined);
  controller.abort();
});

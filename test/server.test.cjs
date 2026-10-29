const test = require('node:test');
const assert = require('node:assert/strict');
const { address, normalize } = require('../src/server.js');
const { OWAClient } = require('../desktop/owa.cjs');
test('HTTPS default adds scheme; custom URL preserves explicit port', () => {
  assert.deepEqual(address('https', 'mail.example.com/owa/'), { server: 'https://mail.example.com', allowHttp: false });
  assert.equal(address('custom', 'https://mail.example.com:8443/owa').server, 'https://mail.example.com:8443');
  assert.throws(() => address('http', 'mail.example.com'));
  assert.throws(() => address('custom', 'http://mail.example.com:8080'));
});
test('HTTP is rejected even with legacy explicit opt-in', () => {
  assert.throws(() => normalize('http://mail.example.com'));
  assert.throws(() => new OWAClient({ server: 'http://mail.example.com' }));
  assert.throws(() => normalize('http://mail.example.com', true));
  assert.throws(() => new OWAClient({ server: 'http://mail.example.com', allowHttp: true }));
  assert.throws(() => address('https', 'http://mail.example.com'));
});
test('reject credentials, query, fragment, unknown paths and protocols', () => {
  for (const url of ['ftp://mail.example.com', 'https://user:password@mail.example.com', 'https://mail.example.com?token=a', 'https://mail.example.com/#x', 'https://mail.example.com/other/owa', 'javascript:alert(1)']) assert.throws(() => address('custom', url));
  assert.throws(() => address('custom', 'mail.example.com'));
  assert.throws(() => address('https', ''));
  assert.throws(() => address('file', 'mail.example.com'));
});
test('HTTPS forms cannot downgrade or cross origin', () => {
  const { loginForm } = require('../desktop/owa.cjs');
  assert.equal(loginForm('<form action="/owa/auth.owa"></form>', 'https://mail.example.com').url, 'https://mail.example.com/owa/auth.owa');
  assert.throws(() => loginForm('<form action="https://mail.example.com/owa/auth.owa"></form>', 'http://mail.example.com'));
  assert.throws(() => loginForm('<form action="http://mail.example.com/owa/auth.owa"></form>', 'https://mail.example.com'));
});

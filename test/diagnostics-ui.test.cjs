const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('report escapes server text, enables rerun and ignores results after account navigation', async () => {
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  let finish;
  const target = { isConnected: true, textContent: '', innerHTML: '' };
  const form = { id: 'settings-form', elements: { diagnosticEmail: { value: '' } }, querySelector: () => target };
  const button = { closest: () => form, disabled: false };
  const context = vm.createContext({
    state: { account: {} }, modalSequence: 1, window: { aster: {} },
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    dateFormat: value => value,
    api: () => new Promise(resolve => { finish = resolve; }),
  });
  vm.runInContext(source.slice(source.indexOf('async function diagnoseProtocols('), source.indexOf('function refreshProtocolNote(')), context);
  const report = { server: 'https://mail.example.com', checkedAt: 'fictional-date', rows: [{ name: 'EWS', status: 'unknown', detail: '<script>untrusted</script>' }] };
  const first = context.diagnoseProtocols(button);
  assert.equal(button.disabled, true);
  finish(report); await first;
  assert.equal(button.disabled, false);
  assert.doesNotMatch(target.innerHTML, /<script>/);
  assert.match(target.innerHTML, /&lt;script&gt;/);
  assert.match(target.innerHTML, /textarea readonly/);
  target.innerHTML = '';
  const second = context.diagnoseProtocols(button);
  context.modalSequence++;
  finish(report); await second;
  assert.equal(target.innerHTML, '');
  assert.equal(button.disabled, false);
});

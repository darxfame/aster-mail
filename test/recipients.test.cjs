const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recipients.js');
function renderer(name, lookup) {
  const fs = require('node:fs'), vm = require('node:vm'), handlers = {}, timers = new Map();
  let timerId = 0, box;
  const input = {
    name, value: 'kept@example.com, Ирина, later@example.com', selectionStart: 22, isConnected: true,
    matches: selector => selector.includes(`#${input.form.id} input[name="${name}"]`),
    closest: () => ({ classList: { add() {} } }), after: value => { box = value; },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() { document.activeElement = input; },
    setSelectionRange(value) { this.selectionStart = value; }, dispatchEvent(event) { handlers[event.type]?.({ target: input }); },
  };
  input.selectionStart = input.value.indexOf(', later');
  input.form = { id: ['attendees', 'optionalAttendees'].includes(name) ? 'event-form' : 'compose-form', elements: { [name]: input } };
  const document = { activeElement: input, addEventListener: (type, callback) => { handlers[type] = callback; },
    createElement: () => ({ hidden: true, innerHTML: '', setAttribute() {}, addEventListener() {},
      querySelectorAll() { return [...this.innerHTML.matchAll(/role="option" id="([^"]+)"/g)].map(match => ({ id: match[1], setAttribute() {}, scrollIntoView() {} })); } }),
  };
  const state = { demo: false, contacts: [], account: { server: 'https://mail.example.com', username: 'alice', sessionId: 'session-a' } };
  const context = vm.createContext({ errorText: require('../src/errors.js').message, window: {}, state, document, HTMLInputElement: Object, Event: class { constructor(type) { this.type = type; } },
    tr: value => value, esc: value => value, avatar: () => '', colleagues: () => [], api: lookup,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/recipients.js'), 'utf8'), context);
  return { input, state, handlers, get box() { return box; }, search: () => handlers.input({ target: input }),
    flush: async () => { const pending = [...timers.values()]; timers.clear(); await Promise.all(pending.map(callback => callback())); } };
}
test('live meeting and compose suggestions call Exchange and preserve surrounding recipients', async () => {
  for (const name of ['attendees', 'optionalAttendees', 'to', 'cc', 'bcc']) {
    const calls = [];
    const h = renderer(name, async (operation, data) => {
      calls.push([operation, data.query]);
      return { items: [{ name: 'Ирина', email: 'irina@example.com', source: 'directory' }] };
    });
    h.search(); await h.flush();
    assert.deepEqual(calls, [['contacts', 'Ирина']]);
    assert.match(h.box.innerHTML, /irina@example.com/);
    assert.doesNotMatch(h.box.innerHTML, /is not a function/);
    const key = value => h.handlers.keydown({ target: h.input, key: value, preventDefault() {} });
    key('ArrowDown'); key('Enter');
    assert.equal(h.input.value, 'kept@example.com, irina@example.com, later@example.com');
  }
});
test('directory suggestions discard responses overtaken by typing or account-session changes', async () => {
  for (const change of ['query', 'session']) {
    let complete;
    const h = renderer('attendees', () => new Promise(resolve => { complete = resolve; }));
    h.search(); const pending = h.flush();
    if (change === 'query') { h.input.value = 'Другое'; h.input.selectionStart = h.input.value.length; h.search(); }
    else h.state.account.sessionId = 'session-b';
    complete({ items: [{ name: 'Old result', email: 'old@example.com' }] }); await pending;
    assert.doesNotMatch(h.box.innerHTML, /old@example.com/);
  }
});
test('participant suggestions match Latin email prefixes and Russian names and exclude duplicates', () => {
  const anna = { name: 'Анна', email: 'anna@example.com' };
  assert.deepEqual(R.matches([anna, anna, { name: 'Ann', email: 'bad-address' }], 'an'), [anna]);
  assert.deepEqual(R.matches([anna], 'ан'), [anna]);
  assert.deepEqual(R.matches([anna], 'AN', ['ANNA@example.com']), []);
});
test('choosing a participant replaces only the current address and preserves surrounding recipients', () => {
  assert.deepEqual(R.replace('an', 2, 'anna@example.com'), { value: 'anna@example.com, ', cursor: 18 });
  const value = 'first@example.com, an, last@example.com';
  const cursor = value.indexOf('an,') + 2;
  assert.equal(R.token(value, cursor).query, 'an');
  assert.equal(R.replace(value, cursor, 'anna@example.com').value, 'first@example.com, anna@example.com, last@example.com');
});
test('reply-all retains other original To recipients and never adds blind recipients', () => {
  const message = {
    from: { email: ' boss@example.com ' },
    to: [{ email: 'ME@example.com' }, { email: 'anna@example.com' }, { email: 'BOSS@example.com' }, { email: 'ANNA@example.com' }, { email: 'me@login.example.com' }],
    cc: [{ email: 'Anna@example.com' }, { email: 'bob@example.com' }, { email: 'me@example.com' }],
    bcc: [{ email: 'private@example.com' }],
  };
  assert.deepEqual(R.reply(message, ['me@example.com', 'me@login.example.com'], true), { to: 'boss@example.com, anna@example.com', cc: 'bob@example.com' });
  assert.deepEqual(R.reply(message, ['me@example.com', 'me@login.example.com']), { to: 'boss@example.com', cc: '' });
});

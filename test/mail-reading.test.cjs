const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('../desktop/protocol.cjs');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
const functions = source.slice(source.indexOf('function applyMessageRead('), source.indexOf('function rsvpButtons('));
function reader(api) {
  const state = { generation: 1, folder: 'inbox', query: '', filter: 'unread', offset: 2, folders: [{ id: 'inbox-id', wellKnown: 'inbox', unread: 2 }], messages: ['a', 'b'].map(id => ({ id, read: false, changeKey: `key-${id}`, parentId: 'inbox-id' })) };
  const errors = [];
  const context = vm.createContext({ tr: value => value, state, api, messageOpenSequence: 0, readingMessages: new Map(), ref: m => ({ id: m.id, changeKey: m.changeKey }), document: { body: { classList: { add() {} } } }, $: () => ({}), icon: () => '', renderMessages() {}, renderReader() {}, renderSidebar() {}, showError: error => errors.push(error.message) });
  vm.runInContext(functions, context);
  return { context, state, errors, open: id => context.openMessage(id) };
}
test('opening mail marks the actual message read before loading meeting status', async () => {
  const calls = [];
  const r = reader(async (operation, data) => { calls.push([operation, data]); return operation === 'message' ? { ...r.state.messages.find(m => m.id === data.id), meeting: { id: 'meeting' } } : operation === 'change' ? { changeKey: 'fresh' } : {}; });
  await r.open('a');
  assert.deepEqual(calls.map(c => c[0]), ['message', 'change', 'event']);
  assert.equal(calls[1][1].ref.id, 'a'); assert.equal(calls[1][1].value, true);
  assert.equal(r.state.messages[0].read, true); assert.equal(r.state.folders[0].unread, 1);
  assert.equal(r.state.offset, 1); assert.equal(r.state.selected.changeKey, 'fresh');
});
test('switching while a meeting loads never marks the newly selected message with the old reference', async () => {
  let finishEvent; const changes = [];
  const r = reader(async (operation, data) => {
    if (operation === 'message') return { ...r.state.messages.find(m => m.id === data.id), ...(data.id === 'a' ? { meeting: { id: 'meeting' } } : {}) };
    if (operation === 'event') return new Promise(resolve => { finishEvent = resolve; });
    changes.push(data.ref.id); return { changeKey: `updated-${data.ref.id}` };
  });
  const first = r.open('a');
  while (!finishEvent) await new Promise(resolve => setImmediate(resolve));
  await r.open('b'); finishEvent({ response: 'Accept' }); await first;
  assert.deepEqual(changes, ['a', 'b']); assert.equal(r.state.selected.id, 'b'); assert.equal(r.state.selected.read, true); assert.equal(r.state.folders[0].unread, 0);
});
test('failed mark-read preserves unread state and count and reports the failure', async () => {
  const r = reader(async (operation, data) => { if (operation === 'message') return { ...r.state.messages.find(m => m.id === data.id) }; throw new Error('offline'); });
  await r.open('a'); assert.equal(r.state.messages[0].read, false); assert.equal(r.state.folders[0].unread, 2); assert.match(r.errors[0], /не удалось отметить/);
});
test('server-read detail reconciles stale list and folder count without another mutation', async () => {
  const r = reader(async operation => { assert.equal(operation, 'message'); return { id: 'a', read: true }; });
  await r.open('a'); assert.equal(r.state.messages[0].read, true); assert.equal(r.state.folders[0].unread, 1);
  r.context.applyMessageRead(r.state.selected, true, 'inbox'); assert.equal(r.state.folders[0].unread, 1);
  r.context.applyMessageRead(r.state.selected, false, 'inbox'); assert.equal(r.state.folders[0].unread, 2);
});
test('unread folder requests filter on server before paging, including older unread items', () => {
  const body = P.findItems('inbox', 50, 'unread').Body;
  assert.equal(body.ViewFilter, 'Unread'); assert.equal(body.Paging.Offset, 50);
  assert.equal(P.findItems('inbox', 0, 'flagged').Body.ViewFilter, 'Flagged');
  assert.throws(() => P.findItems('inbox', 0, 'invalid'));
});
test('signature numeric CR and LF entities become line breaks without decoding HTML markup in plain text', () => {
  const entry = (key, value) => `<DictionaryEntry><DictionaryKey><Value>${key}</Value></DictionaryKey><DictionaryValue><Value>${P.escapeXML(value)}</Value></DictionaryValue></DictionaryEntry>`;
  const raw = `&#xD;\nС уважением,&#xD;\nАнна.&#13;\n&#xD;\nПочта: example@example.com&#xA;Моб.: +7`;
  const data = P.parseSOAP(`<Envelope><ResponseCode>NoError</ResponseCode><Dictionary>${entry('signaturetext', raw)}${entry('signaturehtml', '<div>Анна</div>&#xD;\n<p>Почта</p>')}</Dictionary></Envelope>`);
  const result = P.signatureFromConfiguration(data);
  assert.equal(result.text, '\nС уважением,\nАнна.\n\nПочта: example@example.com\nМоб.: +7');
  assert.equal(result.html, '<div>Анна</div>\n<p>Почта</p>');
});
test('late mail rendering after navigating to contacts ignores removed DOM nodes', () => {
  const context = vm.createContext({ tr: value => value, state: { view: 'contacts', selected: { id: 'a' } }, $: () => null });
  for (const [start, end] of [['function renderMail()', 'function renderMessages()'], ['function renderMessages()', 'function applyMessageRead('], ['function renderReader()', 'function calendarEvents(']]) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    vm.runInContext(source.slice(from, to), context);
  }
  assert.doesNotThrow(() => context.renderMessages()); assert.doesNotThrow(() => context.renderReader()); assert.doesNotThrow(() => context.renderMail());
});

test('rapid keyboard-style opens discard an older detail response without marking it read', async () => {
  const pending = new Map(), changes = [];
  const r = reader(async (operation, data) => {
    if (operation === 'message') return new Promise(resolve => pending.set(data.id, resolve));
    changes.push(data.ref.id); return { changeKey: 'fresh' };
  });
  const first = r.open('a'), second = r.open('b');
  pending.get('b')({ ...r.state.messages[1], text: 'latest' }); await second;
  pending.get('a')({ ...r.state.messages[0], text: 'stale' }); await first;
  assert.equal(r.state.selected.id, 'b'); assert.equal(r.state.selected.text, 'latest');
  assert.deepEqual(changes, ['b']); assert.equal(r.state.messages[0].read, false);
});

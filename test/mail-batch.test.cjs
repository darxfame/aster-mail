const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const { run } = require('../desktop/mail-batch.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const rendererSource = fs.readFileSync(require.resolve('../src/mail-batch.js'), 'utf8');

function fixture(failure) {
  const calls = [];
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'fictional', password: 'fictional' }, async (url, options) => {
    assert.equal(new URL(url).pathname, '/owa/service.svc', 'bulk operations must not use EWS');
    const request = JSON.parse(options.body); calls.push({ action: options.headers.Action, request });
    if (failure && calls.length === 2) return failure();
    return { status: 200, text: JSON.stringify({ Body: { ResponseCode: 'NoError', Items: [{ ItemId: { Id: `mail-${calls.length}`, ChangeKey: 'fresh' } }] } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  return { client, calls };
}
const refs = [{ id: 'mail-1', changeKey: 'old-1' }, { id: 'mail-2', changeKey: 'old-2' }, { id: 'mail-3', changeKey: 'old-3' }];

test('bulk reads use OWA UpdateItem, suppress receipts and return each confirmed key', async () => {
  for (const action of ['read', 'unread']) {
    const { client, calls } = fixture();
    const result = await client.mailBatch({ action, refs });
    assert.equal(result.results.length, 3);
    assert.ok(result.results.every(row => row.status === 'done' && row.changeKey === 'fresh'));
    for (const [index, call] of calls.entries()) {
      assert.equal(call.action, 'UpdateItem');
      assert.equal(call.request.Body.SuppressReadReceipts, true);
      assert.equal(call.request.Body.ItemChanges[0].ItemId.Id, refs[index].id);
      assert.equal(call.request.Body.ItemChanges[0].Updates[0].Item.IsRead, action === 'read');
    }
  }
});
test('archive, trash and folder moves are non-permanent OWA MoveItem operations', async () => {
  for (const [action, folder] of [['archive', 'archive'], ['trash', 'deleteditems'], ['move', 'custom-folder']]) {
    const { client, calls } = fixture();
    await client.mailBatch({ action, refs, folder });
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.action === 'MoveItem' && call.request.Body.ToFolderId.BaseFolderId.Id === folder));
  }
});
test('an unconfirmed write stops the group, reports the processed prefix and never retries', async () => {
  for (const failure of [() => { throw new Error('Network lost'); }, () => ({ status: 401, text: '' }), () => ({ status: 200, text: 'invalid response' })]) {
    const { client, calls } = fixture(failure);
    const result = await client.mailBatch({ action: 'trash', refs });
    assert.equal(calls.length, 2);
    assert.deepEqual(result.results.map(row => row.status), ['done', 'uncertain', 'skipped']);
    assert.match(result.results[1].error, /Проверьте это письмо в OWA/);
    assert.equal(calls[0].request.Body.ItemIds[0].Id, 'mail-1');
    assert.equal(calls[1].request.Body.ItemIds[0].Id, 'mail-2');
  }
});
test('invalid, duplicate and oversized selections never dispatch an operation', async () => {
  const client = { change: () => assert.fail('Invalid write'), move: () => assert.fail('Invalid write') };
  for (const data of [{ action: 'trash', refs: [] }, { action: 'trash', refs: [refs[0], refs[0]] }, { action: 'purge', refs }, { action: 'trash', refs: [{ id: '' }] }, { action: 'trash', refs: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) }, { action: 'move', refs, folder: '' }]) {
    await assert.rejects(run(client, data));
  }
});

test('selection is limited to loaded messages, never marks them read, and clears on navigation', () => {
  const handlers = {}, notes = [];
  const state = { account: { sessionId: 'account' }, view: 'mail', folder: 'inbox', filter: 'all', query: '' };
  const items = Array.from({ length: 125 }, (_, i) => ({ id: String(i), read: false }));
  const context = vm.createContext({ tr: value => value, state, document: { addEventListener: (name, handler) => { handlers[name] = handler; } }, renderMessages() {}, filteredMessages: () => items, toast: note => notes.push(note) });
  vm.runInContext(rendererSource, context);
  context.syncMailSelection(items);
  handlers.change({ target: { checked: true, hasAttribute: name => name === 'data-mail-select-all' } });
  assert.equal(vm.runInContext('mailSelection.size', context), 100);
  assert.ok(items.every(item => item.read === false));
  assert.match(notes[0], /100 загруженных/);
  context.syncMailSelection(items.slice(0, 2));
  assert.equal(vm.runInContext('mailSelection.size', context), 2);
  state.folder = 'sentitems'; context.syncMailSelection(items);
  assert.equal(vm.runInContext('mailSelection.size', context), 0);
});

test('partial results clear selection, show counts and cannot accidentally repeat the unconfirmed write', async () => {
  const errors = []; let calls = 0, loads = 0;
  const messages = refs.map(ref => ({ ...ref }));
  const state = { account: { sessionId: 'account' }, view: 'mail', folder: 'inbox', filter: 'all', query: '', generation: 1, messages };
  const context = vm.createContext({ tr: value => value,
    state, document: { addEventListener() {} }, readingMessages: new Map(),
    renderMessages() {}, ref: message => ({ id: message.id, changeKey: message.changeKey }),
    showError: error => errors.push(error.message), toast() {}, loadView: async () => { loads++; },
    api: async (operation, data) => { calls++; assert.equal(operation, 'mailBatch'); assert.equal(data.action, 'trash'); return { results: [{ id: 'mail-1', status: 'done' }, { id: 'mail-2', status: 'uncertain', error: 'Check OWA' }, { id: 'mail-3', status: 'skipped' }] }; },
  });
  vm.runInContext(rendererSource, context);
  context.syncMailSelection(messages);
  vm.runInContext('for (const message of state.messages) mailSelection.add(message.id)', context);
  await context.runMailBatch('trash');
  assert.equal(calls, 1); assert.equal(loads, 1);
  assert.match(errors.at(-1), /Выполнено: 1 из 3.*Не подтверждено: 1.*Не обработано: 1/);
  assert.equal(vm.runInContext('mailSelection.size', context), 0);
  await context.runMailBatch('trash'); assert.equal(calls, 1);
});

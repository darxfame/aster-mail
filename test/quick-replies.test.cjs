const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalize } = require('../src/quick-replies.js');
const reply = { id: 'fictional-1', title: '  Receipt  ', body: 'Received <b>literally</b>\nThank you.' };
test('quick replies validate bounded plain text and unique IDs without interpreting markup', () => {
  assert.deepEqual(normalize([reply]), [{ ...reply, title: 'Receipt' }]);
  for (const value of [null, {}, [reply, reply], [{ ...reply, id: '../escape' }], [{ ...reply, body: '' }], [{ ...reply, title: 'x'.repeat(101) }], [{ ...reply, body: 'x'.repeat(8001) }], Array.from({ length: 31 }, (_, i) => ({ ...reply, id: `id-${i}` })), Array.from({ length: 10 }, (_, i) => ({ ...reply, id: `id-${i}`, body: 'x'.repeat(8000) }))]) assert.throws(() => normalize(value));
});
function fixture() {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (['quickReplies', 'saveQuickReplies'].includes(operation))");
  const end = source.indexOf("      if (['autoReplies', 'saveAutoReplies'].includes(operation))", start);
  const client = {}, calls = [];
  const store = { data: { values: { 'aster-signature': 'Keep me' }, quickReplies: [] }, async save(patch, guard) { guard(); calls.push(patch); if (store.fail) throw new Error('Storage unavailable'); store.data = { ...store.data, ...patch }; guard(); } };
  const context = vm.createContext({ require: name => name === '../src/quick-replies.js' ? { normalize } : require(name), client, activeClient: client, localStore: store, tr: value => value });
  return { client, calls, store, context, async call(operation, data = {}) { context.operation = operation; context.data = data; return vm.runInContext(`(async()=>{${source.slice(start, end)}})()`, context); } };
}
test('quick reply IPC saves only the dedicated encrypted profile field and rejects stale or concurrent edits', async () => {
  const f = fixture(); assert.equal((await f.call('quickReplies')).value.revision, 0);
  const saved = await f.call('saveQuickReplies', { revision: 0, replies: [reply] });
  assert.equal(saved.value.revision, 1); assert.equal(f.store.data.values['aster-signature'], 'Keep me');
  assert.deepEqual(Object.keys(f.calls[0]), ['quickReplies']);
  await assert.rejects(f.call('saveQuickReplies', { revision: 0, replies: [] }), /другом окне/);
  f.client.quickRepliesSaving = true;
  await assert.rejects(f.call('saveQuickReplies', { revision: 1, replies: [] }), /другом окне/);
  f.client.quickRepliesSaving = false;
  await assert.rejects(f.call('saveQuickReplies', { revision: 1, replies: [reply, reply] }));
  assert.equal(f.calls.length, 1);
});
test('failed and retired quick reply saves retain the previous list and release the write lock', async () => {
  const f = fixture(); f.store.fail = true;
  await assert.rejects(f.call('saveQuickReplies', { revision: 0, replies: [reply] }), /Storage/);
  assert.equal(f.client.quickRepliesSaving, false); assert.deepEqual(f.store.data.quickReplies, []);
  f.store.fail = false; f.context.client = {};
  await assert.rejects(f.call('saveQuickReplies', { revision: 0, replies: [reply] }), /Сессия/);
  assert.deepEqual(f.store.data.quickReplies, []);
});

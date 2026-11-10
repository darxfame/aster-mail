const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/contact-history.js');
const { read } = require('../desktop/contact-history.cjs');
const P = require('../desktop/protocol.cjs');
const email = 'anna@example.com';
function xml(id, patch = {}) {
  const value = { from: 'other@example.com', to: [], cc: [], draft: false, subject: 'Fictional subject', ...patch };
  const mailbox = email => `<t:Mailbox><t:Name>Fictional person</t:Name><t:EmailAddress>${P.escapeXML(email)}</t:EmailAddress></t:Mailbox>`;
  return `<t:Message><t:ItemId Id="${P.escapeXML(id)}" ChangeKey="fresh"/><t:ParentFolderId Id="folder"/><t:Subject>${P.escapeXML(value.subject)}</t:Subject><t:DateTimeReceived>2026-11-01T10:00:00Z</t:DateTimeReceived><t:IsDraft>${value.draft}</t:IsDraft><t:From>${mailbox(value.from)}</t:From><t:ToRecipients>${value.to.map(mailbox).join('')}</t:ToRecipients><t:CcRecipients>${value.cc.map(mailbox).join('')}</t:CcRecipients></t:Message>`;
}
function fixture() {
  const f = { active: true, calls: [], page: { items: [{ id: 'one' }], more: false }, headers: xml('one', { from: email }) };
  f.guard = () => { if (!f.active) throw new Error('Retired session'); };
  f.client = { search: async data => { f.calls.push({ operation: 'search', data }); if (f.afterSearch) await f.afterSearch(); return f.page; },
    ews: async (operation, payload) => { f.calls.push({ operation, payload }); if (f.fail) throw new Error('Metadata unavailable'); return P.parseSOAP(P.soap(`<m:GetItemResponse><m:ResponseMessages><m:GetItemResponseMessage><m:ResponseCode>NoError</m:ResponseCode><m:Items>${f.headers}</m:Items></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>`), 'GetItem'); } };
  return f;
}
test('contact history builds bounded AQS and matches exact SMTP From/To/Cc, excluding aliases, Bcc and drafts', () => {
  assert.equal(H.query('ANNA@example.com'), '(from:"anna@example.com" OR to:"anna@example.com" OR cc:"anna@example.com")');
  for (const invalid of ['', 'Anna', 'a"@example.com', 'a\\b@example.com', '*@example.com', 'x'.repeat(255)]) assert.throws(() => H.query(invalid));
  const base = { id: 'one', from: { email: ' ANNA@example.com ' }, subject: 'Safe subject', html: 'Do not return', body: 'Do not return', bcc: [{ email: email }] };
  assert.equal(H.summary(base, email).role, 'from'); assert.equal(H.summary({ ...base, from: {}, to: [{ email }] }, email).role, 'to');
  assert.equal(H.summary({ ...base, from: {}, cc: [{ email }] }, email).role, 'cc');
  for (const from of [{ name: email, email: 'another@example.com' }, { email: 'anna@example.com.other' }, { email: 'other-anna@example.com' }, { email: 'old-anna@example.com' }, {}]) assert.equal(H.summary({ ...base, from }, email), null);
  assert.equal(H.summary({ ...base, isDraft: true }, email), null);
  assert.doesNotMatch(JSON.stringify(H.summary(base, email)), /Do not return|bcc/);
});
test('history verifies full metadata without body/attachments/Bcc, preserves server order and returns only safe summaries', async () => {
  const f = fixture(); f.page = { items: [{ id: 'cc' }, { id: 'false-positive' }, { id: 'to' }, { id: 'draft' }], more: true };
  f.headers = xml('to', { to: [email] }) + xml('draft', { from: email, draft: true }) + xml('cc', { cc: [email] }) + xml('false-positive', { from: 'anna@example.com.other', subject: email });
  const result = await read(f.client, { email }, f.guard);
  assert.deepEqual(result.items.map(item => item.id), ['cc', 'to']); assert.equal(result.nextOffset, 4); assert.equal(result.more, true);
  assert.equal(f.calls[0].data.query, H.query(email)); assert.equal(f.calls[0].data.kind, 'mail');
  assert.match(f.calls[1].payload, /message:ToRecipients/); assert.match(f.calls[1].payload, /message:CcRecipients/);
  assert.doesNotMatch(f.calls[1].payload, /item:(?:Body|MimeContent|Attachments)|message:BccRecipients/);
  assert.deepEqual(Object.keys(result.items[0]), ['id', 'changeKey', 'parentId', 'subject', 'date', 'role', 'from']);
});
test('paging uses raw candidate counts rather than filtered rows and caps viewing at 200 results', async () => {
  const f = fixture(); f.page = { items: [{ id: 'one' }], more: true, nextOffset: 150 };
  let result = await read(f.client, { email, offset: 100 }, f.guard); assert.equal(result.nextOffset, 150); assert.equal(result.more, true);
  f.page.nextOffset = 200; result = await read(f.client, { email, offset: 150 }, f.guard); assert.equal(result.more, false); assert.equal(result.limited, true);
  for (const offset of [-1, 200, '50', 0.5]) await assert.rejects(read(f.client, { email, offset }, f.guard));
  f.page = { items: [], more: true }; await assert.rejects(read(f.client, { email }, f.guard), /продвинулся/);
  f.page = { items: [], more: false }; assert.equal((await read(f.client, { email }, f.guard)).items.length, 0);
});
test('retired sessions never start metadata reads, failures are surfaced and missing originals never become empty-success pages', async () => {
  const f = fixture(); f.afterSearch = async () => { f.active = false; };
  await assert.rejects(read(f.client, { email }, f.guard), /Retired/); assert.equal(f.calls.length, 1);
  f.active = true; f.afterSearch = null; f.fail = true; await assert.rejects(read(f.client, { email }, f.guard), /unavailable/);
  f.fail = false; f.headers = ''; await assert.rejects(read(f.client, { email }, f.guard), /недоступны/);
  f.headers = xml('one', { from: email }); assert.equal((await read(f.client, { email }, f.guard)).items.length, 1);
  assert.ok(f.calls.every(call => ['search', 'GetItem'].includes(call.operation)));
});
test('waiting reply count events are account-scoped and only update the badge without replacing open content', () => {
  const source = fs.readFileSync(require.resolve('../src/waiting-replies-ui.js'), 'utf8');
  const badge = {}, button = { setAttribute(name, value) { this[name] = value; } };
  const state = { demo: false, account: { sessionId: 'alice' } };
  const context = vm.createContext({ state, tr: value => value, document: { querySelector: selector => selector === '[data-waiting-count]' ? badge : button } });
  vm.runInContext(source.slice(0, source.indexOf('function isSentMessage(')), context);
  context.receiveWaitingReplyCount({ sessionId: 'alice', count: 2 }); assert.equal(state.waitingRepliesCount, 2); assert.equal(badge.hidden, false);
  for (const event of [{ sessionId: 'bob', count: 9 }, { sessionId: 'alice', count: -1 }, { sessionId: 'alice', count: 31 }]) context.receiveWaitingReplyCount(event);
  assert.equal(state.waitingRepliesCount, 2); context.receiveWaitingReplyCount({ sessionId: 'alice', count: 0 }); assert.equal(badge.hidden, true);
  state.demo = true; context.receiveWaitingReplyCount({ sessionId: 'alice', count: 4 }); assert.equal(state.waitingRepliesCount, 0);
});

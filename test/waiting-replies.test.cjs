const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/waiting-replies.js');
const P = require('../desktop/protocol.cjs');
const { WaitingReplies, metadata } = require('../desktop/waiting-replies.cjs');
const sentAt = '2026-01-01T10:00:00Z', due = '2099-01-02T10:00:00Z';
const entry = { id: 'sent&one', internetId: '<original@example.com>', sentAt, due, replyId: null };
const reply = { id: 'reply', date: '2026-01-02T10:00:00Z', inReplyTo: entry.internetId, references: '', isFromMe: false, isDraft: false, itemClass: 'IPM.Note', automated: false };
function messageXML(id, patch = {}) {
  const data = { ParentFolderId: '', Subject: 'Fictional secret subject', InternetMessageId: `<${id}@example.com>`, DateTimeSent: sentAt, DateTimeReceived: reply.date, IsDraft: 'false', IsFromMe: 'false', ItemClass: 'IPM.Note', InReplyTo: '', References: '', ...patch };
  return `<t:Message><t:ItemId Id="${P.escapeXML(id)}"/><t:ParentFolderId Id="${P.escapeXML(data.ParentFolderId)}"/>${Object.entries(data).filter(([key]) => key !== 'ParentFolderId').map(([key, value]) => `<t:${key}>${P.escapeXML(value)}</t:${key}>`).join('')}</t:Message>`;
}
function response(items) { return P.parseSOAP(P.soap(`<m:GetItemResponse><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items>${items}</m:Items></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>`), 'GetItem'); }
function fixture() {
  const f = { active: true, calls: [], writes: [], items: new Map([[entry.id, { ParentFolderId: 'sent-folder', InternetMessageId: entry.internetId, IsFromMe: 'true' }]]) };
  f.guard = () => { if (!f.active) throw new Error('Retired session'); };
  f.store = { data: { values: { 'aster-keep': 'keep' }, waitingReplies: [] }, async save(patch, guard) { guard(); if (f.storageError) throw new Error('Storage failed'); f.writes.push(patch); f.store.data = { ...f.store.data, ...patch }; guard(); } };
  f.client = { async ews(action, xml) {
    f.calls.push({ action, xml });
    if (f.networkError) throw new Error('Network failed');
    if (action === 'GetFolder') return { Folder: { FolderId: { '@_Id': 'sent-folder' } } };
    const ids = [...xml.matchAll(/<t:ItemId Id="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
    if (f.beforeResponse) { const callback = f.beforeResponse; f.beforeResponse = null; await callback(); }
    return response(ids.filter(id => f.items.has(id)).map(id => messageXML(id, f.items.get(id))).join(''));
  } };
  f.waiting = new WaitingReplies(f.client, f.store, f.guard);
  return f;
}
test('reply waits strip payloads, normalize instants and validate bounded identifiers and dates', () => {
  const normalized = W.normalize([{ ...entry, subject: 'Do not store', body: 'Do not store' }]);
  assert.deepEqual(Object.keys(normalized[0]), ['id', 'internetId', 'sentAt', 'due', 'replyId']);
  assert.equal(normalized[0].sentAt, '2026-01-01T10:00:00.000Z');
  for (const data of [null, [entry, entry], [{ ...entry, id: '' }], [{ ...entry, id: '\n' }], [{ ...entry, due: 'invalid' }], [{ ...entry, replyId: false }], Array.from({ length: 31 }, (_, index) => ({ ...entry, id: String(index) }))]) assert.throws(() => W.normalize(data));
});
test('reply detection requires exact header IDs, a later incoming human message and never subject matching', () => {
  assert.equal(W.replyTo(entry, reply), true);
  assert.equal(W.replyTo(entry, { ...reply, inReplyTo: '', references: '<ancestor@example.com>\r\n <original@example.com>' }), true);
  for (const patch of [{ inReplyTo: '', subject: 'Re: same subject' }, { inReplyTo: '<original@example.com.extra>' }, { inReplyTo: '<Original@example.com>' }, { date: sentAt }, { date: '' }, { isFromMe: true }, { isFromMe: null }, { isDraft: true }, { automated: true }, { itemClass: 'REPORT.IPM.Note.IPNRN' }, { itemClass: 'IPM.Schedule.Meeting.Resp.Pos' }]) assert.equal(W.replyTo(entry, { ...reply, ...patch }), false);
  assert.equal(W.replyTo({ ...entry, replyId: 'already-detected' }, reply), false);
});
test('tracking verifies the actual sent folder, writes only identifiers/deadlines, and preserves unrelated settings', async () => {
  const f = fixture(); await f.waiting.track({ id: entry.id, due, subject: 'Ignored' });
  assert.deepEqual(f.waiting.entries(), W.normalize([entry]));
  assert.equal(f.store.data.values['aster-keep'], 'keep');
  assert.deepEqual(Object.keys(f.writes[0]), ['waitingReplies']);
  assert.doesNotMatch(JSON.stringify(f.writes), /subject|body|Fictional/);
  assert.ok(f.calls.every(call => ['GetItem', 'GetFolder'].includes(call.action)));
  assert.match(f.calls[0].xml, /Id="sent&amp;one"/);
  assert.doesNotMatch(f.calls[0].xml, /FieldURI="item:(?:Body|MimeContent|Attachments)"/);
  await f.waiting.remove({ id: entry.id }); assert.deepEqual(f.waiting.entries(), []);
  for (const patch of [{ ParentFolderId: 'inbox' }, { IsDraft: 'true' }, { InternetMessageId: '' }]) {
    f.items.set(entry.id, patch); await assert.rejects(f.waiting.track({ id: entry.id, due }));
  }
  await assert.rejects(f.waiting.track({ id: entry.id, due: sentAt }));
});
test('scan batches fresh metadata, caches successful reads only and preserves detected replies through due-date edits', async () => {
  const f = fixture(); await f.waiting.track({ id: entry.id, due });
  f.items.set('reply', { InReplyTo: entry.internetId });
  f.networkError = true; await f.waiting.scan([{ id: 'reply' }]);
  assert.match(f.waiting.error, /Network/); assert.equal(f.waiting.entries()[0].replyId, null); assert.equal(f.waiting.cache.size, 0);
  f.networkError = false; await f.waiting.scan([{ id: 'reply' }]);
  assert.equal(f.waiting.entries()[0].replyId, 'reply'); assert.equal(f.waiting.error, '');
  const count = f.calls.length; await f.waiting.scan([{ id: 'reply' }]); assert.equal(f.calls.length, count);
  await f.waiting.track({ id: entry.id, due: '2099-02-01T10:00:00Z' });
  assert.equal(f.waiting.entries()[0].replyId, 'reply');
  const listed = await f.waiting.list(); assert.equal(listed.entries[0].subject, 'Fictional secret subject'); assert.doesNotMatch(JSON.stringify(f.writes), /Fictional/);
});
test('a removal overtaking a scan is not resurrected, and retired sessions and failed writes cannot update state', async () => {
  const f = fixture(); await f.waiting.track({ id: entry.id, due });
  f.items.set('reply', { InReplyTo: entry.internetId });
  f.beforeResponse = () => f.waiting.remove({ id: entry.id });
  await f.waiting.scan([{ id: 'reply' }]); assert.deepEqual(f.waiting.entries(), []);
  f.storageError = true; await assert.rejects(f.waiting.track({ id: entry.id, due }), /Storage failed/); assert.deepEqual(f.waiting.entries(), []);
  f.storageError = false; await f.waiting.track({ id: entry.id, due });
  f.beforeResponse = async () => { f.active = false; };
  await f.waiting.scan([{ id: 'late' }]); assert.equal(f.store.data.waitingReplies[0].replyId, null);
  await assert.rejects(f.waiting.remove({ id: entry.id }), /Retired/);
});
test('missing metadata is reported and does not claim a successful check or erase waits', async () => {
  const f = fixture(); await f.waiting.track({ id: entry.id, due });
  await f.waiting.scan([{ id: 'missing' }]); assert.ok(f.waiting.error); assert.equal(f.waiting.checkedAt, null);
  f.items.delete(entry.id); const list = await f.waiting.list(); assert.ok(list.sourceError); assert.equal(list.entries.length, 1);
  await f.waiting.remove({ id: entry.id }); assert.equal(f.waiting.entries().length, 0);
});
test('automatic reply headers are read without requesting mail bodies', async () => {
  const f = fixture(); f.client.ews = async () => response(messageXML('auto', { InReplyTo: entry.internetId }).replace('</t:Message>', '<t:InternetMessageHeaders><t:InternetMessageHeader HeaderName="Auto-Submitted">auto-replied</t:InternetMessageHeader></t:InternetMessageHeaders></t:Message>'));
  assert.equal((await metadata(f.client, ['auto']))[0].automated, true);
});

test('metadata cache stays bounded, concurrent scans share one read, and failed local saves preserve pending waits', async () => {
  const f = fixture(); await f.waiting.track({ id: entry.id, due });
  for (let page = 0; page < 3; page++) {
    const ids = Array.from({ length: 50 }, (_, index) => `page-${page}-${index}`);
    for (const id of ids) f.items.set(id, {});
    await f.waiting.scan(ids.map(id => ({ id })));
  }
  assert.equal(f.waiting.cache.size, 100);
  f.items.set('new-reply', { InReplyTo: entry.internetId });
  let release;
  f.beforeResponse = () => new Promise(resolve => { release = resolve; });
  const first = f.waiting.scan([{ id: 'new-reply' }]), second = f.waiting.scan([{ id: 'new-reply' }]);
  assert.equal(first, second); f.storageError = true; release(); await first;
  assert.equal(f.waiting.entries()[0].replyId, null); assert.match(f.waiting.error, /Storage/);
  f.storageError = false; await f.waiting.scan([{ id: 'new-reply' }]);
  assert.equal(f.waiting.entries()[0].replyId, 'new-reply');
  const other = fixture(); assert.deepEqual(other.waiting.entries(), []); assert.equal(other.waiting.cache.size, 0);
});

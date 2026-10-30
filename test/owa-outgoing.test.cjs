const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const outgoing = require('../desktop/owa-outgoing.cjs');
const values = { to: 'anna@example.com', cc: '', bcc: 'hidden@example.com', subject: 'Subject <&>', body: 'Hello', bodyHtml: '<p>Hello <b>team</b></p>' };
function fixture(handler = () => undefined) {
  const calls = [];
  const raw = { ItemId: { Id: 'draft', ChangeKey: 'fresh' }, ItemClass: 'IPM.Note', IsDraft: true, Subject: '', Body: { BodyType: 'HTML', Value: '<p>Full</p>' }, ToRecipients: [{ EmailAddress: 'anna@example.com' }] };
  const client = new OWAClient({ server: 'https://mail.example.com' }, async (url, options) => {
    assert.ok(url.startsWith('https://mail.example.com/owa/service.svc?'));
    assert.ok(!url.includes('/EWS/'));
    const action = options.headers.Action, payload = JSON.parse(options.body);
    calls.push({ action, payload });
    const response = await handler(action, payload, raw);
    if (response) return response;
    return { status: 200, text: JSON.stringify({ Body: { ResponseMessages: { Items: [{ ResponseCode: 'NoError', ...(action === 'GetItem' ? { Items: [raw] } : ['CreateItem', 'UpdateItem'].includes(action) ? { Items: [{ ItemId: { Id: 'draft', ChangeKey: action === 'UpdateItem' ? 'updated' : 'created' } }] } : {}) }] } } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  return { client, calls, raw };
}
test('fixture-only JSON creation preserves HTML and explicit To/Cc/Bcc, and returns a saved draft reference', async () => {
  const f = fixture();
  assert.deepEqual(await outgoing.create(f.client, values, true), { id: 'draft', changeKey: 'created' });
  const { Body, Header } = f.calls[0].payload;
  assert.equal(Body.MessageDisposition, 'SaveOnly'); assert.equal(Body.SavedItemFolderId.BaseFolderId.Id, 'drafts');
  assert.equal(Body.Items[0].Body.Value, values.bodyHtml); assert.equal(Body.Items[0].Body.BodyType, 'HTML');
  assert.equal(Body.Items[0].Subject, values.subject); assert.deepEqual(Body.Items[0].CcRecipients, []);
  assert.equal(Body.Items[0].BccRecipients[0].EmailAddress, 'hidden@example.com');
  assert.equal(Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC');
  const g = fixture(); await outgoing.create(g.client, { ...values, bodyHtml: undefined });
  assert.equal(g.calls[0].payload.Body.Items[0].Body.BodyType, 'Text');
  assert.equal(g.calls[0].payload.Body.MessageDisposition, 'SendAndSaveCopy');
});
test('reply, reply-all and forward read a fresh source version and retain explicit recipient overrides', async () => {
  for (const [kind, type] of [['reply', 'ReplyToItem'], ['reply-all', 'ReplyAllToItem'], ['forward', 'ForwardItem']]) {
    const f = fixture(); await outgoing.create(f.client, { ...values, kind, reference: { id: 'draft', changeKey: 'old' } });
    assert.deepEqual(f.calls.map(c => c.action), ['GetItem', 'CreateItem']);
    assert.equal(f.calls[0].payload.Body.ItemIds[0].ChangeKey, undefined);
    const item = f.calls[1].payload.Body.Items[0];
    assert.equal(item.__type, `${type}:#Exchange`); assert.equal(item.ReferenceItemId.ChangeKey, 'fresh');
    assert.equal(item.NewBodyContent.Value, values.bodyHtml); assert.equal(item.Body, undefined); assert.deepEqual(item.CcRecipients, []);
  }
});
test('draft read/save/send stays on one item and sends with the updated version, never creates a replacement', async () => {
  const f = fixture();
  const draft = await outgoing.edit(f.client, { action: 'read', ref: { id: 'draft' } });
  assert.equal(draft.html, '<p>Full</p>'); assert.equal(draft.subject, ''); assert.equal(draft.ref.changeKey, 'fresh');
  f.calls.length = 0;
  await outgoing.edit(f.client, { ...values, action: 'send', ref: draft.ref });
  assert.deepEqual(f.calls.map(c => c.action), ['GetItem', 'UpdateItem', 'SendItem']);
  const update = f.calls[1].payload.Body;
  assert.equal(update.ConflictResolution, 'NeverOverwrite'); assert.equal(update.ItemChanges[0].ItemId.ChangeKey, 'fresh');
  assert.equal(update.ItemChanges[0].Updates.find(u => u.Path.FieldURI === 'CcRecipients').__type, 'DeleteItemField:#Exchange');
  assert.equal(f.calls[2].payload.Body.ItemIds[0].ChangeKey, 'updated');
  const g = fixture(); assert.deepEqual(await outgoing.edit(g.client, { ...values, action: 'save', ref: { id: 'draft', changeKey: 'fresh' } }), { id: 'draft', changeKey: 'updated' });
});
test('stale versions, incomplete bodies, attachments and unresolved recipients stop before any write', async () => {
  for (const modify of [raw => { raw.IsDraft = false; }, raw => { raw.ItemClass = 'IPM.Schedule.Meeting.Request'; }, raw => { raw.Body.IsTruncated = true; }, raw => { delete raw.Body; }, raw => { raw.HasAttachments = true; }, raw => { raw.ToRecipients = [{ RoutingType: 'EX', EmailAddress: '/o=legacy' }]; }, raw => { raw.ItemId.ChangeKey = 'other'; }]) {
    const f = fixture(); modify(f.raw);
    await assert.rejects(outgoing.edit(f.client, { ...values, action: 'send', ref: { id: 'draft', changeKey: 'fresh' } }));
    assert.deepEqual(f.calls.map(c => c.action), ['GetItem']);
  }
  for (const change of [{ attachments: [{ name: 'x', content: 'eA==' }] }, { bodyHtml: '<img src="cid:signature">' }, { to: 'invalid' }, { kind: 'invalid' }]) {
    const f = fixture(); await assert.rejects(outgoing.create(f.client, { ...values, ...change })); assert.equal(f.calls.length, 0);
  }
});
test('lost replies, expired sessions and malformed write responses never retry or fall back to EWS', async () => {
  for (const action of ['CreateItem', 'UpdateItem', 'SendItem']) {
    for (const failure of ['lost', 'expired', 'malformed', 'no-key', 'wrong-id']) {
      const f = fixture((operation, _payload, raw) => {
        if (operation !== action) return;
        if (failure === 'lost') throw new Error('Lost response');
        if (failure === 'expired') return { status: 440, text: '' };
        if (failure === 'malformed') return { status: 200, text: '{}' };
        if (failure === 'no-key' && action !== 'SendItem') return { status: 200, text: JSON.stringify({ Body: { ResponseCode: 'NoError', Items: [{ ItemId: { Id: 'draft' } }] } }) };
        if (failure === 'wrong-id' && action === 'UpdateItem') return { status: 200, text: JSON.stringify({ Body: { ResponseCode: 'NoError', Items: [{ ItemId: { Id: 'other', ChangeKey: 'new' } }] } }) };
        throw new Error('Unconfirmed write');
      });
      const pending = action === 'CreateItem' ? outgoing.create(f.client, values, true) : outgoing.edit(f.client, { ...values, action: 'send', ref: { id: 'draft', changeKey: 'fresh' } });
      await assert.rejects(pending, /Проверьте «Черновики» и «Отправленные».*Операция не повторялась/s);
      assert.equal(f.calls.filter(c => c.action === action).length, 1); assert.equal(f.calls.at(-1).action, action);
    }
  }
});

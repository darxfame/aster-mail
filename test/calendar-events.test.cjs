const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../desktop/calendar-events.cjs');
const E = require('../src/events.js');
const P = require('../desktop/protocol.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const source = { id: 'event-1', changeKey: 'key-1', title: 'Project', start: '2026-10-29T08:00:00Z', end: '2026-10-29T09:00:00Z', isOrganizer: true, cancelled: false, attendees: [] };
function xmlItem({ key = 'key-1', response = 'Organizer', type = 'Occurrence' } = {}) {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetItemResponse><ResponseMessages><GetItemResponseMessage><ResponseCode>NoError</ResponseCode><Items><CalendarItem><ItemId Id="event-1" ChangeKey="${key}"/><Subject>Project</Subject><Body BodyType="HTML">&lt;p&gt;Description&lt;/p&gt;</Body><Start>2026-10-29T08:00:00Z</Start><End>2026-10-29T09:00:00Z</End><MyResponseType>${response}</MyResponseType><IsRecurring>true</IsRecurring><CalendarItemType>${type}</CalendarItemType><EffectiveRights><Modify>true</Modify></EffectiveRights></CalendarItem></Items></GetItemResponseMessage></ResponseMessages></GetItemResponse></s:Body></s:Envelope>`;
}
const success = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><Response><ResponseCode>NoError</ResponseCode></Response></s:Body></s:Envelope>';
function client(handler) { const calls = []; const value = new OWAClient({ server: 'https://mail.example.com' }, async (url, options) => { calls.push({ url, options }); return handler(options, calls); }, async () => 'canary'); value.canary = 'canary'; return { value, calls }; }
test('calendar colors follow organizer and response rather than position', () => {
  assert.equal(E.kind({ response: 'Organizer' }), 'organized');
  assert.equal(E.kind({ response: 'Accept' }), 'accepted');
  assert.equal(E.kind({ response: 'Unknown' }), 'pending');
  assert.equal(E.kind({ response: 'Decline' }), 'declined');
  assert.equal(E.kind({ response: 'Declined' }), 'declined');
  assert.equal(E.kind({ response: 'Tentative' }), 'pending');
  assert.equal(E.kind({ response: 'Organizer', cancelled: true }), 'cancelled');
  assert.equal(E.kind({ isOrganizer: false, organizer: { email: 'me@example.com' } }, 'me@example.com'), 'pending');
  assert.equal(E.joinURL({ html: '<a href="https://company.ktalk.ru/room?a=1&amp;b=2">Call</a>' }), 'https://company.ktalk.ru/room?a=1&b=2');
  assert.equal(E.joinURL({ location: 'https://user:password@example.com' }), null);
});
test('calendar details normalize HTML, attachments, recurrence and participant responses', () => {
  const item = P.walk(P.parseSOAP(xmlItem()), o => o.ItemId?.['@_Id'])[0];
  const e = C.normalize({ ...item, Attachments: { FileAttachment: { AttachmentId: { '@_Id': 'image' }, Name: 'photo.png', Size: '100', ContentType: 'image/png', ContentId: 'photo' } }, RequiredAttendees: { Attendee: { Mailbox: { Name: 'Anna', EmailAddress: 'anna@example.com' }, ResponseType: 'Accept' } } });
  assert.equal(e.html, '<p>Description</p>'); assert.equal(e.body, ''); assert.equal(e.recurring, true); assert.equal(e.isOrganizer, true); assert.equal(e.canModify, true);
  assert.equal(e.attachments[0].id, 'image'); assert.equal(e.attendees[0].response, 'Accept');
});
test('single and series identifiers are explicit and invalid scope is rejected', () => {
  assert.match(C.getSOAP(source, 'single'), /<t:ItemId Id="event-1"/);
  assert.match(C.getSOAP(source, 'series'), /<t:RecurringMasterItemId OccurrenceId="event-1"/);
  assert.throws(() => C.getSOAP(source, 'other'));
});
test('organizer updates use conflict protection, send updates and preserve unedited fields', () => {
  const xml = C.updateSOAP(source, { location: 'New <room>', attendees: 'new@example.com' });
  assert.match(xml, /ConflictResolution="NeverOverwrite"/); assert.match(xml, /SendToAllAndSaveCopy/); assert.match(xml, /New &lt;room&gt;/);
  assert.doesNotMatch(xml, /item:Body|Attachments|Recurrence/);
  assert.match(C.updateSOAP(source, { attendees: '' }), /DeleteItemField/);
  assert.throws(() => C.updateSOAP(source, { start: 'invalid' }));
});
test('invitees may update only reminders and never send organizer updates', () => {
  const invited = { ...source, isOrganizer: false };
  assert.match(C.updateSOAP(invited, { reminder: 5, reminderSet: true }), /SendToNone/);
  assert.throws(() => C.updateSOAP(invited, { sensitivity: 'Private' }), /напоминание/);
  assert.throws(() => C.updateSOAP(invited, { showAs: 'Free' }), /напоминание/);
  assert.throws(() => C.updateSOAP(invited, { start: '2026-10-29T12:00:00Z' }), /организатор/);
  assert.throws(() => C.updateSOAP({ ...source, cancelled: true }, { title: 'New' }));
  assert.throws(() => C.updateSOAP(source, { reminder: -1 }));
  assert.throws(() => C.updateSOAP(source, { html: '<script>' }));
});
test('forward and reply use the actual calendar reference; forwarding permissions are enforced', () => {
  const xml = C.messageSOAP(source, { kind: 'forward', to: 'person@example.com', body: '<Comment>' });
  assert.match(xml, /<t:ForwardItem>/); assert.match(xml, /ReferenceItemId Id="event-1"/); assert.match(xml, /&lt;Comment&gt;/);
  assert.match(C.messageSOAP(source, { kind: 'reply-all', body: 'Reply' }), /ReplyAllToItem/);
  assert.throws(() => C.messageSOAP({ ...source, forwardingAllowed: false }, { kind: 'forward', to: 'person@example.com', body: '' }));
});
test('stale edits never mutate the server, and failed update or forward is never repeated', async () => {
  const stale = client(async () => ({ status: 200, text: xmlItem({ key: 'new-key' }) }));
  await assert.rejects(stale.value.updateEvent({ ref: source, scope: 'single', expectedChangeKey: 'old-key', changes: { title: 'New' } }), /изменилась/);
  assert.equal(stale.calls.length, 1);
  for (const operation of ['updateEvent', 'eventMessage']) {
    const mock = client(async (_options, calls) => { if (calls.length === 1) return { status: 200, text: xmlItem() }; throw new Error('Lost response'); });
    await assert.rejects(mock.value[operation]({ ref: source, scope: 'single', expectedChangeKey: 'key-1', changes: { title: 'New' }, kind: 'forward', to: 'a@example.com', body: '' }), /Lost response/);
    assert.equal(mock.calls.length, 2);
  }
});
test('a series edit resolves the recurring master rather than updating only the selected occurrence', async () => {
  const mock = client(async (_options, calls) => ({ status: 200, text: calls.length === 1 ? xmlItem() : calls.length === 2 ? xmlItem({ key: 'master-key', type: 'RecurringMaster' }).replace('Id="event-1"', 'Id="master"') : success }));
  await mock.value.updateEvent({ ref: source, scope: 'series', expectedChangeKey: 'master-key', changes: { location: 'Room' } });
  assert.match(mock.calls[1].options.body, /RecurringMasterItemId/);
  assert.match(mock.calls[2].options.body, /ItemId Id="master" ChangeKey="master-key"/);
});
test('image previews reject SVG, mismatched MIME and oversized images', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
  assert.match(C.imageData({ ContentType: 'image/png', Content: png }), /^data:image\/png;base64,/);
  assert.throws(() => C.imageData({ ContentType: 'image/svg+xml', Content: Buffer.from('<svg/>').toString('base64') }));
  assert.throws(() => C.imageData({ ContentType: 'image/png', Content: Buffer.from('<html>').toString('base64') }));
  assert.throws(() => C.imageData({ ContentType: 'image/png', Content: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }));
});

test('event attachment previews return a decoded byte budget alongside validated raster data', async () => {
  const { OWAClient } = require('../desktop/owa.cjs');
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
  const client = new OWAClient({ server: 'https://mail.example.com' });
  client.eventDetails = async () => ({ attachments: [{ id: 'image', size: 100, type: 'image/png' }] });
  client.ews = async () => ({ FileAttachment: { ContentType: 'image/png', Content: pixel } });
  const result = await client.eventImage({ ref: { id: 'event' }, id: 'image' });
  assert.equal(result.decodedBytes, 4); assert.equal(result.dataURL, `data:image/png;base64,${pixel}`);
});

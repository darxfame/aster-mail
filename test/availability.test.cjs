const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../desktop/availability.cjs');
const S = require('../src/availability.js');
const { OWAClient } = require('../desktop/owa.cjs');
const start = '2026-10-29T06:00:00.000Z', end = '2026-10-29T07:00:00.000Z';
const data = emails => ({ emails, start, end });
const row = merged => ({ ResponseMessage: { ResponseCode: 'NoError' }, FreeBusyView: { MergedFreeBusy: merged } });
test('OWA availability uses concrete request types, UTC wall time and 15-minute slots', () => {
  const q = A.query(data('a@example.com,A@example.com'));
  assert.deepEqual(q.emails, ['a@example.com']);
  assert.equal(q.payload.request.__type, 'GetUserAvailabilityInternalJsonRequest:#Exchange');
  assert.equal(q.payload.request.Body.__type, 'GetUserAvailabilityRequest:#Exchange');
  assert.equal(q.payload.request.Body.MailboxDataArray[0].__type, 'MailboxData:#Exchange');
  assert.equal(q.payload.request.Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC');
  assert.equal(q.payload.request.Body.FreeBusyViewOptions.TimeWindow.StartTime, '2026-10-29T06:00:00');
  assert.throws(() => A.query(data('bad<@example.com')));
  assert.throws(() => A.query({ ...data('a@example.com'), end: '2026-11-20' }));
});
test('missing mailbox data never shifts subsequent colleagues onto another calendar', () => {
  const q = A.query(data('a@example.com,b@example.com,c@example.com'));
  const result = A.normalize({ Body: { FreeBusyResponseArray: [row('0000'), { ResponseMessage: { ResponseCode: 'ErrorNoFreeBusyAccess' } }, row('2222')] } }, q);
  assert.equal(S.status(result[0], Date.parse(start)).kind, 'free');
  assert.ok(result[1].error);
  assert.equal(result[2].email, 'c@example.com');
  assert.equal(S.status(result[2], Date.parse(start)).kind, 'busy');
  assert.ok(A.normalize({ Body: [row('0000'), row('2222')] }, q).every(p => p.error));
});
test('unknown and truncated slots are not free; busy status spans consecutive blocks', () => {
  const q = A.query(data('a@example.com'));
  const [p] = A.normalize({ Body: [row('2240')] }, q);
  assert.equal(S.status(p, Date.parse(start)).until, '2026-10-29T06:45:00.000Z');
  assert.equal(S.status(p, Date.parse(start) + 30 * 60000).kind, 'unknown');
  assert.equal(S.available([p], start, end), false);
  assert.equal(S.status(p, Date.parse(end)).kind, 'unknown');
  assert.ok(A.normalize({ Body: [row('00')] }, q)[0].error);
});
test('suggestions require every participant to be free for the whole duration', () => {
  const day = new Date(2026, 9, 29), from = new Date(day), to = new Date(day); to.setDate(to.getDate() + 1);
  const busyStart = new Date(day); busyStart.setHours(9, 30);
  const busyEnd = new Date(day); busyEnd.setHours(10, 30);
  const people = [{ start: from.toISOString(), end: to.toISOString(), blocks: [{ start: busyStart.toISOString(), end: busyEnd.toISOString(), type: 'Busy' }] }];
  const suggestions = S.suggestions(people, day, 60, +day);
  assert.equal(new Date(suggestions[0]).getHours(), 10);
  assert.equal(new Date(suggestions[0]).getMinutes(), 30);
  assert.deepEqual(S.suggestions([...people, { ...people[0], error: 'No access' }], day, 60, +day), []);
});
test('availability uses authenticated OWA transport and retains per-recipient errors', async () => {
  let captured;
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'DOMAIN\\user' }, async (url, options) => {
    captured = { url, options };
    return { status: 200, text: JSON.stringify({ Body: { FreeBusyResponseArray: [row('0000'), { ResponseMessage: { ResponseCode: 'ErrorNoFreeBusyAccess' } }] } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  const result = await client.availability(data('a@example.com,b@example.com'));
  assert.match(captured.url, /action=GetUserAvailabilityInternal/);
  assert.equal(captured.options.headers['X-OWA-CANARY'], 'canary');
  const request = JSON.parse(decodeURIComponent(captured.options.headers['X-OWA-UrlPostData']));
  assert.equal(captured.options.body, undefined);
  assert.equal(request.request.Body.MailboxDataArray.length, 2);
  assert.equal(result[0].error, undefined);
  assert.equal(result[1].error, 'ErrorNoFreeBusyAccess');
});

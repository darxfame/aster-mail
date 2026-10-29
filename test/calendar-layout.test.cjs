const test = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../src/calendar-layout.js');
const C = require('../desktop/calendar-events.cjs');
const E = require('../src/events.js');
const { OWAClient } = require('../desktop/owa.cjs');
const event = (id, start, end) => ({ id, start: `2026-10-29T${start}:00+03:00`, end: `2026-10-29T${end}:00+03:00` });
test('overlapping events occupy adjacent columns; touching events reuse the full width', () => {
  const result = layout([event('long', '10:00', '12:00'), event('short', '10:30', '11:00'), event('third', '10:45', '11:30'), event('later', '12:00', '13:00')], '2026-10-29T09:00:00+03:00', 'Europe/Moscow');
  const [long, short, third, later] = result.entries;
  assert.equal(long.top, 600); assert.equal(long.height, 120);
  assert.equal(long.columns, 3); assert.equal(short.columns, 3); assert.equal(third.columns, 3);
  assert.equal(later.width, 1); assert.equal(later.left, 0);
  for (const a of result.entries) for (const b of result.entries) {
    if (a === b || a.top >= b.bottom || b.top >= a.bottom) continue;
    assert.ok(a.left + a.width <= b.left + 1e-9 || b.left + b.width <= a.left + 1e-9);
  }
});
test('midnight events are clipped, all-day events stay outside the grid, and DST retains real duration', () => {
  const result = layout([{ id: 'overnight', start: '2026-10-28T23:00:00+03:00', end: '2026-10-29T01:00:00+03:00' }, { ...event('all-day', '00:00', '23:59'), allDay: true }], '2026-10-29T09:00:00+03:00', 'Europe/Moscow');
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].top, 0); assert.equal(result.entries[0].height, 60);
  const dst = layout([{ id: 'DST', start: '2026-03-08T01:30:00-05:00', end: '2026-03-08T03:30:00-04:00' }], '2026-03-08T12:00:00Z', 'America/New_York');
  assert.equal(dst.dayMinutes, 1380); assert.equal(dst.entries[0].height, 60);
});
test('accepted meetings are green before opening; opening reads details without accepting', async () => {
  const listItem = C.normalize({ ItemId: { Id: 'accepted' }, Subject: 'Already accepted', Start: '2026-10-29T07:00:00Z', End: '2026-10-29T07:30:00Z', ResponseType: 'Accept', SeriesId: 'recurring' });
  for (const [response, state] of [['Accept', 'accepted'], ['Tentative', 'tentative'], ['Decline', 'declined'], ['Organizer', 'organizer'], ['Unknown', 'notResponded']]) assert.equal(E.responseState({ response }), state);
  assert.equal(E.kind(listItem), 'accepted'); assert.equal(listItem.recurring, true);
  const pending = C.normalize({ ItemId: { Id: 'pending' }, ResponseType: 'Unknown' });
  assert.equal(E.kind(pending), 'pending');
  const calls = [];
  const client = new OWAClient({ server: 'https://mail.example.com' }, async (_url, options) => {
    calls.push(options);
    return { status: 200, text: '<Envelope><Body><GetItemResponse><ResponseCode>NoError</ResponseCode><Items><CalendarItem><ItemId Id="accepted" ChangeKey="version"/><Subject>Already accepted</Subject><Start>2026-10-29T07:00:00Z</Start><End>2026-10-29T07:30:00Z</End><MyResponseType>Accept</MyResponseType></CalendarItem></Items></GetItemResponse></Body></Envelope>' };
  }, async () => 'canary'); client.canary = 'canary';
  const detail = await client.eventDetails({ id: 'accepted' });
  assert.equal(E.kind(detail), E.kind(listItem));
  assert.equal(calls.length, 1); assert.match(calls[0].body, /<m:GetItem>/);
  assert.doesNotMatch(calls[0].body, /AcceptItem|CreateItem|UpdateItem/);
});

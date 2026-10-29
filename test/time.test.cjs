const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const T = require('../src/time.js');
const C = require('../src/calendar.js');
const { preferences } = require('../desktop/notifications.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const { pollingRange, upcomingMeetings, countdown } = require('../desktop/meetings.cjs');

test('Exchange dates honor explicit offsets, UTC context for bare times and .NET milliseconds in every PC zone', () => {
  const value = '2026-10-29T07:00:00.000Z';
  assert.equal(T.exchange('2026-10-29T10:00:00+03:00'), value);
  assert.equal(T.exchange('2026-10-29T07:00:00'), value);
  assert.equal(T.exchange(`/Date(${Date.parse(value)}+0300)/`), value);
  assert.equal(T.exchange('invalid'), null);
  for (const TZ of ['Europe/Moscow', 'America/Chicago', 'Asia/Tokyo']) {
    const output = execFileSync(process.execPath, ['-e', "process.stdout.write(require('./src/time.js').exchange('2026-10-29T07:00:00'))"], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(output, value);
  }
});
test('time zone defaults follow the PC, explicit settings validate and input round-trips in half-hour zones', () => {
  assert.equal(preferences().timeZone, 'system');
  assert.equal(preferences({ timeZone: 'No/SuchZone' }).timeZone, 'system');
  assert.equal(T.zone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(preferences({ timeZone: 'Asia/Tokyo' }).timeZone, 'Asia/Tokyo');
  for (const zone of ['Europe/Moscow', 'America/New_York', 'Asia/Kolkata', 'Australia/Adelaide']) {
    const instant = T.fromWall('2026-10-29T10:00', zone);
    assert.equal(T.wall(instant, zone), '2026-10-29T10:00:00');
  }
  assert.throws(() => T.fromWall('2026-03-08T02:30', 'America/New_York'), /пропущено/);
  assert.throws(() => T.fromWall('2026-11-01T01:30', 'America/New_York'), /повторяется/);
  assert.throws(() => T.fromWall('2026-02-30T10:00', 'UTC'));
});
test('calendar days and month navigation use the chosen zone across midnight and DST', () => {
  const zone = 'America/New_York', date = '2026-03-08T12:00:00Z';
  const range = C.range(date, 'day', zone);
  assert.equal(range.start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal((range.end - range.start) / 3600000, 23);
  assert.equal(T.wall(C.move(range.start, 'day', 1, zone), zone), '2026-03-09T00:00:00');
  const tokyo = C.range('2026-10-28T23:30:00Z', 'day', 'Asia/Tokyo');
  assert.equal(tokyo.start.toISOString(), '2026-10-28T15:00:00.000Z');
  assert.equal(T.wall(C.move(tokyo.start, 'month', 1, 'Asia/Tokyo'), 'Asia/Tokyo'), '2026-11-01T00:00:00');
});
test('at 09:50 the widget picks today’s recurring 10:00 meeting before 16:00 and tomorrow', async () => {
  const now = Date.parse('2026-10-29T09:50:00+03:00'), range = pollingRange(new Date(now));
  let payload;
  const client = new OWAClient({ server: 'https://mail.example.com' }, async (_url, options) => {
    payload = JSON.parse(decodeURIComponent(options.headers['X-OWA-UrlPostData']));
    return { status: 200, text: JSON.stringify({ Body: { Items: [
      { ItemId: { Id: 'evening' }, Start: '2026-10-29T16:00:00+03:00', End: '2026-10-29T17:00:00+03:00' },
      { ItemId: { Id: 'tomorrow' }, Start: '2026-10-30T10:00:00+03:00', End: '2026-10-30T10:30:00+03:00' },
      { ItemId: { Id: 'today' }, Start: '2026-10-29T10:00:00+03:00', End: '2026-10-29T10:30:00+03:00', CalendarItemType: 'Occurrence', ResponseType: 'Accept' },
    ] } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  const events = await client.calendar(range), next = upcomingMeetings(events, now)[0];
  assert.equal(next.id, 'today'); assert.equal(next.response, 'Accept'); assert.equal(next.recurring, true);
  assert.equal(countdown(next, now).label, 'Через 10 мин');
  assert.equal(payload.Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC');
  assert.equal(payload.Body.RangeStart, range.start.slice(0, 19));
  assert.ok(Date.parse(`${payload.Body.RangeStart}Z`) < now - 12 * 3600000);
  for (const zone of ['Europe/Moscow', 'Asia/Tokyo', 'America/New_York']) {
    assert.ok(T.format(next.start, { hour: '2-digit' }, zone));
    assert.equal(countdown(next, now).label, 'Через 10 мин');
  }
});

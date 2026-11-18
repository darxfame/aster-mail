const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../src/day-summary.js');
const T = require('../src/time.js');
const C = require('../src/calendar.js');
const schedule = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
const event = (start, end, extra = {}) => ({ id: start, start: `2026-11-13T${start}:00Z`, end: `2026-11-13T${end}:00Z`, showAs: 'Busy', ...extra });
test('overlaps count once, clip to working hours and find only remaining free time', () => {
  const result = D.day([event('08:00', '10:00'), event('09:30', '11:00'), event('16:30', '18:00')], Date.parse('2026-11-13T10:00Z'), 'UTC', schedule);
  assert.equal(result.scheduledMinutes, 150); assert.equal(result.percent, 31);
  assert.equal(result.longest.start, Date.parse('2026-11-13T11:00Z')); assert.equal(result.longest.end, Date.parse('2026-11-13T16:30Z'));
  assert.equal(result.next.start, Date.parse('2026-11-13T11:00Z'));
  assert.equal(result.next.end, Date.parse('2026-11-13T16:30Z'));
  assert.equal(result.today.length, 3); assert.equal(result.upcoming.length, 2);
});
test('cancelled and declined events do not block time; every other calendar interval does', () => {
  const result = D.day([event('09:00', '17:00', { cancelled: true }), event('09:00', '17:00', { response: 'Decline' }), event('09:00', '17:00', { showAs: 'Free' }), event('09:00', '17:00', { showAs: 'WorkingElsewhere' }), event('10:00', '11:00', { showAs: 'Tentative' })], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(result.scheduledMinutes, 480); assert.equal(result.today.length, 4);
  const allDay = D.day([{ start: '2026-11-13T00:00Z', end: '2026-11-14T00:00Z', allDay: true, showAs: 'OOF' }], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(allDay.percent, 100); assert.equal(allDay.upcoming.length, 0); assert.equal(allDay.longest, null);
});
test('calendar intervals block time equally regardless of availability status', () => {
  for (const extra of [{ showAs: 'Free', showAsKnown: true }, { showAs: 'WorkingElsewhere' }, { showAs: 'Free', showAsKnown: false }, { showAs: 'NoData' }, { showAs: undefined }]) {
    const result = D.day([event('10:00', '11:00', extra)], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.scheduledMinutes, 60); assert.equal(result.percent, 13);
    assert.equal(result.longest.start, Date.parse('2026-11-13T11:00Z'));
    assert.equal(result.longest.end, Date.parse('2026-11-13T17:00Z'));
  }
});
test('unknown and confirmed overlaps count once, with no gap through either kind', () => {
  const result = D.day([event('10:00', '12:00'), event('11:00', '13:00', { showAsKnown: false }), event('15:00', '17:00', { showAsKnown: false })], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(result.scheduledMinutes, 300);
  assert.equal(result.longest.start, Date.parse('2026-11-13T13:00Z')); assert.equal(result.longest.end, Date.parse('2026-11-13T15:00Z'));
  const allDay = D.day([event('09:00', '17:00', { showAsKnown: false })], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(allDay.longest, null); assert.equal(allDay.percent, 100);
  assert.equal(D.day([event('09:00', '10:00', { showAsKnown: false })], Date.parse('2026-11-13T18:00Z'), 'UTC', schedule).longest, null);
});
test('empty, non-working and finished days, invalid events and midnight boundaries', () => {
  const now = Date.parse('2026-11-13T09:00Z');
  assert.equal(D.day([], now, 'UTC', schedule).longest.end - now, 8 * 3600000);
  assert.equal(D.day([], Date.parse('2026-11-13T18:00Z'), 'UTC', schedule).longest, null);
  assert.equal(D.day([], Date.parse('2026-11-13T18:00Z'), 'UTC', schedule).next, null);
  assert.equal(D.day([], Date.parse('2026-11-14T09:00Z'), 'UTC', schedule).working, false);
  assert.equal(D.day([], Date.parse('2026-11-14T09:00Z'), 'UTC', schedule).next, null);
  const result = D.day([{ start: 'invalid', end: 'invalid' }, event('10:00', '09:00'), { start: '2026-11-12T23:00Z', end: '2026-11-13T00:00Z' }], now, 'UTC', schedule);
  assert.equal(result.today.length, 0);
});
test('legend follows calendar participation and organizer identity, while pending meetings block free windows', () => {
  const result = D.day([
    event('09:00', '10:00', { response: 'Accept', isOrganizer: true }),
    event('09:30', '10:30', { response: 'Accept', isOrganizer: false }),
    event('10:00', '11:00', { response: 'Tentative' }),
    event('11:00', '12:00', { response: 'Unknown' }),
    event('12:00', '17:00', { response: 'Decline' }),
    event('12:00', '17:00', { cancelled: true }),
  ], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.deepEqual(result.segments.map(segment => segment.kind), ['organized', 'accepted', 'pending', 'declined']);
  assert.equal(result.scheduledMinutes, 180); assert.equal(result.today.length, 5);
  assert.equal(result.longest.start, Date.parse('2026-11-13T12:00Z'));
  assert.equal(result.longest.end, Date.parse('2026-11-13T17:00Z'));
  const own = D.day([event('09:00', '10:00', { organizer: { email: 'me@example.test' } })], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule, 'me@example.test');
  assert.equal(own.segments[0].kind, 'organized');
});
test('IANA work boundaries and DST days use wall-time arithmetic', () => {
  const settings = { days: [0], start: '00:00', end: '04:00' };
  const day = D.day([], Date.parse('2026-11-01T04:00Z'), 'America/New_York', settings);
  assert.equal(day.workEnd - day.workStart, 5 * 3600000);
  const moscow = D.day([event('06:00', '07:00')], Date.parse('2026-11-13T06:00Z'), 'Europe/Moscow', schedule);
  assert.equal(moscow.scheduledMinutes, 60); assert.equal(moscow.workStart, Date.parse('2026-11-13T06:00Z'));
});
test('next free window is the earliest remaining gap, independently of the longest gap', () => {
  const result = D.day([event('10:00', '11:00'), event('13:00', '14:00')], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(result.next.start, Date.parse('2026-11-13T09:00Z'));
  assert.equal(result.next.end, Date.parse('2026-11-13T10:00Z'));
  assert.equal(result.longest.start, Date.parse('2026-11-13T14:00Z'));
  assert.equal(result.longest.end, Date.parse('2026-11-13T17:00Z'));
  const ongoing = D.day([event('10:00', '11:00'), event('13:00', '14:00')], Date.parse('2026-11-13T10:30Z'), 'UTC', schedule);
  assert.equal(ongoing.next.start, Date.parse('2026-11-13T11:00Z'));
  assert.equal(ongoing.next.end, Date.parse('2026-11-13T13:00Z'));
});
function renderer(now = Date.now()) {
  let clockNow = now;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clockNow])); }
    static now() { return clockNow; }
  }
  const pending = [], calls = [], state = { account: {}, view: 'mail', generation: 1, selected: null };
  const context = vm.createContext({ window: { asterCalendar: C }, state, T, timeZone: 'UTC', Date: Clock, localPreferences: { getItem: () => null }, mailWriteEpoch: 0, mailWrites: 0, mailboxWriting: () => context.mailWrites, ready: () => true, $: () => ({}), dayKey: value => T.wall(value, 'UTC').slice(0, 10), api: (operation, data) => { calls.push({ operation, data }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } });
  context.agentMailSession = null;
  const appSource = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  vm.runInContext(appSource.slice(appSource.indexOf('function mailboxWriting()'), appSource.indexOf('async function api(')), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/day-summary-ui.js'), 'utf8'), context);
  let renders = 0; context.renderDaySummary = () => { renders++; };
  return { context, state, calls, pending, advance: milliseconds => { clockNow += milliseconds; }, summary: () => vm.runInContext('daySummary', context), get renders() { return renders; } };
}
test('overview reads unread summaries only and tolerates independent mail/calendar failures', async () => {
  const f = renderer(), promise = f.context.refreshDaySummary();
  assert.equal(f.calls[0].operation, 'messages'); assert.equal(f.calls[0].data.filter, 'unread'); assert.equal(f.calls[0].data.folder, 'inbox');
  assert.equal(f.calls[0].data.refresh, true);
  assert.equal(f.calls[1].operation, 'calendar');
  f.pending[0].resolve({ items: [], total: 0 }); f.pending[1].reject(new Error('offline')); await promise;
  assert.equal(f.summary().mail.total, 0); assert.equal(f.summary().calendar, undefined); assert.equal(f.summary().calendarError, true); assert.equal(f.summary().updated, 0); assert.equal(f.renders, 1);
});
test('navigation, writes, account retirement and newer refreshes discard old reads', async () => {
  for (const invalidate of [f => { f.state.generation++; }, f => { f.context.mailWriteEpoch++; }, f => { f.context.mailWrites = 1; }, f => { f.state.account = {}; }, f => f.context.resetDaySummary()]) {
    const f = renderer(), promise = f.context.refreshDaySummary();
    invalidate(f); f.pending[0].resolve({ items: [{ id: 'stale' }] }); f.pending[1].resolve([]); await promise;
    assert.equal(f.summary()?.mail, undefined); assert.equal(f.renders, 0);
  }
  const f = renderer(), first = f.context.refreshDaySummary(), second = f.context.refreshDaySummary(true);
  f.pending[2].resolve({ items: [{ id: 'new' }] }); f.pending[3].resolve([]); await second;
  f.pending[0].resolve({ items: [{ id: 'stale' }] }); f.pending[1].resolve([]); await first;
  assert.equal(f.summary().mail.items[0].id, 'new'); assert.equal(f.renders, 1);
});
test('inbox snapshots update previews/counts immediately and reuse the current calendar', async () => {
  const f = renderer(), initial = f.context.refreshDaySummary();
  f.pending[0].resolve({ items: [{ id: 'old' }], total: 1 }); f.pending[1].resolve([]); await initial;
  f.context.receiveDayInbox({ inbox: { unread: 1 }, page: { items: [{ id: 'new', read: false }, { id: 'read', read: true }], more: false } });
  assert.equal(f.summary().mail.total, 1); assert.equal(f.summary().mail.items[0].id, 'new'); assert.equal(f.calls.length, 2);
  f.context.receiveDayInbox({ inbox: { unread: 0 }, page: { items: [{ id: 'new', read: true }], more: false } });
  assert.equal(f.summary().mail.total, 0); assert.equal(f.summary().mail.items.length, 0);
});
test('changing the time zone reloads the calendar range even on the same civil date', async () => {
  const f = renderer(), initial = f.context.refreshDaySummary();
  f.pending[0].resolve({ items: [], total: 0 }); f.pending[1].resolve([]); await initial;
  f.context.timeZone = 'Europe/London';
  const changed = f.context.refreshDaySummary();
  assert.equal(f.calls.length, 4);
  f.pending[2].resolve({ items: [], total: 0 }); f.pending[3].resolve([]); await changed;
});
test('existing inbox polls refresh moved and removed calendar intervals after 15 seconds', async () => {
  const now = Date.parse('2026-11-13T09:00Z'), f = renderer(now);
  const initial = f.context.refreshDaySummary();
  f.pending[0].resolve({ items: [], total: 0 }); f.pending[1].resolve([event('10:00', '11:00')]); await initial;
  const snapshot = { inbox: { unread: 0 }, page: { items: [], more: false } };
  f.advance(15000); f.context.receiveDayInbox(snapshot);
  assert.equal(f.calls.length, 4);
  f.pending[2].resolve({ items: [], total: 0 }); f.pending[3].resolve([event('13:00', '14:00')]);
  await new Promise(resolve => setImmediate(resolve));
  let day = D.day(f.summary().calendar.events, now + 15000, 'UTC', schedule);
  assert.equal(day.blocks[0].start, Date.parse('2026-11-13T13:00Z'));
  assert.equal(day.longest.end, Date.parse('2026-11-13T13:00Z'));
  f.advance(15000); f.context.receiveDayInbox(snapshot);
  assert.equal(f.calls.length, 6);
  f.pending[4].resolve({ items: [], total: 0 }); f.pending[5].resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  day = D.day(f.summary().calendar.events, now + 30000, 'UTC', schedule);
  assert.equal(day.scheduledMinutes, 0); assert.equal(day.blocks.length, 0);
  assert.equal(day.longest.start, now + 30000); assert.equal(day.longest.end, Date.parse('2026-11-13T17:00Z'));
});
test('returning from a calendar edit reloads the summary even before its polling interval', async () => {
  const f = renderer(), initial = f.context.refreshDaySummary();
  f.pending[0].resolve({ items: [], total: 0 }); f.pending[1].resolve([]); await initial;
  f.state.generation++;
  const returning = f.context.refreshDaySummary();
  assert.equal(f.calls.length, 4);
  f.pending[2].resolve({ items: [], total: 0 }); f.pending[3].resolve([event('10:00', '11:00')]); await returning;
  assert.equal(f.summary().calendar.events.length, 1);
});

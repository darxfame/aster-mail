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
  assert.equal(result.busyMinutes, 150); assert.equal(result.percent, 31);
  assert.equal(result.longest.start, Date.parse('2026-11-13T11:00Z')); assert.equal(result.longest.end, Date.parse('2026-11-13T16:30Z'));
  assert.equal(result.today.length, 3); assert.equal(result.upcoming.length, 2);
});
test('cancelled, declined and free events do not block time; tentative and all-day busy events do', () => {
  const result = D.day([event('09:00', '17:00', { cancelled: true }), event('09:00', '17:00', { response: 'Decline' }), event('09:00', '17:00', { showAs: 'Free' }), event('09:00', '17:00', { showAs: 'WorkingElsewhere' }), event('10:00', '11:00', { showAs: 'Tentative' })], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(result.busyMinutes, 60); assert.equal(result.today.length, 3);
  const allDay = D.day([{ start: '2026-11-13T00:00Z', end: '2026-11-14T00:00Z', allDay: true, showAs: 'OOF' }], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
  assert.equal(allDay.percent, 100); assert.equal(allDay.upcoming.length, 0); assert.equal(allDay.longest, null);
});
test('unknown availability never becomes a free-time recommendation', () => {
  for (const extra of [{ showAs: 'Free', showAsKnown: false }, { showAs: 'NoData' }, { showAs: undefined }]) {
    const result = D.day([event('10:00', '11:00', extra)], Date.parse('2026-11-13T09:00Z'), 'UTC', schedule);
    assert.equal(result.unknown.length, 1); assert.equal(result.longest, null); assert.equal(result.busyMinutes, 0);
  }
});
test('empty, non-working and finished days, invalid events and midnight boundaries', () => {
  const now = Date.parse('2026-11-13T09:00Z');
  assert.equal(D.day([], now, 'UTC', schedule).longest.end - now, 8 * 3600000);
  assert.equal(D.day([], Date.parse('2026-11-13T18:00Z'), 'UTC', schedule).longest, null);
  assert.equal(D.day([], Date.parse('2026-11-14T09:00Z'), 'UTC', schedule).working, false);
  const result = D.day([{ start: 'invalid', end: 'invalid' }, event('10:00', '09:00'), { start: '2026-11-12T23:00Z', end: '2026-11-13T00:00Z' }], now, 'UTC', schedule);
  assert.equal(result.today.length, 0);
});
test('IANA work boundaries and DST days use wall-time arithmetic', () => {
  const settings = { days: [0], start: '00:00', end: '04:00' };
  const day = D.day([], Date.parse('2026-11-01T04:00Z'), 'America/New_York', settings);
  assert.equal(day.workEnd - day.workStart, 5 * 3600000);
  const moscow = D.day([event('06:00', '07:00')], Date.parse('2026-11-13T06:00Z'), 'Europe/Moscow', schedule);
  assert.equal(moscow.busyMinutes, 60); assert.equal(moscow.workStart, Date.parse('2026-11-13T06:00Z'));
});
function renderer() {
  const pending = [], calls = [], state = { account: {}, view: 'mail', generation: 1, selected: null };
  const context = vm.createContext({ window: { asterCalendar: C }, state, T, timeZone: 'UTC', Date, mailWriteEpoch: 0, mailWrites: 0, ready: () => true, $: () => ({}), dayKey: value => T.wall(value, 'UTC').slice(0, 10), api: (operation, data) => { calls.push({ operation, data }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/day-summary-ui.js'), 'utf8'), context);
  let renders = 0; context.renderDaySummary = () => { renders++; };
  return { context, state, calls, pending, summary: () => vm.runInContext('daySummary', context), get renders() { return renders; } };
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../src/events.js');
const now = Date.parse('2026-10-30T08:52:00Z');
test('widget renders simultaneous meetings beyond the preview limit with their own actions', async () => {
  const nodes = Object.fromEntries(['#connection', '#updated', '#error', '#meetings', '.day-scroll'].map(key => [key, { scrollTop: 100 }]));
  const handlers = {}, calls = [];
  const context = vm.createContext({ tr: value => value, Date: class extends Date { static now() { return now; } },
    window: { asterTime: require('../src/time.js'), asterEvents: E, asterCalendarLayout: require('../src/calendar-layout.js'),
      asterI18n: { language: 'ru', setLanguage() {} }, asterWidget: { onUpdate() {}, state: () => new Promise(() => {}), action: async (...args) => { calls.push(args); return { ok: true }; } } },
    document: { querySelector: key => nodes[key], body: { classList: { toggle() {} } }, addEventListener: (type, callback) => { handlers[type] = callback; } }, setInterval() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/widget.js'), 'utf8'), context);
  const events = Array.from({ length: 7 }, (_, index) => ({ id: `event-${index}`, title: `Meeting ${index}`, start: '2026-10-30T09:00:00Z', end: `2026-10-30T${index % 2 ? '10' : '09'}:30:00Z`, joinUrl: `https://calls.example.com/${index}` }));
  context.render({ connected: true, timeZone: 'UTC', events: events.slice(0, 5), calendarEvents: [...events, { ...events[0], id: 'declined', response: 'Decline' }], lastPoll: new Date(now).toISOString() });
  const featured = nodes['#meetings'].innerHTML.split('<section class="day-grid">')[0];
  assert.equal((featured.match(/class="featured"/g) || []).length, 7);
  assert.match(featured, /Встречи · 7/);
  assert.doesNotMatch(featured, /data-id="declined"/);
  for (const event of events) {
    assert.ok(featured.includes(`data-action="join" data-id="${event.id}"`));
    assert.ok(featured.includes(`data-action="open" data-id="${event.id}"`));
  }
  const button = { dataset: { action: 'join', id: 'event-1' }, disabled: false };
  await handlers.click({ target: { closest: () => button } });
  assert.deepEqual(calls, [['join', 'event-1']]);
  assert.equal(button.disabled, false);
});
test('menu bar identifies all concurrent meetings instead of choosing one ending time', () => {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const events = ['one', 'two'].map((id, index) => ({ id, title: `Meeting ${id}`, start: new Date(now - (index + 1) * 60000).toISOString(), end: new Date(now + (index + 1) * 60000).toISOString() }));
  let title, tooltip;
  const context = vm.createContext({ tr: value => value, process: { platform: 'darwin' }, client: {}, widgetWindow: null,
    nearestMeetings: values => E.nearestMeetings(values, now), widgetState: () => ({ events, calendarEvents: events, countdown: E.countdown(events[0], now) }),
    tray: { setTitle: value => { title = value; }, setToolTip: value => { tooltip = value; } },
  });
  vm.runInContext(source.slice(source.indexOf('function refreshWidget('), source.indexOf('function toggleWidget(')), context);
  context.refreshWidget();
  assert.equal(title, 'Встречи · 2');
  assert.match(tooltip, /Meeting one/);
  assert.match(tooltip, /Meeting two/);
});

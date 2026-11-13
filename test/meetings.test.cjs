const test = require('node:test');
const assert = require('node:assert/strict');
const { httpsURL, meetingLink, upcomingMeetings, nearestMeetings, countdown } = require('../desktop/meetings.cjs');
const now = Date.parse('2026-10-28T10:00:00Z');
const event = { id: 'next', start: '2026-10-28T10:12:00Z', end: '2026-10-28T11:00:00Z' };
test('widget grows per visible meeting, shrinks on dismissal and stays within the display at every scale', () => {
  const { widgetBounds } = require('../desktop/meetings.cjs');
  const anchor = { x: 900, y: 0, width: 24, height: 24 }, area = { x: 0, y: 24, width: 1200, height: 1200 };
  const meetings = [event, { ...event, id: 'second' }, { ...event, id: 'third' }];
  const bounds = count => widgetBounds({ calendarEvents: meetings.slice(0, count) }, anchor, area, 1, now);
  assert.equal(bounds(0).height, 560);
  assert.equal(bounds(1).height, 560);
  assert.equal(bounds(2).height, 710);
  assert.equal(bounds(3).height, 860);
  assert.equal(widgetBounds({ calendarEvents: meetings, dismissedMeetings: [`second:${event.start}`] }, anchor, area, 1, now).height, 710);
  for (const scale of [0.8, 1, 2]) {
    const result = widgetBounds({ calendarEvents: meetings }, anchor, area, scale, now);
    assert.ok(result.x >= area.x && result.y >= area.y);
    assert.ok(result.x + result.width <= area.x + area.width);
    assert.ok(result.y + result.height <= area.y + area.height);
    assert.equal(result.height, Math.min(Math.round(860 * scale), area.height - 16));
  }
});
test('meeting links accept HTTPS without credentials and find supported call links', () => {
  assert.equal(httpsURL('javascript:alert(1)'), null);
  assert.equal(httpsURL('https://user:secret@example.com'), null);
  assert.equal(meetingLink({ body: '<a href="https://teams.microsoft.com/l/meetup?a=1&amp;b=2">Join</a>' }), 'https://teams.microsoft.com/l/meetup?a=1&b=2');
  assert.equal(meetingLink({ location: 'https://calls.example.com/room' }), 'https://calls.example.com/room');
  assert.equal(meetingLink({ body: 'Read https://example.com/privacy' }), null);
});
test('upcoming meetings exclude unavailable events and roll over after the end', () => {
  const events = [event, { ...event, id: 'cancelled', cancelled: true }, { ...event, id: 'declined', response: 'Decline' }, { ...event, allDay: true }, { ...event, start: 'invalid' }];
  assert.deepEqual(upcomingMeetings(events, now).map(e => e.id), ['next']);
  assert.deepEqual(upcomingMeetings(events, Date.parse(event.end)), []);
  assert.equal(countdown(event, now).label, 'Через 12 мин');
  assert.equal(countdown(event, now + 15 * 60000).label, 'До конца · 45 мин');
  assert.equal(countdown(null, now).label, 'Свободно');
});
test('menu bar distinguishes time until start from time until end and expires at the exact boundary', () => {
  const E = require('../src/events.js');
  assert.equal(countdown, E.countdown);
  assert.equal(countdown(event, Date.parse(event.start) - 8 * 60000).label, 'Через 8 мин');
  assert.equal(countdown(event, Date.parse(event.end) - 8 * 60000).label, 'До конца · 8 мин');
  assert.equal(countdown(event, Date.parse(event.start)).active, true);
  assert.equal(countdown(event, Date.parse(event.end)).label, 'Свободно');
});
test('nearest meetings include every simultaneous start and every ongoing meeting', () => {
  const other = { ...event, id: 'other', start: '2026-10-28T13:12:00+03:00', end: '2026-10-28T10:40:00Z' };
  const later = { ...event, id: 'later', start: '2026-10-28T10:30:00Z' };
  const events = [other, later, { ...event, id: 'declined', response: 'Decline' }, event, { ...event, id: 'all-day', allDay: true }, { ...event, id: 'cancelled', cancelled: true }];
  assert.deepEqual(nearestMeetings(events, now).map(e => e.id), ['other', 'next']);
  assert.deepEqual(nearestMeetings(events, Date.parse(later.start)).map(e => e.id), ['other', 'next', 'later']);
  assert.deepEqual(nearestMeetings(events, Date.parse(other.end)).map(e => e.id), ['next', 'later']);
  assert.deepEqual(nearestMeetings(events, Date.parse(event.end)), []);
  assert.deepEqual(events.map(e => e.id), ['other', 'later', 'declined', 'next', 'all-day', 'cancelled']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { httpsURL, meetingLink, upcomingMeetings, countdown } = require('../desktop/meetings.cjs');
const now = Date.parse('2026-10-28T10:00:00Z');
const event = { id: 'next', start: '2026-10-28T10:12:00Z', end: '2026-10-28T11:00:00Z' };
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
  assert.equal(countdown(event, now).label, '12 мин');
  assert.equal(countdown(event, now + 15 * 60000).label, 'Сейчас · 45 мин');
  assert.equal(countdown(null, now).label, 'Свободно');
});

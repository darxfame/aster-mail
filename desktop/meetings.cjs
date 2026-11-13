function httpsURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const meetingLink = event => require('../src/events.js').joinURL(event);
const { upcomingMeetings, nearestMeetings, countdown } = require('../src/events.js');
function pollingRange(now = new Date()) {
  // Load whole days: OWA recurring-event expansion must include today's occurrences.
  const T = require('../src/time.js'), C = require('../src/calendar.js');
  const today = C.range(now, 'day').start;
  return { start: T.add(today, { days: -1 }).toISOString(), end: T.add(today, { days: 8 }).toISOString() };
}
function widgetBounds(state, anchor, area, scale = 1, now = Date.now()) {
  const meetings = require('../src/events.js').focusMeetings(state.calendarEvents || state.events || [], now)
    .filter(event => !(state.dismissedMeetings || []).includes(`${event.id}:${event.start}`));
  const width = Math.min(Math.round(380 * scale), area.width - 16);
  const height = Math.min(Math.round((560 + Math.max(0, meetings.length - 1) * 150) * scale), area.height - 16);
  const x = Math.max(area.x + 8, Math.min(anchor.x + anchor.width / 2 - width / 2, area.x + area.width - width - 8));
  const below = anchor.y + anchor.height + 8;
  const y = below + height <= area.y + area.height - 8 ? below : Math.max(area.y + 8, anchor.y - height - 8);
  return { x: Math.round(x), y: Math.round(y), width, height };
}
module.exports = { widgetBounds, httpsURL, meetingLink, upcomingMeetings, nearestMeetings, countdown, pollingRange };

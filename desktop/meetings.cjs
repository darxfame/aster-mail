function httpsURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const meetingLink = event => require('../src/events.js').joinURL(event);
const { upcomingMeetings, countdown } = require('../src/events.js');
function pollingRange(now = new Date()) {
  // Load whole days: OWA recurring-event expansion must include today's occurrences.
  const T = require('../src/time.js'), C = require('../src/calendar.js');
  const today = C.range(now, 'day').start;
  return { start: T.add(today, { days: -1 }).toISOString(), end: T.add(today, { days: 8 }).toISOString() };
}
module.exports = { httpsURL, meetingLink, upcomingMeetings, countdown, pollingRange };

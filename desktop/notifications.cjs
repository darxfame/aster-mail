// Pure notification policy, independent of Electron and real mailboxes.
const T = require('../src/time.js');
const defaults = { mail: true, meetings: true, sounds: true, minutes: 15, preview: false, timeZone: 'system', theme: 'light' };
function preferences(value = {}) {
  const result = { ...defaults };
  for (const key of ['mail', 'meetings', 'sounds', 'preview']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if ([0, 5, 10, 15, 30].includes(Number(value.minutes))) result.minutes = Number(value.minutes);
  try { if (typeof value.timeZone === 'string') { T.zone(value.timeZone); result.timeZone = value.timeZone || 'system'; } } catch { /* Invalid saved zone falls back to the computer. */ }
  if (['light', 'dark'].includes(value.theme)) result.theme = value.theme;
  return result;
}
class NotificationTracker {
  constructor() { this.mailSeen = new Set(); this.meetingSeen = new Map(); this.baseline = null; }
  newMail(messages, now = Date.now()) {
    if (this.baseline === null) {
      this.baseline = now;
      for (const m of messages) this.mailSeen.add(m.id);
      return [];
    }
    const fresh = messages.filter(m => !this.mailSeen.has(m.id) && !m.read && new Date(m.date).getTime() >= this.baseline);
    for (const m of messages) this.mailSeen.add(m.id);
    if (this.mailSeen.size > 2000) this.mailSeen = new Set([...this.mailSeen].slice(-1000));
    return fresh;
  }
  reminders(events, minutes, now = Date.now()) {
    for (const [key, date] of this.meetingSeen) if (date < now - 86400000) this.meetingSeen.delete(key);
    return events.filter(event => {
      if (event.hasReminderSettings && event.reminderSet === false) return false;
      const lead = event.hasReminderSettings && Number.isInteger(event.reminder) && event.reminder >= 0 ? event.reminder : minutes;
      if (event.allDay || event.cancelled || ['Decline', 'Declined'].includes(event.response)) return false;
      const start = new Date(event.start).getTime(), key = `${event.id}:${event.start}`;
      // Grace allows the first poll after waking from sleep to remind about a meeting just started.
      if (!Number.isFinite(start) || start < now - 60000 || start > now + lead * 60000 || this.meetingSeen.has(key)) return false;
      this.meetingSeen.set(key, start); return true;
    });
  }
}
module.exports = { defaults, preferences, NotificationTracker };

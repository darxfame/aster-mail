const tr = require('../src/i18n.js').text;
// Pure notification policy, independent of Electron and real mailboxes.
const T = require('../src/time.js');
const defaults = { mail: true, meetings: true, sounds: true, minutes: 15, preview: false, debugErrors: false, timeZone: 'system', theme: 'light', language: 'ru' };
function reminderMinutes(value) {
  if (!Array.isArray(value) || value.length > 16 || value.some(n => !Number.isInteger(n) || n < 0 || n > 1440)) return null;
  return [...new Set(value)].sort((a, b) => b - a);
}
function meetingReminders(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).filter(entry => entry && typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 16000 && typeof entry.start === 'string' && Number.isFinite(Date.parse(entry.start)) && reminderMinutes(entry.minutes))
    .map(entry => ({ id: entry.id, start: new Date(entry.start).toISOString(), minutes: reminderMinutes(entry.minutes) }));
}
function preferences(value = {}) {
  const result = { ...defaults };
  for (const key of ['mail', 'meetings', 'sounds', 'preview', 'debugErrors']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if ([0, 5, 10, 15, 30].includes(Number(value.minutes))) result.minutes = Number(value.minutes);
  try { if (typeof value.timeZone === 'string') { T.zone(value.timeZone); result.timeZone = value.timeZone || 'system'; } } catch { /* Invalid saved zone falls back to the computer. */ }
  if (['light', 'dark'].includes(value.theme)) result.theme = value.theme;
  if (['ru', 'en'].includes(value.language)) result.language = value.language;
  result.meetingReminders = meetingReminders(value.meetingReminders);
  result.meetingMinutes = reminderMinutes(value.meetingMinutes);
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
  reminders(events, minutes, now = Date.now(), overrides = [], common = null) {
    for (const [key, date] of this.meetingSeen) if (date < now - 86400000) this.meetingSeen.delete(key);
    return events.filter(event => {
      const custom = overrides.find(entry => entry.id === event.id && Date.parse(entry.start) === Date.parse(event.start));
      if (!custom && !common && event.hasReminderSettings && event.reminderSet === false) return false;
      const lead = event.hasReminderSettings && Number.isInteger(event.reminder) && event.reminder >= 0 ? event.reminder : minutes;
      if (event.allDay || event.cancelled || ['Decline', 'Declined'].includes(event.response)) return false;
      const start = new Date(event.start).getTime();
      // Grace allows the first poll after waking from sleep to remind about a meeting just started.
      if (!Number.isFinite(start) || start < now - 60000) return false;
      const due = (custom ? custom.minutes : common || [lead]).filter(n => start <= now + n * 60000);
      let fresh = false;
      for (const n of due) {
        const key = `${event.id}:${start}:${n}`;
        if (!this.meetingSeen.has(key)) fresh = true;
        this.meetingSeen.set(key, start);
      }
      // Coalesce missed thresholds into one alert after sleep or a delayed poll.
      if (this.meetingSeen.size > 4000) this.meetingSeen = new Map([...this.meetingSeen].slice(-2000));
      return fresh;
    });
  }
}
function mailAlert(message, preview = false) {
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  return { id: message.id, title: preview ? text(message.from?.name || message.from?.email) || tr('Новое письмо') : tr('Новое письмо'),
    body: preview ? [text(message.subject) || tr('(Без темы)'), text(message.preview).slice(0, 240)].filter(Boolean).join('\n') : tr('В Exchange получено новое письмо.'), navigation: { view: 'mail', id: message.id } };
}
module.exports = { defaults, preferences, meetingReminders, NotificationTracker, mailAlert };

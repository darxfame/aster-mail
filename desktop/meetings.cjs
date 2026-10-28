function httpsURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function meetingLink(event) {
  const explicit = httpsURL(event.joinUrl); if (explicit) return explicit;
  const text = `${event.location || ''}\n${event.body || ''}\n${event.preview || ''}`.replace(/&amp;/g, '&');
  const candidates = (text.match(/https:\/\/[^\s<>"']+/gi) || []).map(s => httpsURL(s.replace(/[),.;]+$/, ''))).filter(Boolean);
  const known = candidates.find(value => /(^|\.)(teams\.microsoft\.com|teams\.live\.com|zoom\.us|webex\.com|meet\.google\.com|telemost\.yandex\.ru|ktalk\.ru|kontur\.talk|talk\.kontur\.ru|meet\.jit\.si)$/i.test(new URL(value).hostname));
  return known || httpsURL((event.location || '').trim());
}
function upcomingMeetings(events, now = Date.now()) {
  return events.filter(event => !event.cancelled && !event.allDay && !['Decline', 'Declined'].includes(event.response) && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
function countdown(event, now = Date.now()) {
  if (!event) return { label: 'Свободно', detail: 'Нет ближайших встреч', active: false };
  const active = Date.parse(event.start) <= now;
  const minutes = Math.max(1, Math.ceil((Date.parse(active ? event.end : event.start) - now) / 60000));
  const label = minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} м` : ''}`;
  return { label: active ? `Сейчас · ${label}` : label, detail: active ? 'до окончания встречи' : 'до начала встречи', active };
}
module.exports = { httpsURL, meetingLink, upcomingMeetings, countdown };

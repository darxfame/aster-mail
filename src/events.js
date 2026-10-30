(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  function organizer(event, email = '') {
    if (typeof event.isOrganizer === 'boolean') return event.isOrganizer;
    return event.response === 'Organizer' || Boolean(email.includes('@') && event.organizer?.email?.toLowerCase() === email.toLowerCase());
  }
  function kind(event, email) {
    if (event.cancelled) return 'cancelled';
    if (['Decline', 'Declined'].includes(event.response)) return 'declined';
    if (organizer(event, email)) return 'organized';
    return ['Accept', 'Accepted'].includes(event.response) ? 'accepted' : 'pending';
  }
  function responseState(event, email) {
    if (organizer(event, email)) return 'organizer';
    if (['Accept', 'Accepted'].includes(event.response)) return 'accepted';
    if (['Tentative', 'TentativelyAccepted'].includes(event.response)) return 'tentative';
    if (['Decline', 'Declined'].includes(event.response)) return 'declined';
    return 'notResponded';
  }
  function upcomingMeetings(events, now = Date.now()) {
    return events.filter(event => !event.cancelled && !event.allDay && !['Decline', 'Declined'].includes(event.response) && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > now)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }
  function nearestMeetings(events, now = Date.now()) {
    const upcoming = upcomingMeetings(events, now);
    if (!upcoming.length) return [];
    const firstStart = Date.parse(upcoming[0].start);
    return upcoming.filter(event => firstStart <= now ? Date.parse(event.start) <= now : Date.parse(event.start) === firstStart);
  }
  function countdown(event, now = Date.now()) {
    if (!event || !Number.isFinite(Date.parse(event.start)) || !(Date.parse(event.end) > now)) return { label: tr('Свободно'), duration: '', detail: tr('Нет ближайших встреч'), active: false };
    const active = Date.parse(event.start) <= now;
    const minutes = Math.max(1, Math.ceil((Date.parse(active ? event.end : event.start) - now) / 60000));
    const duration = minutes < 60 ? `${minutes} ${tr("мин")}` : `${Math.floor(minutes / 60)} ${tr("ч")}${minutes % 60 ? ` ${minutes % 60} ${tr("м")}` : ''}`;
    return { label: active ? `${tr("До конца ·")} ${duration}` : `${tr("Через")} ${duration}`, duration, detail: active ? tr('до окончания встречи') : tr('до начала встречи'), active };
  }
  function links(event) {
    const text = `${event.joinUrl || ''}\n${event.location || ''}\n${event.body || ''}\n${event.html || ''}`.replace(/&amp;/g, '&');
    return [...new Set((text.match(/https?:\/\/[^\s<>"']+/gi) || []).map(value => value.replace(/[),.;]+$/, '')).filter(value => {
      try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }))];
  }
  function joinURL(event) {
    const urls = links(event).filter(value => value.startsWith('https:'));
    return urls.find(url => url === event.joinUrl) || urls.find(value => /(^|\.)(teams\.microsoft\.com|teams\.live\.com|zoom\.us|webex\.com|meet\.google\.com|telemost\.yandex\.ru|ktalk\.ru|kontur\.talk|talk\.kontur\.ru|meet\.jit\.si)$/i.test(new URL(value).hostname)) || urls.find(url => url === event.location?.trim()) || null;
  }
  const api = { organizer, kind, responseState, upcomingMeetings, nearestMeetings, countdown, links, joinURL };
  if (typeof module !== 'undefined') module.exports = api; else root.asterEvents = api;
})(typeof window === 'undefined' ? {} : window);

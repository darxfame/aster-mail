(function (root) {
  function organizer(event, email = '') {
    if (typeof event.isOrganizer === 'boolean') return event.isOrganizer;
    return event.response === 'Organizer' || Boolean(email.includes('@') && event.organizer?.email?.toLowerCase() === email.toLowerCase());
  }
  function kind(event, email) {
    if (event.cancelled) return 'cancelled';
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
  const api = { organizer, kind, responseState, links, joinURL };
  if (typeof module !== 'undefined') module.exports = api; else root.asterEvents = api;
})(typeof window === 'undefined' ? {} : window);

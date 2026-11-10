(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  const recipients = typeof module !== 'undefined' ? require('./recipients.js') : root.asterRecipients;
  const server = typeof module !== 'undefined' ? require('./server.js') : root.asterServer;
  const validEmail = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim());
  function sourceLink(address, id) {
    if (typeof id !== 'string' || !id || id.length > 16000 || /[\u0000-\u001f]/.test(id)) return '';
    try {
      const url = new URL('/owa/', server.normalize(address));
      url.searchParams.set('ItemID', id); url.searchParams.set('exvsurl', '1'); url.searchParams.set('viewmodel', 'ReadMessageItem');
      return url.href;
    } catch { return ''; }
  }
  function draft(message, { ownEmails = [], sent = false, address = '', text = '', received = '' } = {}) {
    const own = ownEmails.filter(validEmail).map(value => value.trim().toLowerCase());
    const clean = person => ({ email: validEmail(person?.email) ? person.email.trim() : '' });
    const mail = { from: clean(message.from), to: (message.to || []).map(clean), cc: (message.cc || []).map(clean) };
    const targets = own.length ? recipients.reply(mail, own, true, sent) : { to: '', cc: '' };
    const attendees = [targets.to, targets.cc].filter(Boolean).join(', ');
    const candidates = sent || own.includes(mail.from.email.toLowerCase()) ? [...mail.to, ...mail.cc] : [mail.from, ...mail.to, ...mail.cc];
    const title = message.subject || tr('(Без темы)'), sourceUrl = sourceLink(address, message.id);
    const author = [message.from?.name, mail.from.email].filter(Boolean).join(' · ');
    const header = [`${tr('Исходное письмо:')} ${title}`, author ? `${tr('Автор исходного письма:')} ${author}` : '', received ? `${tr('Дата исходного письма:')} ${received}` : '', sourceUrl ? `${tr('Открыть исходное письмо в OWA:')} ${sourceUrl}` : ''].filter(Boolean).join('\n');
    const bodyText = String(text).slice(0, 16000);
    return { title, attendees, body: `${header}\n\n${bodyText}`, sourceUrl, unknownIdentity: !own.length, omittedRecipients: candidates.some(person => !person.email), truncated: String(text).length > bodyText.length };
  }
  const api = { draft, sourceLink };
  if (typeof module !== 'undefined') module.exports = api; else root.asterMailToMeeting = api;
})(typeof window === 'undefined' ? {} : window);

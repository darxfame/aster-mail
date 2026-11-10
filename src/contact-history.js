(function(root) {
  const tr = typeof module === 'undefined' ? value => root.asterI18n.text(value) : require('./i18n.js').text;
  function email(value) {
    if (typeof value !== 'string' || value.length > 254 || /[\u0000-\u001f\u007f]/.test(value) || !/^[^\s<>@"\\*?]+@[^\s<>@"\\*?]+\.[^\s<>@"\\*?]+$/.test(value)) throw new Error(tr('Для истории переписки нужен полный SMTP-адрес контакта.'));
    return value.toLowerCase();
  }
  function query(value) {
    const address = email(value);
    return `(from:"${address}" OR to:"${address}" OR cc:"${address}")`;
  }
  function role(message, address) {
    const same = person => typeof person?.email === 'string' && person.email.trim().toLowerCase() === address;
    if (same(message.from)) return 'from';
    if ((message.to || []).some(same)) return 'to';
    if ((message.cc || []).some(same)) return 'cc';
    return '';
  }
  function summary(message, address) {
    const matched = role(message, address);
    if (!matched || message.isDraft) return null;
    return { id: message.id, changeKey: message.changeKey || '', parentId: message.parentId || '', subject: String(message.subject || '').slice(0, 1000), date: message.date || null, role: matched,
      from: { name: String(message.from?.name || '').slice(0, 1000), email: String(message.from?.email || '').slice(0, 254) } };
  }
  const api = { email, query, role, summary };
  if (typeof module !== 'undefined') module.exports = api; else root.asterContactHistory = api;
})(typeof window === 'undefined' ? {} : window);

(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  function normalize(input = {}) {
    const result = {};
    for (const key of ['text', 'from', 'to', 'start', 'end', 'folder']) {
      const value = input[key] ?? '';
      if (typeof value !== 'string' || value.length > (key === 'folder' ? 16000 : key === 'text' ? 2000 : 254) || /[\u0000-\u001f]/.test(value)) throw new Error(tr('Проверьте поля поиска писем.'));
      result[key] = value.trim();
    }
    for (const key of ['from', 'to']) if (/["\\]/.test(result[key])) throw new Error(tr('В имени или адресе для поиска не должно быть кавычек и обратной косой черты.'));
    for (const key of ['start', 'end']) if (result[key] && (!/^\d{4}-\d\d-\d\d$/.test(result[key]) || !Number.isFinite(Date.parse(`${result[key]}T00:00:00Z`)) || new Date(`${result[key]}T00:00:00Z`).toISOString().slice(0, 10) !== result[key])) throw new Error(tr('Укажите корректные даты поиска.'));
    if (result.start && result.end && result.end < result.start) throw new Error(tr('Окончание периода поиска должно быть не раньше начала.'));
    result.attachments = input.attachments || 'any';
    if (!['any', 'yes', 'no'].includes(result.attachments)) throw new Error(tr('Проверьте поля поиска писем.'));
    return result;
  }
  function query(input) {
    const value = normalize(input), parts = [];
    const date = value => `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
    if (value.text) parts.push(`(${value.text})`);
    for (const key of ['from', 'to']) if (value[key]) parts.push(`${key}:"${value[key]}"`);
    if (value.start && value.end) parts.push(`received:${date(value.start)}..${date(value.end)}`);
    else if (value.start) parts.push(`received:>=${date(value.start)}`);
    else if (value.end) parts.push(`received:<=${date(value.end)}`);
    if (value.attachments !== 'any') parts.push(`hasattachment:${value.attachments === 'yes' ? 'true' : 'false'}`);
    const result = parts.join(' AND ') || (value.folder ? '*' : '');
    if (result.length > 2000) throw new Error(tr('Поисковый запрос слишком длинный. Сократите условия.'));
    return result;
  }
  function matches(message, input) {
    const value = normalize(input), lower = value => String(value || '').toLocaleLowerCase();
    const person = value => `${value?.name || ''} ${value?.email || ''}`;
    if (value.folder && message.folder !== value.folder && message.parentId !== value.folder) return false;
    if (value.from && !lower(person(message.from)).includes(lower(value.from))) return false;
    if (value.to && !(message.to || []).some(item => lower(person(item)).includes(lower(value.to)))) return false;
    if (value.attachments !== 'any' && Boolean(message.hasAttachments) !== (value.attachments === 'yes')) return false;
    const received = Number.isFinite(Date.parse(message.date)) ? new Date(message.date).toISOString().slice(0, 10) : '';
    if ((value.start || value.end) && (!received || value.start && received < value.start || value.end && received > value.end)) return false;
    const content = [message.subject, message.text, message.html?.replace(/<[^>]*>/g, ' '), message.preview, ...[message.from, ...(message.to || []), ...(message.cc || []), ...(message.bcc || [])].map(person), ...(message.attachments || []).map(file => file.name)].join(' ');
    return !value.text || lower(content).includes(lower(value.text));
  }
  const api = { normalize, query, matches };
  if (typeof module !== 'undefined') module.exports = api; else root.asterMailSearch = api;
})(typeof window === 'undefined' ? {} : window);

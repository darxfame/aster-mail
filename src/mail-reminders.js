(function(root) {
  const tr = typeof module === 'undefined' ? value => root.asterI18n.text(value) : require('./i18n.js').text;
  function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/.test(value); }
  function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function normalize(entries) {
    if (!Array.isArray(entries) || entries.length > 30 || JSON.stringify(entries).length > 180000) throw new Error(tr('Можно сохранить не более 30 напоминаний о письмах.'));
    const seen = new Set();
    return entries.map(entry => {
      if (!entry || !id(entry.id) || typeof entry.token !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(entry.token) || !instant(entry.due) || entry.notifiedAt !== null && !instant(entry.notifiedAt) || seen.has(entry.id)) throw new Error(tr('Некорректное напоминание о письме.'));
      seen.add(entry.id);
      return { id: entry.id, token: entry.token, due: new Date(entry.due).toISOString(), notifiedAt: entry.notifiedAt === null ? null : new Date(entry.notifiedAt).toISOString() };
    });
  }
  const api = { id, normalize };
  if (typeof module !== 'undefined') module.exports = api; else root.asterMailReminders = api;
})(typeof window === 'undefined' ? {} : window);

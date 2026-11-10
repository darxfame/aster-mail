(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  function normalize(value) {
    if (!Array.isArray(value) || value.length > 30 || new TextEncoder().encode(JSON.stringify(value)).length > 64000) throw new Error(tr('Можно сохранить до 30 быстрых ответов общим размером до 64 КБ.'));
    const ids = new Set();
    return value.map(reply => {
      if (!reply || typeof reply.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(reply.id) || ids.has(reply.id) || typeof reply.title !== 'string' || !reply.title.trim() || reply.title.length > 100 || typeof reply.body !== 'string' || !reply.body.trim() || reply.body.length > 8000) throw new Error(tr('Укажите название до 100 символов и текст ответа до 8000 символов.'));
      ids.add(reply.id);
      return { id: reply.id, title: reply.title.trim(), body: reply.body };
    });
  }
  const api = { normalize };
  if (typeof module !== 'undefined') module.exports = api; else root.asterQuickReplies = api;
})(typeof window === 'undefined' ? {} : window);

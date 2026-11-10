(function(root) {
  const tr = typeof module === 'undefined' ? value => root.asterI18n.text(value) : require('./i18n.js').text;
  function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/.test(value); }
  function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function normalize(entries) {
    if (!Array.isArray(entries) || entries.length > 30 || JSON.stringify(entries).length > 180000) throw new Error(tr('Можно сохранить не более 30 ожиданий ответа.'));
    const seen = new Set();
    return entries.map(entry => {
      if (!entry || !id(entry.id) || !id(entry.internetId) || !instant(entry.sentAt) || !instant(entry.due) || entry.replyId !== null && !id(entry.replyId) || seen.has(entry.id)) throw new Error(tr('Некорректное ожидание ответа.'));
      seen.add(entry.id);
      return { id: entry.id, internetId: entry.internetId, sentAt: new Date(entry.sentAt).toISOString(), due: new Date(entry.due).toISOString(), replyId: entry.replyId };
    });
  }
  function replyTo(entry, message) {
    const references = `${message.inReplyTo || ''} ${message.references || ''}`.match(/<[^<>\s]+>/g) || [];
    return !entry.replyId && message.id !== entry.id && message.isFromMe === false && message.isDraft === false && /^IPM\.Note(?:\.|$)/.test(message.itemClass || '') && !message.automated && Date.parse(message.date) > Date.parse(entry.sentAt) && references.includes(entry.internetId);
  }
  const api = { id, normalize, replyTo };
  if (typeof module !== 'undefined') module.exports = api; else root.asterWaitingReplies = api;
})(typeof window === 'undefined' ? {} : window);

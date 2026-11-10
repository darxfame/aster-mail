const P = require('./protocol.cjs');
const T = require('../src/time.js');
const W = require('../src/waiting-replies.js');
const tr = require('../src/i18n.js').text;

// GetItem avoids FindItem's truncation of References. No body or attachments are requested.
// https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/finditem-operation
async function metadata(client, ids) {
  if (!ids.length) return [];
  if (ids.length > 50 || ids.some(value => !W.id(value))) throw new Error(tr('Некорректное ожидание ответа.'));
  const fields = ['item:Subject', 'item:ParentFolderId', 'item:ItemClass', 'item:DateTimeSent', 'item:DateTimeReceived', 'item:IsDraft', 'item:IsFromMe', 'item:InReplyTo', 'item:InternetMessageHeaders', 'message:InternetMessageId', 'message:References'];
  const result = await client.ews('GetItem', P.soap(`<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${fields.map(field => `<t:FieldURI FieldURI="${field}"/>`).join('')}</t:AdditionalProperties></m:ItemShape><m:ItemIds>${ids.map(id => `<t:ItemId Id="${P.escapeXML(id)}"/>`).join('')}</m:ItemIds></m:GetItem>`));
  const messages = P.walk(result, value => value.ItemId?.['@_Id']).map(value => {
    const headers = P.walk(value.InternetMessageHeaders, header => header['@_HeaderName']);
    const header = name => String(headers.find(header => header['@_HeaderName'].toLowerCase() === name)?.['#text'] || '').trim();
    return { id: value.ItemId['@_Id'], parentId: value.ParentFolderId?.['@_Id'] || '', subject: String(value.Subject || '').slice(0, 1000),
      internetId: value.InternetMessageId || '', sentAt: T.exchange(value.DateTimeSent), date: T.exchange(value.DateTimeReceived),
      inReplyTo: String(value.InReplyTo || header('in-reply-to')).slice(0, 65536), references: String(value.References || header('references')).slice(0, 65536),
      isFromMe: value.IsFromMe === 'true' ? true : value.IsFromMe === 'false' ? false : null,
      isDraft: value.IsDraft === 'true' ? true : value.IsDraft === 'false' ? false : null, itemClass: value.ItemClass || '',
      automated: Boolean(header('auto-submitted') && header('auto-submitted').toLowerCase() !== 'no') };
  }).filter(value => ids.includes(value.id));
  if (ids.some(id => !messages.some(message => message.id === id))) throw new Error(tr('Не все письма доступны для проверки ответа.'));
  return messages;
}

class WaitingReplies {
  constructor(client, store, guard) {
    this.client = client; this.store = store; this.guard = guard;
    this.queue = Promise.resolve(); this.cache = new Map(); this.scanPromise = null; this.checkedAt = null; this.error = '';
  }
  entries() { this.guard(); return W.normalize(this.store.data.waitingReplies || []); }
  update(change) {
    const task = this.queue.then(async () => {
      const next = W.normalize(change(this.entries()));
      await this.store.save({ waitingReplies: next }, this.guard); this.guard();
    });
    this.queue = task.catch(() => {}); return task;
  }
  async track({ id, due }) {
    if (!W.id(id) || typeof due !== 'string' || !Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now()) throw new Error(tr('Укажите будущий срок ожидания.'));
    const [source] = await metadata(this.client, [id]); this.guard();
    const folders = await this.client.ews('GetFolder', P.soap('<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="sentitems"/></m:FolderIds></m:GetFolder>')); this.guard();
    const sentId = P.walk(folders, value => value.FolderId?.['@_Id'])[0]?.FolderId['@_Id'];
    if (!sentId || !source || source.parentId !== sentId || source.isDraft !== false || !/^IPM\.Note(?:\.|$)/.test(source.itemClass) || !source.sentAt || !/^<[^<>\s]+>$/.test(source.internetId)) throw new Error(tr('Выберите отправленное письмо с почтовым идентификатором.'));
    await this.update(entries => {
      const existing = entries.find(entry => entry.id === id);
      return [...entries.filter(entry => entry.id !== id), { id, internetId: source.internetId, sentAt: source.sentAt, due, replyId: existing?.replyId || null }];
    });
  }
  remove({ id }) {
    if (!W.id(id)) throw new Error(tr('Некорректное ожидание ответа.'));
    return this.update(entries => entries.filter(entry => entry.id !== id));
  }
  async list() {
    const entries = this.entries();
    let sources = [], sourceError = '';
    try { sources = await metadata(this.client, entries.map(entry => entry.id)); this.guard(); }
    catch (error) { this.guard(); sourceError = error.message; }
    return { entries: entries.map(entry => ({ ...entry, subject: sources.find(source => source.id === entry.id)?.subject || '' })), checkedAt: this.checkedAt, error: this.error, sourceError };
  }
  scan(messages) {
    if (!this.scanPromise) this.scanPromise = this.scanPage(messages).finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }
  async scanPage(messages) {
    if (!this.entries().some(entry => !entry.replyId)) return;
    try {
      // Bounded to the latest inbox page supplied by the existing read-only mail poll.
      const ids = [...new Set(messages.slice(0, 50).map(message => message.id))].filter(W.id);
      const missing = ids.filter(id => !this.cache.has(id));
      const fresh = await metadata(this.client, missing); this.guard();
      for (const message of fresh) this.cache.set(message.id, message);
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      const candidates = ids.map(id => this.cache.get(id)).filter(Boolean);
      const matched = entries => entries.map(entry => {
        const reply = candidates.find(message => W.replyTo(entry, message));
        return reply ? { ...entry, replyId: reply.id } : entry;
      });
      if (JSON.stringify(matched(this.entries())) !== JSON.stringify(this.entries())) await this.update(matched);
      this.guard(); this.checkedAt = new Date().toISOString(); this.error = '';
    } catch (error) {
      try { this.guard(); this.error = error.message; } catch { /* Retired accounts cannot publish state. */ }
    }
  }
}
module.exports = { WaitingReplies, metadata };

const crypto = require('node:crypto');
const R = require('../src/mail-reminders.js');
const P = require('./protocol.cjs');
const tr = require('../src/i18n.js').text;

class MailReminders {
  constructor(store, { guard, available, deliver }) {
    this.store = store; this.guard = guard; this.available = available; this.deliver = deliver;
    this.queue = Promise.resolve(); this.error = '';
  }
  entries() { this.guard(); return R.normalize(this.store.data.mailReminders || []); }
  run(action) {
    const task = this.queue.then(() => { this.guard(); return action(); });
    this.queue = task.catch(() => {}); return task;
  }
  async write(entries) {
    await this.store.save({ mailReminders: R.normalize(entries) }, this.guard); this.guard();
  }
  set({ id, due }) {
    return this.run(async () => {
      if (!R.id(id) || typeof due !== 'string' || !Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now()) throw new Error(tr('Укажите будущее время напоминания.'));
      const entry = { id, token: crypto.randomUUID(), due: new Date(due).toISOString(), notifiedAt: null };
      await this.write([...this.entries().filter(item => item.id !== id), entry]); this.error = '';
      return entry;
    });
  }
  remove({ id, token }) {
    return this.run(async () => {
      const existing = this.entries().find(entry => entry.id === id);
      if (!R.id(id) || !existing || token !== existing.token) throw new Error(tr('Напоминание изменилось. Обновите список.'));
      await this.write(this.entries().filter(entry => entry.id !== id)); this.error = '';
    });
  }
  tick(now = Date.now()) {
    return this.run(async () => {
      if (!this.available()) return;
      const entries = this.entries(), due = entries.filter(entry => !entry.notifiedAt && Date.parse(entry.due) <= now);
      if (!due.length) return;
      const tokens = new Set(due.map(entry => entry.token));
      // Claim before OS handoff so restarting cannot replay a dispatched reminder.
      // A crash between these steps can suppress the popup; the due entry stays in the list.
      await this.write(entries.map(entry => tokens.has(entry.token) ? { ...entry, notifiedAt: new Date(now).toISOString() } : entry));
      // Privacy/account state can change while encrypted storage is being written.
      if (!this.available() || !this.deliver(due.length)) await this.write(entries);
      this.error = '';
    }).catch(error => {
      try { this.guard(); this.error = tr('Не удалось обработать напоминания. Проверьте список напоминаний.'); } catch { /* Retired sessions cannot publish errors or deliver alerts. */ }
    });
  }
}

async function subjects(client, entries) {
  if (!entries.length) return [];
  const ids = R.normalize(entries).map(entry => entry.id);
  const result = await client.ews('GetItem', P.soap(`<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Subject"/></t:AdditionalProperties></m:ItemShape><m:ItemIds>${ids.map(id => `<t:ItemId Id="${P.escapeXML(id)}"/>`).join('')}</m:ItemIds></m:GetItem>`));
  const values = P.walk(result, value => value.ItemId?.['@_Id']).filter(value => ids.includes(value.ItemId['@_Id'])).map(value => ({ id: value.ItemId['@_Id'], subject: String(value.Subject || '').slice(0, 1000) }));
  if (ids.some(id => !values.some(value => value.id === id))) throw new Error(tr('Некоторые письма напоминаний недоступны. Напоминания можно удалить из списка.'));
  return values;
}
module.exports = { MailReminders, subjects };

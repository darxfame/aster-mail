const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MailReminders, subjects } = require('../desktop/mail-reminders.cjs');
const { normalize } = require('../src/mail-reminders.js');
const due = '2099-01-01T10:00:00Z', later = '2099-01-02T10:00:00Z';
function fixture() {
  const f = { active: true, available: true, delivered: [], writes: [], fail: false };
  f.guard = () => { if (!f.active) throw new Error('Retired session'); };
  f.store = { data: { values: { 'aster-keep': 'Preserve' } }, async save(patch, guard) {
    guard(); if (f.beforeSave) { const callback = f.beforeSave; f.beforeSave = null; await callback(); }
    guard(); if (f.fail) throw new Error('Storage failed');
    f.writes.push(patch); f.store.data = { ...f.store.data, ...patch }; guard();
  } };
  f.options = { guard: f.guard, available: () => f.available, deliver: count => { f.delivered.push(count); return true; } };
  f.reminders = new MailReminders(f.store, f.options); return f;
}
test('mail reminders validate bounded identifiers/times and strip all mail payloads', () => {
  const entry = { id: 'fictional', token: 'token-1', due, notifiedAt: null, subject: 'Private subject', text: 'Private text', recipients: ['private@example.com'] };
  assert.deepEqual(normalize([entry]), [{ id: entry.id, token: entry.token, due: new Date(due).toISOString(), notifiedAt: null }]);
  for (const entries of [null, [entry, entry], [{ ...entry, token: '../escape' }], [{ ...entry, id: '\n' }], [{ ...entry, notifiedAt: false }], [{ ...entry, due: 'bad' }], Array.from({ length: 31 }, (_, id) => ({ ...entry, id: String(id) }))]) assert.throws(() => normalize(entries));
});
test('deadlines fire once, coalesce after sleep, survive restart and never alter unrelated settings', async () => {
  const f = fixture(); await f.reminders.set({ id: 'one', due }); await f.reminders.set({ id: 'two', due: later });
  assert.equal(f.store.data.values['aster-keep'], 'Preserve'); assert.deepEqual(Object.keys(f.writes[0]), ['mailReminders']);
  await f.reminders.tick(Date.parse(due) - 1); assert.deepEqual(f.delivered, []);
  await f.reminders.tick(Date.parse(later)); assert.deepEqual(f.delivered, [2]);
  await f.reminders.tick(Date.parse(later) + 60000); assert.deepEqual(f.delivered, [2]);
  const restored = new MailReminders(f.store, f.options); await restored.tick(Date.parse(later) + 120000); assert.deepEqual(f.delivered, [2]);
  assert.ok(restored.entries().every(entry => entry.notifiedAt));
});
test('unhandled deadlines catch up after restart; privacy defers and cancellation removes them', async () => {
  const f = fixture(); const entry = await f.reminders.set({ id: 'one', due }); f.available = false;
  await f.reminders.tick(Date.parse(later)); assert.deepEqual(f.delivered, []); assert.equal(f.reminders.entries()[0].notifiedAt, null);
  const restored = new MailReminders(f.store, f.options); f.available = true;
  await restored.tick(Date.parse(later)); assert.deepEqual(f.delivered, [1]);
  const next = await restored.set({ id: 'one', due: later }); assert.notEqual(next.token, entry.token);
  await assert.rejects(restored.remove(entry), /изменилось/);
  await restored.remove(next); await restored.tick(Date.parse(later)); assert.deepEqual(f.delivered, [1]);
});
test('privacy changing during encryption defers handoff and failed storage never submits a notification', async () => {
  const f = fixture(); await f.reminders.set({ id: 'one', due });
  f.beforeSave = async () => { f.available = false; }; await f.reminders.tick(Date.parse(later));
  assert.equal(f.reminders.entries()[0].notifiedAt, null); assert.deepEqual(f.delivered, []);
  f.available = true; f.fail = true; await f.reminders.tick(Date.parse(later));
  assert.ok(f.reminders.error); assert.deepEqual(f.delivered, []);
  f.fail = false; await f.reminders.tick(Date.parse(later)); assert.deepEqual(f.delivered, [1]); assert.equal(f.reminders.error, '');
});
test('a retired account cannot persist or deliver after a delayed write; separate accounts share no state', async () => {
  const f = fixture(); await f.reminders.set({ id: 'one', due });
  f.beforeSave = async () => { f.active = false; }; await f.reminders.tick(Date.parse(later));
  assert.equal(f.store.data.mailReminders[0].notifiedAt, null); assert.deepEqual(f.delivered, []);
  await assert.rejects(f.reminders.set({ id: 'two', due }), /Retired/);
  const other = fixture(); assert.deepEqual(other.reminders.entries(), []);
});
test('concurrent ticks dispatch once and an explicit reschedule re-arms only the new schedule', async () => {
  const f = fixture(); await f.reminders.set({ id: 'one', due });
  await Promise.all([f.reminders.tick(Date.parse(later)), f.reminders.tick(Date.parse(later))]); assert.deepEqual(f.delivered, [1]);
  await f.reminders.set({ id: 'one', due: later }); await f.reminders.tick(Date.parse(later)); assert.deepEqual(f.delivered, [1, 1]);
  await assert.rejects(f.reminders.set({ id: 'two', due: '2000-01-01T00:00:00Z' }));
});
test('reminder subjects are read without bodies, and unavailable originals do not remove schedules', async () => {
  const f = fixture(); await f.reminders.set({ id: 'one&two', due }); let request;
  const client = { ews: async (action, xml) => { assert.equal(action, 'GetItem'); request = xml; return { Message: { ItemId: { '@_Id': 'one&two' }, Subject: 'Private <b>subject</b>' } }; } };
  assert.deepEqual(await subjects(client, f.reminders.entries()), [{ id: 'one&two', subject: 'Private <b>subject</b>' }]);
  assert.match(request, /Id="one&amp;two"/); assert.match(request, /FieldURI="item:Subject"/); assert.doesNotMatch(request, /FieldURI="item:(?:Body|MimeContent|Attachments)"/);
  client.ews = async () => ({}); await assert.rejects(subjects(client, f.reminders.entries()));
  assert.equal(f.reminders.entries().length, 1); assert.doesNotMatch(JSON.stringify(f.writes), /Private|subject/);
});
test('reminder notifications use existing mail sound and reject clicks from retired sessions', () => {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const listeners = {}, sounds = [], navigation = [], notes = [];
  class Notification {
    static isSupported() { return true; }
    constructor(options) { notes.push(options); }
    on(name, callback) { listeners[name] = callback; }
    show() {}
  }
  const context = vm.createContext({ tr: value => value, Notification, privacyHidden: () => false, notificationSettings: { sounds: true }, activeNotifications: new Set(), client: { syncId: 'alice' },
    reveal: value => navigation.push(value), process: { platform: 'win32' }, path: require('node:path'), __dirname: '/fixture', window: { isDestroyed: () => false, webContents: { send: (...args) => sounds.push(args) } } });
  vm.runInContext(source.slice(source.indexOf('function notify('), source.indexOf('function closeMailReminderAlerts(')), context);
  assert.equal(context.notify('mail-reminder', 'Generic reminder', 'Open reminder list', { view: 'mail', mailReminders: true, sessionId: 'alice' }), true);
  assert.deepEqual(sounds, [['aster-sound', 'mail']]); assert.equal(notes[0].silent, true);
  listeners.click(); assert.equal(navigation.length, 1); context.client.syncId = 'bob'; listeners.click(); assert.equal(navigation.length, 1);
});

test('local reminder IPC needs no Exchange read and its optional title lookup rejects retired sessions', async () => {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = source.indexOf("      if (['mailReminders', 'mailReminderSubjects', 'setMailReminder', 'removeMailReminder'].includes(operation))");
  const end = source.indexOf("      if (['waitingReplies'", start);
  const f = fixture(); await f.reminders.set({ id: 'one', due });
  const client = { mailReminders: f.reminders };
  const c = vm.createContext({ client, activeClient: client, operation: 'mailReminders', data: {}, tr: value => value, Notification: { isSupported: () => true }, privacyHidden: () => false,
    closeMailReminderAlerts() {}, errorMessage: error => error.message, reminderSubjects: async () => { throw new Error('Offline'); } });
  const call = () => vm.runInContext(`(async()=>{${source.slice(start, end)}})()`, c);
  const local = await call(); assert.equal(local.value.entries.length, 1); assert.equal(local.value.entries[0].id, 'one');
  c.operation = 'mailReminderSubjects'; assert.equal((await call()).value.error, 'Offline');
  c.reminderSubjects = async () => { c.client = {}; return []; };
  await assert.rejects(call(), /Сессия аккаунта завершена/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NotificationTracker, preferences } = require('../desktop/notifications.cjs');
const now = Date.parse('2026-10-28T10:00:00Z');
test('first mail snapshot is a silent baseline; old and read mail do not alert', () => {
  const t = new NotificationTracker();
  const old = { id: 'old', read: false, date: new Date(now - 1000).toISOString() };
  assert.deepEqual(t.newMail([old], now), []);
  const fresh = { id: 'fresh', read: false, date: new Date(now + 1000).toISOString() };
  const read = { ...fresh, id: 'read', read: true };
  const historical = { ...old, id: 'shifted-page' };
  assert.deepEqual(t.newMail([fresh, old, read, historical], now + 60000).map(m => m.id), ['fresh']);
  assert.deepEqual(t.newMail([fresh], now + 120000), []);
});
test('meetings notify once within the lead time and moved meetings can notify again', () => {
  const t = new NotificationTracker();
  const event = { id: 'e', start: new Date(now + 10 * 60000).toISOString() };
  assert.equal(t.reminders([event], 5, now).length, 0);
  assert.equal(t.reminders([event], 15, now).length, 1);
  assert.equal(t.reminders([event], 15, now + 60000).length, 0);
  assert.equal(t.reminders([{ ...event, start: new Date(now + 14 * 60000).toISOString() }], 15, now).length, 1);
});
test('all-day, cancelled, declined, and expired events do not produce reminders', () => {
  const t = new NotificationTracker(), event = { id: 'e', start: new Date(now + 5 * 60000).toISOString() };
  assert.deepEqual(t.reminders([{ ...event, allDay: true }, { ...event, cancelled: true }, { ...event, response: 'Decline' }, { ...event, start: new Date(now - 120000).toISOString() }], 15, now), []);
});
test('zero-minute reminders tolerate one polling interval after start', () => {
  const t = new NotificationTracker(), event = { id: 'e', start: new Date(now + 30000).toISOString() };
  assert.equal(t.reminders([event], 0, now).length, 0);
  assert.equal(t.reminders([event], 0, now + 60000).length, 1);
  assert.equal(t.reminders([event], 0, now + 65000).length, 0);
});
test('settings reject invalid reminder times and preserve disabled notifications', () => {
  assert.equal(preferences({ minutes: -10 }).minutes, 15);
  assert.equal(preferences({ minutes: '30', mail: false, meetings: false, sounds: false }).minutes, 30);
  assert.equal(preferences({ mail: false }).mail, false);
});
test('both original notification sounds are valid, different PCM WAV assets', () => {
  const sounds = ['aster-mail.wav', 'aster-meeting.wav'].map(name => fs.readFileSync(path.join(__dirname, '../assets/sounds', name)));
  for (const sound of sounds) {
    assert.equal(sound.toString('ascii', 0, 4), 'RIFF'); assert.equal(sound.toString('ascii', 8, 12), 'WAVE');
    assert.equal(sound.readUInt16LE(20), 1); assert.equal(sound.readUInt32LE(24), 44100); assert.equal(sound.readUInt32LE(40) + 44, sound.length);
    assert.ok(sound.length > 44100);
  }
  assert.ok(!sounds[0].equals(sounds[1]));
});
test('server reminder settings override the default and can disable a single meeting reminder', () => {
  const now = Date.now(), tracker = new NotificationTracker();
  const start = new Date(now + 10 * 60000).toISOString();
  assert.equal(tracker.reminders([{ id: 'disabled', start, hasReminderSettings: true, reminderSet: false, reminder: 15 }], 15, now).length, 0);
  assert.equal(tracker.reminders([{ id: 'later', start, hasReminderSettings: true, reminderSet: true, reminder: 5 }], 15, now).length, 0);
  assert.equal(tracker.reminders([{ id: 'earlier', start, hasReminderSettings: true, reminderSet: true, reminder: 30 }], 5, now).length, 1);
});
test('mail alerts include sender, subject and bounded plain preview; privacy hides all three', () => {
  const { mailAlert } = require('../desktop/notifications.cjs');
  const message = { id: 'new', from: { name: 'Anna', email: 'anna@example.com' }, subject: 'Project', preview: 'Hello\nteam ' + 'a'.repeat(500) };
  const alert = mailAlert(message, true);
  assert.equal(alert.title, 'Anna'); assert.match(alert.body, /^Project\nHello team /);
  assert.ok(alert.body.length <= 248); assert.equal(alert.navigation.id, 'new');
  const hidden = mailAlert(message, false);
  assert.doesNotMatch(JSON.stringify(hidden), /Anna|anna@example.com|Project|Hello/);
});
test('slow calendar polling does not block mail and duplicate concurrent mail polls are suppressed', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const begin = source.indexOf('async function pollMail()'), end = source.indexOf('\nconst page =', begin);
  let finish, calls = 0; const alerts = [];
  const client = { mailCache: {generation:0}, inboxStatus: async () => null, messages: async options => { assert.equal(options.refresh, true); calls++; return new Promise(resolve => { finish = resolve; }); } };
  const context = vm.createContext({ tr: value => value, client, window: null, polling: true, mailPolling: false, notificationSettings: { mail: true }, tracker: { newMail: page => page }, queueMailAlert: message => ({ ...message, navigation: { id: message.id } }), mailAlert: require('../desktop/notifications.cjs').mailAlert, notify: (...args) => alerts.push(args), lastPollError: '' });
  vm.runInContext(source.slice(begin, end), context);
  const first = context.pollMail(); await context.pollMail(); assert.equal(calls, 1);
  finish({ items: [{ id: 'fresh', title: 'Anna', body: 'Preview' }] }); await first;
  assert.equal(alerts.length, 1); assert.equal(context.mailPolling, false);
  const stale = context.pollMail(); context.client = {}; finish({ items: [{ id: 'other-account' }] }); await stale;
  assert.equal(alerts.length, 1);
});
test('persistent preview queue is bounded and replaces duplicates without replaying old entries', () => {
  const vm = require('node:vm'), source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const snapshots = [];
  const context = vm.createContext({ tr: value => value, window: { isDestroyed: () => false, webContents: { send: (_channel, alerts) => snapshots.push(alerts) } }, notificationSettings: { preview: true }, mailAlert: require('../desktop/notifications.cjs').mailAlert });
  vm.runInContext(source.slice(source.indexOf('let mailAlerts ='), source.indexOf('async function pollMail()')), context);
  for (let id = 0; id < 25; id++) context.queueMailAlert({ id: String(id), from: { name: 'Anna' }, subject: 'Subject' });
  assert.equal(snapshots.at(-1).length, 20); assert.equal(snapshots.at(-1)[0].id, '24');
  context.queueMailAlert({ id: '24', from: { name: 'Pavel' } });
  assert.equal(snapshots.at(-1).length, 20); assert.equal(snapshots.at(-1)[0].title, 'Pavel');
});
test('inbox synchronizes with notifications disabled and rejects a snapshot overtaken by a mailbox write', async () => {
  const vm=require('node:vm'), source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  const snapshots=[];
  const client={syncId:'session',mailCache:{generation:0},messages:async()=>({items:[{id:'new'}],more:false}),inboxStatus:async()=>({id:'inbox',unread:1})};
  const context=vm.createContext({ tr: value => value,client,window:{isDestroyed:()=>false,webContents:{send:(channel,data)=>snapshots.push({channel,data})}},mailPolling:false,notificationSettings:{mail:false},tracker:{newMail:page=>page},queueMailAlert:()=>assert.fail('Notifications are disabled'),notify:()=>assert.fail('Notifications are disabled')});
  vm.runInContext(source.slice(source.indexOf('async function pollMail()'),source.indexOf('\nconst page =')),context);
  await context.pollMail(); assert.equal(snapshots.length,1); assert.equal(snapshots[0].channel,'aster-inbox'); assert.equal(snapshots[0].data.sessionId,'session'); assert.equal(snapshots[0].data.page.items[0].id,'new');
  client.messages=async()=>{client.mailCache.generation++;return {items:[{id:'obsolete'}]};};
  await context.pollMail(); assert.equal(snapshots.length,1);
});

test('notification content is hidden by default and explicit privacy choices survive normalization', () => {
  assert.equal(preferences().preview, false);
  assert.equal(preferences({ preview: false }).preview, false);
  assert.equal(preferences({ preview: true }).preview, true);
  const { mailAlert } = require('../desktop/notifications.cjs');
  assert.doesNotMatch(JSON.stringify(mailAlert({ id: 'm', subject: 'Secret', preview: 'Confidential', from: { name: 'Private sender' } })), /Secret|Confidential|Private sender/);
});

test('each meeting can notify at multiple independent thresholds without duplicates', () => {
  const t = new NotificationTracker(), start = new Date(now + 60 * 60000).toISOString();
  const event = { id: 'multiple', start, hasReminderSettings: true, reminderSet: false };
  const overrides = [{ id: event.id, start, minutes: [30, 10, 5] }];
  const check = minute => t.reminders([event], 15, now + minute * 60000, overrides).length;
  assert.equal(check(0), 0); assert.equal(check(30), 1); assert.equal(check(31), 0);
  assert.equal(check(50), 1); assert.equal(check(51), 0); assert.equal(check(55), 1); assert.equal(check(56), 0);
  assert.equal(new NotificationTracker().reminders([{ ...event, id: 'other' }], 15, now + 55 * 60000, overrides).length, 0);
});
test('waking coalesces missed thresholds and an empty custom schedule disables one occurrence', () => {
  const t = new NotificationTracker(), event = { id: 'repeat', start: new Date(now + 60000).toISOString() };
  const overrides = [{ id: event.id, start: event.start, minutes: [30, 10, 5, 0] }];
  assert.equal(t.reminders([event], 15, now, overrides).length, 1);
  assert.equal(t.reminders([event], 15, now + 1000, overrides).length, 0);
  assert.equal(t.reminders([event], 15, now + 60000, overrides).length, 1);
  const disabled = [{ ...overrides[0], minutes: [] }];
  assert.equal(new NotificationTracker().reminders([event], 15, now, disabled).length, 0);
  assert.equal(new NotificationTracker().reminders([{ ...event, start: new Date(now + 120000).toISOString() }], 15, now, disabled).length, 1);
});
test('custom schedules are bounded settings without meeting titles or payloads', () => {
  const { meetingReminders } = require('../desktop/notifications.cjs');
  const start = new Date(now).toISOString(), entry = { id: 'e', start, minutes: [5, 30, 5], title: 'private' };
  assert.deepEqual(meetingReminders([entry]), [{ id: 'e', start, minutes: [30, 5] }]);
  for (const minutes of [[-1], [1.5], [1441], ['5'], Array(17).fill(5)]) assert.deepEqual(meetingReminders([{ ...entry, minutes }]), []);
  assert.equal(meetingReminders(Array(250).fill(entry)).length, 200);
  assert.equal(preferences({ meetingReminders: [entry] }).meetingReminders.length, 1);
  assert.equal(preferences().meetingReminders.length, 0);
});

test('common intervals apply to every eligible meeting and individual schedules replace them', () => {
  const t = new NotificationTracker(), start = new Date(now + 30 * 60000).toISOString();
  const events = ['a', 'b', 'c'].map(id => ({ id, start, hasReminderSettings: true, reminderSet: false }));
  const overrides = [{ id: 'b', start, minutes: [10] }, { id: 'c', start, minutes: [] }];
  assert.deepEqual(t.reminders(events, 15, now, overrides, [30, 5]).map(e => e.id), ['a']);
  assert.deepEqual(t.reminders(events, 15, now + 20 * 60000, overrides, [30, 5]).map(e => e.id), ['b']);
  assert.deepEqual(t.reminders(events, 15, now + 25 * 60000, overrides, [30, 5]).map(e => e.id), ['a']);
  assert.deepEqual(new NotificationTracker().reminders(events, 15, now, [], []), []);
  for (const event of [{ ...events[0], allDay: true }, { ...events[0], cancelled: true }, { ...events[0], response: 'Declined' }]) assert.equal(t.reminders([event], 15, now, [], [30]).length, 0);
  assert.deepEqual(preferences({ meetingMinutes: [5, 30, 5] }).meetingMinutes, [30, 5]);
  assert.equal(preferences({ meetingMinutes: [-1] }).meetingMinutes, null);
  assert.deepEqual(preferences({ meetingMinutes: [] }).meetingMinutes, []);
});

test('saving individual reminders checks the current occurrence and account before persisting settings', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const block = source.slice(source.indexOf("      if (operation === 'saveMeetingReminders')"), source.indexOf("      if (operation === 'saveLocalData')"));
  const start = new Date(now + 3600000).toISOString(), writes = [];
  const activeClient = { eventDetails: async () => ({ id: 'event', start }) };
  const context = vm.createContext({ tr: value => value, require: name => { assert.equal(name, './notifications.cjs'); return require('../desktop/notifications.cjs'); }, preferences,
    operation: 'saveMeetingReminders', activeClient, client: activeClient, notificationSettings: preferences({ meetingMinutes: [30, 5] }),
    localStore: { save: async (patch, guard) => { guard(); writes.push(patch); } },
    data: { ref: { id: 'event' }, start, custom: true, minutes: [30, 10, 5] },
  });
  const run = () => vm.runInContext(`(async () => { ${block} })()`, context);
  await run(); assert.equal(writes.length, 1); assert.deepEqual(writes[0].notifications.meetingMinutes, [30, 5]);
  assert.deepEqual(writes[0].notifications.meetingReminders[0], { id: 'event', start, minutes: [30, 10, 5] });
  context.data.custom = false; await run(); assert.equal(writes[1].notifications.meetingReminders.length, 0);
  activeClient.eventDetails = async () => ({ id: 'event', start: new Date(now).toISOString() });
  await assert.rejects(run(), /Встреча изменилась/); assert.equal(writes.length, 2);
  activeClient.eventDetails = async () => { context.client = {}; return { id: 'event', start }; };
  await assert.rejects(run(), /Сессия аккаунта завершена/); assert.equal(writes.length, 2);
});

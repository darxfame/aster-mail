const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sharingAppRunning, SharingPrivacy } = require('../desktop/sharing-privacy.cjs');
test('automatic privacy conservatively recognises known calling apps and browsers, never the app itself', () => {
  for (const name of ['zoom.us', 'Microsoft Teams', 'Google Chrome', 'Safari', 'OBS']) assert.equal(sharingAppRunning(`/Applications/${name}.app/Contents/MacOS/${name}\n`, 'darwin'), true);
  for (const name of ['ms-teams.exe', 'Zoom.exe', 'chrome.exe', 'obs64.exe']) assert.equal(sharingAppRunning(`"${name}","123","Console","1","1 K"`, 'win32'), true);
  assert.equal(sharingAppRunning('/Applications/Aster Mail.app/Contents/MacOS/Aster Mail\n/usr/sbin/replayd', 'darwin'), false);
  assert.equal(sharingAppRunning('/Applications/NotZoom.app/Contents/MacOS/NotZoom', 'darwin'), false);
});
test('privacy checks coalesce; failures return unknown and changes are published once', async () => {
  let finish, reads = 0, changes = 0;
  const policy = new SharingPrivacy({ read: () => { reads++; return new Promise(resolve => { finish = resolve; }); }, changed: () => changes++ });
  const first = policy.check(), second = policy.check(); assert.equal(reads, 1);
  finish(true); await Promise.all([first, second]); assert.equal(policy.active, true); assert.equal(changes, 1);
  policy.read = async () => true; await policy.check(); assert.equal(changes, 1);
  policy.read = async () => { throw new Error('permission denied'); }; await policy.check(); assert.equal(policy.active, null); assert.equal(changes, 2);
});
test('tray snapshots redact before IPC and never contain bodies, participants or meeting URLs', () => {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  let hidden = false;
  const context = vm.createContext({ tr: value => value, privacyHidden: () => hidden,
    notificationSettings: { preview: false, interfaceScale: 1 }, client: {}, account: { server: 'https://mail.example.test' }, presentationMode: false,
    widgetEvents: [{ id: 'e', title: 'Secret title', body: 'Secret body', organizer: { name: 'Private person' }, joinUrl: 'https://meet.example.test/secret', start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z' }],
    upcomingMeetings: events => events, meetingLink: e => e.joinUrl, pollingRange: () => ({}), countdown: () => ({}), dismissedMeetings: new Set(), mailAlerts: [], i18n: { language: 'ru' }, lastPoll: null, lastMailError: '', lastPollError: '', errorMessage: value => value });
  vm.runInContext(source.slice(source.indexOf('function widgetState('), source.indexOf('function refreshWidget(')), context);
  let snapshot = context.widgetState();
  assert.doesNotMatch(JSON.stringify(snapshot), /Secret|Private person|meet.example/);
  assert.equal(snapshot.calendarEvents.length, 1);
  context.notificationSettings.preview = true;
  snapshot = context.widgetState(); assert.match(JSON.stringify(snapshot), /Secret title/); assert.doesNotMatch(JSON.stringify(snapshot), /Secret body|Private person|meet.example/);
  hidden = true; snapshot = context.widgetState();
  assert.equal(snapshot.events.length, 0); assert.equal(snapshot.calendarEvents.length, 0); assert.equal(snapshot.mailAlerts.length, 0);
});
test('activating privacy closes already shown alerts and never replays them on exit', () => {
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const sends = [], closed = [];
  const context = vm.createContext({ notificationSettings: { autoPrivacy: true }, SharingPrivacy: class { constructor() { this.active = false; } },
    activeNotifications: new Set([{ close: () => closed.push(true) }]), mailAlerts: ['private'], publishMailAlerts() { sends.push([...context.mailAlerts]); }, refreshWidget() {}, updateTrayMenu() {} });
  vm.runInContext(source.slice(source.indexOf('let presentationMode ='), source.indexOf('let dismissedMeetings =')), context);
  context.syncNotificationPrivacy(); context.mailAlerts = ['private'];
  vm.runInContext('sharingPrivacy.active = true; syncNotificationPrivacy();', context);
  assert.equal(context.mailAlerts.length, 0); assert.equal(closed.length, 1);
  vm.runInContext('sharingPrivacy.active = false; syncNotificationPrivacy();', context);
  assert.equal(sends.at(-1).length, 0); assert.equal(context.activeNotifications.size, 0);
});

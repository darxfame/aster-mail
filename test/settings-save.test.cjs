const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
function settings({ changed = {}, apiError, sync = true } = {}) {
  const calls = [], writes = [], form = { id: 'settings-form', querySelector: () => ({ hidden: true, dataset: {} }), querySelectorAll: () => [] };
  const data = { notifyMail: 'on', notifyMeetings: 'on', notifySounds: 'on', autoPrivacy: 'on', interfaceScale: '1', minutes: '15', timeZone: 'system', theme: 'light', language: 'ru', navigationPlacement: 'sidebar', syncSignature: sync ? 'on' : undefined, signature: 'Edited local signature', debugErrors: 'on', ...changed };
  let pending;
  const context = vm.createContext({ form, tr: value => value, state: { view: 'mail', account: { sessionId: 'fictional' }, theme: 'light', signature: 'Original signature' },
    window: { aster: {}, asterI18n: { language: 'ru' } }, notificationPreferences: {}, timeZone: 'system', navigationPlacement: 'sidebar', syncSignature: sync,
    T: { zone() {} }, submitForm(_form, operation) { pending = operation(data); }, api: async (operation, value) => { calls.push(operation); if (apiError) throw apiError; return value; },
    localPreferences: { setItem: (key, value) => writes.push([key, value]) }, localSave: Promise.resolve(), clearError() {}, applyLanguage() {}, applyInterfaceScale: async () => {},
    renderSidebar() {}, renderMail() { calls.push('renderMail'); }, renderCalendar() { calls.push('renderCalendar'); }, renderContacts() { calls.push('renderContacts'); },
    getServerSignature: async () => { calls.push('signature'); throw new Error('OWA unavailable'); }, loadView: async () => { calls.push('loadView'); throw new Error('OWA unavailable'); },
    ready: () => true, welcome() {}, document: { body: { classList: { toggle() {} } } }, $: () => ({ close() { calls.push('close'); } }), toast() {}, miniMonthCursor: null,
  });
  const begin = source.indexOf("  if (form.id === 'settings-form') {"), end = source.indexOf("  if (form.id === 'connect-form')", begin);
  vm.runInContext(`async function save() { ${source.slice(begin, end)} }`, context);
  return { calls, writes, context, async save() { await context.save(); return pending; } };
}
test('saving debug settings while OWA is unavailable performs only local writes and preserves the reader', async () => {
  const f = settings();
  await f.save();
  assert.deepEqual(f.calls, ['saveNotifications', 'close']);
  assert.equal(f.context.notificationPreferences.debugErrors, true);
  assert.equal(f.context.syncSignature, true);
  assert.ok(f.writes.some(([key, value]) => key === 'aster-signature-sync' && value === 'true'));
});
test('display changes repaint cached data without reloading Exchange and local signatures still save', async () => {
  const f = settings({ changed: { theme: 'dark' }, sync: false });
  await f.save();
  assert.deepEqual(f.calls, ['saveNotifications', 'close', 'renderMail']);
  assert.equal(f.context.state.signature, 'Edited local signature');
});
test('a local settings write failure stays an error and leaves the form open', async () => {
  const f = settings({ apiError: new Error('Local storage unavailable') });
  await assert.rejects(f.save(), /Local storage unavailable/);
  assert.deepEqual(f.calls, ['saveNotifications']);
});
test('backend saves debug preferences without polling OWA and retains session guards', async () => {
  const main = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const start = main.indexOf("      if (operation === 'saveNotifications') {"), end = main.indexOf("      if (operation === 'testNotification')", start);
  const preferences = require('../desktop/notifications.cjs').preferences;
  for (const mode of ['connected', 'stale', 'retired', 'storage-failure']) {
    let saves = 0;
    const context = vm.createContext({ require, tr: value => value, operation: 'saveNotifications', data: { sessionId: mode === 'stale' ? 'old' : 'current', timeZone: 'system', debugErrors: true },
      preferences, notificationSettings: preferences(), client: { syncId: 'current' }, connection: {},
      localStore: { async save(_value, guard) { saves++; if (mode === 'storage-failure') throw new Error('Local storage unavailable'); if (mode === 'retired') context.connection = {}; guard(); } },
      sharingPrivacy: {}, syncNotificationPrivacy() {}, i18n: { setLanguage() {} }, updateTrayMenu() {}, tracker: {}, mailAlerts: [], publishMailAlerts() {}, activeNotifications: new Set(),
      refreshPrivacy: async () => {}, refreshWidget() {}, pollNotifications() { assert.fail('Local settings must not poll OWA'); },
    });
    vm.runInContext(`async function save() { ${main.slice(start, end)} }`, context);
    if (mode === 'connected') {
      const result = await context.save(); assert.equal(result.ok, true); assert.equal(result.value.debugErrors, true); assert.equal(saves, 1);
    } else {
      await assert.rejects(context.save(), mode === 'storage-failure' ? /Local storage unavailable/ : /Сессия аккаунта завершена/);
      assert.equal(context.notificationSettings.debugErrors, false); assert.equal(saves, mode === 'stale' ? 0 : 1);
    }
  }
});

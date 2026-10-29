const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');

test('logout clears renderer corporate data, signatures, drafts, meetings and local preference copies', () => {
  const nodes = { '#search': { value: 'private query' }, '#people-search-suggestions': { replaceChildren() { this.cleared = true; } } };
  const context = vm.createContext({
    window: { asterMailFind: { reset() { nodes.findCleared = true; } } },
    state: { account: { sessionId: 'old' }, generation: 1, selected: { html: 'private mail' }, messages: ['private'], contacts: ['private'], events: ['private'], signature: 'private' },
    localValues: { 'aster-signature': 'private' }, localSave: Promise.resolve(),
    localPreferences: { getItem: () => null },
    messageOpenSequence: 1, readingMessages: new Map([['mail', Promise.resolve()]]),
    mailSelection: new Set(['private-mail-id']), mailSelectionScope: 'old-account',
    serverSignature: { html: 'private' }, composeData: { body: 'private draft' }, activeMeeting: { body: 'private' }, meetingEdit: {}, meetingRequest: 1,
    moveRuleContext: {}, mailDrag: {}, mailPeopleChoices: ['private'], colleagueData: ['private'], directoryResults: ['private'], directoryRequest: 1, colleagueRequest: 1,
    document: { body: { classList: { toggle() {} } } }, $: key => nodes[key], renderMailAlerts() {}, renderSidebar() {},
  });
  vm.runInContext(source.slice(source.indexOf('function applyAccount('), source.indexOf('async function boot()')), context);
  context.applyAccount(null);
  assert.equal(nodes.findCleared, true);
  assert.equal(context.state.account, null); assert.equal(context.state.signature, ''); assert.equal(context.state.selected, null);
  for (const key of ['messages', 'contacts', 'events', 'folders']) assert.equal(context.state[key].length, 0);
  for (const key of ['serverSignature', 'composeData', 'activeMeeting', 'meetingEdit', 'moveRuleContext', 'mailDrag']) assert.equal(context[key], null);
  assert.equal(context.readingMessages.size, 0); assert.equal(Object.keys(context.localValues).length, 0);
  assert.equal(context.mailSelection.size, 0); assert.equal(context.mailSelectionScope, '');
  assert.equal(nodes['#search'].value, ''); assert.equal(nodes['#people-search-suggestions'].cleared, true);
  assert.equal(context.notificationPreferences.preview, false);
  context.localPreferences.getItem = key => context.localValues[key] ?? null;
  context.applyAccount({ server: 'https://mail.example.com', username: 'bob', sessionId: 'new', localData: { 'aster-signature': 'Bob signature' }, notifications: { preview: true } });
  assert.equal(context.state.signature, 'Bob signature'); assert.equal(context.notificationPreferences.preview, true);
  assert.equal(context.state.account.localData, undefined);
});

test('a renderer request carries its original session and discards late results after account switch', async () => {
  let complete, observed;
  const context = vm.createContext({
    state: { account: { sessionId: 'alice' } }, mailWrites: 0, mailWriteEpoch: 0,
    window: { aster: { invoke: (operation, data) => { observed = { operation, data }; return new Promise(resolve => { complete = resolve; }); } } },
  });
  vm.runInContext(source.slice(source.indexOf('async function api('), source.indexOf('let pendingMailAlerts')), context);
  const pending = context.api('message', { id: 'private' });
  assert.equal(observed.data.sessionId, 'alice');
  context.state.account = { sessionId: 'bob' }; complete({ ok: true, value: { html: 'Alice private mail' } });
  await assert.rejects(pending, /Сессия аккаунта завершена/);
});

test('a superseded login cannot publish a client or credentials after another account connects', async () => {
  const mainSource = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  const attempts = [], sessions = [], saved = [];
  class FakeClient {
    constructor(account, transport, cookieToken, clearCookies) {
      this.account = account; this.transport = transport; this.cookieToken = cookieToken; this.clearCookies = clearCookies;
      this.mailCache = { clear() {} }; this.photoCache = new Map(); attempts.push(this);
    }
    authenticate() { return new Promise(resolve => { this.finish = resolve; }); }
  }
  const context = vm.createContext({
    OWAClient: FakeClient, client: null, connection: null, account: null, accountEpoch: 0, resettingLocalData: false, AbortController,
    attachmentFiles: { clear: async () => {} },
    crypto: require('node:crypto'), normalizeServer: value => new URL(value).origin,
    session: { fromPartition: id => { const value = { id, clearStorageData: async () => {}, cookies: { get: async () => [{ value: id }] } }; sessions.push(value); return value; } },
    createTransport: (_net, account, session, signal) => Object.assign(() => {}, { account, session, signal }), net: {}, fetchContentImage() {},
    localStore: { requireEncryption() {}, load: async (_owner, guard) => { guard(); return {}; }, saveCredentials: async (account, guard) => { guard(); saved.push(account.username); }, removeCredentials: async guard => guard() },
    mailAlerts: [], publishMailAlerts() {}, NotificationTracker: class {}, preferences: () => ({ preview: false }), refreshWidget() {}, activeNotifications: new Set(), pollNotifications() {},
  });
  vm.runInContext(mainSource.slice(mainSource.indexOf('function retireAccount('), mainSource.indexOf('\nconst methods')), context);
  const first = context.connect({ server: 'https://mail.example.com', username: 'alice', password: 'fictional-A' }, true);
  await new Promise(resolve => setImmediate(resolve));
  const second = context.connect({ server: 'https://mail.example.com', username: 'bob', password: 'fictional-B' }, true);
  await new Promise(resolve => setImmediate(resolve));
  attempts[1].finish(); const connected = await second;
  attempts[0].finish(); await assert.rejects(first, /Сессия аккаунта завершена/);
  assert.equal(context.client.account.username, 'bob'); assert.equal(connected.username, 'bob');
  assert.deepEqual(saved, ['bob']); assert.equal(attempts[0].transport.signal.aborted, true); assert.equal(attempts[0].account.password, '');
  assert.notEqual(attempts[0].transport.session.id, attempts[1].transport.session.id);
  assert.equal(await attempts[1].cookieToken(), sessions[2].id);
  assert.throws(() => attempts[0].clearCookies(), /Сессия аккаунта завершена/);
});

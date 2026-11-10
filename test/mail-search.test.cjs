const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { OWAClient } = require('../desktop/owa.cjs');
const source = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
const S = require('../src/mail-search.js');
function client(handler) {
  const calls = [];
  const value = new OWAClient({ server: 'https://mail.example.com', username: 'fictional', password: 'fictional' }, async (url, options) => {
    const body = JSON.parse(options.body).Body; calls.push({ url, body });
    return { status: 200, text: JSON.stringify({ Body: await handler(body) }) };
  }, async () => 'canary');
  value.canary = 'canary'; return { value, calls };
}
function renderer(extra = {}) {
  const context = vm.createContext({ tr: value => value, contactHistoryBody: () => '', mountContactHistory() {}, ...extra });
  vm.runInContext(source.slice(source.indexOf('function mailRecipientDetails(')), context);
  return context;
}
test('calendar and personal contact search use OWA FindItem AQS without a loaded calendar window or EWS', async () => {
  const { value, calls } = client(body => ({ RootFolder: { Items: body.ParentFolderIds[0].Id === 'calendar' ? [{ ItemId: { Id: 'event' }, Subject: 'Fictional event', Start: '2027-06-01T09:00:00Z', End: '2027-06-01T10:00:00Z', CalendarItemType: 'RecurringMaster' }] : [{ ItemId: { Id: 'contact' }, DisplayName: 'Fictional person', EmailAddresses: [{ Value: 'person@example.com' }] }], IncludesLastItemInRange: false, IndexedPagingOffset: body.Paging.Offset + 50 } }));
  const event = await value.search({ kind: 'calendar', query: 'budget', offset: 0 });
  assert.equal(event.items[0].start, '2027-06-01T09:00:00.000Z'); assert.equal(event.items[0].recurring, true);
  const contact = await value.search({ kind: 'contacts', query: 'person@example.com', offset: 50 });
  assert.equal(contact.items[0].email, 'person@example.com'); assert.equal(contact.nextOffset, 100);
  assert.equal(calls[0].body.QueryString.Value, 'budget'); assert.equal(calls[1].body.Paging.Offset, 50);
  assert.equal(calls.every(call => call.url.includes('/owa/service.svc')), true);
  assert.equal(calls.some(call => call.body.CalendarView || call.body.RangeStart), false);
});
test('invalid search kinds, offsets and stalled pages fail without silent partial success', async () => {
  const { value, calls } = client(() => ({ RootFolder: { Items: [], IncludesLastItemInRange: false } }));
  await assert.rejects(value.search({ kind: 'tasks', query: 'x' }), /тип/);
  await assert.rejects(value.search({ kind: 'calendar', query: 'x', offset: -1 }), /запрос/);
  assert.equal(calls.length, 0);
  await assert.rejects(value.search({ kind: 'calendar', query: 'x' }), /продвинул/);
});
test('mail filters compile bounded AQS with explicit US dates, quoted people and inclusive ranges', () => {
  assert.equal(S.query({ text: 'budget OR report', from: 'Alex Example', to: 'person@example.com', start: '2026-11-01', end: '2026-11-10', attachments: 'yes' }), '(budget OR report) AND from:"Alex Example" AND to:"person@example.com" AND received:11/01/2026..11/10/2026 AND hasattachment:true');
  assert.equal(S.query({ folder: 'inbox' }), '*');
  assert.equal(S.query({ start: '2026-11-01', attachments: 'no' }), 'received:>=11/01/2026 AND hasattachment:false');
  assert.equal(S.query({ end: '2026-11-10' }), 'received:<=11/10/2026');
  for (const input of [{ from: 'a" OR from:b' }, { to: 'a\\b' }, { from: {} }, { start: '2026-02-30' }, { start: '2026-13-01' }, { start: '2026-11-10', end: '2026-11-01' }, { attachments: 'maybe' }, { text: 'x'.repeat(2001) }, { text: 'x'.repeat(1999), from: 'a' }]) assert.throws(() => S.query(input));
});
test('scoped mail search uses shallow OWA FindItem, filters before paging and honors the server cursor', async () => {
  const { value, calls } = client(() => ({ RootFolder: { Items: [{ ItemId: { Id: 'older-match' }, Subject: 'Older mail', From: { Mailbox: { EmailAddress: 'alex@example.com' } }, HasAttachments: true }], IncludesLastItemInRange: false, IndexedPagingOffset: 120 } }));
  const query = S.query({ from: 'alex@example.com', attachments: 'yes' });
  const result = await value.search({ kind: 'mail', query, folder: 'real-folder-id', offset: 50 });
  assert.equal(result.items[0].id, 'older-match'); assert.equal(result.items[0].hasAttachments, true); assert.equal(result.nextOffset, 120);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /action=FindItem/);
  assert.equal(calls[0].body.ParentFolderIds[0].Id, 'real-folder-id');
  assert.equal(calls[0].body.Traversal, 'Shallow'); assert.equal(calls[0].body.Paging.Offset, 50);
  assert.equal(calls[0].body.QueryString.Value, query); assert.equal(calls[0].body.ShapeName, 'MailListItem');
  for (const folder of [{}, false, null, 0, ' ', 'x'.repeat(16001), 'folder\n']) await assert.rejects(value.search({ kind: 'mail', query: 'report', folder }));
  assert.equal(calls.length, 1);
});
test('folder-only search omits AQS and rejects stalled pages and access errors', async () => {
  const { value, calls } = client(() => ({ RootFolder: { Items: [], IncludesLastItemInRange: true } }));
  assert.equal((await value.search({ query: '*', folder: 'inbox' })).more, false);
  assert.equal(calls[0].body.QueryString, undefined);
  const stalled = client(() => ({ RootFolder: { Items: [], IncludesLastItemInRange: false, IndexedPagingOffset: 50 } }));
  await assert.rejects(stalled.value.search({ query: 'report', folder: 'inbox' }), /продвинул/);
  const denied = client(() => ({ ResponseMessages: { Items: [{ ResponseCode: 'ErrorAccessDenied' }] } }));
  await assert.rejects(denied.value.search({ query: 'report', folder: 'inbox' }), /ErrorAccessDenied/);
});
test('advanced filters search only mail and retain folder/unread/flag constraints on every page', async () => {
  const calls = [];
  const context = renderer({ api: async (_operation, data) => { calls.push(data); return { items: [], more: false }; } });
  await context.searchMailbox('from:"alex@example.com"', 'unread', 50, { folder: 'inbox' });
  assert.equal(calls.length, 1); assert.equal(calls[0].folder, 'inbox'); assert.equal(calls[0].offset, 50);
  assert.equal(calls[0].query, '(from:"alex@example.com") AND isread:false');
  calls.length = 0;
  await context.searchMailbox('*', 'flagged', 0, { folder: 'inbox' });
  assert.equal(calls.length, 1); assert.equal(calls[0].query, 'isflagged:true');
});
test('demo filters require the requested sender, To recipient, UTC day, folder and attachment state together', () => {
  const message = { from: { name: 'Alex', email: 'alex@example.com' }, to: [{ email: 'to@example.com' }], cc: [{ email: 'cc@example.com' }], folder: 'inbox', hasAttachments: true, date: '2026-11-10T23:59:59Z', subject: 'Budget', text: 'Report', attachments: [] };
  const criteria = { from: 'alex', to: 'to@example.com', folder: 'inbox', start: '2026-11-10', end: '2026-11-10', attachments: 'yes', text: 'report' };
  assert.equal(S.matches(message, criteria), true);
  for (const patch of [{ to: 'cc@example.com' }, { from: 'other' }, { folder: 'sentitems' }, { end: '2026-11-09', start: '' }, { attachments: 'no' }]) assert.equal(S.matches(message, { ...criteria, ...patch }), false);
  assert.equal(S.matches({ ...message, date: null }, criteria), false);
});
test('one failed search source preserves other results and reports the failure; mail paging stays independent', async () => {
  const calls = [];
  const context = renderer({ api: async (_method, data) => {
    calls.push(data);
    if (data.kind === 'calendar') throw new Error('Calendar access denied');
    return { items: [{ id: data.kind }], more: false };
  } });
  const result = await context.searchMailbox('budget', 'all');
  assert.equal(result.items[0].id, 'mail'); assert.equal(result.related.contacts.items[0].id, 'contacts');
  assert.match(result.related.calendar.error, /access denied/); assert.equal(calls.length, 3);
  calls.length = 0;
  await context.searchMailbox('budget', 'all', 50);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'mail'); assert.equal(calls[0].offset, 50);
});
test('demo search finds body text, cc recipients and attachment names as well as standalone events and contacts', () => {
  const context = renderer({ window: {}, structuredClone });
  vm.runInContext(fs.readFileSync(require.resolve('../src/demo.js'), 'utf8'), context);
  for (const query of ['План проекта.pdf', 'irina.novikova@example.com', 'приоритетах']) assert.ok(context.demoMailSearch(query).items.length, query);
  const result = context.demoMailSearch('Анна');
  assert.ok(result.items.length); assert.ok(result.related.calendar.items.length); assert.ok(result.related.contacts.items.length);
});
test('contact directory results cannot repaint a closed dialog or overwrite another recipient with a similar name', async () => {
  let resolve, updates = 0;
  const dialog = { open: true }, fields = new Map();
  const context = renderer({ state: { account: {}, generation: 1, contacts: [], demo: false }, modalBusy: false, modalSequence: 0,
    colleagues: () => [], avatar: () => '', icon: () => '', esc: value => String(value),
    $: selector => selector === '#modal' ? dialog : { querySelector: selector => { updates++; if (!fields.has(selector)) fields.set(selector, {}); return fields.get(selector); } },
    api: () => new Promise(done => { resolve = done; }),
    modal() { context.modalSequence++; },
  });
  const pending = context.openContactCard({ name: 'Same Name', email: 'one@example.com' }, true);
  dialog.open = false; resolve({ items: [{ name: 'Same Name', email: 'other@example.com' }] }); await pending;
  assert.equal(updates, 0);
  dialog.open = true;
  const next = context.openContactCard({ name: 'Same Name', email: 'one@example.com' }, true);
  resolve({ items: [{ name: 'Same Name', email: 'other@example.com', company: 'Wrong company' }] }); await next;
  assert.equal(context.currentContactCard().person.email, 'one@example.com');
  assert.equal(context.currentContactCard().person.company, undefined);
  assert.doesNotMatch(fields.get('[data-contact-field="status"]').textContent, /Сведения из справочника/);
});

test('pending object pages are discarded after navigation or account retirement', async () => {
  let finish, renders = 0;
  const group = { items: [{ id: 'first' }], nextOffset: 50 };
  const state = { generation: 1, query: 'old', searchObjects: { calendar: group } };
  const context = renderer({ state, api: () => new Promise(resolve => { finish = resolve; }), renderMessages() { renders++; } });
  const pending = context.moreSearchObjects({ dataset: { kind: 'calendar' } });
  state.generation++; state.query = 'new'; state.searchObjects = null;
  finish({ items: [{ id: 'stale' }], more: false }); await pending;
  assert.equal(state.searchObjects, null); assert.equal(renders, 0);
});
test('mail source failure is visible even when calendar search succeeds', async () => {
  const context = renderer({ api: async (_method, data) => {
    if (data.kind === 'mail') throw new Error('Mail search unavailable');
    return { items: [{ id: data.kind }], more: false };
  } });
  const result = await context.searchMailbox('budget', 'all');
  assert.equal(result.items.length, 0); assert.match(result.related.mail.error, /unavailable/);
  assert.equal(result.related.calendar.items[0].id, 'calendar');
});

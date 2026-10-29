const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { OWAClient } = require('../desktop/owa.cjs');
const source = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
function client(handler) {
  const calls = [];
  const value = new OWAClient({ server: 'https://mail.example.com', username: 'fictional', password: 'fictional' }, async (url, options) => {
    const body = JSON.parse(options.body).Body; calls.push({ url, body });
    return { status: 200, text: JSON.stringify({ Body: await handler(body) }) };
  }, async () => 'canary');
  value.canary = 'canary'; return { value, calls };
}
function renderer(extra = {}) {
  const context = vm.createContext({ ...extra });
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

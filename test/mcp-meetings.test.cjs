const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { OWAClient } = require('../desktop/owa.cjs');
const { createTools } = require('../desktop/mcp-tools.cjs');
const T = require('../src/time.js');
const sessionId = 'fictional-session';
const start = '2027-03-28T08:00:00Z', end = '2027-03-28T09:00:00Z';
const ok = '<Envelope><ResponseCode>NoError</ResponseCode></Envelope>';
function fixture() {
  const calls = [], approvals = [], writes = [];
  const state = { key: 'key', allowed: true, response: 'Organizer', lost: false, retired: false };
  const event = (master = false) => `<Envelope><ResponseCode>NoError</ResponseCode><Items><CalendarItem><ItemId Id="${master ? 'master' : 'event'}" ChangeKey="${master ? 'master-' : ''}${state.key}"/><Subject>Planning</Subject><Start>${start}</Start><End>${end}</End><Body BodyType="HTML">&lt;p&gt;Fictional meeting&lt;/p&gt;</Body><MyResponseType>${state.response}</MyResponseType><CalendarItemType>${master ? 'RecurringMaster' : 'Occurrence'}</CalendarItemType><IsRecurring>true</IsRecurring><EffectiveRights><Modify>true</Modify></EffectiveRights><RequiredAttendees><Attendee><Mailbox><EmailAddress>anna@example.test</EmailAddress></Mailbox></Attendee></RequiredAttendees></CalendarItem></Items></Envelope>`;
  const active = new OWAClient({ server: 'https://mail.example.test', username: 'DOMAIN\\fictional', password: 'do-not-expose' }, async (url, options) => {
    const action = options.headers.SOAPAction?.match(/\/([^/]+)"$/)?.[1] || new URL(url).searchParams.get('action');
    calls.push({ action, options });
    if (action === 'GetItem') return { status: 200, text: event(options.body.includes('RecurringMasterItemId')) };
    if (action === 'CreateItem' || action === 'UpdateItem') { if (state.lost) throw new Error('Lost response'); return { status: 200, text: ok }; }
    if (action === 'GetCalendarView') return { status: 200, text: JSON.stringify({ Body: { Items: [{ ItemId: { Id: 'event', ChangeKey: 'key' }, Subject: 'Planning', Start: start, End: end, IsOrganizer: false, MyResponseType: 'Unknown', Password: 'do-not-expose' }] } }) };
    if (action === 'FindItem') return { status: 200, text: JSON.stringify({ Body: { RootFolder: { Items: [{ ItemId: { Id: 'event', ChangeKey: 'key' }, Subject: 'Planning', Start: start, End: end }], IncludesLastItemInRange: false, IndexedPagingOffset: 120 } } }) };
    throw new Error(`Unexpected fixture operation: ${action}`);
  }, async () => 'fictional-canary');
  active.canary = 'fictional-canary'; active.syncId = sessionId;
  active.identity = async () => ({ email: 'self@example.test' });
  const call = createTools({ current: () => state.retired ? null : active, confirm: async context => { approvals.push(context); state.afterApproval?.(); return state.allowed; }, writing: (delta, _active, name) => writes.push([delta, name]) });
  return { active, state, call, calls, approvals, writes };
}
const update = changes => ({ sessionId, id: 'event', scope: 'single', expectedChangeKey: 'key', changes });
test('meeting reads and searches use existing OWA/EWS paths without accepting invitations', async () => {
  const f = fixture();
  const list = await f.call('list_meetings', { sessionId, start, end });
  assert.equal(list.items[0].title, 'Planning'); assert.equal(list.items[0].isOrganizer, false);
  assert.equal(list.complete, false); assert.equal(JSON.stringify(list).includes('do-not-expose'), false);
  const page = await f.call('search_meetings', { sessionId, query: 'Planning', offset: 50 });
  assert.equal(page.nextOffset, 120); assert.equal(page.more, true);
  const search = JSON.parse(f.calls.find(call => call.action === 'FindItem').options.body);
  assert.equal(search.Body.QueryString.Value, 'Planning');
  const detail = await f.call('read_meeting', { sessionId, id: 'event', scope: 'series' });
  assert.equal(detail.scope, 'series'); assert.equal(detail.id, 'master'); assert.equal(detail.changeKey, 'master-key');
  assert.equal(detail.html, '<p>Fictional meeting</p>');
  assert.equal(f.calls.some(call => ['CreateItem', 'UpdateItem'].includes(call.action)), false);
  assert.equal(f.approvals.length, 0);
});
test('invalid ranges, dates, recipients and meeting changes are rejected before approval or writes', async () => {
  const f = fixture();
  for (const input of [{ start: '2027-03-28T08:00', end }, { start: '2027-02-30T08:00:00Z', end }, { start: end, end: start }, { start, end: '2027-05-01T09:00:00Z' }]) await assert.rejects(f.call('list_meetings', { sessionId, ...input }));
  await assert.rejects(f.call('create_meeting', { sessionId, title: 'New', start, end, attendees: ['name,other@example.test'] }));
  await assert.rejects(f.call('create_meeting', { sessionId, title: 'New', start, end, allDay: true }));
  await assert.rejects(f.call('update_meeting', { ...update({ title: 'New' }), scope: undefined }));
  await assert.rejects(f.call('update_meeting', update({})), /изменений/);
  await assert.rejects(f.call('update_meeting', update({ reminderSet: 'true' })));
  await assert.rejects(f.call('update_meeting', update({ reminder: -1 })));
  await assert.rejects(f.call('update_meeting', update({ recurrence: {} })));
  assert.equal(f.approvals.length, 0); assert.equal(f.calls.some(call => ['CreateItem', 'UpdateItem'].includes(call.action)), false);
});
test('meeting creation skips native approval, escapes plain text and sends exactly one invitation write', async () => {
  const f = fixture(), input = { sessionId, title: 'Planning <&>', body: 'Line 1\n<script>literal</script>', start, end, attendees: ['ANNA@example.test', 'anna@example.test'] };
  f.state.allowed = false;
  assert.equal(await f.call('create_meeting', input), true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'CreateItem');
  assert.equal(f.approvals.length, 0);
  const xml = f.calls[0].options.body;
  assert.match(xml, /SendMeetingInvitations="SendToAllAndSaveCopy"/);
  assert.match(xml, /Planning &lt;&amp;&gt;/); assert.match(xml, /BodyType="Text"/);
  assert.match(xml, /Line 1\n&lt;script&gt;literal&lt;\/script&gt;/);
  assert.equal((xml.match(/<t:Attendee>/g) || []).length, 1);
  assert.deepEqual(f.writes, [[1, 'create_meeting'], [-1, 'create_meeting']]);
});
test('organizer moves preserve duration, use NeverOverwrite and notify attendees', async () => {
  const f = fixture();
  await f.call('update_meeting', update({ start: '2027-03-28T10:30:00Z' }));
  assert.deepEqual(f.calls.map(call => call.action), ['GetItem', 'GetItem', 'UpdateItem']);
  const xml = f.calls.at(-1).options.body;
  assert.match(xml, /NeverOverwrite/); assert.match(xml, /ChangeKey="key"/); assert.match(xml, /SendToAllAndSaveCopy/);
  assert.match(xml, /2027-03-28T10:30:00.000Z/); assert.match(xml, /2027-03-28T11:30:00.000Z/);
  assert.doesNotMatch(xml, /item:Body|RequiredAttendees|Recurrence/);
  assert.equal(f.approvals.length, 0);
});
test('invitees can change reminders only; stale keys and changes during approval never overwrite', async () => {
  const invited = fixture(); invited.state.response = 'Accept';
  await assert.rejects(invited.call('update_meeting', update({ title: 'Forbidden' })), /организатор/);
  assert.equal(invited.approvals.length, 0);
  await invited.call('update_meeting', update({ reminder: 5, reminderSet: false }));
  assert.match(invited.calls.at(-1).options.body, /SendToNone/);
  const stale = fixture(); stale.state.key = 'new';
  await assert.rejects(stale.call('update_meeting', update({ location: 'Room' })), /changed/);
  assert.equal(stale.approvals.length, 0);
  const raced = fixture(); let reads = 0;
  const transport = raced.active.transport;
  raced.active.transport = async (...args) => { if (++reads === 2) raced.state.key = 'new'; return transport(...args); };
  await assert.rejects(raced.call('update_meeting', update({ location: 'Room' })), /uncertain/);
  assert.equal(raced.calls.some(call => call.action === 'UpdateItem'), false);
});
test('series updates use the master version; retirement and uncertain writes are never replayed', async () => {
  const series = fixture();
  await series.call('update_meeting', { ...update({ location: 'Room' }), scope: 'series', expectedChangeKey: 'master-key' });
  assert.match(series.calls.at(-1).options.body, /Id="master" ChangeKey="master-key"/);
  const retired = fixture(); retired.state.retired = true;
  await assert.rejects(retired.call('create_meeting', { sessionId, title: 'Planning', start, end }), /session ended/);
  assert.equal(retired.calls.length, 0);
  for (const name of ['create_meeting', 'update_meeting']) {
    const f = fixture(); f.state.lost = true;
    await assert.rejects(f.call(name, name === 'create_meeting' ? { sessionId, title: 'Planning', start, end } : update({ location: 'Room' })), /uncertain/);
    assert.equal(f.calls.filter(call => ['CreateItem', 'UpdateItem'].includes(call.action)).length, 1);
    assert.equal(f.writes.at(-1)[0], -1);
  }
});
test('free/busy and slots include self, honor IANA/DST and never treat missing data as free', async () => {
  const f = fixture(); let requested;
  f.active.availability = async input => {
    requested = input;
    return input.emails.split(',').map(email => ({ email, start: input.start, end: input.end, blocks: [] }));
  };
  const slots = await f.call('find_meeting_slots', { sessionId, date: '2027-03-28', timeZone: 'Europe/Berlin', minutes: 60, emails: ['anna@example.test'] });
  assert.equal(requested.emails, 'anna@example.test,self@example.test');
  assert.equal(Date.parse(requested.end) - Date.parse(requested.start), 23 * 3600000);
  assert.equal(slots.slots.length, 6); assert.equal(slots.includesSelf, true);
  assert.equal(T.wall(slots.slots[0].start, 'Europe/Berlin').slice(11, 16), '09:00');
  assert.equal(Date.parse(slots.slots[0].end) - Date.parse(slots.slots[0].start), 3600000);
  const check = await f.call('get_availability', { sessionId, start, end, emails: [] });
  assert.equal(check.people[0].email, 'self@example.test');
  f.active.identity = async () => ({ email: '' });
  const unknown = await f.call('find_meeting_slots', { sessionId, date: '2027-03-28', timeZone: 'Europe/Berlin', minutes: 60, emails: ['anna@example.test'] });
  assert.equal(unknown.includesSelf, false); assert.deepEqual(unknown.slots, []); assert.ok(unknown.people.at(-1).error);
  f.active.identity = async () => ({ email: 'self@example.test' });
  f.active.availability = async input => [{ email: 'anna@example.test', start: input.start, end: input.end, blocks: [] }];
  assert.deepEqual((await f.call('find_meeting_slots', { sessionId, date: '2027-03-28', timeZone: 'UTC', minutes: 60, emails: ['anna@example.test'] })).slots, [], 'A missing self row cannot be treated as free');
  f.active.availability = async input => [{ email: 'anna@example.test', start: input.start, end: input.end, blocks: [], error: 'No access' }];
  assert.deepEqual((await f.call('find_meeting_slots', { sessionId, date: '2027-03-28', timeZone: 'UTC', minutes: 60, emails: ['anna@example.test'] })).slots, []);
  await assert.rejects(f.call('find_meeting_slots', { sessionId, date: '2027-02-30', timeZone: 'UTC', minutes: 60, emails: [] }));
  await assert.rejects(f.call('find_meeting_slots', { sessionId, date: '2027-03-28', timeZone: 'Invalid/Zone', minutes: 60, emails: [] }));
  await assert.rejects(f.call('get_availability', { sessionId, start, end: '2027-04-30T09:00:00Z', emails: [] }));
});
test('calendar background refresh preserves an open draft and discards navigation/account races', async () => {
  const source = fs.readFileSync(require.resolve('../src/calendar-ui.js'), 'utf8');
  for (const race of [null, context => { context.state.generation++; }, context => { context.state.account = { sessionId: 'other' }; }]) {
    let finish, renders = 0;
    const context = vm.createContext({ state: { demo: false, account: { sessionId }, generation: 1, view: 'calendar', week: new Date(start), events: [] }, timeZone: 'UTC', calendarMode: () => 'week', window: { asterCalendar: { range: () => ({ start: new Date(start), end: new Date(end) }) } }, invalidateDaySummary() {}, api: () => new Promise(resolve => { finish = resolve; }), renderCalendar() { renders++; } });
    vm.runInContext(source.slice(0, source.indexOf('function timelineMarkup(')), context);
    await context.receiveCalendarChange({ sessionId, busy: true });
    const pending = context.receiveCalendarChange({ sessionId, busy: false });
    race?.(context); finish([{ id: 'new' }]); await pending;
    assert.equal(renders, race ? 0 : 1);
    if (!race) assert.equal(context.state.events[0].id, 'new');
  }
});

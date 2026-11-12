const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/meeting-conflicts.js');
const C = require('../desktop/meeting-conflicts.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const meeting = { id: 'self', start: '2026-10-25T00:30:00Z', end: '2026-10-25T02:30:00Z' };
const event = (id, fields = {}) => ({ ...meeting, id, title: 'Fictional meeting', showAs: 'Busy', ...fields });
test('exact overlaps exclude self and touching boundaries, never a matching title', () => {
  const result = analyze(meeting, [event('self'), event('before', { end: meeting.start, start: '2026-10-24T23:00:00Z' }), event('after', { start: meeting.end, end: '2026-10-25T03:30:00Z' }), event('other')], true);
  assert.equal(result.kind, 'busy'); assert.deepEqual(result.conflicts.map(e => e.id), ['other']);
});
test('busy, tentative, elsewhere, private and unknown states keep their meaning', () => {
  for (const showAs of ['Free', 'WorkingElsewhere']) assert.equal(analyze(meeting, [event('other', { showAs })], true).kind, 'free');
  assert.equal(analyze(meeting, [event('other', { showAs: 'Tentative' })], true).kind, 'tentative');
  assert.equal(analyze(meeting, [event('other', { showAsKnown: false })], true).kind, 'unknown');
  assert.equal(analyze(meeting, [event('other', { showAs: 'NoData' })], true).kind, 'unknown');
  assert.equal(analyze(meeting, [], false).kind, 'unknown');
  const result = analyze(meeting, [event('other', { sensitivity: 'Private' })], false);
  assert.equal(result.kind, 'busy'); assert.equal(result.complete, false); assert.equal(result.conflicts[0].title, '');
});
test('occurrences remain separate and cancelled or declined instances do not conflict', () => {
  const rows = [event('cancelled', { cancelled: true }), event('declined', { response: 'Decline' }), event('exception', { calendarType: 'Exception' })];
  assert.deepEqual(analyze(meeting, rows, true).conflicts.map(e => e.id), ['exception']);
  assert.equal(analyze(meeting, [event('master', { calendarType: 'RecurringMaster' })], true).kind, 'unknown');
  assert.equal(analyze(meeting, [event('bad', { start: 'invalid' })], true).kind, 'unknown');
});
test('calendar view explicitly expands instances and requires proven completeness', () => {
  const xml = C.query(meeting);
  assert.match(xml, /CalendarView MaxEntriesReturned="1000"/);
  assert.match(xml, /StartDate="2026-10-25T00:30:00.000Z"/);
  assert.doesNotMatch(xml, /UpdateItem|SendItem|CreateItem/);
  assert.equal(C.query({ ...meeting, calendarType: 'RecurringMaster' }), null);
  const root = { '@_IncludesLastItemInRange': 'true', '@_TotalItemsInView': '0', Items: '' };
  assert.equal(C.normalize({ RootFolder: root }, meeting).kind, 'free');
  assert.equal(C.normalize({ RootFolder: { ...root, '@_IncludesLastItemInRange': 'false' } }, meeting).kind, 'unknown');
  assert.equal(C.normalize({ RootFolder: { ...root, '@_TotalItemsInView': '1' } }, meeting).kind, 'unknown');
  assert.equal(C.normalize({}, meeting).kind, 'unknown');
});
test('conflicts read the current event and query only its current interval without writes', async () => {
  const client = new OWAClient({ server: 'https://mail.example.test', username: 'fictional' }, async () => assert.fail('Unexpected transport'), async () => 'token');
  const calls = [];
  client.eventDetails = async ref => { assert.equal(ref.id, 'old'); return { ...meeting, changeKey: 'fresh' }; };
  client.ews = async (operation, body) => { calls.push(operation); assert.match(body, /00:30:00/); return { RootFolder: { '@_IncludesLastItemInRange': 'true', '@_TotalItemsInView': '0', Items: '' } }; };
  const result = await client.eventConflicts({ ref: { id: 'old' } });
  assert.equal(result.kind, 'free'); assert.equal(result.id, 'self'); assert.equal(result.changeKey, 'fresh'); assert.deepEqual(calls, ['FindItem']);
});
test('an unlinked meeting request remains visible with unknown availability', () => {
  const { message } = require('../desktop/protocol.cjs');
  const result = message({ ItemId: { Id: 'invitation' }, ItemClass: 'IPM.Schedule.Meeting.Request', Subject: 'Fictional invitation' });
  assert.equal(result.meeting.id, ''); assert.equal(result.meeting.start, null);
});
test('forward notifications preserve their body without an invitation or availability banner', () => {
  const { message } = require('../desktop/protocol.cjs');
  const html = '<p>Fictional attendee forwarded the invitation.</p><table><tr><th>Собрание</th><td>Груминг</td></tr><tr><th>Время собрания</th><td>17 ноября 2026 г. 15:00-16:00.</td></tr></table>';
  for (const associated of [undefined, { Id: 'calendar', ChangeKey: 'fresh' }]) {
    const result = message({ ItemId: { Id: 'notice' }, ItemClass: 'IPM.Schedule.Meeting.Notification.Forward', AssociatedCalendarItemId: associated, NormalizedBody: { BodyType: 'HTML', Value: html } });
    assert.equal(result.meeting, null);
    assert.equal(result.html, html);
  }
});
test('linked requests, cancellations and ordinary mail retain their classification', () => {
  const { message } = require('../desktop/protocol.cjs');
  for (const itemClass of ['IPM.Schedule.Meeting.Request', 'IPM.Schedule.Meeting.Canceled']) {
    const result = message({ ItemId: { Id: 'mail' }, ItemClass: itemClass, AssociatedCalendarItemId: { Id: 'calendar', ChangeKey: 'fresh' }, Start: meeting.start, End: meeting.end });
    assert.equal(result.meeting.id, 'calendar');
    assert.equal(result.meeting.changeKey, 'fresh');
    assert.equal(Date.parse(result.meeting.start), Date.parse(meeting.start));
    assert.equal(Date.parse(result.meeting.end), Date.parse(meeting.end));
    assert.equal(result.meeting.cancelled, itemClass.endsWith('Canceled'));
  }
  assert.equal(message({ ItemId: { Id: 'mail' }, ItemClass: 'IPM.Note' }).meeting, null);
});
test('accepted, declined and tentative responses are informational mail even with calendar references and times', () => {
  const { message } = require('../desktop/protocol.cjs');
  for (const response of ['Pos', 'Neg', 'Tent']) for (const associated of [undefined, { Id: 'calendar', ChangeKey: 'fresh' }]) {
    const result = message({ ItemId: { Id: 'reply' }, ItemClass: `IPM.Schedule.Meeting.Resp.${response}`, Subject: 'Fictional response', AssociatedCalendarItemId: associated,
      Start: meeting.start, End: meeting.end, Body: { BodyType: 'Text', Value: 'Fictional participant response.' }, Attachments: [{ AttachmentId: { Id: 'file' }, Name: 'notes.txt' }] });
    assert.equal(result.meeting, null);
    assert.equal(result.text, 'Fictional participant response.');
    assert.equal(result.attachments[0].id, 'file');
  }
  assert.notEqual(message({ ItemId: { Id: 'invite' }, ItemClass: 'IPM.Schedule.Meeting.Request', Subject: 'Принято: Ретро спринта' }).meeting, null, 'Classification must use the Exchange class, not the subject');
});
test('a late conflict result cannot replace a newer meeting card', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/meeting-ui.js'), 'utf8');
  const pending = [], target = { innerHTML: '' }, dialog = { open: false, dataset: {}, classList: { add() {} } };
  const context = vm.createContext({ tr: value => value, meetingRequest: 0, activeMeeting: null,
    state: { demo: false, events: [], view: 'mail' }, $: () => dialog, document: { querySelector: () => target }, ref: value => value,
    modal() { dialog.open = true; }, api: async (_operation, ref) => ({ id: ref.id, attachments: [] }), renderMeetingCard() {},
    loadMeetingConflicts: () => new Promise(resolve => pending.push(resolve)), meetingConflictMarkup: result => result.label });
  vm.runInContext(source.slice(source.indexOf('async function openMeeting('), source.indexOf('function renderMeetingCard(')), context);
  await context.openMeeting({ id: 'first' }); await context.openMeeting({ id: 'second' });
  pending[0]({ label: 'outdated' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(target.innerHTML, '');
  pending[1]({ label: 'current' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(target.innerHTML, 'current');
});

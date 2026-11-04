const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../desktop/availability.cjs');
const S = require('../src/availability.js');
const { OWAClient } = require('../desktop/owa.cjs');
const start = '2026-10-29T06:00:00.000Z', end = '2026-10-29T07:00:00.000Z';
const data = emails => ({ emails, start, end });
const row = merged => ({ ResponseMessage: { ResponseCode: 'NoError' }, FreeBusyView: { MergedFreeBusy: merged } });
test('OWA availability uses concrete request types, UTC wall time and 15-minute slots', () => {
  const q = A.query(data('a@example.com,A@example.com'));
  assert.deepEqual(q.emails, ['a@example.com']);
  assert.equal(q.payload.request.__type, 'GetUserAvailabilityInternalJsonRequest:#Exchange');
  assert.equal(q.payload.request.Body.__type, 'GetUserAvailabilityRequest:#Exchange');
  assert.equal(q.payload.request.Body.MailboxDataArray[0].__type, 'MailboxData:#Exchange');
  assert.equal(q.payload.request.Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC');
  assert.equal(q.payload.request.Body.FreeBusyViewOptions.TimeWindow.StartTime, '2026-10-29T06:00:00');
  assert.throws(() => A.query(data('bad<@example.com')));
  assert.throws(() => A.query({ ...data('a@example.com'), end: '2026-11-20' }));
});
test('missing mailbox data never shifts subsequent colleagues onto another calendar', () => {
  const q = A.query(data('a@example.com,b@example.com,c@example.com'));
  const result = A.normalize({ Body: { FreeBusyResponseArray: [row('0000'), { ResponseMessage: { ResponseCode: 'ErrorNoFreeBusyAccess' } }, row('2222')] } }, q);
  assert.equal(S.status(result[0], Date.parse(start)).kind, 'free');
  assert.ok(result[1].error);
  assert.equal(result[2].email, 'c@example.com');
  assert.equal(S.status(result[2], Date.parse(start)).kind, 'busy');
  assert.ok(A.normalize({ Body: [row('0000'), row('2222')] }, q).every(p => p.error));
});
test('unknown and truncated slots are not free; busy status spans consecutive blocks', () => {
  const q = A.query(data('a@example.com'));
  const [p] = A.normalize({ Body: [row('2240')] }, q);
  assert.equal(S.status(p, Date.parse(start)).until, '2026-10-29T06:45:00.000Z');
  assert.equal(S.status(p, Date.parse(start) + 30 * 60000).kind, 'unknown');
  assert.equal(S.available([p], start, end), false);
  assert.equal(S.status(p, Date.parse(end)).kind, 'unknown');
  assert.ok(A.normalize({ Body: [row('00')] }, q)[0].error);
});
test('suggestions require every participant to be free for the whole duration', () => {
  const day = new Date(2026, 9, 29), from = new Date(day), to = new Date(day); to.setDate(to.getDate() + 1);
  const busyStart = new Date(day); busyStart.setHours(9, 30);
  const busyEnd = new Date(day); busyEnd.setHours(10, 30);
  const people = [{ start: from.toISOString(), end: to.toISOString(), blocks: [{ start: busyStart.toISOString(), end: busyEnd.toISOString(), type: 'Busy' }] }];
  const suggestions = S.suggestions(people, day, 60, +day);
  assert.equal(new Date(suggestions[0]).getHours(), 10);
  assert.equal(new Date(suggestions[0]).getMinutes(), 30);
  assert.deepEqual(S.suggestions([...people, { ...people[0], error: 'No access' }], day, 60, +day), []);
});
test('availability uses authenticated OWA transport and retains per-recipient errors', async () => {
  let captured;
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'DOMAIN\\user' }, async (url, options) => {
    captured = { url, options };
    return { status: 200, text: JSON.stringify({ Body: { FreeBusyResponseArray: [row('0000'), { ResponseMessage: { ResponseCode: 'ErrorNoFreeBusyAccess' } }] } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  const result = await client.availability(data('a@example.com,b@example.com'));
  assert.match(captured.url, /action=GetUserAvailabilityInternal/);
  assert.equal(captured.options.headers['X-OWA-CANARY'], 'canary');
  const request = JSON.parse(decodeURIComponent(captured.options.headers['X-OWA-UrlPostData']));
  assert.equal(captured.options.body, undefined);
  assert.equal(request.request.Body.MailboxDataArray.length, 2);
  assert.equal(result[0].error, undefined);
  assert.equal(result[1].error, 'ErrorNoFreeBusyAccess');
});

test('demo planner reads the live personal calendar, including meetings without attendees', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const events = [
    { start, end, showAs: 'Busy' },
    { start: '2026-10-29T06:15:00Z', end: '2026-10-29T08:00:00Z', showAs: 'Busy' }
  ];
  const context = vm.createContext({ state: { demo: true }, window: { asterDemo: { events } } });
  vm.runInContext(source.slice(source.indexOf('async function fetchAvailability('), source.indexOf('function availabilityLabel(')), context);
  const fetch = async emails => context.fetchAvailability(emails, new Date('2026-10-29T00:00:00Z'), new Date('2026-10-30T00:00:00Z'));
  const [mine] = await fetch(['you@example.com']);
  assert.equal(mine.blocks.length, 2);
  assert.equal(S.available([mine], start, end), false);
  assert.equal(S.status(mine, Date.parse('2026-10-29T06:20:00Z')).until, '2026-10-29T08:00:00.000Z');
  assert.equal(S.available([mine], '2026-10-29T08:00:00Z', '2026-10-29T08:30:00Z'), true);
  for (const fields of [{ showAs: 'Free' }, { showAs: 'WorkingElsewhere' }, { cancelled: true }, { response: 'Decline' }, { response: 'Declined' }]) {
    events.splice(0, events.length, { start, end, showAs: 'Busy', ...fields });
    assert.equal(S.available(await fetch(['YOU@example.com']), start, end), true, JSON.stringify(fields));
  }
  for (const fields of [{ showAs: 'Tentative' }, { showAs: 'OOF' }, { showAs: 'NoData' }, { showAs: 'Busy', showAsKnown: false }, {}]) {
    events.splice(0, events.length, { start, end, ...fields });
    assert.equal(S.available(await fetch(['you@example.com']), start, end), false, JSON.stringify(fields));
  }
  const withParticipant = await fetch(['colleague@example.com', 'you@example.com']);
  assert.equal(withParticipant[0].email, 'colleague@example.com');
  assert.equal(withParticipant[0].blocks[0].type, 'Busy');
  assert.equal(S.available([withParticipant[1]], start, end), false);
  events.length = 0;
  assert.equal(S.available(await fetch(['you@example.com']), start, end), true);
  context.state.demo = false;
  context.api = async (operation, payload) => { assert.equal(operation, 'availability'); assert.equal(payload.emails, 'real@example.test'); return 'server availability'; };
  assert.equal(await fetch(['real@example.test']), 'server availability');
});

test('live planner includes the resolved own mailbox without attendees and never confirms missing data as free', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  for (const scenario of ['email-busy', 'domain-busy', 'free', 'missing', 'unknown', 'no-identity', 'participant']) {
    const calls = [], from = '2026-10-29T00:00:00.000Z', to = '2026-10-30T00:00:00.000Z';
    const form = { elements: { start: { value: '2026-10-29T06:00' }, end: { value: '2026-10-29T07:00' }, attendees: { value: scenario === 'participant' ? 'other@example.test' : '' } } };
    const box = { innerHTML: '', isConnected: true }, button = {};
    const client = new OWAClient({ server: 'https://mail.example.test', username: scenario === 'email-busy' ? 'me@example.test' : 'DOMAIN\\fictional' }, async (url, options) => {
      calls.push(url);
      if (url.includes('GetOwaUserConfiguration')) return { status: 200, text: JSON.stringify({ Body: { UserSessionSettings: { UserEmailAddress: scenario === 'no-identity' ? '' : 'Me@example.test' } } }) };
      assert.ok(url.includes('GetUserAvailabilityInternal'));
      const request = JSON.parse(decodeURIComponent(options.headers['X-OWA-UrlPostData'])).request;
      const emails = request.Body.MailboxDataArray.map(item => item.Email.Address);
      assert.ok(emails.includes('me@example.test'));
      assert.equal(emails.length, scenario === 'participant' ? 2 : 1);
      assert.equal(request.Body.FreeBusyViewOptions.TimeWindow.StartTime, from.slice(0, 19));
      const responses = emails.map(email => {
        if (email !== 'me@example.test' || scenario === 'free') return row('0'.repeat(96));
        if (scenario === 'missing') return { ResponseMessage: { ResponseCode: 'ErrorNoFreeBusyAccess' } };
        return row('0'.repeat(24) + (scenario === 'unknown' ? '4444' : '2222') + '0'.repeat(68));
      });
      return { status: 200, text: JSON.stringify({ Body: { FreeBusyResponseArray: responses } }) };
    }, async () => 'fictional-token');
    client.canary = 'fictional-token';
    const context = vm.createContext({ state: { demo: false, account: { username: client.account.username } }, timeZone: 'UTC', T: require('../src/time.js'),
      window: { asterCalendar: { range: () => ({ start: new Date(from), end: new Date(to) }) }, asterAvailability: S },
      $: selector => selector === '#event-form' ? form : box, tr: value => value, esc: String,
      colleagues: () => [], dateFormat: () => '', time: () => '', errorText: error => error.message,
      availabilityLabel: (person, at) => ({ ...S.status(person, at), text: '' }),
      fetchAvailability: (emails, start, end) => client.availability({ emails: emails.join(','), start: start.toISOString(), end: end.toISOString() }),
      api: operation => { assert.equal(operation, 'identity'); return client.identity(); } });
    vm.runInContext(source.slice(source.indexOf('function plannerFingerprint('), source.indexOf('function renderContacts(')), context);
    await context.runPlanner(button);
    assert.equal(button.disabled, false);
    if (scenario === 'missing') { assert.ok(box.innerHTML.includes('ErrorNoFreeBusyAccess')); assert.ok(!box.innerHTML.includes('planner-verdict free')); continue; }
    assert.ok(box.innerHTML.includes('planner-verdict'), scenario);
    assert.equal(box.innerHTML.includes('planner-verdict free'), scenario === 'free', scenario);
    assert.ok(box.innerHTML.includes('Вы'), scenario);
    if (['missing', 'unknown', 'no-identity'].includes(scenario)) assert.ok(box.innerHTML.includes('свободное время не подтверждено'), scenario);
    assert.ok(calls[0].includes('GetOwaUserConfiguration'));
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../desktop/protocol.cjs');
const { OWAClient, loginForm } = require('../desktop/owa.cjs');
const account = { server: 'https://mail.example.com/owa/', username: 'DOMAIN\\user', password: 'secret+&value' };
const ok = body => ({ status: 200, text: JSON.stringify({ Body: body }) });
const soapOK = extra => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><Response><ResponseCode>NoError</ResponseCode>${extra || ''}</Response></s:Body></s:Envelope>`;
function mock(handler) {
  const calls = [];
  const client = new OWAClient(account, async (url, options) => { calls.push({ url, options }); return handler(url, options, calls); }, async () => 'test-canary');
  client.canary = 'test-canary';
  return { client, calls };
}
test('only HTTPS OWA server origins are accepted', () => {
  assert.equal(P.normalizeServer(account.server), 'https://mail.example.com');
  for (const url of ['http://mail.example.com', 'https://user:pass@mail.example.com', 'https://mail.example.com/other', 'https://mail.example.com/?secret=1']) assert.throws(() => P.normalizeServer(url));
});
test('form parsing respects reordered attributes and escapes hidden values', () => {
  const { url, fields } = loginForm('<form action="/owa/auth.owa"><input value="a&amp;b" name="csrf" type="hidden"></form>', 'https://mail.example.com');
  assert.equal(url, 'https://mail.example.com/owa/auth.owa'); assert.equal(fields.get('csrf'), 'a&b');
});
test('credentials cannot be posted to a different origin or an HTTP form', () => {
  for (const action of ['https://attacker.example/login', '//attacker.example/login', 'http://mail.example.com/owa/auth.owa', 'https://mail.example.com:8443/login']) assert.throws(() => loginForm(`<form action="${action}">`, 'https://mail.example.com'));
});
test('form auth sends URL-encoded credentials and obtains a canary', async () => {
  let submitted = false;
  const client = new OWAClient(account, async (_url, options) => {
    if (options.method === 'POST') {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('password'), account.password); assert.equal(form.get('username'), account.username);
      submitted = true;
    }
    return { status: 200, text: '<form action="/owa/auth.owa"></form>' };
  }, async () => submitted ? 'canary' : null);
  await client.authenticate(); assert.equal(client.canary, 'canary');
});
test('definitive login rejection is not retried or followed by a form submission', async () => {
  let count = 0;
  const client = new OWAClient(account, async () => { count++; return { status: 401, text: '' }; }, async () => null);
  await assert.rejects(client.authenticate(), /отклонил/); assert.equal(count, 1);
});
test('folder paging and message fields survive OWA normalization', async () => {
  const { client, calls } = mock(() => ok({ ResponseMessages: { Items: [{ ResponseCode: 'NoError', RootFolder: { IncludesLastItemInRange: false, TotalItemsInView: 82, Items: [{ ItemId: { Id: 'id1', ChangeKey: 'key' }, Subject: 'A', From: { Mailbox: { Name: 'Alex', EmailAddress: 'alex@example.com' } }, IsRead: false, Preview: 'Preview' }] } }] } }));
  const result = await client.messages({ folder: 'inbox', offset: 50 });
  assert.equal(result.more, true); assert.equal(result.items[0].from.email, 'alex@example.com');
  const body = JSON.parse(calls[0].options.body); assert.equal(body.Body.Paging.Offset, 50);
  assert.equal(Object.keys(body.Body.ParentFolderIds[0])[0], '__type');
});
test('nested Exchange application errors fail even with HTTP 200', async () => {
  const { client } = mock(() => ok({ ResponseMessages: { Items: [{ ResponseCode: 'ErrorAccessDenied' }] } }));
  await assert.rejects(client.messages({ folder: 'inbox' }), /ErrorAccessDenied/);
});
test('HTML login pages are never treated as an empty mailbox', async () => {
  const { client } = mock(() => ({ status: 200, text: '<html>Login</html>' }));
  await assert.rejects(client.messages({ folder: 'inbox' }), /вместо JSON/);
});
test('expired read session authenticates and retries once', async () => {
  let reads = 0, auth = 0;
  const { client } = mock(url => url.includes('service.svc') ? (++reads === 1 ? { status: 440, text: '' } : ok({ ResponseMessages: { Items: [{ RootFolder: { Items: [], IncludesLastItemInRange: true } }] } })) : (auth++, { status: 200, text: '' }));
  await client.messages({ folder: 'inbox' }); assert.equal(reads, 2); assert.equal(auth, 1);
});
test('mutation is not replayed on an expired session', async () => {
  const { client, calls } = mock(() => ({ status: 440, text: '' }));
  await assert.rejects(client.change({ ref: { id: 'x' }, field: 'IsRead', value: true }), /не повторялась/); assert.equal(calls.length, 1);
});
test('send is not repeated when the response is lost', async () => {
  const { client, calls } = mock(() => { throw new Error('Connection lost'); });
  await assert.rejects(client.send({ to: 'a@example.com', body: 'Hello' }), /Connection lost/); assert.equal(calls.length, 1);
});
test('outgoing XML escapes untrusted text and validates recipients', () => {
  const xml = P.sendSOAP({ to: 'a@example.com', subject: '<attack>&', body: '<script>&"' });
  assert.match(xml, /&lt;attack&gt;&amp;/); assert.match(xml, /&lt;script&gt;&amp;&quot;/);
  assert.throws(() => P.sendSOAP({ to: 'invalid', body: 'x' }));
  assert.throws(() => P.sendSOAP({ to: '' }));
  assert.match(P.sendSOAP({ to: '', body: 'draft' }, true), /SaveOnly/);
});
test('reply and forward use Exchange references to preserve thread and attachments', () => {
  for (const [kind, tag] of [['reply', 'ReplyToItem'], ['reply-all', 'ReplyAllToItem'], ['forward', 'ForwardItem']]) {
    const xml = P.sendSOAP({ to: 'a@example.com', kind, reference: { id: 'a&b' }, body: 'Response' });
    assert.match(xml, new RegExp(`<t:${tag}>`)); assert.match(xml, /ReferenceItemId Id="a&amp;b"/);
  }
});
test('attachments are saved to a draft, attached, then sent once in that order', async () => {
  const { client, calls } = mock((_url, options) => ({ status: 200, text: soapOK(options.headers.SOAPAction.includes('/CreateItem') ? '<Items><ItemId Id="draft123" ChangeKey="ck"/></Items>' : '<AttachmentId Id="a" RootItemId="draft123" RootItemChangeKey="new-ck"/>') }));
  await client.send({ to: 'a@example.com', subject: 'File', body: 'Hello', attachments: [{ name: 'notes.txt', type: 'text/plain', content: Buffer.from('hello').toString('base64') }] });
  assert.deepEqual(calls.map(c => c.options.headers.SOAPAction.match(/\/([^/]+)"$/)[1]), ['CreateItem', 'CreateAttachment', 'SendItem']);
  assert.match(calls[0].options.body, /SaveOnly/); assert.match(calls[1].options.body, /ParentItemId Id="draft123" ChangeKey="ck"/);
  assert.match(calls[2].options.body, /ItemId Id="draft123" ChangeKey="new-ck"/);
});
test('attachment failure leaves an explicit draft warning and does not send', async () => {
  const { client, calls } = mock((_url, options) => ({ status: 200, text: options.headers.SOAPAction.includes('/CreateItem') ? soapOK('<Items><ItemId Id="draft" ChangeKey="ck"/></Items>') : '<invalid>' }));
  await assert.rejects(client.send({ to: 'a@example.com', attachments: [{ name: 'x', content: 'eA==' }] }), /Черновик уже создан/); assert.equal(calls.length, 2);
});
test('malformed or oversized attachments are rejected before network traffic', async () => {
  const { client, calls } = mock(() => { throw new Error('Should not run'); });
  await assert.rejects(client.send({ to: 'a@example.com', attachments: [{ name: 'a', content: '<xml>' }] }), /Некорректное/);
  await assert.rejects(client.send({ to: 'a@example.com', attachments: [{ name: 'a', content: Buffer.alloc(21 * 1024 * 1024).toString('base64') }] }), /20 МБ/);
  assert.equal(calls.length, 0);
});
test('EWS success must contain explicit NoError; SOAP faults cannot report success', () => {
  assert.doesNotThrow(() => P.parseSOAP(soapOK()));
  assert.throws(() => P.parseSOAP('<html>Login</html>'), /Unexpected EWS/);
  assert.throws(() => P.parseSOAP(soapOK().replace('NoError', 'ErrorAccessDenied')), /ErrorAccessDenied/);
  assert.throws(() => P.parseSOAP('<!DOCTYPE x><x/>'), /Invalid EWS/);
});
test('calendar validates time ranges and does not invite anyone for personal appointments', () => {
  const event = { title: 'Focus', start: '2026-10-29T10:00:00+03:00', end: '2026-10-29T11:00:00+03:00', body: '<&' };
  const xml = P.eventSOAP(event); assert.match(xml, /SendToNone/); assert.match(xml, /2026-10-29T07:00:00.000Z/); assert.match(xml, /&lt;&amp;/);
  assert.match(P.eventSOAP({ ...event, attendees: 'a@example.com' }), /SendToAllAndSaveCopy/);
  assert.throws(() => P.eventSOAP({ ...event, end: event.start }));
});
test('calendar range uses UTC context and the OWA header transport', async () => {
  const { client, calls } = mock(() => ok({ Items: [] }));
  await client.calendar({ start: '2026-10-26T00:00:00Z', end: '2026-11-02T00:00:00Z' });
  const payload = JSON.parse(decodeURIComponent(calls[0].options.headers['X-OWA-UrlPostData']));
  assert.equal(payload.Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC'); assert.equal(payload.Body.CalendarId.BaseFolderId.Id, 'calendar');
});
test('server search uses a session and honors offsets', async () => {
  const { client, calls } = mock(url => ok(url.includes('ExecuteSearch') ? { SearchResults: { Items: [{ ItemId: { Id: 'found' }, Subject: 'Found' }], MoreResultsAvailable: true } } : {}));
  let result = await client.search({ query: 'budget', offset: 0 }); assert.equal(result.items[0].id, 'found');
  result = await client.search({ query: 'budget', offset: 50 }); assert.equal(result.more, true);
  assert.equal(calls.length, 3); assert.equal(JSON.parse(calls[2].options.body).Body.ResultRowOffset, 50);
});
test('overlapping searches finish their own sessions before a later query replaces them', async () => {
  let releaseStart, firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const actions = [];
  const {client} = mock(async (_url, options) => {
    const action = options.headers.Action, body = JSON.parse(options.body).Body;
    actions.push({action,session:body.SearchSessionId,query:body.Query});
    if (action === 'StartSearchSession' && !releaseStart) {
      firstStarted();
      await new Promise(resolve => { releaseStart = resolve; });
    }
    return ok(action === 'ExecuteSearch' ? {SearchResults:{Items:[]}} : {});
  });
  const first = client.search({query:'first'});
  await started;
  const second = client.search({query:'second'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actions.length,1);
  releaseStart();
  await Promise.all([first,second]);
  assert.deepEqual(actions.map(call => call.action),['StartSearchSession','ExecuteSearch','EndSearchSession','StartSearchSession','ExecuteSearch']);
  assert.equal(actions[1].session,actions[0].session);
  assert.equal(actions[2].session,actions[0].session);
  assert.equal(actions[4].session,actions[3].session);
  assert.notEqual(actions[1].session,actions[4].session);
  assert.deepEqual([actions[1].query,actions[4].query],['first','second']);
});
test('failed search requests do not poison later searches', async () => {
  let fail = true;
  const {client} = mock((_url, options) => {
    if (options.headers.Action === 'ExecuteSearch' && fail) { fail = false; throw new Error('Connection lost'); }
    return ok(options.headers.Action === 'ExecuteSearch' ? {SearchResults:{Items:[]}} : {});
  });
  await assert.rejects(client.search({query:'first'}),/Connection lost/);
  assert.deepEqual(await client.search({query:'second'}),{items:[],more:false});
});
test('lost CreateItem replies warn before retrying both plain and attached outgoing mail', async () => {
  for (const save of [false,true]) for (const attachments of [[],[{name:'note.txt',content:'eA=='}]]) {
    const {client,calls} = mock(() => { throw new Error('Сервер не ответил за 30 секунд'); });
    await assert.rejects(client[save ? 'draft' : 'send']({to:'recipient@example.com',body:'Hello',attachments}), error => {
      assert.match(error.message,/Результат операции может быть неизвестен/);
      assert.match(error.message,/Проверьте «Черновики»/);
      if (!save) assert.match(error.message,/«Отправленные»/);
      return true;
    });
    assert.equal(calls.length,1);
  }
});
test('meeting requests expose their calendar reference for RSVP', () => {
  const m = P.message({ ItemId: { Id: 'mail' }, AssociatedCalendarItemId: { Id: 'meeting', ChangeKey: 'key' }, Start: '2026-10-29T10:00:00Z' });
  assert.equal(m.meeting.id, 'meeting'); assert.equal(m.meeting.changeKey, 'key');
});
test('cancelled meeting is not sent an RSVP', async () => {
  const { client, calls } = mock(() => ok({ Items: [{ ItemId: { Id: 'event', ChangeKey: 'fresh' }, Subject: 'Cancelled', IsCancelled: true }] }));
  assert.deepEqual(await client.respond({ ref: { id: 'event' }, response: 'DeclineItem' }), { status: 'cancelled' });
  assert.equal(calls.length, 1); assert.ok(calls[0].url.includes('GetCalendarEvent'));
});
test('RSVP uses the current change key and sends exactly once', async () => {
  const { client, calls } = mock(url => url.includes('service.svc') ? ok({ Items: [{ ItemId: { Id: 'event', ChangeKey: 'fresh' }, Subject: 'Meeting', IsCancelled: false }] }) : { status: 200, text: soapOK() });
  assert.deepEqual(await client.respond({ ref: { id: 'event', changeKey: 'stale' }, response: 'AcceptItem' }), { status: 'sent' });
  assert.equal(calls.length, 2); assert.match(calls[1].options.body, /ChangeKey="fresh"/);
});
test('cancellation racing an RSVP is reported as cancelled without replay', async () => {
  for (const response of ['AcceptItem', 'DeclineItem', 'TentativelyAcceptItem']) {
    const error = { AcceptItem: 'Accept', DeclineItem: 'Decline', TentativelyAcceptItem: 'Tentative' }[response];
    const { client, calls } = mock(url => url.includes('service.svc') ? ok({ Items: [{ ItemId: { Id: 'event' }, Subject: 'Meeting' }] }) : { status: 200, text: soapOK().replace('NoError', `ErrorCalendarIsCancelledFor${error}`) });
    assert.deepEqual(await client.respond({ ref: { id: 'event' }, response }), { status: 'cancelled' });
    assert.equal(calls.length, 2);
  }
});
test('other RSVP errors are not hidden as successful or cancelled responses', async () => {
  const { client, calls } = mock(url => url.includes('service.svc') ? ok({ Items: [{ ItemId: { Id: 'event' }, Subject: 'Meeting' }] }) : { status: 200, text: soapOK().replace('NoError', 'ErrorAccessDenied') });
  await assert.rejects(client.respond({ ref: { id: 'event' }, response: 'DeclineItem' }), /ErrorAccessDenied/);
  assert.equal(calls.length, 2);
});
test('server signature is read from OWA.UserOptions without modifying it', async () => {
  const entry = (key, value) => `<t:DictionaryEntry><t:DictionaryKey><t:Type>String</t:Type><t:Value>${key}</t:Value></t:DictionaryKey><t:DictionaryValue><t:Type>String</t:Type><t:Value>${P.escapeXML(value)}</t:Value></t:DictionaryValue></t:DictionaryEntry>`;
  const html = '<p><b>00123 & Company</b></p>';
  const { client, calls } = mock(() => ({ status: 200, text: soapOK(`<UserConfiguration xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><t:Dictionary>${entry('signaturehtml', html)}${entry('signaturetext', '00123 & Company')}${entry('autoaddsignature', 'True')}${entry('autoaddsignatureonreply', 'False')}</t:Dictionary></UserConfiguration>`) }));
  const signature = await client.signature();
  assert.equal(signature.html, html); assert.equal(signature.text, '00123 & Company');
  assert.equal(signature.autoAddSignature, true); assert.equal(signature.autoAddSignatureOnReply, false);
  assert.equal(calls.length, 1); assert.match(calls[0].options.headers.SOAPAction, /GetUserConfiguration/);
  assert.match(calls[0].options.body, /Name="OWA.UserOptions"/); assert.match(calls[0].options.body, /Id="root"/);
});
test('an explicitly empty OWA signature differs from missing signature settings', () => {
  assert.deepEqual(P.signatureFromConfiguration({ DictionaryEntry: { DictionaryKey: { Value: 'signaturetext' }, DictionaryValue: { Value: '' } } }), { text: '', html: '', autoAddSignature: true, autoAddSignatureOnReply: true });
  assert.throws(() => P.signatureFromConfiguration({ Dictionary: {} }), /не найдена подпись/);
});
test('HTML signatures are sent as escaped HTML content for new messages and replies', () => {
  for (const reference of [undefined, { id: 'original' }]) {
    const xml = P.sendSOAP({ to: 'a@example.com', kind: reference ? 'reply' : 'new', reference, body: 'Plain fallback', bodyHtml: '<div>Hello & welcome</div><b>Signature</b>' });
    assert.match(xml, /BodyType="HTML"/); assert.match(xml, /&lt;b&gt;Signature&lt;\/b&gt;/);
    assert.match(xml, /Hello &amp; welcome/);
    assert.doesNotMatch(xml, /<b>Signature<\/b>/);
  }
});
test('contacts and directory search normalize separately', async () => {
  const { client } = mock((_url, options) => options.headers.SOAPAction?.includes('ResolveNames') ? { status: 200, text: soapOK('<ResolutionSet IncludesLastItemInRange="true"><Resolution><Mailbox><Name>Anna</Name><EmailAddress>a@example.com</EmailAddress><RoutingType>SMTP</RoutingType></Mailbox></Resolution></ResolutionSet>') } : ok({ ResponseMessages: { Items: [{ RootFolder: { Items: [{ ItemId: { Id: 'c1' }, DisplayName: 'Alex', EmailAddresses: [{ Value: 'alex@example.com' }] }], IncludesLastItemInRange: true } }] } }));
  assert.equal((await client.contacts({})).items[0].email, 'alex@example.com');
  assert.equal((await client.contacts({ query: 'Anna' })).items[0].name, 'Anna');
});
test('plain new mail sends directly without a draft or attachment writes', async () => {
  const { client, calls } = mock(() => ({ status: 200, text: soapOK() }));
  await client.send({ to: 'anna@example.com', subject: 'Text', body: 'Only text' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].options.headers.SOAPAction, /CreateItem/);
  assert.match(calls[0].options.body, /MessageDisposition="SendAndSaveCopy"/);
  assert.doesNotMatch(calls[0].options.body, /ReferenceItemId|CreateAttachment|SendItem/);
});
test('text replies and forwards refresh and include the source ChangeKey, then send once', async () => {
  for (const kind of ['reply', 'reply-all', 'forward']) {
    const { client, calls } = mock((_url, options) => options.headers.SOAPAction
      ? { status: 200, text: soapOK() }
      : ok({ Items: [{ ItemId: { Id: 'original', ChangeKey: 'current&key' }, Subject: 'Source' }] }));
    await client.send({ kind, reference: { id: 'original', changeKey: 'stale' }, to: 'anna@example.com', body: 'Text response' });
    assert.equal(calls.length, 2);
    assert.match(calls[1].options.body, /ReferenceItemId Id="original" ChangeKey="current&amp;key"/);
  }
});
test('the last attachment response key is used; a missing updated key never triggers a blind send', async () => {
  const attachment = { name: 'a.txt', content: 'YQ==' };
  for (const response of ['', '<AttachmentId Id="a" RootItemId="draft123" RootItemChangeKey="old"/><AttachmentId Id="b" RootItemId="draft123" RootItemChangeKey="last"/>']) {
    const { client, calls } = mock((_url, options) => ({ status: 200, text: soapOK(options.headers.SOAPAction.includes('/CreateItem') ? '<ItemId Id="draft123" ChangeKey="initial"/>' : response) }));
    if (!response) {
      await assert.rejects(client.send({ to: 'anna@example.com', body: 'Text', attachments: [attachment] }), /Черновик уже создан/);
      assert.equal(calls.length, 2);
    } else {
      await client.send({ to: 'anna@example.com', attachments: [attachment, attachment] });
      assert.match(calls[2].options.body, /ChangeKey="last"/);
    }
  }
});

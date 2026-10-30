const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../desktop/protocol.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const { normalize } = require('../desktop/directory.cjs');
const account = { server: 'https://mail.example.com', username: 'user@example.com', password: 'fictional' };
const response = (code, inner = '') => `<Envelope><ResolveNamesResponse><ResponseCode>${code}</ResponseCode>${inner}</ResolveNamesResponse></Envelope>`;
const person = (name, email, routing = 'SMTP', extra = '') => `<Resolution><Mailbox><Name>${name}</Name><EmailAddress>${email}</EmailAddress><RoutingType>${routing}</RoutingType></Mailbox>${extra}</Resolution>`;
function client(xml) {
  const calls = [];
  const instance = new OWAClient(account, async (url, options) => { calls.push({ url, options }); return { status: 200, text: url.includes('/owa/') ? JSON.stringify({ Body: { ResponseCode: 'ErrorInvalidOperation' } }) : xml }; }, async () => 'canary'); instance.canary = 'canary';
  return { instance, calls };
}
test('meeting recipient lookup searches Active Directory even with no saved contacts', async () => {
  const { instance, calls } = client(response('NoError', `<ResolutionSet IncludesLastItemInRange="true">${person('Ирина Новикова', 'irina@example.com')}</ResolutionSet>`));
  const result = await instance.contacts({ query: 'Новик' });
  assert.equal(result.items[0].name, 'Ирина Новикова'); assert.equal(result.items[0].source, 'directory');
  assert.match(calls[1].url, /\/EWS\/Exchange.asmx$/); assert.match(calls[1].options.headers.SOAPAction, /ResolveNames/);
  assert.match(calls[1].options.body, /SearchScope="ActiveDirectoryContacts"/);
  assert.match(calls[1].options.body, /<m:UnresolvedEntry>Новик<\/m:UnresolvedEntry>/);
  assert.equal(calls.length, 2); assert.equal(JSON.parse(calls[0].options.body).Body.ParentFolderId.BaseFolderId.Id, 'directory');
});
test('multiple ambiguous names are normal suggestions, zero matches are an empty result', async () => {
  const xml = response('ErrorNameResolutionMultipleResults', `<ResolutionSet IncludesLastItemInRange="false">${person('Ирина', 'irina@example.com')}${person('Ирина Другая', 'other@example.com')}</ResolutionSet>`);
  const result = await client(xml).instance.contacts({ query: 'Ирина' });
  assert.equal(result.items.length, 2); assert.equal(result.truncated, true); assert.equal(result.more, false);
  assert.equal((await client(response('ErrorNameResolutionNoResults')).instance.contacts({ query: 'unknown' })).items.length, 0);
  assert.throws(() => P.parseSOAP(xml), /ErrorNameResolutionMultipleResults/);
  assert.throws(() => P.parseSOAP(response('ErrorAccessDenied'), 'ResolveNames'), /ErrorAccessDenied/);
});
test('EX legacy names resolve to SMTP contact addresses and duplicates are removed', () => {
  const xml = response('NoError', `<ResolutionSet>${person('Ирина', '/o=Company/ou=Group/cn=Recipients/cn=irina', 'EX', '<Contact><CompanyName>Research</CompanyName><PhoneNumbers><Entry Key="BusinessPhone">+7 000 123-45-67</Entry></PhoneNumbers><EmailAddresses><Entry Key="EmailAddress1">SMTP:irina@example.com</Entry><Entry Key="EmailAddress2">smtp:alias@example.com</Entry></EmailAddresses></Contact>')}${person('Duplicate', 'IRINA@example.com')}${person('Unresolved EX', '/o=Company/cn=no-email', 'EX')}</ResolutionSet>`);
  const result = normalize(P.parseSOAP(xml)); assert.equal(result.items.length, 1); assert.equal(result.items[0].email, 'irina@example.com'); assert.equal(result.items[0].company, 'Research'); assert.equal(result.items[0].phone, '+7 000 123-45-67');
});
test('directory failures keep the actual cause, and invalid queries never reach the server', async () => {
  await assert.rejects(client(response('ErrorAccessDenied')).instance.contacts({ query: 'Ирина' }), /EWS ResolveNames.*ErrorAccessDenied/);
  const fake = client(response('NoError'));
  await assert.rejects(fake.instance.contacts({ query: 'a' })); assert.equal(fake.calls.length, 0);
  const escaped = client(response('ErrorNameResolutionNoResults')); await escaped.instance.contacts({ query: 'A & B' }); assert.match(escaped.calls[1].options.body, /A &amp; B/);
});
test('demo can suggest a GAL-only person without adding them to personal contacts', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const context = vm.createContext({ tr: value => value, window: {}, structuredClone });
  vm.runInContext(fs.readFileSync(require.resolve('../src/demo.js'), 'utf8'), context);
  const demo = context.window.asterDemo;
  assert.equal(demo.contacts.some(person => person.email === 'irina.novikova@example.com'), false);
  assert.equal(demo.directory.some(person => person.email === 'irina.novikova@example.com'), true);
});
test('OWA FindPeople queries the Exchange directory without any EWS request', async () => {
  const calls = [];
  const instance = new OWAClient(account, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { status: 200, text: JSON.stringify({ Body: { ResultSet: [{ DisplayName: 'Fictional colleague', EmailAddress: { EmailAddress: 'colleague@example.com', RoutingType: 'SMTP' } }], TotalNumberOfPeopleInView: 1 } }) };
  }, async () => 'canary'); instance.canary = 'canary';
  const result = await instance.contacts({ query: 'colleague' });
  assert.equal(result.provider, 'owa'); assert.equal(result.items[0].email, 'colleague@example.com');
  assert.equal(calls.length, 1); assert.match(calls[0].url, /owa\/service.svc/);
  assert.equal(calls[0].body.Body.ParentFolderId.BaseFolderId.Id, 'directory');
  assert.equal(calls[0].body.Body.QueryString, 'colleague');
  assert.equal(calls[0].body.Body.ShouldResolveOneOffEmailAddress, false);
  assert.equal(calls[0].body.Body.IndexedPageItemView.MaxEntriesReturned, 20);
});
test('OWA permission and network errors remain visible and never trigger an EWS fallback', async () => {
  for (const network of [false, true]) {
    let calls = 0;
    const instance = new OWAClient(account, async () => {
      calls++;
      return network ? { status: 503, text: '' } : { status: 200, text: JSON.stringify({ Body: { ResponseCode: 'ErrorAccessDenied' } }) };
    }, async () => 'canary'); instance.canary = 'canary';
    await assert.rejects(instance.contacts({ query: 'fictional' }), error => network ? error.connectionError === true : /ErrorAccessDenied/.test(error.message));
    assert.equal(calls, 1);
  }
});
test('OWA personas convert explicit SMTP alternatives, deduplicate and reject unresolved EX names', () => {
  const { normalizePeople } = require('../desktop/directory.cjs');
  const result = normalizePeople({ ResultSet: [{ DisplayName: 'Fictional', EmailAddresses: [{ RoutingType: 'EX', EmailAddress: '/o=fictional/cn=person', OriginalDisplayName: 'person@example.com' }] }, { EmailAddress: { EmailAddress: 'PERSON@example.com' } }], TotalNumberOfPeopleInView: 50 });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].email, 'person@example.com'); assert.equal(result.truncated, true);
  assert.throws(() => normalizePeople({ ResultSet: [{ EmailAddress: { RoutingType: 'EX', EmailAddress: '/o=fictional' } }] }), /SMTP/);
});

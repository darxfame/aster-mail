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
  const instance = new OWAClient(account, async (url, options) => { calls.push({ url, options }); return { status: 200, text: xml }; }, async () => 'canary'); instance.canary = 'canary';
  return { instance, calls };
}
test('meeting recipient lookup searches Active Directory even with no saved contacts', async () => {
  const { instance, calls } = client(response('NoError', `<ResolutionSet IncludesLastItemInRange="true">${person('Ирина Новикова', 'irina@example.com')}</ResolutionSet>`));
  const result = await instance.contacts({ query: 'Новик' });
  assert.equal(result.items[0].name, 'Ирина Новикова'); assert.equal(result.items[0].source, 'directory');
  assert.match(calls[0].url, /\/EWS\/Exchange.asmx$/); assert.match(calls[0].options.headers.SOAPAction, /ResolveNames/);
  assert.match(calls[0].options.body, /SearchScope="ActiveDirectoryContacts"/);
  assert.match(calls[0].options.body, /<m:UnresolvedEntry>Новик<\/m:UnresolvedEntry>/);
  assert.equal(calls.length, 1);
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
  const escaped = client(response('ErrorNameResolutionNoResults')); await escaped.instance.contacts({ query: 'A & B' }); assert.match(escaped.calls[0].options.body, /A &amp; B/);
});
test('demo can suggest a GAL-only person without adding them to personal contacts', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const context = vm.createContext({ window: {}, structuredClone });
  vm.runInContext(fs.readFileSync(require.resolve('../src/demo.js'), 'utf8'), context);
  const demo = context.window.asterDemo;
  assert.equal(demo.contacts.some(person => person.email === 'irina.novikova@example.com'), false);
  assert.equal(demo.directory.some(person => person.email === 'irina.novikova@example.com'), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../desktop/protocol.cjs');
const R = require('../desktop/mail-rules.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const soap = value => `<Envelope><ResponseCode>NoError</ResponseCode>${value}</Envelope>`;
const account = { server: 'https://mail.example.com', username: 'user@example.com', password: 'fictional' };
function client(handler, remote) {
  const calls = [];
  const instance = new OWAClient(account, async (url, options) => { calls.push({ url, options }); return handler(url, options, calls); }, async () => 'canary', async () => {}, remote);
  instance.canary = 'canary'; return { instance, calls };
}
test('message importance and favorites update only allowed values, with receipts suppressed', () => {
  const request = P.update({ id: 'mail', changeKey: 'key' }, 'Importance', 'High');
  assert.equal(request.Body.ItemChanges[0].Updates[0].Item.Importance, 'High');
  assert.equal(request.Body.SuppressReadReceipts, true);
  assert.equal(request.Body.SendCalendarInvitationsOrCancellations, 'SendToNone');
  assert.throws(() => P.update({ id: 'mail' }, 'Importance', true));
  assert.throws(() => P.update({ id: 'mail' }, 'IsRead', 'false'));
  assert.equal(P.message({ ItemId: { Id: 'mail' }, Importance: 'High' }).importance, 'High');
});
test('a move rule is appended and does not replace existing rules or run on old messages', async () => {
  const requests = [];
  await R.create({ ews: async (action, xml) => { requests.push({ action, xml }); return { InboxRules: { Rule: { RuleId: 'existing', Priority: '8' } }, OutlookRuleBlobExists: 'false' }; } }, { name: 'Design & people', sender: 'anna@example.com', subject: 'Design & review', folder: 'target&id' });
  assert.deepEqual(requests.map(r => r.action), ['GetInboxRules', 'UpdateInboxRules']);
  assert.match(requests[1].xml, /<t:Priority>9<\/t:Priority>/);
  assert.match(requests[1].xml, /<t:FromAddresses><t:Address><t:EmailAddress>anna@example.com/);
  assert.match(requests[1].xml, /<t:ContainsSubjectStrings>/);
  assert.match(requests[1].xml, /target&amp;id/); assert.match(requests[1].xml, /<m:RemoveOutlookRuleBlob>false/);
  assert.doesNotMatch(requests[1].xml, /SetRuleOperation|DeleteRuleOperation|StopProcessingRules|RunInboxRules/);
});
test('Outlook rules are never deleted to create a move rule; an uncertain update is not retried', async () => {
  const data = { name: 'Rule', sender: 'anna@example.com', folder: 'target' }; let calls = 0;
  await assert.rejects(R.create({ ews: async () => { calls++; return { OutlookRuleBlobExists: 'true' }; } }, data), /не удалить/); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(R.create({ ews: async action => { calls++; if (action === 'UpdateInboxRules') throw new Error('connection lost'); return {}; } }, data), /connection lost/); assert.equal(calls, 2);
  await assert.rejects(R.create({ ews: () => assert.fail('Invalid rule reached network') }, { ...data, sender: '' }));
});
test('Exchange photos work without ContentType in the SOAP response and are cached per client', async () => {
  const { instance, calls } = client(() => ({ status: 200, text: soap(`<PictureData>${pixel}</PictureData>`) }));
  const image = await instance.personPhoto({ email: 'anna@example.com' });
  assert.equal(image, `data:image/png;base64,${pixel}`);
  await instance.personPhoto({ email: 'ANNA@example.com' }); assert.equal(calls.length, 1);
  assert.match(calls[0].options.body, /<m:GetUserPhoto>/);
  const missing = client(() => ({ status: 500, text: 'No photo' })); assert.equal(await missing.instance.personPhoto({ email: 'unknown@example.com' }), null);
});
test('signature images load as validated raster bytes, and inline attachments retain CID on send', async () => {
  const entry = (key, value) => `<DictionaryEntry><DictionaryKey><Value>${key}</Value></DictionaryKey><DictionaryValue><Value>${P.escapeXML(value)}</Value></DictionaryValue></DictionaryEntry>`;
  const { instance, calls } = client((_url, options) => ({ status: 200, text: options.headers.SOAPAction.includes('GetUserConfiguration') ? soap(entry('signaturehtml', `<p>Anna</p><img src="data:image/png;base64,${pixel}">`)) : options.headers.SOAPAction.includes('CreateItem') ? soap('<ItemId Id="draft" ChangeKey="ck"/>') : soap('<AttachmentId Id="a" RootItemId="draft" RootItemChangeKey="latest"/>') }));
  const signature = await instance.signature(); assert.equal(Object.keys(signature.images).length, 1); assert.deepEqual(signature.errors, {});
  await instance.send({ to: 'recipient@example.com', body: 'Hello', bodyHtml: '<p>Hello</p><img src="cid:signature@aster.local">', attachments: [{ name: 'signature.png', type: 'image/png', content: pixel, inline: true, contentId: 'signature@aster.local' }] });
  const attach = calls.find(call => call.options.headers.SOAPAction.includes('CreateAttachment')).options.body;
  assert.match(attach, /<t:IsInline>true<\/t:IsInline>/); assert.match(attach, /<t:ContentId>signature@aster.local/);
  assert.equal(calls.filter(call => call.options.headers.SOAPAction.includes('SendItem')).length, 1);
});
test('relative OWA signature images use the isolated image transport without OWA credentials', async () => {
  const html = '<img src="/owa/image.png">';
  const downloads = [];
  const { instance, calls } = client(() => ({ status: 200, text: soap(`<DictionaryEntry><DictionaryKey><Value>signaturehtml</Value></DictionaryKey><DictionaryValue><Value>${P.escapeXML(html)}</Value></DictionaryValue></DictionaryEntry>`) }), async url => { downloads.push(url); return { ContentType: 'image/png', Content: pixel }; });
  const signature = await instance.signature(); assert.equal(signature.images['https://mail.example.com/owa/image.png'], `data:image/png;base64,${pixel}`);
  assert.deepEqual(downloads, ['https://mail.example.com/owa/image.png']);
  assert.equal(calls.length, 1);
});
test('attachment cards escape file names, show extensions and expose Save As without a second download path', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
  const context = vm.createContext({ esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]), bytes: () => '2 КБ' });
  vm.runInContext(source.slice(0, source.indexOf('function renderSignaturePreview')), context);
  const html = context.mailAttachments({ attachments: [{ id: 'id', name: '<script>.PDF', size: 2000 }] });
  assert.match(html, /extension-pdf/); assert.match(html, />PDF</); assert.match(html, /Сохранить как/);
  assert.match(html, /data-action="attachment"/); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-action="open-attachment"/);
  assert.match(html, /aria-label="Открыть вложение: &lt;script&gt;.PDF"/);
});

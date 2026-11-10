const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../desktop/protocol.cjs');
const R = require('../desktop/auto-replies.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const response = (extra = '', state = 'Disabled', allowed = 'All') => P.soap(`<m:GetUserOofSettingsResponse><m:ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage><t:OofSettings><t:OofState>${state}</t:OofState><t:ExternalAudience>None</t:ExternalAudience><t:Duration><t:StartTime>2026-11-10T09:00:00Z</t:StartTime><t:EndTime>2026-11-11T18:00:00Z</t:EndTime></t:Duration><t:InternalReply lang="ru"><t:Message>&lt;p&gt;Away &amp;amp; back&lt;/p&gt;</t:Message></t:InternalReply><t:ExternalReply><t:Message/></t:ExternalReply>${extra}</t:OofSettings><m:AllowExternalOof>${allowed}</m:AllowExternalOof></m:GetUserOofSettingsResponse>`);
function fixture() {
  const calls = [];
  const client = new OWAClient({ server: 'https://mail.example.com', username: 'DOMAIN\\fictional' }, async (url, options) => {
    calls.push({ url, options });
    if (options.headers.SOAPAction.includes('/SetUserOofSettings')) {
      if (client.failWrite) throw new Error('Lost response');
      return { status: client.writeStatus || 200, text: P.soap('<m:SetUserOofSettingsResponse><m:ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage></m:SetUserOofSettingsResponse>') };
    }
    return { status: 200, text: client.response || response() };
  }, async () => 'fictional');
  client.canary = 'fictional'; client.identity = async () => ({ email: 'owner@example.com' });
  return { client, calls };
}
test('OOF reads normalized UTC settings for the authenticated mailbox without writing', async () => {
  const { client, calls } = fixture();
  const value = await R.read(client);
  assert.equal(value.state, 'Disabled'); assert.equal(value.internal, '<p>Away &amp; back</p>'); assert.equal(value.external, '');
  assert.equal(value.start, '2026-11-10T09:00:00.000Z'); assert.equal(value.allowExternal, 'All');
  assert.match(value.revision, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 1); assert.match(calls[0].options.body, /<t:Address>owner@example.com<\/t:Address>/);
  assert.equal(calls[0].url, 'https://mail.example.com/EWS/Exchange.asmx');
  assert.throws(() => R.normalize(P.parseSOAP(response('', 'Unknown'))), /неподдерживаемые/);
});
test('OOF saves each mode once, preserves unedited OWA HTML, language and disabled schedule', async () => {
  for (const state of ['Disabled', 'Enabled', 'Scheduled']) {
    const { client, calls } = fixture(); const value = await R.read(client);
    const input = { revision: value.revision, state, audience: 'Known', start: '2026-11-12T09:00:00.000Z', end: '2026-11-13T09:00:00.000Z' };
    assert.equal(await R.save(client, input), true);
    assert.equal(calls.length, 3);
    const xml = calls[2].options.body;
    assert.match(xml, /<m:SetUserOofSettingsRequest>/); assert.match(xml, /lang="ru"/);
    assert.match(xml, /&lt;p&gt;Away &amp;amp; back&lt;\/p&gt;/);
    assert.match(xml, new RegExp(`<t:OofState>${state}</t:OofState>`));
    assert.match(xml, /<t:ExternalAudience>Known<\/t:ExternalAudience>/);
    assert.match(xml, new RegExp(state === 'Scheduled' ? '2026-11-12T09:00:00.000Z' : '2026-11-10T09:00:00.000Z'));
    await assert.rejects(R.save(client, input), /Загрузите/); assert.equal(calls.length, 3);
  }
});
test('edited OOF text is escaped HTML, including literal markup and newlines', async () => {
  const { client, calls } = fixture(); const value = await R.read(client);
  await R.save(client, { ...value, internal: '<script>alert(1)</script>\nA & B', external: '' });
  const parsed = P.parseSOAP(calls.at(-1).options.body.replace('<m:SetUserOofSettingsRequest>', '<m:SetUserOofSettingsRequest><m:ResponseCode>NoError</m:ResponseCode>'));
  const settings = parsed.Envelope.Body.SetUserOofSettingsRequest.UserOofSettings;
  assert.equal(settings.InternalReply.Message, '<html><body>&lt;script&gt;alert(1)&lt;/script&gt;<br>A &amp; B</body></html>');
});
test('OOF rejects invalid values and server policy violations before any write', async () => {
  const { client, calls } = fixture(); client.response = response('', 'Disabled', 'Known');
  const value = await R.read(client);
  for (const patch of [{ state: 'Other' }, { audience: 'Other' }, { audience: 'All' }, { internal: 'x'.repeat(32001) }, { internal: {} }, { internal: '\u0000' }, { state: 'Scheduled', start: 'bad', end: 'bad' }, { state: 'Scheduled', start: value.end, end: value.start }]) {
    await assert.rejects(R.save(client, { revision: value.revision, state: 'Enabled', audience: 'None', ...patch }));
  }
  assert.equal(calls.length, 1);
});
test('OOF refuses changed server settings, concurrent saves and a retired account', async () => {
  const { client, calls } = fixture(); const value = await R.read(client);
  client.response = response('', 'Enabled');
  await assert.rejects(R.save(client, { ...value }), /изменились/); assert.equal(calls.length, 2);
  client.autoRepliesSaving = true;
  await assert.rejects(R.save(client, { ...value }), /уже выполняется/); assert.equal(calls.length, 2);
  client.autoRepliesSaving = false;
  let guards = 0;
  await assert.rejects(R.save(client, value, () => { if (++guards === 2) throw new Error('Retired'); }), /Retired/);
  assert.equal(calls.some(call => call.options.headers.SOAPAction.includes('/SetUserOofSettings')), false);
});
test('OOF rejects impossible dates and can disable existing replies after a policy restriction', async () => {
  const { client, calls } = fixture();
  const value = await R.read(client);
  for (const start of ['2026-02-30T09:00:00.000Z', '2026-13-01T09:00:00.000Z', '2026-11-10T09:00:00+03:00']) {
    await assert.rejects(R.save(client, { ...value, state: 'Scheduled', start, end: '2027-11-10T09:00:00.000Z' }), /корректный период/);
  }
  assert.equal(calls.length, 1);
  client.response = response('', 'Enabled', 'None').replace('<t:ExternalAudience>None', '<t:ExternalAudience>All');
  const restricted = await R.read(client);
  await R.save(client, { ...restricted, state: 'Disabled' });
  assert.match(calls.at(-1).options.body, /<t:OofState>Disabled<\/t:OofState>/);
});
test('OOF never replays a lost, expired or rejected write, and requires a reload', async () => {
  for (const failure of ['lost', 440, 403, 500]) {
    const { client, calls } = fixture(); const value = await R.read(client);
    if (failure === 'lost') client.failWrite = true; else client.writeStatus = failure;
    await assert.rejects(R.save(client, value)); assert.equal(calls.length, 3);
    await assert.rejects(R.save(client, value), /Загрузите/); assert.equal(calls.length, 3);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../desktop/mail-rules.cjs');
const P = require('../desktop/protocol.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const { createTools } = require('../desktop/mcp-tools.cjs');
const rule = () => ({ RuleId: 'rule&1', DisplayName: 'Invoices', Priority: '4', IsEnabled: 'true', IsNotSupported: 'false', IsInError: 'false', Conditions: { FromAddresses: { Address: { EmailAddress: 'anna@example.test', RoutingType: 'SMTP' } }, ContainsSubjectStrings: { String: 'Invoice' } }, Exceptions: '', Actions: { MarkAsRead: 'true', MoveToFolder: { FolderId: { '@_Id': 'target', '@_ChangeKey': 'key' } } } });
function fixture() {
  const client = new OWAClient({ server: 'https://mail.example.test', username: 'fictional' }, async () => assert.fail('Unexpected network'));
  const calls = []; let stored = rule(), blob = 'false', failure = false;
  client.syncId = 'session';
  client.ews = async (action, xml) => { calls.push({ action, xml }); if (action === 'GetInboxRules') return { InboxRules: { Rule: stored }, OutlookRuleBlobExists: blob }; if (failure) throw new Error('Lost response'); return {}; };
  client.folders = async () => [{ id: 'target', name: 'Invoices' }];
  return { client, calls, set stored(value) { stored = value; }, set blob(value) { blob = value; }, set failure(value) { failure = value; } };
}
test('rules parse real SOAP shape, retain IDs, expose flags and refuse lossy round trips', async () => {
  const f = fixture();
  const result = await R.list(f.client);
  assert.equal(result.items[0].editable, true); assert.equal(result.items[0].folder, 'target');
  const xml = '<Envelope><ResponseCode>NoError</ResponseCode><Rule><RuleId>x</RuleId><DisplayName>Read</DisplayName><Priority>0</Priority><IsEnabled>false</IsEnabled><Conditions><FromAddresses><Address><EmailAddress>anna@example.test</EmailAddress></Address></FromAddresses></Conditions><Actions><MarkAsRead>true</MarkAsRead></Actions></Rule></Envelope>';
  f.stored = P.parseSOAP(xml).Envelope.Rule;
  assert.equal((await R.list(f.client)).items[0].editable, true);
  for (const mutate of [r => { r.Conditions.SentToMe = 'true'; }, r => { r.Actions.Delete = 'true'; }, r => { r.Exceptions = { Categories: { String: 'keep' } }; }, r => { r.Conditions.ContainsSubjectStrings.String = [' valid', 'two']; }, r => { r.IsNotSupported = 'true'; }, r => { r.IsInError = 'true'; }, r => { r.Conditions.FromAddresses.Address.RoutingType = 'EX'; }]) {
    const r = rule(); mutate(r); f.stored = r;
    assert.equal((await R.list(f.client)).items[0].editable, false);
  }
  f.stored = rule(); f.blob = 'true';
  const protectedRule = (await R.list(f.client)).items[0];
  assert.equal(protectedRule.editable, false);
  assert.equal(protectedRule.readOnlyReason, 'outlook');
  assert.deepEqual(protectedRule.details.conditions.map(detail => detail.key), ['FromAddresses', 'ContainsSubjectStrings']);
  assert.deepEqual(protectedRule.details.actions.at(-1), { key: 'MoveToFolder', values: ['target'] });
});
test('EX senders stay editable and retain the original routing type and address on save', async () => {
  const f = fixture();
  const legacy = '/o=Example/ou=Group/cn=Recipients/cn=lab&robot';
  f.stored = {
    ...rule(),
    Conditions: { FromAddresses: { Address: { Name: 'Lab <robot>', EmailAddress: legacy, RoutingType: 'EX', MailboxType: 'Mailbox' } } },
    Actions: { MoveToFolder: { FolderId: { '@_Id': 'target' } }, StopProcessingRules: 'true' },
  };
  const [entry] = (await f.client.mailRules()).items;
  assert.equal(entry.editable, true);
  assert.equal(entry.sender, '');
  assert.deepEqual(entry.internalSenders, [{ index: 0, name: 'Lab <robot>' }]);
  assert.doesNotMatch(JSON.stringify(entry), /\/cn=Recipients/);
  const update = { action: 'update', id: entry.id, revision: entry.revision };
  await f.client.changeMailRule({ ...update, changes: { folder: 'another-folder', sender: 'new@example.test' } });
  const xml = f.calls.at(-1).xml;
  assert.match(xml, /<t:Name>Lab &lt;robot&gt;<\/t:Name>/);
  assert.ok(xml.includes(`<t:EmailAddress>${P.escapeXML(legacy)}</t:EmailAddress><t:RoutingType>EX</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType>`));
  assert.match(xml, /new@example.test/);
  assert.match(xml, /<t:MoveToFolder><t:FolderId Id="another-folder"/);
  assert.match(xml, /<t:StopProcessingRules>true/);
  assert.match(xml, /<m:RemoveOutlookRuleBlob>false/);
  await assert.rejects(f.client.changeMailRule({ ...update, changes: { name: 'No conditions' }, removeInternalSenders: [0] }));
  await assert.rejects(f.client.changeMailRule({ ...update, changes: { name: 'Unknown sender' }, removeInternalSenders: [1] }));
  await f.client.changeMailRule({ ...update, changes: { sentOnlyToMe: true }, removeInternalSenders: [0] });
  assert.doesNotMatch(f.calls.at(-1).xml, /<t:FromAddresses>/);
  assert.match(f.calls.at(-1).xml, /<t:SentOnlyToMe>true/);
  f.blob = 'TRUE';
  const [blocked] = (await f.client.mailRules()).items;
  assert.equal(blocked.readOnlyReason, 'outlook');
  assert.deepEqual(blocked.details.conditions[0].values, ['Lab <robot>']);
  await assert.rejects(f.client.changeMailRule({ ...update, changes: { name: 'Blocked' } }), /клиентские правила Outlook/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 2);
});
test('body conditions, subject exceptions, multiple senders and copy actions round-trip', async () => {
  const f = fixture();
  const ruleValue = rule();
  ruleValue.Conditions.FromAddresses.Address = [ruleValue.Conditions.FromAddresses.Address, { EmailAddress: 'other@example.test' }];
  ruleValue.Conditions.ContainsBodyStrings = { String: 'billing & finance' };
  ruleValue.Exceptions = { ContainsSubjectStrings: { String: 'Internal' } };
  ruleValue.Actions.CopyToFolder = { FolderId: { '@_Id': 'copy-target' } };
  ruleValue.Actions.StopProcessingRules = 'true';
  f.stored = ruleValue;
  const [entry] = (await R.list(f.client)).items;
  assert.equal(entry.editable, true);
  assert.equal(entry.sender, 'anna@example.test, other@example.test');
  await R.change(f.client, { id: entry.id, revision: entry.revision, action: 'update', changes: { name: 'Billing' } });
  const xml = f.calls.at(-1).xml;
  assert.match(xml, /ContainsBodyStrings><t:String>billing &amp; finance/);
  assert.match(xml, /<t:Exceptions><t:ContainsSubjectStrings><t:String>Internal/);
  assert.match(xml, /<t:CopyToFolder><t:FolderId Id="copy-target"/);
  assert.match(xml, /<t:StopProcessingRules>true/);
  assert.match(xml, /other@example.test/);
  assert.doesNotMatch(R.createSOAP({ name: 'Subject only', subject: 'Invoice', markRead: true }, 0), /FromAddresses/);
});
test('multiple phrases, attachment predicates and priority actions survive OWA rule editing', async () => {
  const f = fixture(), value = rule();
  value.Conditions.ContainsSubjectStrings.String = ['one', 'two & three'];
  value.Conditions.HasAttachments = 'true';
  value.Exceptions = { ContainsBodyStrings: { String: ['one', 'two'] }, HasAttachments: 'true', SentOnlyToMe: 'true' };
  value.Actions.MarkImportance = 'High';
  f.stored = value;
  const [current] = (await R.list(f.client)).items;
  assert.equal(current.editable, true);
  assert.equal(current.subject, 'one\ntwo & three');
  await R.change(f.client, { action: 'update', id: current.id, revision: current.revision, changes: { name: 'Changed' } });
  const xml = f.calls.at(-1).xml;
  assert.match(xml, /<t:ContainsSubjectStrings><t:String>one<\/t:String><t:String>two &amp; three/);
  assert.match(xml, /<t:Exceptions><t:ContainsBodyStrings><t:String>one<\/t:String><t:String>two/);
  assert.match(xml, /<t:HasAttachments>true<\/t:HasAttachments><t:SentOnlyToMe>true/);
  assert.match(xml, /<t:MarkImportance>High/);
  assert.throws(() => R.createSOAP({ name: 'Too many', subject: Array(21).fill('keyword').join('\n'), markRead: true }, 0));
});
test('one rule is updated or deleted, blob preserved, stale and unsupported writes blocked', async () => {
  const f = fixture(), before = (await f.client.mailRules()).items[0];
  await f.client.changeMailRule({ action: 'update', id: before.id, revision: before.revision, changes: { name: 'CreateRuleOperation & safe', enabled: false, folder: '', priority: 2 } });
  const xml = f.calls.at(-1).xml;
  assert.match(xml, /<t:SetRuleOperation>/); assert.match(xml, /<t:RuleId>rule&amp;1/); assert.match(xml, /<t:DisplayName>CreateRuleOperation &amp; safe/);
  assert.match(xml, /<t:IsEnabled>false/); assert.match(xml, /<t:Priority>2/); assert.match(xml, /<t:MarkAsRead>true/); assert.match(xml, /<m:RemoveOutlookRuleBlob>false/);
  assert.doesNotMatch(xml, /<t:(?:MoveToFolder|DeleteRuleOperation|CreateRuleOperation)>/);
  await f.client.changeMailRule({ action: 'delete', id: before.id, revision: before.revision });
  assert.match(f.calls.at(-1).xml, /<t:DeleteRuleOperation><t:RuleId>rule&amp;1/);
  f.stored = { ...rule(), DisplayName: 'Changed elsewhere' };
  await assert.rejects(f.client.changeMailRule({ action: 'delete', id: before.id, revision: before.revision }), /изменилось/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 2);
  f.stored = rule(); f.blob = 'true'; await assert.rejects(f.client.changeMailRule({ action: 'delete', id: before.id, revision: before.revision }), /клиентские правила Outlook/);
  f.blob = 'false';
  await assert.rejects(f.client.changeMailRule({ action: 'delete', id: before.id, revision: before.revision, changes: { id: 'other' } }));
  f.failure = true;
  await assert.rejects(f.client.changeMailRule({ action: 'delete', id: before.id, revision: before.revision }), /Lost response/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 3);
  for (const changes of [{}, { priority: -1 }, { priority: 2147483648 }, { enabled: 'false' }, { markRead: false, folder: '' }, { sender: '', subject: '' }, { name: 42 }, { folder: null }, { unknown: true }]) await assert.rejects(f.client.changeMailRule({ action: 'update', id: before.id, revision: before.revision, changes }));
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 3);
});
test('MCP lists rules and gates edits/deletion with approval, fresh revisions and session guards', async () => {
  const f = fixture(); let active = f.client, allowed = false, approvals = 0;
  const call = createTools({ current: () => active, confirm: async () => { approvals++; return allowed; } });
  const input = { sessionId: 'session', ...(await call('list_rules', { sessionId: 'session' })).items[0] };
  const ref = { sessionId: input.sessionId, id: input.id, revision: input.revision };
  await assert.rejects(call('delete_rule', ref), /cancelled/); assert.equal(approvals, 1);
  assert.equal(f.calls.some(c => c.action === 'UpdateInboxRules'), false);
  allowed = true; await call('update_rule', { ...ref, changes: { enabled: false } });
  assert.match(f.calls.at(-1).xml, /<t:IsEnabled>false/);
  const stale = createTools({ current: () => active, confirm: async () => { f.stored = { ...rule(), DisplayName: 'Elsewhere' }; return true; } });
  await assert.rejects(stale('delete_rule', ref), /uncertain/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 1);
  f.stored = rule();
  const retire = createTools({ current: () => active, confirm: async () => { active = null; return true; } });
  await assert.rejects(retire('delete_rule', ref), /session ended/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 1);
  active = f.client; f.failure = true;
  await assert.rejects(call('delete_rule', ref), /uncertain/);
  assert.equal(f.calls.filter(c => c.action === 'UpdateInboxRules').length, 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const { createTools, tools } = require('../desktop/mcp-tools.cjs');
const { McpFiles, limit } = require('../desktop/mcp-files.cjs');
const sessionId = 'fictional-mail-session';
const success = '<Envelope><ResponseCode>NoError</ResponseCode></Envelope>';
function fixture() {
  const requests = [], approvals = [], writes = [], invokes = [];
  const state = { live: true, key: 'draft-key', fail: '', allowed: true };
  const client = new OWAClient({ server: 'https://mail.example.test', username: 'self@example.test', password: 'never-expose' }, async (url, options) => {
    const soap = options.headers?.SOAPAction?.match(/\/([^/]+)"$/)?.[1];
    const action = soap || (options.binary ? 'GetFileAttachment' : new URL(url).searchParams.get('action')); requests.push({ action, options });
    if (options.binary) return { status: 200, buffer: Buffer.from('payload') };
    if (state.fail === action) throw new Error('Lost response');
    if (action === 'GetItem' && soap) return { status: 200, text: `<Envelope><ResponseCode>NoError</ResponseCode><Message><ItemId Id="draft" ChangeKey="${state.key}"/><ItemClass>IPM.Note</ItemClass><IsDraft>true</IsDraft><Subject>Draft</Subject><Body BodyType="Text">Existing body</Body><ToRecipients><Mailbox><EmailAddress>anna@example.test</EmailAddress></Mailbox></ToRecipients><CcRecipients><Mailbox><EmailAddress>cc@example.test</EmailAddress></Mailbox></CcRecipients><BccRecipients><Mailbox><EmailAddress>bcc@example.test</EmailAddress></Mailbox></BccRecipients><Attachments><FileAttachment><AttachmentId Id="old-file"/><Name>old.txt</Name><Size>3</Size></FileAttachment></Attachments></Message></Envelope>` };
    if (action === 'GetItem') return { status: 200, text: JSON.stringify({ Body: { Items: [{ ItemId: { Id: 'source', ChangeKey: 'fresh-source-key' }, ParentFolderId: { Id: 'inbox-id' }, Subject: 'Original', From: { EmailAddress: 'anna@example.test' }, ToRecipients: [{ EmailAddress: 'self@example.test' }, { EmailAddress: 'other@example.test' }], CcRecipients: [{ EmailAddress: 'cc@example.test' }], Attachments: [{ AttachmentId: { Id: 'source-file' }, Name: 'source.txt', Size: 7, ContentType: 'text/plain' }] }] } }) };
    if (action === 'CreateItem') return { status: 200, text: '<Envelope><ResponseCode>NoError</ResponseCode><ItemId Id="created" ChangeKey="created-key"/></Envelope>' };
    if (action === 'UpdateItem') return { status: 200, text: '<Envelope><ResponseCode>NoError</ResponseCode><ItemId Id="draft" ChangeKey="updated-key"/></Envelope>' };
    if (action === 'CreateAttachment') {
      const id = options.body.includes('Id="draft"') ? 'draft' : 'created';
      return { status: 200, text: `<Envelope><ResponseCode>NoError</ResponseCode><AttachmentId RootItemId="${id}" RootItemChangeKey="last-attachment-key"/></Envelope>` };
    }
    if (action === 'GetAttachment') return { status: 200, text: '<Envelope><ResponseCode>NoError</ResponseCode><Content>cGF5bG9hZA==</Content></Envelope>' };
    if (soap) return { status: 200, text: success };
    throw new Error('Unexpected fixture request');
  }, async () => 'fictional');
  client.canary = 'fictional'; client.syncId = sessionId;
  client.identity = async () => ({ email: 'self@example.test', emails: ['self@example.test'] });
  client.folders = async () => [{ id: 'inbox-id', wellKnown: 'inbox' }, { id: 'sent-id', wellKnown: 'sentitems' }];
  const host = { sanitize: async html => html, invoke: async (operation, input) => { invokes.push({ operation, input }); return true; }, local: async () => true, settings: async () => ({ theme: 'light' }), action: async input => ({ action: input.action }), panel: async panel => ({ opened: panel }) };
  const call = createTools({ current: () => state.live ? client : null, host, confirm: async input => { approvals.push(input); state.afterApproval?.(); return state.allowed; }, writing: delta => writes.push(delta) });
  return { call, client, state, requests, approvals, writes, host, invokes };
}
test('opening MCP attachments needs confirmation and a live account while preview and save keep their own behavior', async () => {
  const f = fixture(), operations = [];
  f.host.attachment = async action => { operations.push(action); return true; };
  const { handle } = await f.call('upload_attachment', { sessionId, name: 'report.txt', type: 'text/plain', content: 'dGVzdA==', offset: 0, final: true });
  const action = action => f.call('attachment_action', { sessionId, handle, action });
  f.state.allowed = false;
  await assert.rejects(action('open'), /cancelled/);
  assert.equal(f.approvals[0].prompt.detail, 'report.txt');
  assert.deepEqual(operations, []);
  await action('preview');
  await action('save');
  assert.equal(f.approvals.length, 1);
  f.state.allowed = true;
  await action('open');
  f.state.afterApproval = () => { f.state.live = false; };
  await assert.rejects(action('open'), /session/);
  assert.deepEqual(operations, ['preview', 'save', 'open']);
});
test('mail sending skips native confirmation, preserves Cc/Bcc and uses fresh reply-all recipients', async () => {
  const f = fixture(); f.state.allowed = false;
  await f.call('send_mail', { sessionId, kind: 'reply-all', reference: { id: 'source', changeKey: 'stale' }, body: 'Reply', bcc: ['private@example.test'], signature: 'none' });
  assert.equal(f.approvals.length, 0);
  const sends = f.requests.filter(request => request.action === 'CreateItem'); assert.equal(sends.length, 1);
  const xml = sends[0].options.body;
  assert.match(xml, /ReplyAllToItem/); assert.match(xml, /fresh-source-key/); assert.doesNotMatch(xml, /stale/);
  assert.match(xml, /anna@example.test/); assert.match(xml, /other@example.test/); assert.match(xml, /cc@example.test/); assert.match(xml, /private@example.test/);
  assert.doesNotMatch(xml, /<t:EmailAddress>self@example.test/);
});
test('uploaded attachments stay in memory and sends use the last RootItemChangeKey', async () => {
  const f = fixture();
  const upload = await f.call('upload_attachment', { sessionId, name: 'report.txt', type: 'text/plain', content: 'aGVsbG8=', offset: 0, final: true });
  await f.call('send_mail', { sessionId, to: ['anna@example.test'], body: 'Report', attachments: [{ handle: upload.handle }], signature: 'none' });
  assert.deepEqual(f.requests.map(request => request.action), ['CreateItem', 'CreateAttachment', 'SendItem']);
  assert.match(f.requests.at(-1).options.body, /ChangeKey="last-attachment-key"/);
  assert.match(f.requests[1].options.body, /aGVsbG8=/); assert.equal(f.approvals.length, 0);
  f.call.retire();
  await assert.rejects(f.call('send_mail', { sessionId, to: ['anna@example.test'], body: 'Report', attachments: [{ handle: upload.handle }] }), /expired/);
});
test('draft creation/save retain native approval; sending an existing draft does not and preserves recipients/attachments', async () => {
  const f = fixture();
  await f.call('create_draft', { sessionId, body: 'Draft', to: [] }); assert.equal(f.approvals.length, 1);
  const draft = await f.call('read_draft', { sessionId, id: 'draft' });
  assert.equal(draft.bcc[0].email, 'bcc@example.test'); assert.equal(draft.changeKey, 'draft-key');
  await assert.rejects(f.call('update_draft', { sessionId, id: 'draft', expectedChangeKey: 'old', changes: { subject: 'New' } }), /changed/);
  f.state.allowed = false;
  await f.call('send_draft', { sessionId, id: 'draft', expectedChangeKey: 'draft-key', changes: { subject: 'Final' } });
  assert.equal(f.approvals.length, 1);
  const update = f.requests.find(request => request.action === 'UpdateItem').options.body;
  assert.match(update, /NeverOverwrite/); assert.match(update, /Final/); assert.match(update, /Existing body/);
  assert.match(update, /anna@example.test/); assert.match(update, /cc@example.test/); assert.match(update, /bcc@example.test/);
  assert.doesNotMatch(update, /Attachments/); assert.match(f.requests.at(-1).options.body, /updated-key/);
});
test('failed sends are not repeated, invalid addresses fail before writes, other changes remain cancellable', async () => {
  const f = fixture();
  await assert.rejects(f.call('send_mail', { sessionId, body: 'Missing recipients' }), /получателя/);
  assert.equal(f.requests.length, 0);
  f.state.fail = 'CreateItem';
  await assert.rejects(f.call('send_mail', { sessionId, body: 'Hello', to: ['anna@example.test'] }), /uncertain/);
  assert.equal(f.requests.length, 1); assert.deepEqual(f.writes, [1, -1]);
  f.state.allowed = false;
  await assert.rejects(f.call('folder_action', { sessionId, action: 'read', folder: 'inbox' }), /cancelled/);
  assert.equal(f.requests.length, 1);
});
test('account retirement during mail preparation prevents a send and unsupported settings fail before approval', async () => {
  const f = fixture();
  f.host.sanitize = async html => { f.state.live = false; return html; };
  await assert.rejects(f.call('send_mail', { sessionId, body: 'Hello', bodyHtml: '<b>Hello</b>', to: ['anna@example.test'], signature: 'none' }), /session ended/);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.writes, []);
  await assert.rejects(f.call('client_action', { action: 'save_settings', settings: { minutes: 7 } }), /numeric argument/);
  assert.equal(f.approvals.length, 0);
});
test('attachment reads verify parent ownership, support chunks and do not accept arbitrary local paths', async () => {
  const f = fixture();
  const chunk = await f.call('read_attachment', { sessionId, sourceId: 'source', attachmentId: 'source-file', offset: 2, length: 3 });
  assert.equal(Buffer.from(chunk.content, 'base64').toString(), 'ylo'); assert.equal(chunk.more, true); assert.equal(chunk.nextOffset, 5);
  const count = f.requests.filter(request => request.action === 'GetFileAttachment').length;
  await assert.rejects(f.call('read_attachment', { sessionId, sourceId: 'source', attachmentId: 'unrelated' }), /does not belong/);
  assert.equal(f.requests.filter(request => request.action === 'GetFileAttachment').length, count);
  await assert.rejects(f.call('upload_attachment', { sessionId, name: 'secret', content: '', offset: 0, path: '/private/account' }), /arguments/);
});
test('memory uploads enforce ownership, exact offsets, completion, TTL and the total byte budget', () => {
  const files = new McpFiles(), owner = {}, other = {};
  const upload = files.upload({ name: 'a.txt', content: 'YQ==', offset: 0 }, owner);
  assert.throws(() => files.get(upload.handle, other), /another account/);
  assert.throws(() => files.upload({ handle: upload.handle, content: 'Yg==', offset: 0 }, owner), /offset/);
  assert.equal(files.upload({ handle: upload.handle, content: 'Yg==', offset: 1, final: true }, owner).size, 2);
  assert.throws(() => files.upload({ handle: upload.handle, content: '', offset: 2 }, owner), /offset/);
  files.entries.get(upload.handle).until = 0;
  assert.throws(() => files.get(upload.handle, owner), /expired/); assert.equal(files.bytes, 0);
  files.upload({ name: 'full', content: Buffer.alloc(limit).toString('base64'), offset: 0, final: true }, owner);
  assert.throws(() => files.upload({ name: 'overflow', content: 'YQ==', offset: 0 }, owner), /limit/);
  files.clear(); assert.equal(files.bytes, 0); assert.equal(files.entries.size, 0);
});
test('existing client handlers receive only whitelisted operations, including settings before login', async () => {
  const f = fixture();
  await f.call('set_quick_replies', { sessionId, revision: 1, replies: [{ id: 'a', title: 'Thanks', body: 'Thank you' }] });
  assert.equal(f.invokes.at(-1).operation, 'saveQuickReplies');
  await f.call('set_auto_replies', { sessionId, revision: 'a'.repeat(64), state: 'Disabled', audience: 'None' });
  assert.equal(f.invokes.at(-1).operation, 'saveAutoReplies');
  f.state.live = false;
  assert.deepEqual(await f.call('get_client_settings'), { theme: 'light' });
  assert.deepEqual(await f.call('open_client_panel', { panel: 'modules' }), { opened: 'modules' });
  assert.deepEqual(await f.call('open_client_panel', { panel: 'rules' }), { opened: 'rules' });
  await assert.rejects(f.call('client_action', { action: 'restore' }), /string argument/);
  await assert.rejects(f.call('open_client_panel', { panel: 'executeJavaScript' }), /string argument/);
  for (const name of ['send_mail', 'create_meeting', 'respond_meeting', 'remove_meeting', 'message_meeting', 'send_draft']) assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, false);
});
test('sender rules can mark read, move or combine actions without touching an Outlook rule blob', async () => {
  const rules = require('../desktop/mail-rules.cjs');
  const basic = { name: 'Billing', sender: 'billing@example.test', subject: 'Invoice' };
  const read = rules.createSOAP({ ...basic, markRead: true }, 1);
  assert.match(read, /<t:MarkAsRead>true/); assert.doesNotMatch(read, /MoveToFolder/);
  const both = rules.createSOAP({ ...basic, markRead: true, folder: 'target' }, 1);
  assert.match(both, /MarkAsRead.*MoveToFolder/); assert.match(both, /RemoveOutlookRuleBlob>false/);
  const move = rules.createSOAP({ ...basic, folder: 'target' }, 1); assert.doesNotMatch(move, /MarkAsRead/);
  assert.throws(() => rules.createSOAP(basic, 1)); assert.throws(() => rules.createSOAP({ ...basic, markRead: 'true' }, 1));
  const actions = [];
  await assert.rejects(rules.create({ ews: async action => { actions.push(action); return { OutlookRuleBlobExists: 'true' }; } }, { ...basic, markRead: true }), /Outlook/);
  assert.deepEqual(actions, ['GetInboxRules']);
  const f = fixture(); f.client.createMailRule = async input => { assert.equal(input.markRead, true); assert.equal(input.folder, undefined); return true; };
  assert.equal(await f.call('create_rule', { sessionId, ...basic, markRead: true }), true);
});

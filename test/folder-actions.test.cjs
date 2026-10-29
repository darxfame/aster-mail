const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const soap = body => `<Envelope><ResponseCode>NoError</ResponseCode>${body}</Envelope>`;
function fixture(fail = '') {
  const calls = [];
  const client = new OWAClient({server:'https://mail.example.com',username:'me@example.com',password:'fake'},async (_url, options) => {
    const action = options.headers.SOAPAction.match(/\/([^/]+)"$/)[1]; calls.push({action, body:options.body});
    if (action === fail) throw new Error('Lost response');
    return {status:200,text:soap(action === 'GetFolder' ? '<Folder><FolderId Id="custom&amp;id" ChangeKey="fresh&amp;key"/><DisplayName>Custom</DisplayName></Folder>' : '')};
  },async () => 'canary'); client.canary = 'canary';
  client.folders = async () => [{id:'inbox-id',wellKnown:'inbox'},{id:'trash-id',wellKnown:'deleteditems'},{id:'custom&id',name:'Custom',changeKey:'fresh&key'}];
  return {client,calls};
}
test('read-all is a single server operation for the chosen folder with read receipts suppressed', async () => {
  const {client,calls} = fixture();
  await client.mailCache.get('old',async()=>({unread:10}));
  await client.folderOperation({action:'read',folder:'inbox'});
  assert.equal(calls.length,1); assert.equal(calls[0].action,'MarkAllItemsAsRead');
  assert.match(calls[0].body,/<m:ReadFlag>true<\/m:ReadFlag>/);
  assert.match(calls[0].body,/<m:SuppressReadReceipts>true<\/m:SuppressReadReceipts>/);
  assert.match(calls[0].body,/<t:DistinguishedFolderId Id="inbox"\/>/);
  assert.equal(client.mailCache.entries.size,0);
});
test('create supports root and subfolder and escapes display names', async () => {
  for (const folder of ['msgfolderroot','custom&id']) {
    const {client,calls}=fixture();
    await client.folderOperation({action:'create',folder,name:' New <&> '});
    assert.equal(calls.length,1); assert.equal(calls[0].action,'CreateFolder');
    assert.match(calls[0].body,/<t:DisplayName>New &lt;&amp;&gt;<\/t:DisplayName>/);
    assert.match(calls[0].body,/IPF.Note/);
  }
});
test('rename reads current folder key and does not overwrite a stale folder', async () => {
  const {client,calls}=fixture();
  await client.folderOperation({action:'rename',folder:'custom&id',name:'Renamed',expectedChangeKey:'fresh&key'});
  assert.deepEqual(calls.map(c=>c.action),['GetFolder','UpdateFolder']);
  assert.match(calls[1].body,/Id="custom&amp;id" ChangeKey="fresh&amp;key"/);
  const stale=fixture();
  await assert.rejects(stale.client.folderOperation({action:'rename',folder:'custom&id',name:'New',expectedChangeKey:'old'}),/изменилась/);
  assert.deepEqual(stale.calls.map(c=>c.action),['GetFolder']);
});
test('folder removal moves to trash, including content, and never calls permanent deletion', async () => {
  const {client,calls}=fixture();
  await client.folderOperation({action:'trash',folder:'custom&id'});
  assert.deepEqual(calls.map(c=>c.action),['GetFolder','MoveFolder']);
  assert.match(calls[1].body,/<t:DistinguishedFolderId Id="deleteditems"\/>/);
  assert.doesNotMatch(calls[1].body,/DeleteFolder|HardDelete|SoftDelete/);
});
test('system folders are protected for aliases and raw IDs; invalid names never write', async () => {
  const {client,calls}=fixture();
  for (const folder of ['inbox','inbox-id','trash-id']) for (const action of ['rename','trash']) await assert.rejects(client.folderOperation({action,folder,name:'New'}),/Системную/);
  for (const name of ['', '  ', 'x'.repeat(256), 'bad\u0000name']) await assert.rejects(client.folderOperation({action:'create',folder:'inbox',name}),/название/);
  await assert.rejects(client.folderOperation({action:'erase',folder:'inbox'}),/Некорректная/);
  assert.equal(calls.length,0);
});
test('a lost mutation reply is not replayed and clears stale cached counts', async () => {
  const {client,calls}=fixture('UpdateFolder');
  await client.mailCache.get('counts',async()=>({unread:5}));
  await assert.rejects(client.folderOperation({action:'rename',folder:'custom&id',name:'New'}),/Операция не повторялась/);
  assert.equal(calls.filter(c=>c.action==='UpdateFolder').length,1); assert.equal(client.mailCache.entries.size,0);
});

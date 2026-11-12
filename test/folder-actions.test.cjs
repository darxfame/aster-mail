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
  client.folders = async () => [{id:'inbox-id',wellKnown:'inbox'},{id:'trash-id',wellKnown:'deleteditems'},{id:'custom&id',name:'Custom',changeKey:'fresh&key',systemIdentityKnown:true}];
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
test('failed system identity reads keep folders readable but block rename and trash by raw ID', async () => {
  for (const failedAlias of ['inbox', 'archive']) {
    const writes = [];
    const client = new OWAClient({server:'https://mail.example.com'}, async (_url, options) => {
      if (options.headers.SOAPAction) { writes.push(options.headers.SOAPAction); throw new Error('Unexpected write'); }
      const body = JSON.parse(options.body).Body;
      if (options.headers.Action === 'GetFolder') {
        const alias = body.FolderIds[0].Id;
        if (alias === failedAlias) throw new Error('Connection lost');
        return {status:200,text:JSON.stringify({Body:{Folders:[{FolderId:{Id:`real-${alias}`},DisplayName:alias}]}})};
      }
      return {status:200,text:JSON.stringify({Body:{RootFolder:{IncludesLastItemInRange:true,Folders:[{FolderId:{Id:`real-${failedAlias}`},DisplayName:failedAlias},{FolderId:{Id:'custom'},DisplayName:'Custom'}]}}})};
    },async ()=>'canary');
    client.canary = 'canary';
    const folders = await client.folders();
    assert.ok(folders.some(folder => folder.id === `real-${failedAlias}`));
    for (const folder of [`real-${failedAlias}`, 'custom']) for (const action of ['rename', 'trash']) {
      await assert.rejects(client.folderOperation({action,folder,name:'Changed'}),/определить системные папки/);
    }
    assert.equal(writes.length,0);
  }
});
test('an explicitly absent optional archive permits custom folder mutations', async () => {
  const writes = [];
  const client = new OWAClient({server:'https://mail.example.com'}, async (_url, options) => {
    if (options.headers.SOAPAction) {
      const action = options.headers.SOAPAction.match(/\/([^/]+)"$/)[1];
      writes.push(action);
      return {status:200,text:soap(action === 'GetFolder' ? '<Folder><FolderId Id="custom" ChangeKey="fresh"/></Folder>' : '')};
    }
    const body = JSON.parse(options.body).Body;
    if (options.headers.Action === 'GetFolder') {
      const alias = body.FolderIds[0].Id;
      return {status:200,text:JSON.stringify({Body:alias === 'archive' ? {ResponseCode:'ErrorFolderNotFound'} : {Folders:[{FolderId:{Id:`real-${alias}`},DisplayName:alias}]}})};
    }
    return {status:200,text:JSON.stringify({Body:{RootFolder:{IncludesLastItemInRange:true,Folders:[{FolderId:{Id:'custom'},DisplayName:'Custom'}]}}})};
  },async ()=>'canary');
  client.canary = 'canary';
  await client.folderOperation({action:'trash',folder:'custom'});
  assert.deepEqual(writes,['GetFolder','MoveFolder']);
});

const syncAliases = ['syncissues', 'conflicts', 'localfailures', 'serverfailures'];
function synchronizationFixture(failure) {
  const writes = [], lookups = [];
  const client = new OWAClient({server:'https://mail.example.test'}, async (_url, options) => {
    if (options.headers.SOAPAction) {
      const action = options.headers.SOAPAction.match(/\/([^/]+)"$/)[1];
      if (action === 'GetFolder') return {status:200,text:soap('<Folder><FolderId Id="custom" ChangeKey="fresh"/></Folder>')};
      writes.push(action); return {status:200,text:soap('')};
    }
    const body = JSON.parse(options.body).Body;
    if (options.headers.Action === 'GetFolder') {
      const alias = body.FolderIds[0].Id; lookups.push(body.FolderIds[0]);
      if (syncAliases.includes(alias) && failure) {
        if (failure === 'absent') return {status:200,text:JSON.stringify({Body:{ResponseCode:'ErrorFolderNotFound'}})};
        throw new Error('Fictional failed identity read');
      }
      return {status:200,text:JSON.stringify({Body:{Folders:[{FolderId:{Id:`real-${alias}`,ChangeKey:'fresh'},ParentFolderId:{Id:alias==='syncissues'?'root':'real-syncissues'},DisplayName:`Localized ${alias}`}]}})};
    }
    const folders = syncAliases.map(alias => ({FolderId:{Id:`real-${alias}`,ChangeKey:'fresh'},ParentFolderId:{Id:alias==='syncissues'?'root':'real-syncissues'},DisplayName:`Localized ${alias}`,FolderClass:'IPF.Note'}));
    folders.push({FolderId:{Id:'custom',ChangeKey:'fresh'},DisplayName:'Ошибки синхронизации',FolderClass:'IPF.Note'});
    return {status:200,text:JSON.stringify({Body:{RootFolder:{IncludesLastItemInRange:true,Folders:failure==='absent'?folders.slice(-1):folders}}})};
  },async ()=>'canary');
  client.canary='canary';
  return {client,writes,lookups};
}
test('synchronization system folders are protected by actual identity before any mutation', async () => {
  const {client,writes,lookups}=synchronizationFixture();
  const folders=await client.folders();
  for (const alias of syncAliases) {
    assert.equal(folders.find(folder=>folder.id===`real-${alias}`).wellKnown,alias);
    assert.ok(lookups.some(folder=>folder.Id===alias && folder.__type==='DistinguishedFolderId:#Exchange'));
    for (const action of ['rename','trash']) for (const folder of [alias,`real-${alias}`]) await assert.rejects(client.folderOperation({action,folder,name:'New'}),/Системную папку/);
  }
  assert.equal(writes.length,0);
  await client.folderOperation({action:'trash',folder:'custom'});
  assert.deepEqual(writes,['MoveFolder'],'A custom folder with a system-looking name remains mutable');
});
test('absent optional synchronization folders allow custom writes; unresolved identities fail closed', async () => {
  const absent=synchronizationFixture('absent');
  await absent.client.folderOperation({action:'trash',folder:'custom'});
  assert.deepEqual(absent.writes,['MoveFolder']);
  const failed=synchronizationFixture('failed');
  const folders=await failed.client.folders();
  assert.ok(folders.some(folder=>folder.id==='custom'));
  await assert.rejects(failed.client.folderOperation({action:'trash',folder:'custom'}),/определить системные папки/);
  assert.equal(failed.writes.length,0);
});

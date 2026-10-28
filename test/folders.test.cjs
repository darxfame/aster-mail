const test = require('node:test');
const assert = require('node:assert/strict');
const { tree } = require('../src/folders.js');
const { OWAClient } = require('../desktop/owa.cjs');
const defaults = [['inbox', 'Входящие', 'inbox'], ['sentitems', 'Отправленные', 'send'], ['drafts', 'Черновики', 'file'], ['archive', 'Архив', 'archive'], ['deleteditems', 'Корзина', 'trash'], ['junkemail', 'Спам', 'shield']];
test('distinguished folders merge by actual ID and preserve nested folders with duplicate names', () => {
  const roots = tree([{ id: 'real-inbox', wellKnown: 'inbox', name: 'Inbox', unread: 4 }, { id: 'custom', parentId: 'real-inbox', name: 'Projects' }, { id: 'nested', parentId: 'custom', name: 'Inbox' }, { id: 'other', parentId: 'root', name: 'Documents' }], defaults);
  assert.equal(roots.length, 7);
  assert.equal(roots[0].key, 'inbox'); assert.equal(roots[0].unread, 4);
  assert.equal(roots[0].children[0].children[0].key, 'nested');
  assert.equal(roots.filter(f => f.key === 'real-inbox').length, 0);
  assert.equal(roots[3].name, 'Documents');
});
test('cyclic and missing folder parents remain visible without recursion', () => {
  const roots = tree([{ id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }, { id: 'c', parentId: 'unknown', name: 'C' }], defaults);
  assert.equal(roots.length, 9);
});
test('server folder identities, parents and paged results are retained despite a missing archive', async () => {
  const client = new OWAClient({ server: 'https://mail.example.com' }, async (_url, options) => {
    const request = JSON.parse(options.body);
    if (options.headers.Action === 'GetFolder') {
      const alias = request.Body.FolderIds[0].Id;
      if (alias === 'archive') return { status: 200, text: JSON.stringify({ Body: { ResponseCode: 'ErrorFolderNotFound' } }) };
      return { status: 200, text: JSON.stringify({ Body: { Folders: [{ FolderId: { Id: `real-${alias}` }, DisplayName: alias, ParentFolderId: { Id: 'root' } }] } }) };
    }
    const offset = request.Body.Paging.Offset;
    return { status: 200, text: JSON.stringify({ Body: { RootFolder: { IncludesLastItemInRange: offset > 0, IndexedPagingOffset: 50, Folders: offset ? [{ FolderId: { Id: 'custom' }, ParentFolderId: { Id: 'real-inbox' }, DisplayName: 'Project' }] : [{ FolderId: { Id: 'real-inbox' }, DisplayName: 'Inbox', UnreadCount: 7 }] } } }) };
  }, async () => 'canary');
  client.canary = 'canary';
  const folders = await client.folders();
  assert.equal(folders.filter(f => f.id === 'real-inbox').length, 1);
  assert.equal(folders.find(f => f.id === 'real-inbox').wellKnown, 'inbox');
  assert.equal(folders.find(f => f.id === 'custom').parentId, 'real-inbox');
});

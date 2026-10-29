const P = require('./protocol.cjs');
const known = new Set(['inbox', 'sentitems', 'drafts', 'archive', 'deleteditems', 'junkemail', 'msgfolderroot']);
const reference = id => known.has(id) ? `<t:DistinguishedFolderId Id="${id}"/>` : `<t:FolderId Id="${P.escapeXML(id)}"/>`;
async function run(client, data) {
  if (!['read', 'create', 'rename', 'trash'].includes(data.action) || typeof data.folder !== 'string' || !data.folder || data.folder.length > 16000 || /[\x00-\x1f]/.test(data.folder)) throw new Error('Некорректная операция с папкой');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (['create', 'rename'].includes(data.action) && (!name || name.length > 255 || /[\x00-\x1f]/.test(name))) throw new Error('Укажите название папки от 1 до 255 символов');
  const folders = await client.folders();
  const folder = folders.find(folder => folder.id === data.folder || folder.wellKnown === data.folder);
  if (!folder && !(data.action === 'create' && data.folder === 'msgfolderroot')) throw new Error('Папка не найдена. Обновите список папок.');
  if (['rename', 'trash'].includes(data.action) && (known.has(data.folder) || folder.wellKnown)) throw new Error('Системную папку нельзя переименовать или переместить в корзину');
  if (['rename', 'trash'].includes(data.action) && folder.systemIdentityKnown !== true) throw new Error('Не удалось определить системные папки. Обновите список перед изменением папки.');
  try {
    if (data.action === 'read') {
      await client.ews('MarkAllItemsAsRead', P.soap(`<m:MarkAllItemsAsRead><m:ReadFlag>true</m:ReadFlag><m:SuppressReadReceipts>true</m:SuppressReadReceipts><m:FolderIds>${reference(data.folder)}</m:FolderIds></m:MarkAllItemsAsRead>`));
    } else if (data.action === 'create') {
      await client.ews('CreateFolder', P.soap(`<m:CreateFolder><m:ParentFolderId>${reference(data.folder)}</m:ParentFolderId><m:Folders><t:Folder><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>${P.escapeXML(name)}</t:DisplayName></t:Folder></m:Folders></m:CreateFolder>`));
    } else {
      const detail = await client.ews('GetFolder', P.soap(`<m:GetFolder><m:FolderShape><t:BaseShape>AllProperties</t:BaseShape></m:FolderShape><m:FolderIds>${reference(folder.id)}</m:FolderIds></m:GetFolder>`));
      const current = P.walk(detail, value => value.FolderId?.['@_Id'] === folder.id)[0]?.FolderId;
      if (!current?.['@_ChangeKey']) throw new Error('Exchange не вернул версию папки');
      if (data.expectedChangeKey && data.expectedChangeKey !== current['@_ChangeKey']) throw new Error('Папка изменилась на сервере. Обновите список перед изменением.');
      const ref = `<t:FolderId Id="${P.escapeXML(folder.id)}" ChangeKey="${P.escapeXML(current['@_ChangeKey'])}"/>`;
      if (data.action === 'rename') {
        await client.ews('UpdateFolder', P.soap(`<m:UpdateFolder><m:FolderChanges><t:FolderChange>${ref}<t:Updates><t:SetFolderField><t:FieldURI FieldURI="folder:DisplayName"/><t:Folder><t:DisplayName>${P.escapeXML(name)}</t:DisplayName></t:Folder></t:SetFolderField></t:Updates></t:FolderChange></m:FolderChanges></m:UpdateFolder>`));
      } else {
        await client.ews('MoveFolder', P.soap(`<m:MoveFolder><m:ToFolderId><t:DistinguishedFolderId Id="deleteditems"/></m:ToFolderId><m:FolderIds>${ref}</m:FolderIds></m:MoveFolder>`));
      }
    }
    return true;
  } catch (error) { throw new Error(`${error.message}\nОперация не повторялась. Обновите список папок перед новой попыткой.`); }
  finally { client.mailCache.clear(); }
}
module.exports = { run };

const tr = require('../src/i18n.js').text;
// Sequential OWA writes stop at the first unconfirmed result; nothing is replayed.
async function run(client, data) {
  const actions = ['read', 'unread', 'archive', 'trash', 'move'];
  if (!actions.includes(data.action) || !Array.isArray(data.refs) || !data.refs.length || data.refs.length > 100 ||
      data.refs.some(ref => typeof ref?.id !== 'string' || !ref.id || ref.id.length > 16000 || (ref.changeKey !== undefined && (typeof ref.changeKey !== 'string' || ref.changeKey.length > 16000))) ||
      new Set(data.refs.map(ref => ref.id)).size !== data.refs.length) throw new Error(tr('Выберите от 1 до 100 разных писем'));
  if (data.action === 'move' && (typeof data.folder !== 'string' || !data.folder || data.folder.length > 16000 || /[\x00-\x1f]/.test(data.folder))) throw new Error(tr('Выберите папку назначения'));
  const results = [];
  for (const ref of data.refs) {
    if (results.some(result => result.status === 'uncertain')) { results.push({ id: ref.id, status: 'skipped' }); continue; }
    try {
      if (data.action === 'read' || data.action === 'unread') {
        const updated = await client.change({ ref, field: 'IsRead', value: data.action === 'read' });
        results.push({ id: ref.id, status: 'done', changeKey: updated?.changeKey });
      } else {
        await client.move({ ref, folder: data.action === 'archive' ? 'archive' : data.action === 'trash' ? 'deleteditems' : data.folder });
        results.push({ id: ref.id, status: 'done' });
      }
    } catch (error) {
      results.push({ id: ref.id, status: 'uncertain', error: `${error.message}${tr("\nПроверьте это письмо в OWA перед повтором. Оставшиеся письма не обрабатывались.")}` });
    }
  }
  return { results };
}
module.exports = { run };

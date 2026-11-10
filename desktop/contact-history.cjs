const H = require('../src/contact-history.js');
const P = require('./protocol.cjs');
const T = require('../src/time.js');
const tr = require('../src/i18n.js').text;
async function read(client, { email, offset = 0 }, guard) {
  const address = H.email(email), query = H.query(address);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= 200) throw new Error(tr('Некорректная страница истории переписки.'));
  guard();
  // Reuse the serialized whole-mailbox search, without changing the renderer's query.
  const page = await client.search({ kind: 'mail', query, offset }); guard();
  if (!Array.isArray(page.items) || page.items.length > 50) throw new Error(tr('Сервер вернул неподдерживаемую страницу истории переписки.'));
  const candidates = page.items.slice(0, 200 - offset);
  const ids = [...new Set(candidates.map(item => item.id))];
  if (ids.some(id => typeof id !== 'string' || !id || id.length > 16000)) throw new Error(tr('Сервер вернул неподдерживаемую страницу истории переписки.'));
  const nextOffset = page.nextOffset ?? offset + candidates.length;
  if (!Number.isSafeInteger(nextOffset) || nextOffset < offset || page.more && (!candidates.length || nextOffset <= offset)) throw new Error(tr('Поиск переписки не продвинулся. Обновите карточку.'));
  let items = [];
  if (ids.length) {
    // AQS string matching is not exact; verify full From/To/Cc metadata with GetItem.
    // https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/how-to-perform-an-aqs-search-by-using-ews-in-exchange
    const fields = ['item:Subject', 'item:ParentFolderId', 'item:DateTimeReceived', 'item:DateTimeSent', 'item:IsDraft', 'message:From', 'message:ToRecipients', 'message:CcRecipients'];
    const result = await client.ews('GetItem', P.soap(`<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${fields.map(field => `<t:FieldURI FieldURI="${field}"/>`).join('')}</t:AdditionalProperties></m:ItemShape><m:ItemIds>${ids.map(id => `<t:ItemId Id="${P.escapeXML(id)}"/>`).join('')}</m:ItemIds></m:GetItem>`)); guard();
    const found = P.walk(result, value => value.ItemId?.['@_Id']).filter(value => ids.includes(value.ItemId['@_Id']));
    if (ids.some(id => !found.some(value => value.ItemId['@_Id'] === id))) throw new Error(tr('Некоторые письма истории недоступны. Обновите переписку.'));
    const people = value => P.walk(value, person => typeof person.EmailAddress === 'string').map(P.address);
    items = ids.map(id => {
      const value = found.find(value => value.ItemId['@_Id'] === id);
      return H.summary({ id, changeKey: value.ItemId['@_ChangeKey'], parentId: value.ParentFolderId?.['@_Id'], subject: value.Subject,
        date: T.exchange(value.DateTimeReceived || value.DateTimeSent), isDraft: value.IsDraft !== 'false', from: people(value.From)[0], to: people(value.ToRecipients), cc: people(value.CcRecipients) }, address);
    }).filter(Boolean);
  }
  const limited = nextOffset >= 200 && page.more || candidates.length < page.items.length;
  return { items, nextOffset: Math.min(200, nextOffset), more: Boolean(page.more && nextOffset < 200), limited: Boolean(limited), checked: candidates.length };
}
module.exports = { read };

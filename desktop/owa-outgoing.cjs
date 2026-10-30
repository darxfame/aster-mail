// Candidate JSON contracts, exercised only by fixtures until verified on the target Exchange.
const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
const kinds = { new: 'Message', reply: 'ReplyToItem', 'reply-all': 'ReplyAllToItem', forward: 'ForwardItem' };
function reference(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 16000 || typeof value.changeKey !== 'string' || !value.changeKey || value.changeKey.length > 16000) throw new Error('Invalid item version');
  return { id: value.id, changeKey: value.changeKey };
}
function fields(data, send) {
  if (!Array.isArray(data.attachments || []) || data.attachments?.length || /(?:cid:|<img\b)/i.test(data.bodyHtml || '')) throw new Error(tr('OWA-отправка с файлами и картинками подписи пока не подтверждена. Продолжите в OWA.'));
  if (typeof data.subject !== 'string' || data.subject.length > 100000 || typeof data.body !== 'string' || data.body.length > 10000000 || data.bodyHtml !== undefined && (typeof data.bodyHtml !== 'string' || data.bodyHtml.length > 10000000)) throw new Error('Invalid message body');
  const to = P.emails(data.to || ''), cc = P.emails(data.cc || ''), bcc = P.emails(data.bcc || '');
  if (send && !to.length && !cc.length && !bcc.length) throw new Error(tr('Укажите получателя'));
  const recipients = values => values.map(EmailAddress => P.typed('EmailAddressWrapper', { EmailAddress, RoutingType: 'SMTP' }));
  return { Subject: data.subject, Body: P.typed('BodyContentType', { BodyType: data.bodyHtml ? 'HTML' : 'Text', Value: data.bodyHtml || data.body }), ToRecipients: recipients(to), CcRecipients: recipients(cc), BccRecipients: recipients(bcc) };
}
function success(json) {
  const codes = P.walk(json, value => typeof value.ResponseCode === 'string');
  if (codes.length !== 1 || codes[0].ResponseCode !== 'NoError') throw new Error('Unconfirmed OWA write response');
  return json;
}
function savedReference(json, expected) {
  success(json);
  const items = P.walk(json, value => value.ItemId?.Id);
  if (items.length !== 1) throw new Error('OWA did not return one saved item');
  const result = reference({ id: items[0].ItemId.Id, changeKey: items[0].ItemId.ChangeKey });
  if (expected && result.id !== expected) throw new Error('OWA returned another draft');
  return result;
}
async function write(client, action, payload, parse = success) {
  try { return parse(await client.call(action, payload, { retry: false })); }
  catch (error) {
    throw Object.assign(new Error(`${error.message}${tr('\nРезультат операции может быть неизвестен. Проверьте «Черновики» и «Отправленные» в OWA перед повтором. Операция не повторялась.')}`), { connectionError: error.connectionError === true });
  }
}
async function readItem(client, ref) {
  if (typeof ref?.id !== 'string' || !ref.id || ref.id.length > 16000) throw new Error('Invalid item reference');
  const json = await client.call('GetItem', P.request('GetItem', {
    ItemShape: P.typed('ItemResponseShape', { BaseShape: 'AllProperties', BodyType: 'HTML', FilterHtmlContent: true }),
    ItemIds: [P.item({ id: ref.id })],
  }));
  const items = P.walk(json, value => value.ItemId?.Id === ref.id);
  if (items.length !== 1) throw new Error('OWA did not return the requested item');
  return items[0];
}
async function create(client, data, save = false) {
  const kind = data.kind || 'new';
  if (!Object.hasOwn(kinds, kind)) throw new Error('Invalid compose mode');
  const values = fields(data, !save);
  let message = P.typed(kinds[kind], values);
  if (kind !== 'new') {
    const current = await readItem(client, data.reference);
    const ref = reference({ id: current.ItemId.Id, changeKey: current.ItemId.ChangeKey });
    message.ReferenceItemId = P.item(ref);
    if (data.replaceBody !== true) { message.NewBodyContent = message.Body; delete message.Body; }
  } else if (data.reference) throw new Error('Unexpected message reference');
  const payload = P.request('CreateItem', {
    Items: [message], MessageDisposition: save ? 'SaveOnly' : 'SendAndSaveCopy',
    SavedItemFolderId: P.target(save ? 'drafts' : 'sentitems'),
  });
  const result = await write(client, 'CreateItem', payload, save ? savedReference : success);
  return save ? result : true;
}
async function readDraft(client, ref) {
  const raw = await readItem(client, ref);
  if (raw.IsDraft !== true || raw.ItemClass !== 'IPM.Note') throw new Error(tr('Редактировать можно только обычный почтовый черновик. Обновите папку «Черновики».'));
  const version = reference({ id: raw.ItemId.Id, changeKey: raw.ItemId.ChangeKey });
  if (!raw.Body || !['Text', 'HTML'].includes(raw.Body.BodyType) || typeof raw.Body.Value !== 'string' || raw.IsTruncated === true || raw.Body.IsTruncated === true) throw new Error(tr('Exchange не вернул полный текст черновика. Продолжите редактирование в OWA.'));
  if ([raw.ToRecipients, raw.CcRecipients, raw.BccRecipients].flatMap(value => value || []).some(value => !P.address(value).email)) throw new Error(tr('У части получателей черновика нет SMTP-адреса. Продолжите редактирование в OWA.'));
  if (raw.HasAttachments || raw.Attachments?.length) throw new Error(tr('OWA-отправка с файлами и картинками подписи пока не подтверждена. Продолжите в OWA.'));
  return { ...P.message({ ...raw, NormalizedBody: undefined }), subject: raw.Subject || '', ref: version };
}
async function edit(client, data) {
  if (!['read', 'save', 'send'].includes(data.action)) throw new Error('Invalid draft action');
  const values = data.action === 'read' ? null : fields(data, data.action === 'send');
  const current = await readDraft(client, data.ref);
  if (data.action === 'read') return current;
  const expected = reference(data.ref);
  if (expected.changeKey !== current.changeKey) throw new Error(tr('Черновик изменился на сервере. Откройте его заново перед сохранением.'));
  const updates = Object.entries(values).map(([name, value]) => Array.isArray(value) && !value.length
    ? P.typed('DeleteItemField', { Path: P.property(name) })
    : P.typed('SetItemField', { Path: P.property(name), Item: P.typed('Message', { [name]: value }) }));
  const updated = await write(client, 'UpdateItem', P.request('UpdateItem', {
    ItemChanges: [P.typed('ItemChange', { ItemId: P.item(current.ref), Updates: updates })],
    ConflictResolution: 'NeverOverwrite', MessageDisposition: 'SaveOnly',
    SendCalendarInvitationsOrCancellations: 'SendToNone', SuppressReadReceipts: true,
  }), json => savedReference(json, expected.id));
  if (data.action === 'save') return updated;
  await write(client, 'SendItem', P.request('SendItem', { ItemIds: [P.item(updated)], SaveItemToFolder: true, SavedItemFolderId: P.target('sentitems') }));
  return true;
}
module.exports = { create, edit };

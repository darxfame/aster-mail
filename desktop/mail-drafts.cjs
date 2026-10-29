const P = require('./protocol.cjs');
const { imageData } = require('./calendar-events.cjs');
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const flag = value => value === true || value === 'true';
const limit = 20 * 1024 * 1024;
const item = ref => `<t:ItemId Id="${P.escapeXML(ref.id)}"${ref.changeKey ? ` ChangeKey="${P.escapeXML(ref.changeKey)}"` : ''}/>`;

async function read(client, ref) {
  const response = await client.ews('GetItem', P.soap(`<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>HTML</t:BodyType></m:ItemShape><m:ItemIds>${item({ id: ref.id })}</m:ItemIds></m:GetItem>`));
  const raw = P.walk(response, value => value.ItemId?.['@_Id'] === ref.id)[0];
  if (!raw || !flag(raw.IsDraft) || raw.ItemClass !== 'IPM.Note') throw new Error('Редактировать можно только обычный почтовый черновик. Обновите папку «Черновики».');
  const changeKey = raw.ItemId['@_ChangeKey'];
  if (!changeKey) throw new Error('Exchange не вернул версию черновика');
  const recipients = value => list(value?.Mailbox);
  if ([raw.ToRecipients, raw.CcRecipients, raw.BccRecipients].flatMap(recipients).some(value => !P.address(value).email)) throw new Error('У части получателей черновика нет SMTP-адреса. Продолжите редактирование в OWA.');
  const body = raw.Body;
  if (!body || !['HTML', 'Text'].includes(body['@_BodyType'])) throw new Error('Exchange не вернул полный текст черновика. Продолжите редактирование в OWA.');
  const attachments = [...list(raw.Attachments?.FileAttachment), ...list(raw.Attachments?.ItemAttachment)].map(value => ({
    AttachmentId: { Id: value.AttachmentId?.['@_Id'] }, Name: value.Name, Size: Number(value.Size), ContentType: value.ContentType,
    ContentId: value.ContentId, IsInline: flag(value.IsInline),
  }));
  if ((flag(raw.HasAttachments) && !attachments.length) || attachments.some(value => !value.AttachmentId.Id || !Number.isSafeInteger(value.Size) || value.Size < 0)) throw new Error('Exchange не вернул размер или ID вложений черновика');
  return { ...P.message({
    ...raw, ItemId: { Id: ref.id, ChangeKey: changeKey }, ParentFolderId: { Id: raw.ParentFolderId?.['@_Id'] || '' },
    Body: { BodyType: body['@_BodyType'], Value: body['#text'] ?? (typeof body === 'string' ? body : '') },
    ToRecipients: recipients(raw.ToRecipients), CcRecipients: recipients(raw.CcRecipients), BccRecipients: recipients(raw.BccRecipients),
    Attachments: attachments, IsRead: flag(raw.IsRead), HasAttachments: flag(raw.HasAttachments) || attachments.length > 0,
  }), subject: raw.Subject || '', isDraft: true, bcc: recipients(raw.BccRecipients).map(P.address), ref: { id: ref.id, changeKey } };
}

function validateAttachments(attachments, current) {
  if (!Array.isArray(attachments) || attachments.length > 100) throw new Error('Слишком много вложений');
  let size = current.attachments.reduce((total, attachment) => total + attachment.size, 0);
  for (const attachment of attachments) {
    if (typeof attachment.name !== 'string' || !attachment.name || attachment.name.length > 500 || typeof attachment.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) throw new Error('Некорректное вложение');
    if (attachment.inline !== undefined && typeof attachment.inline !== 'boolean') throw new Error('Некорректное inline-вложение');
    if (attachment.inline) {
      if (typeof attachment.contentId !== 'string' || !/^[a-zA-Z0-9@._-]{1,160}$/.test(attachment.contentId)) throw new Error('Некорректный Content-ID подписи');
      imageData({ ContentType: attachment.type, Content: attachment.content });
    }
    size += Buffer.from(attachment.content, 'base64').length;
  }
  if (size > limit) throw new Error('Суммарный размер вложений превышает 20 МБ');
}

async function run(client, data) {
  if (!['read', 'save', 'send'].includes(data.action) || typeof data.ref?.id !== 'string' || !data.ref.id || data.ref.id.length > 16000) throw new Error('Некорректная ссылка на черновик');
  const current = await read(client, data.ref);
  if (data.action === 'read') return current;
  if (!data.ref.changeKey || current.changeKey !== data.ref.changeKey) throw new Error('Черновик изменился на сервере. Откройте его заново перед сохранением.');
  const to = P.emails(data.to || ''), cc = P.emails(data.cc || ''), bcc = P.emails(data.bcc || '');
  if (data.action === 'send' && !to.length && !cc.length && !bcc.length) throw new Error('Укажите получателя');
  if (typeof data.subject !== 'string' || data.subject.length > 100000 || typeof data.body !== 'string' || data.body.length > 10000000 || (data.bodyHtml !== undefined && (typeof data.bodyHtml !== 'string' || data.bodyHtml.length > 10000000))) throw new Error('Некорректный текст черновика');
  const attachments = data.attachments || [];
  validateAttachments(attachments, current);
  const fields = [];
  const set = (field, value) => fields.push(`<t:SetItemField><t:FieldURI FieldURI="${field}"/><t:Message>${value}</t:Message></t:SetItemField>`);
  set('item:Subject', `<t:Subject>${P.escapeXML(data.subject)}</t:Subject>`);
  set('item:Body', `<t:Body BodyType="${data.bodyHtml ? 'HTML' : 'Text'}">${P.escapeXML(data.bodyHtml || data.body)}</t:Body>`);
  for (const [name, values] of [['ToRecipients', to], ['CcRecipients', cc], ['BccRecipients', bcc]]) {
    if (values.length) set(`message:${name}`, `<t:${name}>${values.map(email => `<t:Mailbox><t:EmailAddress>${P.escapeXML(email)}</t:EmailAddress></t:Mailbox>`).join('')}</t:${name}>`);
    else fields.push(`<t:DeleteItemField><t:FieldURI FieldURI="message:${name}"/></t:DeleteItemField>`);
  }
  try {
    const updated = await client.ews('UpdateItem', P.soap(`<m:UpdateItem ConflictResolution="NeverOverwrite" MessageDisposition="SaveOnly"><m:ItemChanges><t:ItemChange>${item(current.ref)}<t:Updates>${fields.join('')}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`));
    const latest = P.walk(updated, value => value.ItemId?.['@_Id'] === current.id)[0]?.ItemId;
    if (!latest?.['@_ChangeKey']) throw new Error('Exchange не вернул актуальную версию сохранённого черновика');
    let ref = { id: current.id, changeKey: latest['@_ChangeKey'] };
    if (attachments.length) {
      const attached = await client.ews('CreateAttachment', P.soap(`<m:CreateAttachment><m:ParentItemId Id="${P.escapeXML(ref.id)}" ChangeKey="${P.escapeXML(ref.changeKey)}"/><m:Attachments>${attachments.map(attachment => `<t:FileAttachment><t:Name>${P.escapeXML(attachment.name)}</t:Name><t:ContentType>${P.escapeXML(attachment.type || 'application/octet-stream')}</t:ContentType>${attachment.inline ? `<t:ContentId>${P.escapeXML(attachment.contentId)}</t:ContentId>` : ''}<t:IsInline>${attachment.inline === true}</t:IsInline><t:Content>${attachment.content}</t:Content></t:FileAttachment>`).join('')}</m:Attachments></m:CreateAttachment>`));
      const root = P.walk(attached, value => value['@_RootItemChangeKey']).at(-1);
      if (root?.['@_RootItemId'] !== ref.id || !root['@_RootItemChangeKey']) throw new Error('Exchange не вернул версию черновика после вложений');
      ref = { id: ref.id, changeKey: root['@_RootItemChangeKey'] };
    }
    if (data.action === 'send') {
      await client.ews('SendItem', P.soap(`<m:SendItem SaveItemToFolder="true"><m:ItemIds>${item(ref)}</m:ItemIds><m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></m:SavedItemFolderId></m:SendItem>`));
      return true;
    }
    return ref;
  } catch (error) { throw new Error(`${error.message}\nРезультат операции может быть неизвестен. Проверьте «Черновики» и «Отправленные» в OWA перед повтором. Операция не повторялась.`); }
}

module.exports = { run };

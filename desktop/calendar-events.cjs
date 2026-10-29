const P = require('./protocol.cjs');
const T = require('../src/time.js');
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const flag = value => value === true || value === 'true';
const id = value => value?.Id || value?.['@_Id'];
function normalize(o) {
  const body = o.Body || o.NormalizedBody || {}, bodyValue = body.Value ?? body['#text'] ?? '';
  const person = (a, role) => ({ ...P.address(a.Mailbox || a), role, response: a.ResponseType || '' });
  const attendees = (value, role) => list(value?.Attendee || value).map(a => person(a, role));
  const rawAttachments = Array.isArray(o.Attachments) ? o.Attachments : [...list(o.Attachments?.FileAttachment), ...list(o.Attachments?.ItemAttachment)];
  const response = o.MyResponseType || o.ResponseType || '';
  return {
    id: id(o.ItemId), changeKey: o.ItemId?.ChangeKey || o.ItemId?.['@_ChangeKey'] || '', title: o.Subject || '(Без названия)', start: T.exchange(o.Start), end: T.exchange(o.End),
    organizer: P.address(o.Organizer?.Mailbox || o.Organizer), response,
    ...(o.IsOrganizer !== undefined ? { isOrganizer: flag(o.IsOrganizer) } : response ? { isOrganizer: response === 'Organizer' } : {}),
    cancelled: flag(o.IsCancelled), allDay: flag(o.IsAllDayEvent), recurring: flag(o.IsRecurring) || Boolean(o.SeriesId) || ['Occurrence', 'Exception', 'RecurringMaster'].includes(o.CalendarItemType), calendarType: o.CalendarItemType || 'Single',
    recurrence: o.Recurrence || null, location: typeof o.Location === 'string' ? o.Location : o.Location?.DisplayName || '',
    html: (body.BodyType || body['@_BodyType']) === 'HTML' ? bodyValue : '', body: (body.BodyType || body['@_BodyType']) === 'HTML' ? '' : bodyValue || o.Preview || '',
    attendees: [...attendees(o.RequiredAttendees, 'required'), ...attendees(o.OptionalAttendees, 'optional'), ...attendees(o.Resources, 'resource')],
    attachments: rawAttachments.filter(a => id(a.AttachmentId)).map(a => ({ id: id(a.AttachmentId), name: a.Name || 'Вложение', size: Number(a.Size) || 0, type: a.ContentType || '', contentId: a.ContentId || '', inline: flag(a.IsInline) })),
    hasReminderSettings: o.ReminderIsSet !== undefined || o.IsReminderSet !== undefined || o.ReminderMinutesBeforeStart !== undefined,
    showAs: o.LegacyFreeBusyStatus || 'Busy', sensitivity: o.Sensitivity || 'Normal', reminder: Number(o.ReminderMinutesBeforeStart ?? 15), reminderSet: flag(o.ReminderIsSet ?? o.IsReminderSet ?? true),
    canModify: o.EffectiveRights?.Modify === undefined ? null : flag(o.EffectiveRights.Modify),
    forwardingAllowed: o.IsForwardingAllowed === undefined ? o.ResponseObjects !== undefined ? Object.hasOwn(Object(o.ResponseObjects), 'ForwardItem') : null : flag(o.IsForwardingAllowed),
    canReply: o.ResponseObjects !== undefined ? Object.hasOwn(Object(o.ResponseObjects), 'ReplyToItem') : null,
    canReplyAll: o.ResponseObjects !== undefined ? Object.hasOwn(Object(o.ResponseObjects), 'ReplyAllToItem') : null,
    joinUrl: o.OnlineMeetingJoinUrl || o.JoinOnlineMeetingUrl || o.OnlineMeeting?.JoinUrl || '',
  };
}
function itemXML(ref, scope = 'single') {
  if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > 16000 || !['single', 'series'].includes(scope)) throw new Error('Некорректная ссылка на встречу');
  return scope === 'series' ? `<t:RecurringMasterItemId OccurrenceId="${P.escapeXML(ref.id)}"/>` : `<t:ItemId Id="${P.escapeXML(ref.id)}"/>`;
}
function getSOAP(ref, scope) {
  return P.soap(`<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>HTML</t:BodyType></m:ItemShape><m:ItemIds>${itemXML(ref, scope)}</m:ItemIds></m:GetItem>`);
}
function updateSOAP(current, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Нет изменений');
  const fields = [], allowed = ['title', 'body', 'start', 'end', 'location', 'attendees', 'optionalAttendees', 'allDay', 'reminder', 'reminderSet', 'showAs', 'sensitivity'];
  if (Object.keys(changes).some(key => !allowed.includes(key))) throw new Error('Неподдерживаемое поле встречи');
  if (current.cancelled || current.canModify === false) throw new Error('Встреча отменена или недоступна для редактирования');
  if (current.isOrganizer !== true && Object.keys(changes).some(key => !['reminder', 'reminderSet'].includes(key))) throw new Error('Только организатор может изменять свойства встречи. Участнику доступно только напоминание.');
  const set = (field, value, element = field.split(':')[1]) => fields.push(`<t:SetItemField><t:FieldURI FieldURI="${field}"/><t:CalendarItem><t:${element}>${value}</t:${element}></t:CalendarItem></t:SetItemField>`);
  for (const key of ['title', 'body', 'location']) if (Object.hasOwn(changes, key)) {
    if (typeof changes[key] !== 'string' || changes[key].length > (key === 'body' ? 1000000 : 2000) || (key === 'title' && !changes[key].trim())) throw new Error('Проверьте название и описание встречи');
    if (key === 'body') fields.push(`<t:SetItemField><t:FieldURI FieldURI="item:Body"/><t:CalendarItem><t:Body BodyType="Text">${P.escapeXML(changes.body)}</t:Body></t:CalendarItem></t:SetItemField>`);
    else set(key === 'title' ? 'item:Subject' : 'calendar:Location', P.escapeXML(changes[key]));
  }
  if (Object.hasOwn(changes, 'start') || Object.hasOwn(changes, 'end')) {
    const start = new Date(changes.start ?? current.start), end = new Date(changes.end ?? current.end);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) throw new Error('Окончание должно быть позже начала');
    set('calendar:Start', start.toISOString()); set('calendar:End', end.toISOString());
  }
  for (const [key, field] of [['attendees', 'RequiredAttendees'], ['optionalAttendees', 'OptionalAttendees']]) if (Object.hasOwn(changes, key)) {
    const role = key === 'attendees' ? 'required' : 'optional';
    if (current.attendees?.some(a => a.role === role && !a.email)) throw new Error('У части участников нет SMTP-адреса. Измените список участников в OWA.');
    const emails = P.emails(changes[key]);
    if (emails.length) set(`calendar:${field}`, emails.map(email => `<t:Attendee><t:Mailbox><t:EmailAddress>${P.escapeXML(email)}</t:EmailAddress></t:Mailbox></t:Attendee>`).join(''));
    else fields.push(`<t:DeleteItemField><t:FieldURI FieldURI="calendar:${field}"/></t:DeleteItemField>`);
  }
  for (const [key, field] of [['allDay', 'calendar:IsAllDayEvent'], ['reminderSet', 'item:ReminderIsSet']]) if (Object.hasOwn(changes, key)) { if (typeof changes[key] !== 'boolean') throw new Error('Некорректный флаг встречи'); set(field, String(changes[key])); }
  if (Object.hasOwn(changes, 'reminder')) { if (!Number.isInteger(changes.reminder) || changes.reminder < 0 || changes.reminder > 40320) throw new Error('Некорректное напоминание'); set('item:ReminderMinutesBeforeStart', changes.reminder); }
  for (const [key, field, values] of [['showAs', 'calendar:LegacyFreeBusyStatus', ['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere']], ['sensitivity', 'item:Sensitivity', ['Normal', 'Personal', 'Private', 'Confidential']]]) if (Object.hasOwn(changes, key)) { if (!values.includes(changes[key])) throw new Error('Некорректное свойство встречи'); set(field, changes[key]); }
  if (!fields.length) throw new Error('Нет изменений для сохранения');
  const notify = current.isOrganizer === true && Object.keys(changes).some(key => !['reminder', 'reminderSet', 'showAs', 'sensitivity'].includes(key));
  return P.soap(`<m:UpdateItem ConflictResolution="NeverOverwrite" SendMeetingInvitationsOrCancellations="${notify ? 'SendToAllAndSaveCopy' : 'SendToNone'}"><m:ItemChanges><t:ItemChange><t:ItemId Id="${P.escapeXML(current.id)}" ChangeKey="${P.escapeXML(current.changeKey)}"/><t:Updates>${fields.join('')}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`);
}
function messageSOAP(current, data) {
  const type = { reply: 'ReplyToItem', 'reply-all': 'ReplyAllToItem', forward: 'ForwardItem' }[data.kind];
  if (!type || current.cancelled) throw new Error('Некорректное действие или встреча отменена');
  if ((data.kind === 'reply' && current.canReply === false) || (data.kind === 'reply-all' && current.canReplyAll === false)) throw new Error('Ответ на эту встречу недоступен');
  if (data.kind === 'forward' && current.forwardingAllowed === false) throw new Error('Пересылка этой встречи запрещена организатором');
  if (typeof data.body !== 'string' || data.body.length > 1000000) throw new Error('Некорректное сообщение');
  const emails = data.kind === 'forward' ? P.emails(data.to) : [];
  if (data.kind === 'forward' && !emails.length) throw new Error('Укажите получателей');
  return P.soap(`<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:${type}>${emails.length ? `<t:ToRecipients>${emails.map(email => `<t:Mailbox><t:EmailAddress>${P.escapeXML(email)}</t:EmailAddress></t:Mailbox>`).join('')}</t:ToRecipients>` : ''}<t:ReferenceItemId Id="${P.escapeXML(current.id)}" ChangeKey="${P.escapeXML(current.changeKey)}"/><t:NewBodyContent BodyType="Text">${P.escapeXML(data.body)}</t:NewBodyContent></t:${type}></m:Items></m:CreateItem>`);
}
function imageData(attachment) { return require('./raster-images.cjs').inspect(attachment).dataURL; }

module.exports = { normalize, itemXML, getSOAP, updateSOAP, messageSOAP, imageData };

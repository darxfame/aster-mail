// OWA payload shapes adapted from mac-owa-widget (MIT); see THIRD_PARTY_NOTICES.md.
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const T = require('../src/time.js');
const typed = (name, fields = {}) => ({ __type: `${name}:#Exchange`, ...fields });
const folder = id => typed(['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive', 'contacts', 'calendar', 'msgfolderroot'].includes(id) ? 'DistinguishedFolderId' : 'FolderId', { Id: id });
const item = ref => typed('ItemId', { Id: ref.id, ...(ref.changeKey ? { ChangeKey: ref.changeKey } : {}) });
const property = FieldURI => typed('PropertyUri', { FieldURI });
const target = id => typed('TargetFolderId', { BaseFolderId: folder(id) });
function request(action, fields, version = 'Exchange2013') {
  return typed(`${action}JsonRequest`, {
    Header: typed('JsonRequestHeaders', {
      RequestServerVersion: version,
      TimeZoneContext: typed('TimeZoneContext', { TimeZoneDefinition: typed('TimeZoneDefinitionType', { Id: 'UTC' }) }),
    }),
    Body: typed(`${action}Request`, fields),
  });
}
const paging = offset => typed('IndexedPageView', { BasePoint: 'Beginning', Offset: offset, MaxEntriesReturned: 50 });
function findItems(id, offset = 0, filter = 'all') {
  if (!['all', 'unread', 'flagged'].includes(filter)) throw new Error('Invalid mail filter');
  return request('FindItem', {
    ItemShape: typed('ItemResponseShape', { BaseShape: 'IdOnly' }),
    ParentFolderIds: [folder(id)], Traversal: 'Shallow', Paging: paging(offset),
    ViewFilter: { all: 'All', unread: 'Unread', flagged: 'Flagged' }[filter], IsWarmUpSearch: false, FocusedViewFilter: -1, Grouping: null,
    ShapeName: id === 'contacts' ? 'Contact' : 'MailListItem',
    ...(id === 'contacts' ? {} : { SortOrder: [typed('SortResults', { Order: 'Descending', Path: property('DateTimeReceived') })] }),
  }, 'Exchange2016');
}
function getItems(refs) {
  return request('GetItem', {
    ItemShape: typed('ItemResponseShape', {
      BaseShape: 'AllProperties', BodyType: 'HTML', FilterHtmlContent: true,
      BlockExternalImagesIfSenderUntrusted: false, MaximumBodySize: 2097152,
    }),
    ItemIds: refs.map(item), ShapeName: 'ItemNormalizedBody',
  }, 'V2017_08_18');
}
function update(ref, field, value) {
  if (!['IsRead', 'Flag', 'Importance'].includes(field)) throw new Error('Unsupported message update');
  if (field === 'Importance' ? !['High', 'Normal'].includes(value) : typeof value !== 'boolean') throw new Error('Invalid message value');
  return request('UpdateItem', {
    ItemChanges: [typed('ItemChange', { ItemId: item(ref), Updates: [typed('SetItemField', {
      Path: property(field), Item: typed(field === 'IsRead' ? 'Message' : 'Item', { [field]: field === 'Flag' ? typed('FlagType', { FlagStatus: value ? 'Flagged' : 'NotFlagged' }) : value }),
    })] })],
    ConflictResolution: 'AutoResolve', MessageDisposition: 'SaveOnly', SuppressReadReceipts: true,
    SendCalendarInvitationsOrCancellations: 'SendToNone',
  }, 'Exchange2015');
}
function walk(value, predicate, results = []) {
  if (!value || typeof value !== 'object') return results;
  if (!Array.isArray(value) && predicate(value)) results.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, predicate, results);
  return results;
}
function checkJSON(json) {
  const failure = walk(json, o => typeof o.ResponseCode === 'string' && o.ResponseCode !== 'NoError')[0];
  if (failure) throw new Error(`Exchange: ${failure.ResponseCode}`);
  if (json?.Body?.ErrorCode || json?.error) throw new Error('OWA returned an application error');
  if (!json || typeof json !== 'object' || (!json.Body && !json.findFolders)) throw new Error('Unexpected OWA response');
  return json;
}
function address(value) {
  const o = value?.Mailbox || value || {};
  return { name: o.Name || '', email: o.RoutingType === 'EX' ? '' : o.EmailAddress || '' };
}
function message(o) {
  const body = o.UniqueBody || o.NormalizedBody || o.Body || {};
  return {
    id: o.ItemId.Id, parentId: o.ParentFolderId?.Id || '', changeKey: o.ItemId.ChangeKey, subject: o.Subject || '(Без темы)',
    from: address(o.From || o.Sender), to: (o.ToRecipients || []).map(address), cc: (o.CcRecipients || []).map(address),
    date: T.exchange(o.DateTimeReceived || o.DateTimeSent), preview: o.Preview || '', read: Boolean(o.IsRead),
    importance: o.Importance || 'Normal', flagged: o.Flag?.FlagStatus === 'Flagged', hasAttachments: Boolean(o.HasAttachments),
    html: body.BodyType === 'Text' ? null : body.Value || '', text: body.BodyType === 'Text' ? body.Value : '',
    attachments: (o.Attachments || []).filter(a => a.AttachmentId).map(a => ({ id: a.AttachmentId.Id, name: a.Name, size: a.Size, type: a.ContentType || '', contentId: a.ContentId || '', inline: Boolean(a.IsInline) })),
    meeting: o.AssociatedCalendarItemId?.Id ? { id: o.AssociatedCalendarItemId.Id, changeKey: o.AssociatedCalendarItemId.ChangeKey, start: T.exchange(o.Start), end: T.exchange(o.End), location: typeof o.Location === 'string' ? o.Location : o.Location?.DisplayName, cancelled: o.IsCancelled === true || o.ItemClass === 'IPM.Schedule.Meeting.Canceled' } : null,
  };
}
const escapeXML = value => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
function soap(body) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><soap:Header><t:RequestServerVersion Version="Exchange2013_SP1"/><t:TimeZoneContext><t:TimeZoneDefinition Id="UTC"/></t:TimeZoneContext></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}
function parseSOAP(text) {
  if (/<!DOCTYPE/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Invalid EWS XML response');
  const data = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, processEntities: true, parseTagValue: false }).parse(text);
  const codes = walk(data, o => o.ResponseCode !== undefined).map(o => o.ResponseCode);
  if (!codes.length) throw new Error('Unexpected EWS response; check that /EWS/Exchange.asmx is enabled');
  const error = codes.find(code => code !== 'NoError');
  if (error) { const failure = new Error(`Exchange: ${error}`); failure.code = error; throw failure; }
  return data;
}
function signatureFromConfiguration(data) {
  const options = {};
  for (const entry of walk(data, o => o.DictionaryKey && o.DictionaryValue)) {
    const key = String(entry.DictionaryKey.Value || '').toLowerCase();
    options[key] = entry.DictionaryValue.Value ?? '';
  }
  if (!Object.hasOwn(options, 'signaturehtml') && !Object.hasOwn(options, 'signaturetext')) throw new Error('В настройках OWA не найдена подпись. Проверьте подпись в веб-интерфейсе Exchange.');
  const flag = key => Object.hasOwn(options, key) ? String(options[key]).toLowerCase() === 'true' : true;
  // Exchange may leave XML numeric CR/LF entities inside dictionary string values.
  const lines = value => String(value || '').replace(/&#(?:x0*d|0*13);/gi, '\r').replace(/&#(?:x0*a|0*10);/gi, '\n').replace(/\r\n?/g, '\n');
  return { html: lines(options.signaturehtml), text: lines(options.signaturetext), autoAddSignature: flag('autoaddsignature'), autoAddSignatureOnReply: flag('autoaddsignatureonreply') };
}
function emails(value) {
  if (typeof value !== 'string' || value.length > 10000) throw new Error('Invalid recipients');
  const result = value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  if (result.some(email => !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))) throw new Error('Укажите адреса через запятую: name@company.ru');
  return result;
}
function sendSOAP(data, save = false) {
  const to = emails(data.to), cc = emails(data.cc || '');
  if (!save && !to.length) throw new Error('Укажите получателя');
  const recipients = values => values.map(email => `<t:Mailbox><t:EmailAddress>${escapeXML(email)}</t:EmailAddress></t:Mailbox>`).join('');
  const subject = `<t:Subject>${escapeXML(data.subject)}</t:Subject>`;
  const bodyType = data.bodyHtml ? 'HTML' : 'Text';
  const body = escapeXML(data.bodyHtml || data.body);
  const recipientXML = `${to.length ? `<t:ToRecipients>${recipients(to)}</t:ToRecipients>` : ''}${cc.length ? `<t:CcRecipients>${recipients(cc)}</t:CcRecipients>` : ''}`;
  let messageXML;
  if (data.reference && ['reply', 'reply-all', 'forward'].includes(data.kind)) {
    const kind = { reply: 'ReplyToItem', 'reply-all': 'ReplyAllToItem', forward: 'ForwardItem' }[data.kind];
    messageXML = `<t:${kind}>${subject}${recipientXML}<t:ReferenceItemId Id="${escapeXML(data.reference.id)}"/><t:NewBodyContent BodyType="${bodyType}">${body}</t:NewBodyContent></t:${kind}>`;
  } else messageXML = `<t:Message>${subject}<t:Body BodyType="${bodyType}">${body}</t:Body>${recipientXML}</t:Message>`;
  return soap(`<m:CreateItem MessageDisposition="${save ? 'SaveOnly' : 'SendAndSaveCopy'}"><m:SavedItemFolderId><t:DistinguishedFolderId Id="${save ? 'drafts' : 'sentitems'}"/></m:SavedItemFolderId><m:Items>${messageXML}</m:Items></m:CreateItem>`);
}
function eventSOAP(data) {
  const start = new Date(data.start), end = new Date(data.end), attendees = emails(data.attendees || '');
  if (!data.title?.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Укажите название и корректное время встречи');
  return soap(`<m:CreateItem SendMeetingInvitations="${attendees.length ? 'SendToAllAndSaveCopy' : 'SendToNone'}"><m:SavedItemFolderId><t:DistinguishedFolderId Id="calendar"/></m:SavedItemFolderId><m:Items><t:CalendarItem><t:Subject>${escapeXML(data.title)}</t:Subject><t:Body BodyType="Text">${escapeXML(data.body)}</t:Body><t:ReminderIsSet>true</t:ReminderIsSet><t:ReminderMinutesBeforeStart>15</t:ReminderMinutesBeforeStart><t:Start>${start.toISOString()}</t:Start><t:End>${end.toISOString()}</t:End><t:Location>${escapeXML(data.location)}</t:Location>${attendees.length ? `<t:RequiredAttendees>${attendees.map(email => `<t:Attendee><t:Mailbox><t:EmailAddress>${escapeXML(email)}</t:EmailAddress></t:Mailbox></t:Attendee>`).join('')}</t:RequiredAttendees>` : ''}</t:CalendarItem></m:Items></m:CreateItem>`);
}
const normalizeServer = require('../src/server.js').normalize;

module.exports = { typed, folder, item, target, property, request, paging, findItems, getItems, update, walk, checkJSON, address, message, escapeXML, soap, parseSOAP, signatureFromConfiguration, emails, sendSOAP, eventSOAP, normalizeServer };

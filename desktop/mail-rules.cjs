const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
const { createHash } = require('node:crypto');
const textFields = ['name', 'sender', 'subject', 'body', 'exceptSubject', 'exceptBody', 'folder', 'copyFolder', 'importance'];
const booleanFields = ['markRead', 'stopProcessing', 'enabled', 'sentOnlyToMe', 'hasAttachments', 'exceptHasAttachments', 'exceptSentOnlyToMe'];
const allowedChanges = [...textFields, ...booleanFields, 'priority'];
const mailboxAddress = /^[^\s<>@,;]+@[^\s<>@,;]+$/;
const invalidRule = () => new Error(tr('Укажите название, хотя бы одно условие и действие правила.'));
const phrases = value => String(value || '').split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
const importanceValues = ['', 'Low', 'Normal', 'High'];
const addressFields = ['Name', 'EmailAddress', 'RoutingType', 'MailboxType'];
const isInternal = address => address?.RoutingType === 'EX';
const validAddress = address => only(address, addressFields) && Object.values(address).every(value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)) &&
  typeof address.EmailAddress === 'string' && (isInternal(address)
    ? /^\/o=.+\/cn=.+$/i.test(address.EmailAddress)
    : (!address.RoutingType || address.RoutingType === 'SMTP') && mailboxAddress.test(address.EmailAddress));
const serializeAddress = address => `<t:Address>${addressFields.filter(key => address[key]).map(key => `<t:${key}>${P.escapeXML(address[key])}</t:${key}>`).join('')}</t:Address>`;
const smtpAddresses = value => P.emails(value || '').map(EmailAddress => ({ EmailAddress }));
function createSOAP(data, priority, id = '', addresses = smtpAddresses(data.sender)) {
  const name = String(data.name || '').trim();
  const [subject, body, exceptSubject, exceptBody] = ['subject', 'body', 'exceptSubject', 'exceptBody'].map(key => phrases(data[key]));
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name) || addresses.length > 20 || !addresses.every(validAddress) ||
    !addresses.length && !subject.length && !body.length && !data.sentOnlyToMe && !data.hasAttachments ||
    [subject, body, exceptSubject, exceptBody].some(values => values.length > 20 || values.some(value => value.length > 200 || /[\x00-\x1f]/.test(value))) ||
    !importanceValues.includes(data.importance ?? '') ||
    booleanFields.some(key => data[key] !== undefined && typeof data[key] !== 'boolean') ||
    ['folder', 'copyFolder'].some(key => data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 16000 || /[\x00-\x1f]/.test(data[key]))) ||
    !data.folder && !data.copyFolder && !data.markRead && !data.stopProcessing && !data.importance ||
    !Number.isSafeInteger(priority) || priority < 0 || priority > 2147483647) throw invalidRule();
  const folder = value => ['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive'].includes(value)
    ? `<t:DistinguishedFolderId Id="${value}"/>` : `<t:FolderId Id="${P.escapeXML(value)}"/>`;
  const strings = (tag, values) => values.length ? `<t:${tag}>${values.map(value => `<t:String>${P.escapeXML(value)}</t:String>`).join('')}</t:${tag}>` : '';
  const flag = (tag, enabled) => enabled ? `<t:${tag}>true</t:${tag}>` : '';
  const conditions = strings('ContainsBodyStrings', body) + strings('ContainsSubjectStrings', subject) +
    (addresses.length ? `<t:FromAddresses>${addresses.map(serializeAddress).join('')}</t:FromAddresses>` : '') +
    flag('HasAttachments', data.hasAttachments) + flag('SentOnlyToMe', data.sentOnlyToMe);
  const exceptions = strings('ContainsBodyStrings', exceptBody) + strings('ContainsSubjectStrings', exceptSubject) +
    flag('HasAttachments', data.exceptHasAttachments) + flag('SentOnlyToMe', data.exceptSentOnlyToMe);
  const actions = `${data.copyFolder ? `<t:CopyToFolder>${folder(data.copyFolder)}</t:CopyToFolder>` : ''}${flag('MarkAsRead', data.markRead)}${data.importance ? `<t:MarkImportance>${data.importance}</t:MarkImportance>` : ''}${data.folder ? `<t:MoveToFolder>${folder(data.folder)}</t:MoveToFolder>` : ''}${flag('StopProcessingRules', data.stopProcessing)}`;
  const operation = id ? 'SetRuleOperation' : 'CreateRuleOperation';
  return updateSOAP(`<t:${operation}><t:Rule>${id ? `<t:RuleId>${P.escapeXML(id)}</t:RuleId>` : ''}<t:DisplayName>${P.escapeXML(name)}</t:DisplayName><t:Priority>${priority}</t:Priority><t:IsEnabled>${data.enabled !== false}</t:IsEnabled><t:Conditions>${conditions}</t:Conditions>${exceptions ? `<t:Exceptions>${exceptions}</t:Exceptions>` : ''}<t:Actions>${actions}</t:Actions></t:Rule></t:${operation}>`);
}
function updateSOAP(operation) {
  return P.soap(`<m:UpdateInboxRules><m:RemoveOutlookRuleBlob>false</m:RemoveOutlookRuleBlob><m:Operations>${operation}</m:Operations></m:UpdateInboxRules>`);
}
async function createRule(client, data) {
  const input = Object.fromEntries(allowedChanges.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  createSOAP(input, 0); // Validate before any request.
  const { rules, outlookRuleBlobExists } = await readRules(client);
  if (outlookRuleBlobExists) throw new Error(tr('Exchange хранит совместимые правила Outlook. Чтобы не удалить их, создайте новое правило в OWA.'));
  const priorities = rules.map(rule => Number(rule.Priority));
  if (priorities.some(p => !Number.isSafeInteger(p) || p < 0)) throw new Error(tr('Exchange вернул некорректные приоритеты правил'));
  await client.ews('UpdateInboxRules', createSOAP(input, Math.max(-1, ...priorities) + 1));
  return true;
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const bool = value => ['true', '1'].includes(String(value).toLowerCase());
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const empty = value => value == null || value === '' || only(value, []);
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ruleAddresses = rule => array(rule.Conditions?.FromAddresses?.Address);
const internalDisplayName = address => address.Name || tr('Внутренний отправитель Exchange');
const protectedMessages = {
  outlook: 'В ящике есть клиентские правила Outlook. Редактируйте правила через OWA или Outlook, чтобы сохранить их.',
  server: 'Exchange сообщает, что правило повреждено или недоступно через EWS. Проверьте его в OWA или Outlook.',
  unsupported: 'В этом правиле есть условия или действия, которые Aster пока не редактирует. Откройте правило в OWA или Outlook.',
};
function describe(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([key]) => !key.startsWith('@_')).map(([key, field]) => {
    if (key === 'FromAddresses') {
      return { key, values: array(field?.Address).map(address => isInternal(address) ? internalDisplayName(address) : address?.Name || address?.EmailAddress || '').filter(Boolean) };
    }
    const values = [];
    const collect = item => {
      if (item && typeof item === 'object') {
        for (const [name, child] of Object.entries(item)) if (!name.startsWith('@_') || name === '@_Id') collect(child);
      } else if (item != null && item !== '') values.push(String(item));
    };
    collect(field);
    return { key, values };
  });
}
function normalize(rule, blocked) {
  const { Conditions: conditions, Exceptions: exceptions, Actions: actions } = rule;
  const addresses = ruleAddresses(rule);
  const validPhrases = (object, key) => {
    const value = object?.[key];
    if (value === undefined) return true;
    const values = array(value?.String);
    return only(value, ['String']) && values.length > 0 && values.every(text =>
      typeof text === 'string' && text && text.trim() === text && !/[\x00-\x1f]/.test(text));
  };
  // Keep unknown predicate values read-only so an edit cannot change their semantics.
  const validAttachmentFlag = object => object?.HasAttachments === undefined || bool(object.HasAttachments);
  const phraseText = value => array(value?.String).join('\n');
  const folderId = value => value?.FolderId || value?.DistinguishedFolderId;
  const validFolder = value => value === undefined || only(value, ['FolderId', 'DistinguishedFolderId']) && Object.keys(value).length === 1 && only(folderId(value), ['@_Id', '@_ChangeKey']) && Boolean(folderId(value)['@_Id']);
  const data = {
    name: rule.DisplayName, sender: addresses.filter(address => !isInternal(address)).map(address => address?.EmailAddress || '').join(', '),
    subject: phraseText(conditions?.ContainsSubjectStrings), body: phraseText(conditions?.ContainsBodyStrings),
    exceptSubject: phraseText(exceptions?.ContainsSubjectStrings), exceptBody: phraseText(exceptions?.ContainsBodyStrings),
    hasAttachments: bool(conditions?.HasAttachments), exceptHasAttachments: bool(exceptions?.HasAttachments), exceptSentOnlyToMe: bool(exceptions?.SentOnlyToMe),
    importance: importanceValues.includes(actions?.MarkImportance) ? actions.MarkImportance : '',
    folder: folderId(actions?.MoveToFolder)?.['@_Id'] || '', copyFolder: folderId(actions?.CopyToFolder)?.['@_Id'] || '',
    markRead: bool(actions?.MarkAsRead), stopProcessing: bool(actions?.StopProcessingRules), sentOnlyToMe: bool(conditions?.SentOnlyToMe),
  };
  const validBoolean = value => value === undefined || ['true', 'false', '0', '1'].includes(String(value).toLowerCase());
  const serverBlocked = bool(rule.IsNotSupported) || bool(rule.IsInError);
  let editable = !blocked && !serverBlocked && only(rule, ['RuleId', 'DisplayName', 'Priority', 'IsEnabled', 'IsNotSupported', 'IsInError', 'Conditions', 'Exceptions', 'Actions'])
    && typeof data.name === 'string' && data.name === data.name.trim()
    && rule.IsEnabled !== undefined && validBoolean(rule.IsEnabled) && validBoolean(rule.IsNotSupported) && validBoolean(rule.IsInError)
    && only(conditions, ['FromAddresses', 'ContainsSubjectStrings', 'ContainsBodyStrings', 'SentOnlyToMe', 'HasAttachments']) && validBoolean(conditions.SentOnlyToMe) && validAttachmentFlag(conditions)
    && (conditions.FromAddresses === undefined || only(conditions.FromAddresses, ['Address']) && addresses.length > 0
      && addresses.every(validAddress))
    && validPhrases(conditions, 'ContainsSubjectStrings') && validPhrases(conditions, 'ContainsBodyStrings')
    && (empty(exceptions) || only(exceptions, ['ContainsSubjectStrings', 'ContainsBodyStrings', 'HasAttachments', 'SentOnlyToMe'])
      && validPhrases(exceptions, 'ContainsSubjectStrings') && validPhrases(exceptions, 'ContainsBodyStrings')
      && validAttachmentFlag(exceptions) && validBoolean(exceptions.SentOnlyToMe))
    && only(actions, ['MoveToFolder', 'CopyToFolder', 'MarkAsRead', 'StopProcessingRules', 'MarkImportance'])
    && validBoolean(actions.MarkAsRead) && validBoolean(actions.StopProcessingRules)
    && (actions.MarkImportance === undefined || importanceValues.slice(1).includes(actions.MarkImportance))
    && validFolder(actions.MoveToFolder) && validFolder(actions.CopyToFolder);
  try { createSOAP(data, Number(rule.Priority), '', addresses); } catch { editable = false; }
  const internalSenders = addresses.flatMap((address, index) => isInternal(address) ? [{ index, name: internalDisplayName(address) }] : []);
  const reason = blocked ? 'outlook' : serverBlocked ? 'server' : 'unsupported';
  return {
    id: String(rule.RuleId), revision: revision(rule), priority: Number(rule.Priority), enabled: bool(rule.IsEnabled),
    ...data, internalSenders, editable: Boolean(editable),
    ...(!editable ? { readOnlyReason: reason, details: { conditions: describe(conditions), exceptions: describe(exceptions), actions: describe(actions) } } : {}),
  };
}
async function readRules(client) {
  const configuration = await client.ews('GetInboxRules', P.soap('<m:GetInboxRules/>'));
  const outlookRuleBlobExists = P.walk(configuration, value => bool(value.OutlookRuleBlobExists)).length > 0;
  const rules = P.walk(configuration, value => value.RuleId !== undefined && value.Priority !== undefined);
  return { rules, outlookRuleBlobExists };
}
async function list(client) {
  const { rules, outlookRuleBlobExists } = await readRules(client);
  const items = rules.map(rule => normalize(rule, outlookRuleBlobExists));
  return { items: items.sort((a, b) => a.priority - b.priority), outlookRuleBlobExists };
}
function validateChange(data) {
  if (!data || !['update', 'delete'].includes(data.action) || typeof data.id !== 'string' || !data.id || data.id.length > 16000 || /[\x00-\x1f]/.test(data.id) || !/^[a-f0-9]{64}$/.test(data.revision)) throw new Error(tr('Некорректное изменение правила'));
  if (data.action === 'delete' && (data.changes !== undefined || data.removeInternalSenders !== undefined)) throw new Error(tr('Некорректное изменение правила'));
  if (data.action === 'update') {
    const removals = data.removeInternalSenders;
    if (removals !== undefined && (!Array.isArray(removals) || removals.length > 20 || removals.some(index => !Number.isInteger(index) || index < 0 || index >= 20))) throw invalidRule();
    if (!data.changes || typeof data.changes !== 'object' || Array.isArray(data.changes)) throw new Error(tr('Некорректное изменение правила'));
    const entries = Object.entries(data.changes);
    if (!entries.length || entries.some(([key, value]) => !allowedChanges.includes(key) ||
      textFields.includes(key) && typeof value !== 'string' || booleanFields.includes(key) && typeof value !== 'boolean' ||
      key === 'priority' && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647))) throw new Error(tr('Некорректное изменение правила'));
  }
}
async function prepare(client, data) {
  validateChange(data);
  const { rules, outlookRuleBlobExists } = await readRules(client);
  const original = rules.find(rule => String(rule.RuleId) === data.id);
  if (!original || revision(original) !== data.revision) throw new Error(tr('Правило изменилось. Загрузите список заново.'));
  const rule = normalize(original, outlookRuleBlobExists);
  if (!rule.editable) throw new Error(tr(protectedMessages[rule.readOnlyReason]));
  if (data.action === 'delete') return { rule };
  const remove = new Set(data.removeInternalSenders);
  if ([...remove].some(index => !rule.internalSenders.some(sender => sender.index === index))) throw invalidRule();
  const retained = ruleAddresses(original).filter((_, index) => !remove.has(index));
  const updated = { ...rule, ...data.changes, internalSenders: rule.internalSenders.filter(sender => !remove.has(sender.index)) };
  const addresses = updated.sender === rule.sender ? retained : [
    ...retained.filter(isInternal),
    ...smtpAddresses(updated.sender).map(address => retained.find(entry => !isInternal(entry) && entry.EmailAddress === address.EmailAddress) || address),
  ];
  const xml = createSOAP(updated, updated.priority, rule.id, addresses);
  return { rule: updated, xml };
}
async function prepareChange(client, data) { return (await prepare(client, data)).rule; }
async function changeRule(client, data) {
  const { rule, xml } = await prepare(client, data);
  const request = data.action === 'delete'
    ? updateSOAP(`<t:DeleteRuleOperation><t:RuleId>${P.escapeXML(rule.id)}</t:RuleId></t:DeleteRuleOperation>`)
    : xml;
  await client.ews('UpdateInboxRules', request);
  return true;
}
async function write(client, operation, data) {
  if (client.mailRulesWriting) throw new Error(tr('Изменение правил уже выполняется.'));
  client.mailRulesWriting = true;
  try { return await operation(client, data); }
  finally { client.mailRulesWriting = false; }
}
module.exports = { createSOAP, create: (client, data) => write(client, createRule, data), list, change: (client, data) => write(client, changeRule, data), prepareChange, validateChange };

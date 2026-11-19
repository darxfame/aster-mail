const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
const { createHash } = require('node:crypto');
const textFields = ['name', 'sender', 'subject', 'body', 'exceptSubject', 'folder', 'copyFolder'];
const booleanFields = ['markRead', 'stopProcessing', 'enabled'];
const allowedChanges = [...textFields, ...booleanFields, 'priority'];
const mailboxAddress = /^[^\s<>@,;]+@[^\s<>@,;]+$/;
const invalidRule = () => new Error(tr('Укажите название, хотя бы одно условие и действие правила.'));
function createSOAP(data, priority, id = '') {
  const name = String(data.name || '').trim(), subject = String(data.subject || '').trim();
  const body = String(data.body || '').trim(), exceptSubject = String(data.exceptSubject || '').trim();
  const addresses = P.emails(data.sender || '');
  if (!name || name.length > 100 || addresses.length > 20 || !addresses.length && !subject && !body ||
    [subject, body, exceptSubject].some(value => value.length > 200) || /[\x00-\x1f]/.test(name + subject + body + exceptSubject) ||
    booleanFields.some(key => data[key] !== undefined && typeof data[key] !== 'boolean') ||
    ['folder', 'copyFolder'].some(key => data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 16000 || /[\x00-\x1f]/.test(data[key]))) ||
    !data.folder && !data.copyFolder && !data.markRead && !data.stopProcessing ||
    !Number.isSafeInteger(priority) || priority < 0 || priority > 2147483647) throw invalidRule();
  const folder = value => ['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive'].includes(value)
    ? `<t:DistinguishedFolderId Id="${value}"/>` : `<t:FolderId Id="${P.escapeXML(value)}"/>`;
  const string = (tag, value) => value ? `<t:${tag}><t:String>${P.escapeXML(value)}</t:String></t:${tag}>` : '';
  const conditions = string('ContainsBodyStrings', body) + string('ContainsSubjectStrings', subject) + (addresses.length ? `<t:FromAddresses>${addresses.map(address => `<t:Address><t:EmailAddress>${P.escapeXML(address)}</t:EmailAddress></t:Address>`).join('')}</t:FromAddresses>` : '');
  const exceptions = exceptSubject ? `<t:Exceptions>${string('ContainsSubjectStrings', exceptSubject)}</t:Exceptions>` : '';
  const actions = `${data.copyFolder ? `<t:CopyToFolder>${folder(data.copyFolder)}</t:CopyToFolder>` : ''}${data.markRead ? '<t:MarkAsRead>true</t:MarkAsRead>' : ''}${data.folder ? `<t:MoveToFolder>${folder(data.folder)}</t:MoveToFolder>` : ''}${data.stopProcessing ? '<t:StopProcessingRules>true</t:StopProcessingRules>' : ''}`;
  const operation = id ? 'SetRuleOperation' : 'CreateRuleOperation';
  return updateSOAP(`<t:${operation}><t:Rule>${id ? `<t:RuleId>${P.escapeXML(id)}</t:RuleId>` : ''}<t:DisplayName>${P.escapeXML(name)}</t:DisplayName><t:Priority>${priority}</t:Priority><t:IsEnabled>${data.enabled !== false}</t:IsEnabled><t:Conditions>${conditions}</t:Conditions>${exceptions}<t:Actions>${actions}</t:Actions></t:Rule></t:${operation}>`);
}
function updateSOAP(operation) {
  return P.soap(`<m:UpdateInboxRules><m:RemoveOutlookRuleBlob>false</m:RemoveOutlookRuleBlob><m:Operations>${operation}</m:Operations></m:UpdateInboxRules>`);
}
async function createRule(client, data) {
  const input = Object.fromEntries(allowedChanges.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  createSOAP(input, 0); // Validate before any request.
  const configuration = await client.ews('GetInboxRules', P.soap('<m:GetInboxRules/>'));
  if (P.walk(configuration, o => String(o.OutlookRuleBlobExists).toLowerCase() === 'true').length) throw new Error(tr('Exchange хранит совместимые правила Outlook. Чтобы не удалить их, создайте новое правило в OWA.'));
  const rules = P.walk(configuration, o => o.RuleId !== undefined && o.Priority !== undefined);
  const priorities = rules.map(rule => Number(rule.Priority));
  if (priorities.some(p => !Number.isSafeInteger(p) || p < 0)) throw new Error(tr('Exchange вернул некорректные приоритеты правил'));
  await client.ews('UpdateInboxRules', createSOAP(input, Math.max(-1, ...priorities) + 1));
  return true;
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const bool = value => value === true || value === 'true';
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const empty = value => value == null || value === '' || only(value, []);
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function describe(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([key]) => !key.startsWith('@_')).map(([key, field]) => {
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
  const addresses = array(conditions?.FromAddresses?.Address);
  const singleString = (object, key) => {
    const value = object?.[key];
    return value === undefined || only(value, ['String']) && typeof value.String === 'string' && Boolean(value.String) && value.String.trim() === value.String;
  };
  const folderId = value => value?.FolderId || value?.DistinguishedFolderId;
  const validFolder = value => value === undefined || only(value, ['FolderId', 'DistinguishedFolderId']) && Object.keys(value).length === 1 && only(folderId(value), ['@_Id', '@_ChangeKey']) && Boolean(folderId(value)['@_Id']);
  const data = {
    name: rule.DisplayName, sender: addresses.map(address => address?.EmailAddress || '').join(', '),
    subject: conditions?.ContainsSubjectStrings?.String || '', body: conditions?.ContainsBodyStrings?.String || '',
    exceptSubject: exceptions?.ContainsSubjectStrings?.String || '',
    folder: folderId(actions?.MoveToFolder)?.['@_Id'] || '', copyFolder: folderId(actions?.CopyToFolder)?.['@_Id'] || '',
    markRead: bool(actions?.MarkAsRead), stopProcessing: bool(actions?.StopProcessingRules),
  };
  const validBoolean = value => value === undefined || ['true', 'false'].includes(String(value));
  let editable = !blocked && only(rule, ['RuleId', 'DisplayName', 'Priority', 'IsEnabled', 'IsNotSupported', 'IsInError', 'Conditions', 'Exceptions', 'Actions'])
    && typeof data.name === 'string' && data.name === data.name.trim()
    && ['true', 'false'].includes(String(rule.IsEnabled)) && [undefined, false, 'false'].includes(rule.IsNotSupported) && [undefined, false, 'false'].includes(rule.IsInError)
    && only(conditions, ['FromAddresses', 'ContainsSubjectStrings', 'ContainsBodyStrings'])
    && (conditions.FromAddresses === undefined || only(conditions.FromAddresses, ['Address']) && addresses.length > 0
      && addresses.every(address => only(address, ['Name', 'EmailAddress', 'RoutingType', 'MailboxType']) && (!address.RoutingType || address.RoutingType === 'SMTP') && typeof address.EmailAddress === 'string' && mailboxAddress.test(address.EmailAddress)))
    && singleString(conditions, 'ContainsSubjectStrings') && singleString(conditions, 'ContainsBodyStrings')
    && (empty(exceptions) || only(exceptions, ['ContainsSubjectStrings']) && singleString(exceptions, 'ContainsSubjectStrings'))
    && only(actions, ['MoveToFolder', 'CopyToFolder', 'MarkAsRead', 'StopProcessingRules'])
    && validBoolean(actions.MarkAsRead) && validBoolean(actions.StopProcessingRules)
    && validFolder(actions.MoveToFolder) && validFolder(actions.CopyToFolder);
  try { createSOAP(data, Number(rule.Priority)); } catch { editable = false; }
  return { id: String(rule.RuleId), revision: revision(rule), priority: Number(rule.Priority), enabled: bool(rule.IsEnabled), ...data, editable: Boolean(editable), ...(!editable ? { details: { conditions: describe(conditions), exceptions: describe(rule.Exceptions), actions: describe(actions) } } : {}) };
}
async function list(client) {
  const configuration = await client.ews('GetInboxRules', P.soap('<m:GetInboxRules/>'));
  const outlookRuleBlobExists = P.walk(configuration, o => bool(o.OutlookRuleBlobExists)).length > 0;
  const items = P.walk(configuration, o => o.RuleId !== undefined && o.Priority !== undefined).map(rule => normalize(rule, outlookRuleBlobExists));
  return { items: items.sort((a, b) => a.priority - b.priority), outlookRuleBlobExists };
}
function validateChange(data) {
  if (!data || !['update', 'delete'].includes(data.action) || typeof data.id !== 'string' || !data.id || data.id.length > 16000 || /[\x00-\x1f]/.test(data.id) || !/^[a-f0-9]{64}$/.test(data.revision)) throw new Error(tr('Некорректное изменение правила'));
  if (data.action === 'delete' && data.changes !== undefined) throw new Error(tr('Некорректное изменение правила'));
  if (data.action === 'update') {
    if (!data.changes || typeof data.changes !== 'object' || Array.isArray(data.changes)) throw new Error(tr('Некорректное изменение правила'));
    const entries = Object.entries(data.changes);
    if (!entries.length || entries.some(([key, value]) => !allowedChanges.includes(key) ||
      textFields.includes(key) && typeof value !== 'string' || booleanFields.includes(key) && typeof value !== 'boolean' ||
      key === 'priority' && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647))) throw new Error(tr('Некорректное изменение правила'));
  }
}
async function prepareChange(client, data) {
  validateChange(data);
  const configuration = await list(client);
  const rule = configuration.items.find(rule => rule.id === data.id);
  if (!rule || rule.revision !== data.revision) throw new Error(tr('Правило изменилось. Загрузите список заново.'));
  if (!rule.editable) throw new Error(tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.'));
  const updated = data.action === 'update' ? { ...rule, ...data.changes } : rule;
  if (data.action === 'update') createSOAP(updated, updated.priority);
  return updated;
}
async function changeRule(client, data) {
  const rule = await prepareChange(client, data);
  const xml = data.action === 'delete'
    ? updateSOAP(`<t:DeleteRuleOperation><t:RuleId>${P.escapeXML(rule.id)}</t:RuleId></t:DeleteRuleOperation>`)
    : createSOAP({ ...rule, folder: rule.folder || undefined }, rule.priority, rule.id);
  await client.ews('UpdateInboxRules', xml);
  return true;
}
async function write(client, operation, data) {
  if (client.mailRulesWriting) throw new Error(tr('Изменение правил уже выполняется.'));
  client.mailRulesWriting = true;
  try { return await operation(client, data); }
  finally { client.mailRulesWriting = false; }
}
module.exports = { createSOAP, create: (client, data) => write(client, createRule, data), list, change: (client, data) => write(client, changeRule, data), prepareChange, validateChange };

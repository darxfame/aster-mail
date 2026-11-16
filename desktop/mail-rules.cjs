const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
const { createHash } = require('node:crypto');
function createSOAP(data, priority) {
  const name = String(data.name || '').trim(), subject = String(data.subject || '').trim();
  const addresses = P.emails(data.sender || '');
  if (!name || name.length > 100 || addresses.length !== 1 || subject.length > 200 || /[\x00-\x1f]/.test(name + subject) || data.markRead !== undefined && typeof data.markRead !== 'boolean' || data.folder !== undefined && (typeof data.folder !== 'string' || !data.folder || data.folder.length > 16000 || /[\x00-\x1f]/.test(data.folder)) || !data.folder && data.markRead !== true || !Number.isSafeInteger(priority) || priority < 0) throw new Error(tr('Укажите имя правила, отправителя и действие: перенос или отметку прочитанным'));
  const folder = ['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive'].includes(data.folder) ? `<t:DistinguishedFolderId Id="${data.folder}"/>` : `<t:FolderId Id="${P.escapeXML(data.folder)}"/>`;
  return P.soap(`<m:UpdateInboxRules><m:RemoveOutlookRuleBlob>false</m:RemoveOutlookRuleBlob><m:Operations><t:CreateRuleOperation><t:Rule><t:DisplayName>${P.escapeXML(name)}</t:DisplayName><t:Priority>${priority}</t:Priority><t:IsEnabled>true</t:IsEnabled><t:Conditions>${subject ? `<t:ContainsSubjectStrings><t:String>${P.escapeXML(subject)}</t:String></t:ContainsSubjectStrings>` : ''}<t:FromAddresses><t:Address><t:EmailAddress>${P.escapeXML(addresses[0])}</t:EmailAddress></t:Address></t:FromAddresses></t:Conditions><t:Actions>${data.markRead ? '<t:MarkAsRead>true</t:MarkAsRead>' : ''}${data.folder ? `<t:MoveToFolder>${folder}</t:MoveToFolder>` : ''}</t:Actions></t:Rule></t:CreateRuleOperation></m:Operations></m:UpdateInboxRules>`);
}
async function create(client, data) {
  createSOAP(data, 0); // Validate before any request.
  const configuration = await client.ews('GetInboxRules', P.soap('<m:GetInboxRules/>'));
  if (P.walk(configuration, o => String(o.OutlookRuleBlobExists).toLowerCase() === 'true').length) throw new Error(tr('Exchange хранит совместимые правила Outlook. Чтобы не удалить их, создайте новое правило в OWA.'));
  const rules = P.walk(configuration, o => o.RuleId !== undefined && o.Priority !== undefined);
  const priorities = rules.map(rule => Number(rule.Priority));
  if (priorities.some(p => !Number.isSafeInteger(p) || p < 0)) throw new Error(tr('Exchange вернул некорректные приоритеты правил'));
  await client.ews('UpdateInboxRules', createSOAP(data, Math.max(-1, ...priorities) + 1));
  return true;
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const bool = value => value === true || value === 'true';
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const empty = value => value == null || value === '' || only(value, []);
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalize(rule, blocked) {
  const conditions = rule.Conditions, actions = rule.Actions;
  const addresses = array(conditions?.FromAddresses?.Address);
  const subjects = array(conditions?.ContainsSubjectStrings?.String);
  const move = actions?.MoveToFolder;
  const folder = move?.FolderId || move?.DistinguishedFolderId;
  const data = { name: rule.DisplayName, sender: addresses[0]?.EmailAddress || '', subject: subjects[0] || '', folder: folder?.['@_Id'] || '', markRead: bool(actions?.MarkAsRead) };
  let editable = !blocked && only(rule, ['RuleId', 'DisplayName', 'Priority', 'IsEnabled', 'IsNotSupported', 'IsInError', 'Conditions', 'Exceptions', 'Actions'])
    && ['true', 'false'].includes(String(rule.IsEnabled)) && [undefined, false, 'false'].includes(rule.IsNotSupported) && [undefined, false, 'false'].includes(rule.IsInError) && empty(rule.Exceptions)
    && only(conditions, ['FromAddresses', 'ContainsSubjectStrings']) && only(conditions.FromAddresses, ['Address']) && addresses.length === 1
    && only(addresses[0], ['Name', 'EmailAddress', 'RoutingType', 'MailboxType']) && (!addresses[0].RoutingType || addresses[0].RoutingType === 'SMTP')
    && (!conditions.ContainsSubjectStrings || only(conditions.ContainsSubjectStrings, ['String']) && subjects.length === 1 && typeof subjects[0] === 'string')
    && only(actions, ['MoveToFolder', 'MarkAsRead']) && (actions.MarkAsRead === undefined || ['true', 'false'].includes(String(actions.MarkAsRead)))
    && (!move || only(move, ['FolderId', 'DistinguishedFolderId']) && Object.keys(move).length === 1 && only(folder, ['@_Id', '@_ChangeKey']));
  editable = editable && typeof data.name === 'string' && data.name === data.name.trim() && typeof data.subject === 'string' && data.subject === data.subject.trim() && typeof data.sender === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(data.sender);
  try { createSOAP({ ...data, folder: data.folder || undefined }, Number(rule.Priority)); } catch { editable = false; }
  return { id: String(rule.RuleId), revision: revision(rule), priority: Number(rule.Priority), enabled: bool(rule.IsEnabled), ...data, editable: Boolean(editable) };
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
    for (const [key, value] of Object.entries(data.changes)) {
      if (['name', 'sender', 'subject', 'folder'].includes(key) && typeof value !== 'string' || ['markRead', 'enabled'].includes(key) && typeof value !== 'boolean') throw new Error(tr('Некорректное изменение правила'));
    }
    if (!data.changes || !Object.keys(data.changes).length || Object.keys(data.changes).some(key => !['name', 'sender', 'subject', 'folder', 'markRead', 'enabled', 'priority'].includes(key)) || data.changes.enabled !== undefined && typeof data.changes.enabled !== 'boolean' || data.changes.priority !== undefined && (!Number.isSafeInteger(data.changes.priority) || data.changes.priority < 0 || data.changes.priority > 2147483647)) throw new Error(tr('Некорректное изменение правила'));
  }
}
async function prepareChange(client, data) {
  validateChange(data);
  const configuration = await list(client);
  const rule = configuration.items.find(rule => rule.id === data.id);
  if (!rule || rule.revision !== data.revision) throw new Error(tr('Правило изменилось. Загрузите список заново.'));
  if (!rule.editable) throw new Error(tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.'));
  const updated = data.action === 'update' ? { ...rule, ...data.changes } : rule;
  if (data.action === 'update') {
    if (typeof updated.sender !== 'string' || !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(updated.sender)) throw new Error(tr('Некорректное изменение правила'));
    createSOAP({ ...updated, folder: updated.folder || undefined }, updated.priority);
  }
  return updated;
}
async function change(client, data) {
  const rule = await prepareChange(client, data);
  let xml;
  if (data.action === 'delete') xml = P.soap(`<m:UpdateInboxRules><m:RemoveOutlookRuleBlob>false</m:RemoveOutlookRuleBlob><m:Operations><t:DeleteRuleOperation><t:RuleId>${P.escapeXML(rule.id)}</t:RuleId></t:DeleteRuleOperation></m:Operations></m:UpdateInboxRules>`);
  else xml = createSOAP({ ...rule, folder: rule.folder || undefined }, rule.priority).replace('<t:CreateRuleOperation>', '<t:SetRuleOperation>').replace('</t:CreateRuleOperation>', '</t:SetRuleOperation>').replace('<t:Rule>', `<t:Rule><t:RuleId>${P.escapeXML(rule.id)}</t:RuleId>`).replace('<t:IsEnabled>true</t:IsEnabled>', `<t:IsEnabled>${rule.enabled}</t:IsEnabled>`);
  await client.ews('UpdateInboxRules', xml);
  return true;
}
module.exports = { createSOAP, create, list, change, prepareChange, validateChange };

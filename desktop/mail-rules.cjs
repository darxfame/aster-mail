const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
function createSOAP(data, priority) {
  const name = String(data.name || '').trim(), subject = String(data.subject || '').trim();
  const addresses = P.emails(data.sender || '');
  if (!name || name.length > 100 || addresses.length !== 1 || subject.length > 200 || typeof data.folder !== 'string' || !data.folder || data.folder.length > 16000 || !Number.isSafeInteger(priority) || priority < 0) throw new Error(tr('Укажите имя правила, отправителя и папку'));
  const folder = ['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive'].includes(data.folder) ? `<t:DistinguishedFolderId Id="${data.folder}"/>` : `<t:FolderId Id="${P.escapeXML(data.folder)}"/>`;
  return P.soap(`<m:UpdateInboxRules><m:RemoveOutlookRuleBlob>false</m:RemoveOutlookRuleBlob><m:Operations><t:CreateRuleOperation><t:Rule><t:DisplayName>${P.escapeXML(name)}</t:DisplayName><t:Priority>${priority}</t:Priority><t:IsEnabled>true</t:IsEnabled><t:Conditions>${subject ? `<t:ContainsSubjectStrings><t:String>${P.escapeXML(subject)}</t:String></t:ContainsSubjectStrings>` : ''}<t:FromAddresses><t:Address><t:EmailAddress>${P.escapeXML(addresses[0])}</t:EmailAddress></t:Address></t:FromAddresses></t:Conditions><t:Actions><t:MoveToFolder>${folder}</t:MoveToFolder></t:Actions></t:Rule></t:CreateRuleOperation></m:Operations></m:UpdateInboxRules>`);
}
async function create(client, data) {
  createSOAP(data, 0); // Validate before any request.
  const configuration = await client.ews('GetInboxRules', P.soap('<m:GetInboxRules/>'));
  if (P.walk(configuration, o => String(o.OutlookRuleBlobExists).toLowerCase() === 'true').length) throw new Error(tr('Exchange хранит совместимые правила Outlook. Чтобы не удалить их, создайте новое правило в OWA. Письмо уже перемещено.'));
  const rules = P.walk(configuration, o => o.RuleId !== undefined && o.Priority !== undefined);
  const priorities = rules.map(rule => Number(rule.Priority));
  if (priorities.some(p => !Number.isSafeInteger(p) || p < 0)) throw new Error(tr('Exchange вернул некорректные приоритеты правил'));
  await client.ews('UpdateInboxRules', createSOAP(data, Math.max(-1, ...priorities) + 1));
  return true;
}
module.exports = { createSOAP, create };

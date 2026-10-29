const tr = require('../src/i18n.js').text;
const P = require('./protocol.cjs');
const validEmail = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
function normalize(data) {
  const seen = new Set(), items = [];
  for (const resolution of P.walk(data, value => value.Mailbox?.EmailAddress !== undefined)) {
    const mailbox = resolution.Mailbox, contact = resolution.Contact || {};
    const entries = P.walk(contact.EmailAddresses, value => value.Entry !== undefined).flatMap(value => Array.isArray(value.Entry) ? value.Entry : [value.Entry]);
    const addresses = entries.map(value => typeof value === 'string' ? value : value['#text'] || value.Value || value.EmailAddress || '');
    const smtp = addresses.find(value => value.startsWith('SMTP:')) || addresses.find(value => /^smtp:/i.test(value)) || addresses.find(validEmail);
    const direct = mailbox.RoutingType === 'EX' ? '' : String(mailbox.EmailAddress).replace(/^smtp:/i, '').trim();
    const email = validEmail(direct) ? direct : smtp?.replace(/^smtp:/i, '') || '';
    if (!validEmail(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const phones = P.walk(contact.PhoneNumbers, value => value.Entry !== undefined).flatMap(value => Array.isArray(value.Entry) ? value.Entry : [value.Entry]);
    const phone = phones.find(value => value?.['@_Key'] === 'BusinessPhone') || phones[0];
    items.push({ id: `directory:${email.toLowerCase()}`, name: contact.DisplayName || mailbox.Name || email, email, company: contact.CompanyName || '', phone: typeof phone === 'string' ? phone : phone?.['#text'] || phone?.Value || '', source: 'directory' });
  }
  const set = P.walk(data, value => value['@_IncludesLastItemInRange'] !== undefined)[0];
  return { items, more: false, truncated: String(set?.['@_IncludesLastItemInRange']).toLowerCase() === 'false' };
}
async function search(client, query) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 254 || /[\u0000-\u001f]/.test(query)) throw new Error(tr('Для поиска в справочнике укажите от 2 до 254 символов'));
  try {
    const data = await client.ews('ResolveNames', P.soap(`<m:ResolveNames ReturnFullContactData="true" SearchScope="ActiveDirectoryContacts" ContactDataShape="Default"><m:UnresolvedEntry>${P.escapeXML(query.trim())}</m:UnresolvedEntry></m:ResolveNames>`));
    return normalize(data);
  } catch (error) { throw new Error(`${tr("Не удалось выполнить поиск в общем справочнике Exchange (EWS ResolveNames):")} ${error.message}`); }
}
module.exports = { search, normalize };

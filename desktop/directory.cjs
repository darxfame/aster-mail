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
function normalizePeople(body) {
  const people = body.ResultSet;
  if (!Array.isArray(people)) throw Object.assign(new Error(tr('OWA: неподдерживаемый формат справочника')), { code: 'OWADirectoryFormatUnsupported' });
  const seen = new Set(), items = [];
  for (const person of people) {
    const addresses = [person.EmailAddress, ...(Array.isArray(person.EmailAddresses) ? person.EmailAddresses : [])].filter(Boolean);
    const address = addresses.find(value => value.RoutingType !== 'EX' && validEmail(value.EmailAddress)) || addresses.find(value => validEmail(value.OriginalDisplayName));
    const email = address?.RoutingType !== 'EX' && validEmail(address?.EmailAddress) ? address.EmailAddress : address?.OriginalDisplayName;
    if (!validEmail(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    items.push({ id: `directory:${email.toLowerCase()}`, name: person.DisplayName || address.Name || email, email,
      company: person.CompanyName || '', phone: person.BusinessPhoneNumbers?.[0]?.Number || person.PhoneNumber?.Number || '', source: 'directory' });
  }
  if (people.length && !items.length) throw new Error(tr('Справочник вернул записи без SMTP-адресов. Уточните поиск или введите email вручную.'));
  return { items, more: false, truncated: Number(body.TotalNumberOfPeopleInView) > people.length || people.length >= 20, provider: 'owa' };
}
async function search(client, query) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 254 || /[\u0000-\u001f]/.test(query)) throw new Error(tr('Для поиска в справочнике укажите от 2 до 254 символов'));
  let owaError;
  try {
    // FindPeople searches the GAL as its primary source, not only saved contacts.
    const data = await client.call('FindPeople', P.request('FindPeople', {
      IndexedPageItemView: P.typed('IndexedPageView', { BasePoint: 'Beginning', Offset: 0, MaxEntriesReturned: 20 }),
      QueryString: query.trim(), ParentFolderId: P.typed('TargetFolderId', { BaseFolderId: P.typed('DistinguishedFolderId', { Id: 'directory' }) }),
      PersonaShape: P.typed('PersonaResponseShape', { BaseShape: 'Default' }), ShouldResolveOneOffEmailAddress: false,
    }));
    return normalizePeople(data.Body);
  } catch (error) {
    const unsupported = ['ErrorInvalidRequest', 'ErrorInvalidOperation', 'ErrorNotSupported', 'ErrorInvalidServerVersion', 'ErrorInvalidDistinguishedFolderId', 'OWADirectoryFormatUnsupported'].includes(error.code) || [404, 405, 501].includes(error.status);
    if (!unsupported || error.connectionError || client.authRejected) throw Object.assign(new Error(`${tr('Не удалось выполнить поиск в справочнике OWA:')} ${error.message}`), { connectionError: error.connectionError === true });
    owaError = error;
  }
  // Read-only compatibility fallback, only for an explicitly unsupported OWA operation.
  try {
    const data = await client.ews('ResolveNames', P.soap(`<m:ResolveNames ReturnFullContactData="true" SearchScope="ActiveDirectoryContacts" ContactDataShape="Default"><m:UnresolvedEntry>${P.escapeXML(query.trim())}</m:UnresolvedEntry></m:ResolveNames>`));
    return { ...normalize(data), provider: 'ews' };
  } catch (error) { throw new Error(`${tr('Поиск в справочнике недоступен:')} OWA: ${owaError.message}; EWS ResolveNames: ${error.message}`); }
}
module.exports = { search, normalize, normalizePeople };

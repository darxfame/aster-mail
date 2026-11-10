const crypto = require('node:crypto');
const P = require('./protocol.cjs');
const T = require('../src/time.js');
const tr = require('../src/i18n.js').text;
const states = ['Disabled', 'Enabled', 'Scheduled'];
const audiences = ['None', 'Known', 'All'];
const revision = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const message = value => typeof value === 'string' ? value : value?.['#text'] || '';

function normalize(data) {
  const response = data?.Envelope?.Body?.GetUserOofSettingsResponse;
  const settings = response?.OofSettings;
  if (!settings || !states.includes(settings.OofState) || !audiences.includes(settings.ExternalAudience) || !audiences.includes(response.AllowExternalOof)) throw new Error(tr('Сервер вернул неподдерживаемые настройки автоответов.'));
  const result = { state: settings.OofState, audience: settings.ExternalAudience, allowExternal: response.AllowExternalOof,
    start: T.exchange(settings.Duration?.StartTime), end: T.exchange(settings.Duration?.EndTime),
    internal: message(settings.InternalReply?.Message), external: message(settings.ExternalReply?.Message),
    internalLanguage: settings.InternalReply?.['@_lang'] || '', externalLanguage: settings.ExternalReply?.['@_lang'] || '' };
  if (result.state === 'Scheduled' && (!result.start || !result.end || result.end <= result.start)) throw new Error(tr('Сервер вернул неподдерживаемые настройки автоответов.'));
  return result;
}
async function fetchSettings(client, guard) {
  const identity = await client.identity(); guard();
  if (!identity.email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(identity.email)) throw new Error(tr('Не удалось определить адрес почтового ящика для автоответов.'));
  const mailbox = `<t:Mailbox><t:Address>${P.escapeXML(identity.email)}</t:Address></t:Mailbox>`;
  const result = await client.ews('GetUserOofSettings', P.soap(`<m:GetUserOofSettingsRequest>${mailbox}</m:GetUserOofSettingsRequest>`)); guard();
  return { mailbox, settings: normalize(result) };
}
async function read(client, guard = () => {}) {
  const snapshot = await fetchSettings(client, guard);
  client.autoRepliesSnapshot = snapshot;
  return { ...snapshot.settings, revision: revision(snapshot) };
}
function updatedSettings(before, input) {
  if (!states.includes(input.state) || !audiences.includes(input.audience)) throw new Error(tr('Некорректные настройки автоответов.'));
  if (!(input.state === 'Disabled' && input.audience === before.audience) && audiences.indexOf(input.audience) > audiences.indexOf(before.allowExternal)) throw new Error(tr('Внешние автоответы ограничены политикой Exchange.'));
  const next = { ...before, state: input.state, audience: input.audience };
  if (input.state === 'Scheduled') {
    const valid = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && T.exchange(value)?.slice(0, 19) === value.slice(0, 19);
    if (!valid(input.start) || !valid(input.end) || Date.parse(input.end) <= Date.parse(input.start)) throw new Error(tr('Укажите корректный период автоответов.'));
    next.start = T.exchange(input.start); next.end = T.exchange(input.end);
  }
  // OWA replies can contain HTML. Preserve it verbatim unless the user edited that reply.
  for (const key of ['internal', 'external']) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== 'string' || input[key].length > 32000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key])) throw new Error(tr('Текст автоответа должен содержать не более 32000 символов.'));
    next[key] = `<html><body>${P.escapeXML(input[key]).replace(/\r\n?|\n/g, '<br>')}</body></html>`;
  }
  return next;
}
function settingsXML(settings) {
  const reply = (tag, value, language) => `<t:${tag}${language ? ` lang="${P.escapeXML(language)}"` : ''}><t:Message>${P.escapeXML(value)}</t:Message></t:${tag}>`;
  return `<t:UserOofSettings><t:OofState>${settings.state}</t:OofState><t:ExternalAudience>${settings.audience}</t:ExternalAudience>${settings.start && settings.end ? `<t:Duration><t:StartTime>${settings.start}</t:StartTime><t:EndTime>${settings.end}</t:EndTime></t:Duration>` : ''}${reply('InternalReply', settings.internal, settings.internalLanguage)}${reply('ExternalReply', settings.external, settings.externalLanguage)}</t:UserOofSettings>`;
}
async function save(client, input, guard = () => {}) {
  const before = client.autoRepliesSnapshot;
  if (!before || input.revision !== revision(before)) throw new Error(tr('Настройки автоответов изменились. Загрузите их заново.'));
  const next = updatedSettings(before.settings, input);
  if (client.autoRepliesSaving) throw new Error(tr('Сохранение автоответов уже выполняется.'));
  client.autoRepliesSaving = true;
  try {
    const current = await fetchSettings(client, guard);
    if (revision(current) !== input.revision) throw new Error(tr('Настройки автоответов изменились. Загрузите их заново.'));
    guard();
    // Consume the snapshot before writing: an uncertain result requires an explicit reload.
    client.autoRepliesSnapshot = null;
    await client.ews('SetUserOofSettings', P.soap(`<m:SetUserOofSettingsRequest>${current.mailbox}${settingsXML(next)}</m:SetUserOofSettingsRequest>`));
    guard();
    return true;
  } finally { client.autoRepliesSaving = false; }
}
module.exports = { normalize, read, save, updatedSettings, settingsXML };

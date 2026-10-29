const { XMLParser, XMLValidator } = require('fast-xml-parser');
const P = require('./protocol.cjs');

function xml(text) {
  if (text.length > 1024 * 1024 || /<!DOCTYPE/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Сервер вернул HTML или некорректный XML вместо ответа службы.');
  return new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false }).parse(text);
}
function endpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return 'Небезопасный адрес службы';
    return `${url.origin}${url.pathname}`;
  } catch { return 'Некорректный адрес службы'; }
}
function httpDetail(response) {
  const headers = response.headers || {};
  const auth = String(headers['www-authenticate'] || '').match(/\b(Negotiate|NTLM|Basic|Bearer)\b/gi);
  const note = response.status === 401 ? 'Авторизация не принята; это не доказывает отсутствие протокола.'
    : response.status === 403 ? 'Доступ запрещён для аккаунта или сети.'
      : response.status === 404 ? 'Адрес не найден или скрыт шлюзом.'
        : response.status >= 300 && response.status < 400 ? `Перенаправление: ${endpoint(headers.location)}. Переход не выполнялся.`
          : response.status >= 400 ? 'Служба или шлюз вернули ошибку.' : '';
  return `HTTP ${response.status}${auth ? ` · Авторизация: ${[...new Set(auth)].join(', ')}` : ''}${note ? `. ${note}` : ''}`;
}
async function run(client, email = '', { authenticate = false } = {}) {
  const rows = [];
  async function check(name, operation) {
    const row = { name, status: 'unknown', detail: '' };
    rows.push(row);
    try { Object.assign(row, await operation()); }
    catch (error) {
      // Never expose response bodies, mailbox contents, credentials or authentication tokens.
      const code = /\bError[A-Za-z0-9]+\b/.exec(error.code || error.message || '')?.[0];
      const network = /^(ERR_CERT_|ERR_SSL_)/.test(error.code || '') ? 'Ошибка TLS: сертификат или параметры защищённого соединения не приняты.' : error.code === 'ERR_NAME_NOT_RESOLVED' ? 'DNS не разрешил имя сервера. Проверьте адрес и VPN.' : /^ERR_(CONNECTION_|TIMED_OUT)/.test(error.code || '') ? 'Соединение не установлено или прервано. Проверьте VPN и доступность сервера.' : '';
      row.detail = /другой сервер|постороннему серверу/.test(error.message || '') ? 'Сервер требует перехода на другой хост. Межсерверный SSO в Aster пока не поддерживается.' : network ? `${network} ${error.code}` : /401|отклонил логин|Вход не выполнен/.test(error.message || '') ? 'Сервер отклонил вход OWA. Проверьте логин, пароль и способ авторизации; другие службы проверяются отдельно.' : /CANARY/.test(error.message || '') ? 'Сессия OWA не получена: возможны MFA, SSO или неподдерживаемая форма входа.' : code ? `Exchange: ${code}` : /XML|HTML/.test(error.message) ? 'Вместо ожидаемого ответа получена страница входа или некорректный XML.' : 'Не удалось завершить запрос. Возможны VPN, TLS, тайм-аут или завершение сессии.';
    }
  }
  if (authenticate) await check('OWA · вход', async () => {
    await client.authenticate();
    return { status: 'ok', detail: 'Сервер выдал сессию OWA.' };
  });
  const request = (path, options = {}) => client.transport(`${client.origin}${path}`, { ...options, followRedirects: false });
  async function soap(action, body, verify) {
    const response = await request('/EWS/Exchange.asmx', { method: 'POST', headers: {
      'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://schemas.microsoft.com/exchange/services/2006/messages/${action}"`,
      ...(client.canary ? { 'X-OWA-CANARY': client.canary } : {}),
    }, body: P.soap(body) });
    if (response.status !== 200) return { detail: httpDetail(response) };
    const data = P.parseSOAP(response.text, action);
    if (verify && !verify(data)) return { detail: 'Ответ не содержит ожидаемых данных операции.' };
    const version = P.walk(data, value => value.ServerVersionInfo)[0]?.ServerVersionInfo;
    const numbers = version && ['MajorVersion', 'MinorVersion', 'MajorBuildNumber', 'MinorBuildNumber'].map(key => version[`@_${key}`]);
    return { status: 'ok', detail: `Операция ${action} выполнена.${numbers?.every(value => /^\d+$/.test(value)) ? ` Версия Exchange: ${numbers.join('.')}.` : ''}` };
  }
  await Promise.all([
    check('OWA · доступ к почтовой папке', async () => {
      if (!client.canary) return { status: 'skipped', detail: 'Нет сессии OWA. EWS и другие службы проверяются отдельно.' };
      // Bypass automatic authentication/retries and all mailbox caches.
      const response = await request('/owa/service.svc?action=GetFolder&EP=1', { method: 'POST', headers: {
        'Content-Type': 'application/json; charset=utf-8', 'X-OWA-CANARY': client.canary, Action: 'GetFolder',
      }, body: JSON.stringify(P.request('GetFolder', { FolderShape: P.typed('FolderResponseShape', { BaseShape: 'IdOnly' }), FolderIds: [P.folder('inbox')] })) });
      if (response.status !== 200) return { detail: httpDetail(response) };
      const data = P.checkJSON(JSON.parse(response.text));
      return P.walk(data, value => value.FolderId?.Id).length ? { status: 'ok', detail: 'GetFolder выполнен; папка «Входящие» доступна.' } : { detail: 'В ответе нет идентификатора папки.' };
    }),
    ...[['inbox', 'почта'], ['calendar', 'календарь'], ['contacts', 'контакты']].map(([folder, label]) => check(`EWS · ${label}: доступ к папке`, () => soap('GetFolder', `<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="${folder}"/></m:FolderIds></m:GetFolder>`, data => P.walk(data, value => value.FolderId?.['@_Id']).length > 0))),
    ...[['inbox', 'писем'], ['calendar', 'встреч'], ['contacts', 'контактов']].map(([folder, label]) => check(`EWS · чтение списка ${label}`, () => soap('FindItem', `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="1" Offset="0" BasePoint="Beginning"/><m:ParentFolderIds><t:DistinguishedFolderId Id="${folder}"/></m:ParentFolderIds></m:FindItem>`, data => P.walk(data, value => value.RootFolder).length > 0))),
    check('EWS · общий справочник', () => soap('ResolveNames', '<m:ResolveNames ReturnFullContactData="false" SearchScope="ActiveDirectoryContacts"><m:UnresolvedEntry>AsterProtocolDiagnostic</m:UnresolvedEntry></m:ResolveNames>')),
    check('EWS · чтение правил почты', () => soap('GetInboxRules', '<m:GetInboxRules/>')),
    check('Autodiscover · объявленные службы', async () => {
      if (!email) return { status: 'skipped', detail: 'Укажите основной SMTP-адрес, если логин имеет вид DOMAIN\\login.' };
      const response = await request('/autodiscover/autodiscover.xml', { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'X-MapiHttpCapability': '1', 'X-ClientCanHandle': 'Negotiate,ExHttpInfo' },
        body: `<?xml version="1.0" encoding="utf-8"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>${P.escapeXML(email)}</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>` });
      if (response.status !== 200) return { detail: httpDetail(response) };
      const data = xml(response.text);
      const account = data.Autodiscover?.Response?.Account;
      if (!account || account.Action !== 'settings') {
        const redirect = typeof account?.RedirectUrl === 'string' ? ` Сервер указал: ${endpoint(account.RedirectUrl)}.` : '';
        const errorCode = P.walk(data, value => /^\d{1,6}$/.test(value.ErrorCode || ''))[0]?.ErrorCode;
        return { detail: `Настройки не получены.${errorCode ? ` Код Autodiscover: ${errorCode}.` : ''}${redirect} Возможен XML-редирект или необходимость другого адреса Autodiscover. Межсерверный поиск не выполнялся.` };
      }
      const protocols = [account.Protocol || []].flat();
      const names = protocols.map(value => String(value['@_Type'] || value.Type || '')).filter(value => /^[\w-]{1,30}$/.test(value));
      const urls = P.walk(account, value => Object.keys(value).some(key => /^(EwsUrl|ASUrl|OOFUrl|OABUrl|InternalUrl|ExternalUrl)$/.test(key)))
        .flatMap(value => Object.entries(value).filter(([key, val]) => /^(EwsUrl|ASUrl|OOFUrl|OABUrl|InternalUrl|ExternalUrl)$/.test(key) && typeof val === 'string').map(([key, val]) => `${key}: ${endpoint(val)}`));
      return names.length || urls.length ? { status: 'detected', detail: [...new Set([...names, ...urls])].join('\n') + '\nСлужбы объявлены сервером; доступ к ним проверяется отдельно. Другие адреса автоматически не опрашиваются.' } : { detail: 'В ответе настроек нет распознанных служб.' };
    }),
    check('MAPI/HTTP · адрес службы', async () => {
      const response = await request('/mapi/emsmdb/', { method: 'GET' });
      return { detail: `${httpDetail(response)}. HTTP-ответ не подтверждает работоспособность MAPI. Вход и операции ROP не проверялись; смотрите также Autodiscover.` };
    }),
    check('ActiveSync · версии и команды', async () => {
      const response = await request('/Microsoft-Server-ActiveSync', { method: 'OPTIONS' });
      const versions = String(response.headers?.['ms-asprotocolversions'] || '');
      const commands = String(response.headers?.['ms-asprotocolcommands'] || '');
      return response.status === 200 && /^[\d., ]+$/.test(versions) ? { status: 'detected', detail: `Версии: ${versions.slice(0, 200)}.\nКоманды: ${commands.replace(/[^\w, -]/g, '').slice(0, 1000)}.\nВход устройства и синхронизация не проверялись.` } : { detail: `${httpDetail(response)}. Список версий ActiveSync не получен.` };
    }),
  ]);
  rows.push({ name: 'Отправка, вложения и изменения календаря', status: 'skipped', detail: 'Не проверялись: диагностика не создаёт, не отправляет и не изменяет объекты. Успешное чтение не подтверждает права записи.' });
  return { server: client.origin, checkedAt: new Date().toISOString(), rows };
}
module.exports = { run };

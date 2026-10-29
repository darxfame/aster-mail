const P = require('./protocol.cjs');
const calendarEvents = require('./calendar-events.cjs');
const availability = require('./availability.cjs');

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")]));
}
function loginForm(html, origin) {
  const action = attributes(html.match(/<form\b[^>]*>/i)?.[0] || '').action || '/owa/auth.owa';
  const url = new URL(action, `${origin}/owa/`);
  if (url.origin !== origin) throw new Error('Форма входа перенаправляет пароль на другой сервер. Такой вход пока не поддерживается.');
  const fields = new URLSearchParams({ destination: `${origin}/owa/`, flags: '4', forcedownlevel: '0', isUtf8: '1' });
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    if (a.type?.toLowerCase() === 'hidden' && a.name) fields.set(a.name, a.value || '');
  }
  return { url: url.href, fields };
}
class OWAClient {
  constructor(account, transport, cookieToken, clearCookies = async () => {}, imageTransport = null) {
    this.origin = P.normalizeServer(account.server, account.allowHttp === true);
    this.account = account;
    this.transport = transport;
    this.cookieToken = cookieToken;
    this.clearCookies = clearCookies;
    this.canary = null;
    this.mailCache = new (require('./mail-cache.cjs').MailCache)();
    this.imageTransport = imageTransport;
  }
  async token(html = '') {
    const cookie = await this.cookieToken();
    if (cookie) return cookie;
    return html.match(/(?:"canary"\s*:\s*"|canary\s*=\s*["'])([^"']+)/i)?.[1] || null;
  }
  async authenticate() {
    if (this.authRejected) throw new Error('Автоматический вход остановлен после отказа сервера. Подключите аккаунт заново в настройках.');
    if (this.authentication) return this.authentication;
    this.authentication = this.performAuthentication();
    try { return await this.authentication; } finally { this.authentication = null; }
  }
  async performAuthentication() {
    this.canary = null;
    await this.clearCookies();
    const page = await this.transport(`${this.origin}/owa/`, {});
    if (page.status === 401) { this.authRejected = true; throw new Error('Сервер отклонил логин или пароль. Проверьте также домен: DOMAIN\\login.'); }
    if (page.status >= 400) throw new Error(`Страница OWA недоступна (HTTP ${page.status}). Проверьте адрес и VPN.`);
    this.canary = await this.token(page.text);
    if (this.canary) return;
    const form = loginForm(page.text, this.origin);
    for (const key of ['username', 'password', 'passwd', 'passwordText']) form.fields.delete(key);
    form.fields.set('username', this.account.username);
    form.fields.set('password', this.account.password);
    form.fields.set('passwordText', '');
    const auth = await this.transport(form.url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: this.origin, Referer: `${this.origin}/owa/` },
      body: form.fields.toString(),
    });
    if (auth.status >= 400) { if ([401, 440].includes(auth.status)) this.authRejected = true; throw new Error(`Вход не выполнен (HTTP ${auth.status}). Проверьте логин, пароль и VPN.`); }
    this.canary = await this.token(auth.text);
    if (!this.canary) this.canary = await this.token((await this.transport(`${this.origin}/owa/`, {})).text);
    if (!this.canary) { this.authRejected = true; throw new Error('Сервер не выдал OWA CANARY. Возможны неверный пароль, MFA или неподдерживаемая форма входа.'); }
  }
  async call(action, payload, options) {
    try { return await this.requestJSON(action, payload, options); }
    finally { if (['UpdateItem', 'MoveItem', 'DeleteItem'].includes(action)) this.mailCache.clear(); }
  }
  async requestJSON(action, payload, { retry = true, headerBody = false } = {}) {
    if (!this.canary) await this.authenticate();
    const body = JSON.stringify(payload);
    const response = await this.transport(`${this.origin}/owa/service.svc?action=${action}&EP=1&ID=-100&AC=1`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json; charset=UTF-8', Accept: '*/*',
        'X-OWA-CANARY': this.canary, Action: action, 'X-OWA-ActionName': action,
        'X-OWA-ActionId': '-100', 'X-OWA-Attempt': '1', 'X-Requested-With': 'XMLHttpRequest',
        Origin: this.origin, Referer: `${this.origin}/owa/`,
        ...(headerBody ? { 'X-OWA-UrlPostData': encodeURIComponent(body) } : {}),
      }, body: headerBody ? undefined : body,
    });
    if ([401, 440, 449].includes(response.status)) {
      this.canary = null;
      if (retry) { await this.authenticate(); return this.call(action, payload, { retry: false, headerBody }); }
      throw new Error('Сессия истекла. Подключитесь заново; операция не повторялась.');
    }
    if (response.status >= 400) throw new Error(`OWA ${action}: HTTP ${response.status}`);
    let json;
    try { json = JSON.parse(response.text.replace(/^\uFEFF/, '')); } catch { throw new Error(`OWA ${action}: вместо JSON получена страница входа или неподдерживаемый ответ.`); }
    if (action === 'GetUserAvailabilityInternal' && availability.rows(json, payload.request.Body.MailboxDataArray.length)) return json;
    if (action === 'GetOwaUserConfiguration' && !json.Body && json.UserSessionSettings) return P.checkJSON({ Body: json });
    return P.checkJSON(json);
  }
  async ews(action, xml) {
    try { return await this.requestSOAP(action, xml); }
    finally { if (['CreateItem', 'CreateAttachment', 'SendItem', 'UpdateItem', 'MoveItem', 'DeleteItem', 'UpdateInboxRules', 'MarkAllItemsAsRead', 'CreateFolder', 'UpdateFolder', 'MoveFolder'].includes(action)) this.mailCache.clear(); }
  }
  async requestSOAP(action, xml) {
    if (!this.canary) await this.authenticate();
    // Sending is deliberately never retried: a lost reply does not mean the server did not send.
    const response = await this.transport(`${this.origin}/EWS/Exchange.asmx`, {
      method: 'POST', headers: {
        'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://schemas.microsoft.com/exchange/services/2006/messages/${action}"`,
        'X-OWA-CANARY': this.canary,
      }, body: xml,
    });
    if (response.status >= 400) throw new Error(`EWS ${action}: HTTP ${response.status}. Проверьте доступность /EWS/Exchange.asmx. Операция не повторялась.`);
    return P.parseSOAP(response.text, action);
  }
  async identity() {
    if (!this.identityPromise) this.identityPromise = (async () => {
      const valid = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
      let settings = {};
      try {
        const json = await this.call('GetOwaUserConfiguration', P.request('GetOwaUserConfiguration', {}));
        settings = P.walk(json, value => value.UserSessionSettings)[0]?.UserSessionSettings || {};
      } catch { /* A UPN login remains usable if the server restricts configuration reads. */ }
      const emails = [...new Set([settings.UserEmailAddress, settings.UserPrincipalName, this.account.username].filter(valid).map(value => value.toLowerCase()))];
      return { email: valid(settings.UserEmailAddress) ? settings.UserEmailAddress : emails[0] || '', emails };
    })();
    return this.identityPromise;
  }
  async folderOperation(data) { return require('./folder-actions.cjs').run(this, data); }
  async folders(data = {}) { return this.mailCache.get('folders', () => this.fetchFolders(), { ttl: 60000, refresh: data.refresh === true }); }
  async fetchFolders() {
    const aliases = ['inbox', 'sentitems', 'drafts', 'archive', 'deleteditems', 'junkemail'];
    const known = await Promise.allSettled(aliases.map(async alias => {
      const result = await this.call('GetFolder', P.request('GetFolder', { FolderShape: P.typed('FolderResponseShape', { BaseShape: 'AllProperties' }), FolderIds: [P.folder(alias)] }));
      const folder = P.walk(result, o => o.FolderId?.Id && typeof o.DisplayName === 'string')[0];
      return folder ? { ...folder, wellKnown: alias } : null;
    }));
    const folders = new Map();
    for (const result of known) if (result.status === 'fulfilled' && result.value) folders.set(result.value.FolderId.Id, result.value);
    let offset = 0;
    while (offset < 1000) {
      const result = await this.call('FindFolder', P.request('FindFolder', {
        FolderShape: P.typed('FolderResponseShape', { BaseShape: 'AllProperties' }),
        ParentFolderIds: [P.folder('msgfolderroot')], Traversal: 'Deep', Paging: P.paging(offset),
      }));
      const page = P.walk(result, o => o.FolderId?.Id && typeof o.DisplayName === 'string');
      for (const folder of page.filter(o => !o.FolderClass || o.FolderClass === 'IPF.Note')) folders.set(folder.FolderId.Id, { ...folder, wellKnown: folders.get(folder.FolderId.Id)?.wellKnown });
      const root = P.walk(result, o => o.RootFolder)[0]?.RootFolder;
      if (!root || root.IncludesLastItemInRange !== false || !page.length) break;
      const next = Number(root.IndexedPagingOffset);
      offset = Number.isFinite(next) && next > offset ? next : offset + 50;
    }
    return [...folders.values()].map(o => ({ id: o.FolderId.Id, changeKey: o.FolderId.ChangeKey, parentId: o.ParentFolderId?.Id || '', wellKnown: o.wellKnown || '', name: o.DisplayName, unread: o.UnreadCount || 0, total: o.TotalCount || 0 }));
  }
  async messages({ folder = 'inbox', offset = 0, filter = 'all', refresh = false }) {
    return this.mailCache.get(`list:${folder}:${offset}:${filter}`, () => this.fetchMessages({ folder, offset, filter }), { refresh });
  }
  async fetchMessages({ folder, offset, filter }) {
    const json = await this.call('FindItem', P.findItems(folder, offset, filter));
    const root = P.walk(json, o => o.RootFolder)[0]?.RootFolder;
    if (!root) throw new Error('OWA FindItem: в ответе нет списка писем');
    return { items: (root.Items || []).filter(o => o.ItemId?.Id).map(P.message), more: root.IncludesLastItemInRange === false, total: root.TotalItemsInView };
  }
  async message(ref) {
    return this.mailCache.get(`message:${ref.id}:${ref.changeKey || ''}`, () => this.fetchMessage(ref), { ttl: 300000, refresh: ref.refresh === true });
  }
  async fetchMessage(ref) {
    const json = await this.call('GetItem', P.getItems([ref]));
    const o = P.walk(json, o => o.ItemId?.Id && (o.Subject !== undefined || o.NormalizedBody || o.Body))[0];
    if (!o) throw new Error('Письмо не найдено');
    return P.message(o);
  }
  async change(data) {
    const json = await this.call('UpdateItem', P.update(data.ref, data.field, data.value), { retry: false });
    const updated = P.walk(json, o => o.ItemId?.Id)[0]?.ItemId;
    return updated ? { id: updated.Id, changeKey: updated.ChangeKey } : data.ref;
  }
  async createMailRule(data) { return require('./mail-rules.cjs').create(this, data); }
  async move(data) {
    await this.call('MoveItem', P.request('MoveItem', { ItemIds: [P.item(data.ref)], ToFolderId: P.target(data.folder) }), { retry: false });
    return true;
  }
  async outgoing(data, save) {
    const attachments = data.attachments || [];
    if (!Array.isArray(attachments) || attachments.length > 100) throw new Error('Слишком много вложений');
    let size = 0;
    for (const a of attachments) {
      if (typeof a.name !== 'string' || !a.name || a.name.length > 500 || typeof a.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content)) throw new Error('Некорректное вложение');
      if (a.inline !== undefined && typeof a.inline !== 'boolean') throw new Error('Некорректное inline-вложение');
      if (a.inline) {
        if (typeof a.contentId !== 'string' || !/^[a-zA-Z0-9@._-]{1,160}$/.test(a.contentId)) throw new Error('Некорректный Content-ID подписи');
        calendarEvents.imageData({ ContentType: a.type, Content: a.content });
      }
      size += Buffer.from(a.content, 'base64').length;
    }
    if (size > 20 * 1024 * 1024) throw new Error('Суммарный размер вложений превышает 20 МБ');
    if (!save && !P.emails(data.to).length) throw new Error('Укажите получателя');
    if (data.reference && ['reply', 'reply-all', 'forward'].includes(data.kind)) {
      const current = await this.message({ ...data.reference, refresh: true });
      if (!current.changeKey) throw new Error('Exchange не вернул ChangeKey исходного письма. Обновите письмо перед отправкой.');
      data = { ...data, reference: { id: current.id, changeKey: current.changeKey } };
    }
    const response = await this.ews('CreateItem', P.sendSOAP(data, save || attachments.length > 0));
    if (!attachments.length) return true;
    const draft = P.walk(response, o => o.ItemId?.['@_Id'])[0]?.ItemId;
    const draftID = draft?.['@_Id'];
    if (!draftID) throw new Error('Черновик создан, но сервер не вернул его ID. Проверьте папку «Черновики».');
    try {
      if (!draft['@_ChangeKey']) throw new Error('Exchange не вернул ChangeKey черновика');
      const attached = await this.ews('CreateAttachment', P.soap(`<m:CreateAttachment><m:ParentItemId Id="${P.escapeXML(draftID)}" ChangeKey="${P.escapeXML(draft['@_ChangeKey'])}"/><m:Attachments>${attachments.map(a => `<t:FileAttachment><t:Name>${P.escapeXML(a.name)}</t:Name><t:ContentType>${P.escapeXML(a.type || 'application/octet-stream')}</t:ContentType>${a.inline ? `<t:ContentId>${P.escapeXML(a.contentId)}</t:ContentId>` : ''}<t:IsInline>${a.inline === true}</t:IsInline><t:Content>${a.content}</t:Content></t:FileAttachment>`).join('')}</m:Attachments></m:CreateAttachment>`));
      const latest = P.walk(attached, o => o['@_RootItemChangeKey']).at(-1);
      if (!save && (!latest?.['@_RootItemChangeKey'] || latest['@_RootItemId'] !== draftID)) throw new Error('Exchange не вернул актуальный ChangeKey черновика после вложений');
      if (!save) await this.ews('SendItem', P.soap(`<m:SendItem SaveItemToFolder="true"><m:ItemIds><t:ItemId Id="${P.escapeXML(draftID)}" ChangeKey="${P.escapeXML(latest['@_RootItemChangeKey'])}"/></m:ItemIds><m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></m:SavedItemFolderId></m:SendItem>`));
    } catch (error) { throw new Error(`${error.message}\nЧерновик уже создан. Проверьте «Черновики» и «Отправленные» перед повторной отправкой.`); }
    return true;
  }
  async send(data) { return this.outgoing(data, false); }
  async draft(data) { return this.outgoing(data, true); }
  async search({ query, offset = 0 }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('Введите поисковый запрос');
    const scope = [P.typed('PrimaryMailboxSearchScopeType', { FolderScope: P.typed('SearchFolderScopeType', { BaseFolderId: P.folder('msgfolderroot') }) })];
    if (!offset || !this.searchSession || this.searchQuery !== query) {
      if (this.searchSession) await this.call('EndSearchSession', P.request('EndSearchSession', { SearchSessionId: this.searchSession }));
      this.searchSession = require('node:crypto').randomUUID(); this.searchQuery = query;
      await this.call('StartSearchSession', P.request('StartSearchSession', {
        SearchSessionId: this.searchSession, WarmupOptions: 16777215, SuggestionTypes: 1,
        SearchScope: scope, IdFormat: 'EwsId', ApplicationId: 'Owa',
      }));
    }
    const json = await this.call('ExecuteSearch', P.request('ExecuteSearch', {
      ApplicationId: 'Owa', SearchSessionId: this.searchSession, SearchScope: scope, Query: query.trim(),
      SearchRefiners: null, SearchRestrictions: null, IdFormat: 'EwsId', RetrieveRefiners: offset === 0,
      MaxRefinersCountPerRefinerType: 5, ItemTypes: 'MailItems', ResultRowOffset: offset,
      ResultRowCount: 50, MaxResultsCountHint: 250, MaxPreviewLength: 160, PropertySetName: 'Owa16',
      SortOrder: 'DateTime', IncludeDeleted: false, Scenario: 'MailSearch',
    }, 'V2016_06_15'));
    if (!Object.hasOwn(json.Body, 'SearchResults')) throw new Error('OWA ExecuteSearch: неподдерживаемый формат результатов');
    return { items: (json.Body.SearchResults?.Items || []).filter(o => o.ItemId?.Id).map(P.message), more: Boolean(json.Body.SearchResults?.MoreResultsAvailable) };
  }
  async calendar({ start, end }) {
    const json = await this.call('GetCalendarView', P.request('GetCalendarView', {
      CalendarId: P.target('calendar'), RangeStart: new Date(start).toISOString().slice(0, 19), RangeEnd: new Date(end).toISOString().slice(0, 19),
    }, 'V2017_08_18'), { headerBody: true });
    if (!Array.isArray(json.Body.Items)) throw new Error('OWA GetCalendarView: неподдерживаемый формат календаря');
    return json.Body.Items.filter(o => o.ItemId?.Id).map(calendarEvents.normalize);
  }

  async event(ref) {
    const json = await this.call('GetCalendarEvent', P.request('GetCalendarEvent', {
      EventIds: [P.item(ref)], ItemShape: P.typed('ItemResponseShape', { BaseShape: 'AllProperties', BodyType: 'Text', MaximumBodySize: 65536 }),
    }, 'V2017_08_18'));
    const o = P.walk(json, o => o.ItemId?.Id && o.Subject !== undefined)[0];
    if (!o) throw new Error('Встреча не найдена');
    const detail = calendarEvents.normalize(o);
    return { ...detail, ref: { id: detail.id, changeKey: detail.changeKey } };
  }
  async eventDetails(data) {
    const scope = data.scope || 'single';
    if (scope === 'series') {
      const occurrence = await this.eventDetails({ ...data, scope: 'single' });
      if (occurrence.calendarType === 'RecurringMaster') return occurrence;
      if (!occurrence.recurring) throw new Error('Эта встреча не является частью ряда');
    }
    const response = await this.ews('GetItem', calendarEvents.getSOAP(data, scope));
    const o = P.walk(response, o => o.ItemId?.['@_Id'] && o.Start !== undefined)[0];
    if (!o) throw new Error('Exchange не вернул карточку календаря');
    const detail = calendarEvents.normalize(o);
    if (!detail.changeKey) throw new Error('Exchange не вернул версию встречи');
    return { ...detail, ref: { id: detail.id, changeKey: detail.changeKey } };
  }
  async updateEvent(data) {
    const current = await this.eventDetails({ ...data.ref, scope: data.scope || 'single' });
    if (!data.expectedChangeKey || current.changeKey !== data.expectedChangeKey) throw new Error('Встреча изменилась на сервере. Откройте карточку заново перед сохранением.');
    await this.ews('UpdateItem', calendarEvents.updateSOAP(current, data.changes));
    return true;
  }
  async eventMessage(data) {
    const current = await this.eventDetails({ ...data.ref, scope: data.scope || 'single' });
    await this.ews('CreateItem', calendarEvents.messageSOAP(current, data));
    return true;
  }
  async eventImage(data) {
    const current = await this.eventDetails(data.ref);
    const attachment = current.attachments.find(a => a.id === data.id);
    if (!attachment || attachment.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.type)) throw new Error('Недоступное изображение');
    const response = await this.ews('GetAttachment', P.soap(`<m:GetAttachment><m:AttachmentIds><t:AttachmentId Id="${P.escapeXML(data.id)}"/></m:AttachmentIds></m:GetAttachment>`));
    const image = P.walk(response, o => o.Content !== undefined && o.ContentType !== undefined)[0];
    if (!image) throw new Error('Exchange не вернул изображение');
    return calendarEvents.imageData(image);
  }
  async contentImages(data) {
    if (!['message', 'event'].includes(data.kind)) throw new Error('Некорректный тип содержимого');
    const current = data.kind === 'event' ? await this.eventDetails(data.ref) : await this.message(data.ref);
    return require('./content-images.cjs').load(current, async id => {
      const response = await this.ews('GetAttachment', P.soap(`<m:GetAttachment><m:AttachmentIds><t:AttachmentId Id="${P.escapeXML(id)}"/></m:AttachmentIds></m:GetAttachment>`));
      const image = P.walk(response, o => o.Content !== undefined && o.ContentType !== undefined)[0];
      if (!image) throw new Error('Exchange не вернул изображение');
      return image;
    }, this.imageTransport);
  }

  async createEvent(data) { await this.ews('CreateItem', P.eventSOAP(data)); return true; }
  async respond(data) {
    if (!['AcceptItem', 'TentativelyAcceptItem', 'DeclineItem'].includes(data.response)) throw new Error('Invalid RSVP');
    const current = data.scope === 'series' ? await this.eventDetails({ ...data.ref, scope: 'series' }) : await this.event(data.ref);
    if (current.isOrganizer === true) throw new Error('Организатор не отвечает на собственное приглашение');
    if (current.cancelled) return { status: 'cancelled' };
    const latest = current.ref;
    const ref = `<t:ReferenceItemId Id="${P.escapeXML(latest.id)}"${latest.changeKey ? ` ChangeKey="${P.escapeXML(latest.changeKey)}"` : ''}/>`;
    try {
      await this.ews('CreateItem', P.soap(`<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:${data.response}>${ref}</t:${data.response}></m:Items></m:CreateItem>`));
    } catch (error) {
      // Cancellation can race the read above; do not retry or pretend a response was sent.
      if (['ErrorCalendarIsCancelledForAccept', 'ErrorCalendarIsCancelledForDecline', 'ErrorCalendarIsCancelledForTentative'].includes(error.code)) return { status: 'cancelled' };
      throw error;
    }
    return { status: 'sent' };
  }
  async availability(data) {
    const request = availability.query(data);
    const response = await this.call('GetUserAvailabilityInternal', request.payload, { headerBody: true });
    return availability.normalize(response, request);
  }
  async contacts({ query = '', offset = 0 }) {
    if (query.trim()) return require('./directory.cjs').search(this, query);
    const json = await this.call('FindItem', P.request('FindItem', {
      ParentFolderIds: [P.folder('contacts')], Traversal: 'Shallow', Paging: P.paging(offset),
      ItemShape: P.typed('ItemResponseShape', { BaseShape: 'AllProperties' }),
    }));
    const root = P.walk(json, o => o.RootFolder)[0]?.RootFolder;
    if (!root) throw new Error('OWA FindItem: в ответе нет контактов');
    return { items: (root.Items || []).map(o => ({
      id: o.ItemId?.Id, name: o.DisplayName || o.Subject || '',
      email: o.EmailAddresses?.[0]?.Value || o.EmailAddresses?.[0]?.EmailAddress || '',
      company: o.CompanyName || '', phone: o.PhoneNumbers?.[0]?.Value || '',
    })), more: root.IncludesLastItemInRange === false };
  }
  async createContact(data) {
    const email = P.emails(data.email)[0];
    if (!data.name?.trim() || !email) throw new Error('Укажите имя и email');
    await this.ews('CreateItem', P.soap(`<m:CreateItem><m:SavedItemFolderId><t:DistinguishedFolderId Id="contacts"/></m:SavedItemFolderId><m:Items><t:Contact><t:DisplayName>${P.escapeXML(data.name)}</t:DisplayName><t:GivenName>${P.escapeXML(data.name)}</t:GivenName><t:CompanyName>${P.escapeXML(data.company)}</t:CompanyName><t:EmailAddresses><t:Entry Key="EmailAddress1">${P.escapeXML(email)}</t:Entry></t:EmailAddresses>${data.phone ? `<t:PhoneNumbers><t:Entry Key="BusinessPhone">${P.escapeXML(data.phone)}</t:Entry></t:PhoneNumbers>` : ''}</t:Contact></m:Items></m:CreateItem>`));
    return true;
  }
  async personPhoto({ email }) {
    if (P.emails(email).length !== 1) throw new Error('Укажите один адрес');
    this.photoCache ||= new Map();
    const key = email.toLowerCase(), saved = this.photoCache.get(key);
    if (saved && saved.expires > Date.now()) return saved.image;
    let image = null;
    try {
      const result = await this.ews('GetUserPhoto', P.soap(`<m:GetUserPhoto><m:Email>${P.escapeXML(email)}</m:Email><m:SizeRequested>HR64x64</m:SizeRequested></m:GetUserPhoto>`));
      const photo = P.walk(result, value => value.PictureData)[0];
      if (photo) {
        const bytes = Buffer.from(photo.PictureData, 'base64');
        const type = photo.ContentType || (bytes[0] === 137 ? 'image/png' : bytes[0] === 255 ? 'image/jpeg' : bytes.toString('ascii', 0, 3) === 'GIF' ? 'image/gif' : 'image/webp');
        image = calendarEvents.imageData({ ContentType: type, Content: photo.PictureData });
      }
    } catch { /* A missing/private photo keeps initials; do not fail the meeting. */ }
    if (this.photoCache.size >= 128) this.photoCache.delete(this.photoCache.keys().next().value);
    this.photoCache.set(key, { image, expires: Date.now() + 30 * 60000 });
    return image;
  }
  async signature() {
    const configuration = await this.ews('GetUserConfiguration', P.soap('<m:GetUserConfiguration><m:UserConfigurationName Name="OWA.UserOptions"><t:DistinguishedFolderId Id="root"/></m:UserConfigurationName><m:UserConfigurationProperties>Dictionary</m:UserConfigurationProperties></m:GetUserConfiguration>'));
    const signature = P.signatureFromConfiguration(configuration);
    signature.html = signature.html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']*)\2/gi, (all, prefix, quote, src) => {
      if (!src.startsWith('/') || src.startsWith('//')) return all;
      return `${prefix}${quote}${this.origin}${src}${quote}`;
    });
    const loaded = await require('./content-images.cjs').load({ html: signature.html, attachments: [] }, null, async src => {
      const url = new URL(src);
      if (url.origin === this.origin && url.pathname.startsWith('/owa/')) {
        const response = await this.transport(url.href, { binary: true });
        if (response.status >= 400) throw new Error('Изображение подписи недоступно');
        const buffer = response.buffer;
        const type = buffer?.[0] === 137 ? 'image/png' : buffer?.[0] === 255 ? 'image/jpeg' : buffer?.toString('ascii', 0, 3) === 'GIF' ? 'image/gif' : 'image/webp';
        return { ContentType: type, Content: buffer.toString('base64') };
      }
      if (!this.imageTransport) throw new Error('Внешние изображения недоступны');
      return this.imageTransport(src);
    });
    return { ...signature, ...loaded };
  }
  async attachment(id) {
    const url = new URL(`${this.origin}/owa/service.svc/s/GetFileAttachment`);
    url.searchParams.set('id', id); url.searchParams.set('X-OWA-CANARY', this.canary);
    const response = await this.transport(url.href, { binary: true });
    if (response.status >= 400) throw new Error(`Вложение: HTTP ${response.status}`);
    return response.buffer;
  }
}
module.exports = { OWAClient, loginForm };

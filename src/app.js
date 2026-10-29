/* global DOMPurify */
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const initials = name => (name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
const avatar = (name, tone = 0, email = '') => `<div class="avatar tone-${tone % 5}" ${email ? `data-person-email="${esc(email)}"` : ''}>${esc(initials(name))}</div>`;
// Discard legacy plaintext preferences instead of importing unscoped corporate data.
for (const key of Object.keys(window.localStorage)) if (key.startsWith('aster-') && key !== 'aster-language') window.localStorage.removeItem(key);
let localValues = {}, localSave = Promise.resolve();
const localPreferences = {
  getItem: key => localValues[key] ?? null,
  setItem(key, value) {
    localValues[key] = String(value);
    if (!state.account || state.demo) return;
    localSave = api('saveLocalData', { values: { ...localValues } });
    localSave.catch(showError);
  },
};
const T = window.asterTime;
let timeZone = localPreferences.getItem('aster-time-zone') || 'system';
try { T.zone(timeZone); } catch { timeZone = 'system'; }
const dateFormat = (value, options) => value && Number.isFinite(new Date(value).getTime()) ? T.format(value, options, timeZone) : '';
const time = value => dateFormat(value, { hour: '2-digit', minute: '2-digit' });
const dayKey = value => T.wall(value, timeZone).slice(0, 10);
const civil = value => T.civil(value, timeZone);
const addDays = (value, days) => T.add(value, { days }, timeZone);
const calendarDate = value => T.fromWall(`${value}T00:00`, timeZone, false);
const bytes = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} ${tr("МБ")}` : `${Math.max(1, Math.round(n / 1024))} ${tr("КБ")}`;
const ref = value => ({ id: value.id, changeKey: value.changeKey });
const systemFolderNames = [
  ['inbox', 'Входящие', 'inbox'], ['sentitems', 'Отправленные', 'send'], ['drafts', 'Черновики', 'file'],
  ['archive', 'Архив', 'archive'], ['deleteditems', 'Корзина', 'trash'], ['junkemail', 'Нежелательная почта', 'shield'],
];
const systemFolders = systemFolderNames.map(([id, name, symbol]) => [id, tr(name), symbol]);
function applyLanguage(value) {
  window.asterI18n.setLanguage(value);
  try { localStorage.setItem('aster-language', window.asterI18n.language); } catch { /* Storage may be disabled. */ }
  systemFolders.forEach((folder, index) => { folder[1] = tr(systemFolderNames[index][1]); });
}

const state = { demo: false, account: null, view: 'mail', folder: 'inbox', folders: [], messages: [], selected: null, filter: 'all', query: '', more: false, offset: 0, week: new Date(), events: [], contacts: [], generation: 0, signature: localPreferences.getItem('aster-signature') || '', theme: localPreferences.getItem('aster-theme') || 'light' };
let toastTimer, composeData, modalBusy = false;
let messageOpenSequence = 0;
let composeSequence = 0, modalSequence = 0;
const readingMessages = new Map();
let calendarPreference = localPreferences.getItem('aster-calendar-view') || 'auto';
let renderedCalendarMode;
let navigationPlacement = localPreferences.getItem('aster-navigation-placement') === 'bottom' ? 'bottom' : 'sidebar';
const calendarMode = () => window.asterCalendar.mode(calendarPreference, $('#workspace').clientWidth);
const calendarRange = () => window.asterCalendar.range(state.week, calendarMode(), timeZone);
let syncSignature = localPreferences.getItem('aster-signature-sync') === 'true';
let serverSignature = null;
let sidebarCollapsed = localPreferences.getItem('aster-sidebar-collapsed') === 'true';
document.body.classList.toggle('desktop', Boolean(window.aster));
async function getServerSignature() {
  const signatureAccount = state.account;
  const value = state.demo ? { html: tr('<p>С уважением,<br><b>Команда Aster</b></p>'), text: tr('С уважением,\nКоманда Aster'), autoAddSignature: true, autoAddSignatureOnReply: true } : await api('signature');
  if (state.account !== signatureAccount) throw new Error(tr('Сессия аккаунта завершена'));
  if (state.demo) { value.html += '<img src="cid:demo-logo" alt="Aster" width="48" height="48">'; value.images = (await demoContentImages(value.html)).images; }
  const signatureDoc = new DOMParser().parseFromString(value.html || '', 'text/html');
  signatureDoc.querySelectorAll('img').forEach(img => { const src = img.getAttribute('src'); if (value.images?.[src]) img.setAttribute('src', value.images[src]); else { img.removeAttribute('src'); img.alt = tr('Изображение подписи недоступно'); } });
  const html = DOMPurify.sanitize(signatureDoc.body.innerHTML, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'svg', 'math'] });
  let text = value.text || '';
  if (!text && html) {
    const document = new DOMParser().parseFromString(DOMPurify.sanitize(html, { FORBID_TAGS: ['img'] }), 'text/html');
    document.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    document.querySelectorAll('p,div,tr,li').forEach(el => el.append('\n'));
    text = document.body.textContent.trim();
  }
  serverSignature = { ...value, html, text, images: Object.fromEntries(Object.values(value.images || {}).map(src => [src, src])) };
  return serverSignature;
}
async function refreshSignatureField() {
  const form = $('#settings-form'); if (!form) return;
  const input = form.elements.signature, checkbox = form.elements.syncSignature, status = $('#signature-status');
  input.readOnly = checkbox.checked;
  if (!checkbox.checked) { input.value = state.signature; status.textContent = tr('Используется локальная подпись.'); $('#signature-preview')?.replaceChildren(); return; }
  status.textContent = tr('Загружаем подпись из OWA…');
  try {
    const signature = await getServerSignature();
    if (!$('#settings-form') || !checkbox.checked) return;
    input.value = signature.text;
    renderSignaturePreview($('#signature-preview'), signature);
    status.textContent = signature.text || signature.html ? tr('Подпись загружена из OWA. Форматирование сохранится при отправке; настройки OWA для новых писем и ответов учитываются.') : tr('На сервере сохранена пустая подпись.');
  } catch (error) {
    checkbox.checked = false; input.readOnly = false; input.value = state.signature;
    status.textContent = `${tr("Не удалось получить подпись:")} ${error.message}`;
  }
}
let notificationPreferences = { mail: true, meetings: true, sounds: true, minutes: 15, preview: false };
function playSound(kind) {
  if (!['mail', 'meeting'].includes(kind)) return;
  const audio = new Audio(`../assets/sounds/aster-${kind}.wav`);
  audio.volume = 0.65;
  audio.play().catch(() => toast(tr('Звук заблокирован системой. Проверьте настройки звука и уведомлений.')));
}
document.body.classList.toggle('dark', state.theme === 'dark');
let connectionState = { status: 'disconnected' };
let mailWrites = 0, mailWriteEpoch = 0;
async function api(operation, data = {}) {
  if (!window.aster) throw new Error(tr('Подключение OWA доступно в настольном приложении. В браузере можно открыть деморежим.'));
  const writing = ['change','move','mailBatch','folderOperation','send','draft','createMailRule','connect','disconnect'].includes(operation) || operation === 'editDraft' && data.action !== 'read';
  if (writing) { mailWrites++; mailWriteEpoch++; }
  try {
    const sessionId = state.account?.sessionId;
    const result = await window.aster.invoke(operation, { ...data, sessionId });
    if (!['connect', 'restore', 'disconnect'].includes(operation) && sessionId !== state.account?.sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    if (!result.ok) throw Object.assign(new Error(result.error), { connectionError: result.connectionError === true });
    return result.value;
  } finally { if (writing) mailWrites--; }

}
let pendingMailAlerts = [];
function renderMailAlerts(alerts) {
  pendingMailAlerts = alerts;
  let panel = $('#mail-alerts');
  if (!panel) { panel = document.createElement('section'); panel.id = 'mail-alerts'; panel.className = 'mail-alerts'; panel.setAttribute('aria-label', tr('Новые письма')); document.body.append(panel); }
  panel.hidden = !alerts.length;
  panel.innerHTML = alerts.map(alert => `<article class="mail-alert"><div class="mail-alert-heading">${icon('mail')}<span>${tr("Новое письмо")}</span><button type="button" data-dismiss="${esc(alert.id)}" aria-label="${tr("Закрыть уведомление")}">×</button></div><button type="button" class="mail-alert-open" data-open="${esc(alert.id)}"><strong>${esc(alert.title)}</strong><span>${esc(alert.body)}</span><small>${tr("Открыть письмо ↗")}</small></button></article>`).join('');
  panel.onclick = async event => {
    const button = event.target.closest('button'); if (!button) return;
    const id = button.dataset.open || button.dataset.dismiss;
    try {
      if (button.dataset.open) {
        if (id === 'test-mail') { toast(tr('Это тестовое письмо')); }
        else {
          if ($('#modal').open) { toast(tr('Сначала завершите работу с открытым окном')); return; }
          state.view = 'mail'; state.folder = 'inbox'; state.filter = 'all'; state.query = ''; $('#search').value = '';
          await loadView();
          if (!state.messages.some(message => message.id === id)) state.messages.push(await api('message', { id }));
          await openMessage(id);
        }
      }
      if (window.aster) await api('dismissMailAlert', { id });
      else renderMailAlerts(pendingMailAlerts.filter(alert => alert.id !== id));
    } catch (error) { showError(error); }
  };
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function showError(error) {
  if (error.connectionError && state.account) {
    if (connectionState.status !== 'auth-required') connectionState.status = 'reconnecting';
    renderConnection(); return;
  }
  $('#error').textContent = error.message || error; $('#error').hidden = false; $('#status').textContent = tr('Не удалось завершить операцию');
}
function clearError() { $('#error').hidden = true; }
function renderConnection() {
  const node = $('#connection'); if (!node) return;
  const status = state.demo ? 'demo' : state.account ? connectionState.status : 'disconnected';
  const labels = { connected: 'Exchange · HTTPS', reconnecting: tr('Восстанавливаем связь'), 'auth-required': tr('Нужно войти'), disconnected: tr('Не подключено'), demo: tr('Деморежим') };
  const titles = { connected: tr('Соединение с OWA работает'), reconnecting: tr('Связь с OWA прервана. Проверяем автоматически каждые 15 секунд.'), 'auth-required': tr('Сервер отклонил авторизацию. Нажмите, чтобы подключить аккаунт заново.'), disconnected: tr('Подключить Exchange'), demo: tr('Вымышленные данные') };
  node.dataset.state = status; node.dataset.action = 'connection';
  node.innerHTML = `<i></i><span>${labels[status] || labels.disconnected}</span>`;
  node.title = titles[status] || titles.disconnected; node.setAttribute('aria-label', node.title);
}
function resumeConnectionReads() {
  if (connectionState.status !== 'connected' || $('#modal')?.open) return;
  if (state.recoverView === state.generation) {
    state.recoverView = null; state.recoverMessage = null; void loadView();
  } else if (state.recoverMessage?.generation === state.generation && state.selected?.id === state.recoverMessage.id) {
    const { id, generation } = state.recoverMessage; state.recoverMessage = null;
    // Recover the read only; never repeat a possibly accepted mark-read mutation.
    void openMessage(id, generation, { markRead: false });
  }
}
function receiveConnection(snapshot) {
  if (state.demo || !state.account?.sessionId || snapshot.sessionId !== state.account.sessionId || !['connected', 'reconnecting', 'auth-required'].includes(snapshot.status)) return;
  connectionState = snapshot; renderConnection();
  if (snapshot.status === 'connected') resumeConnectionReads();
}
function modal(title, description, body) {
  if (modalBusy) return;
  modalSequence++;
  $('#modal').setAttribute('aria-label', title);
  $('#modal').ondragover = null; $('#modal').ondragleave = null; $('#modal').ondrop = null;
  $('#modal').classList.remove('compose-file-drop');
  delete $('#modal').dataset.eventId;
  delete $('#modal').dataset.meetingCard;
  $('#modal').classList.remove('meeting-dialog', 'meeting-edit-dialog', 'compose-dialog', 'compose-expanded', 'settings-dialog');
  $('#modal').style.width = ''; $('#modal').style.height = '';
  $('#modal-content').innerHTML = `<div class="modal-header"><div><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="${tr("Закрыть")}">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if (!$('#modal').open) $('#modal').showModal();
}
function field(name, label, value = '', type = 'text', required = false) {
  return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
}
function textField(name, label, value = '', cls = '') { return `<label class="field"><span>${esc(label)}</span><textarea name="${name}" class="${cls}">${esc(value)}</textarea></label>`; }
function formError() { return '<div class="form-error" role="alert"></div>'; }
function ready() { return state.demo || state.account; }
function renderSidebar() {
  const restoreFocus = preserveListFocus($('#sidebar'));
  const dock = $('.bottom-dock');
  $('.statusbar').prepend(dock);
  const isMail = state.view === 'mail';
  const folderButtons = renderFolderTree();
  $('#sidebar').innerHTML = `<div class="wordmark"><span class="brand-star" aria-hidden="true">✳</span><span class="brand-text">aster<span> mail</span></span></div><button class="primary sidebar-compose" data-action="${state.view === 'calendar' ? 'new-event' : 'compose'}" aria-label="${state.view === 'calendar' ? tr('Создать встречу') : tr('Написать письмо')}" title="${state.view === 'calendar' ? tr('Создать встречу') : tr('Написать письмо')}">${icon('plus')}<span>${state.view === 'calendar' ? tr('Новая встреча') : tr('Написать письмо')}</span></button>
    <div class="sidebar-scroll">${state.view === 'calendar' ? miniMonthHTML() : `<div class="nav-caption">${tr("Почта")}</div><nav class="folder-list folder-tree" aria-label="${tr("Папки почты")}">${folderButtons}</nav>`}
    </div><div id="sidebar-dock"></div><button class="account-card" data-action="settings" title="${tr("Настройки аккаунта")}" aria-label="${tr("Настройки аккаунта")}"><div class="account-avatar">${esc(initials(state.account?.username || 'Aster'))}</div><div class="account-info"><strong>${esc(state.account?.username || (state.demo ? tr('Демоаккаунт') : tr('Ваш аккаунт')))}</strong><small>${state.account ? esc(new URL(state.account.server).hostname) : state.demo ? tr('Вымышленные данные') : tr('Подключить Exchange')}</small></div></button>`;
  document.body.classList.toggle('navigation-sidebar', navigationPlacement === 'sidebar');
  if (navigationPlacement === 'sidebar') $('#sidebar-dock').append(dock);
  document.querySelectorAll('.view-tab[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === state.view);
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  });
  const hidden = sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', hidden);
  const toggle = $('#sidebar-toggle');
  toggle.setAttribute('aria-expanded', String(!hidden));
  toggle.setAttribute('aria-label', hidden ? tr('Раскрыть меню папок') : tr('Свернуть меню папок'));
  toggle.title = hidden ? tr('Раскрыть меню папок') : tr('Свернуть меню папок');
  $('#sidebar-resize').setAttribute('aria-valuenow', hidden ? '0' : '1');
  const create = $('#quick-create');
  create.dataset.action = { mail: 'compose', calendar: 'new-event', contacts: 'new-contact' }[state.view];
  create.innerHTML = `${icon('plus')}<span>${{ mail: tr('Написать'), calendar: tr('Встреча'), contacts: tr('Контакт') }[state.view]}</span>`;
  create.setAttribute('aria-label', { mail: tr('Написать'), calendar: tr('Создать встречу'), contacts: tr('Новый контакт') }[state.view]);
  document.body.classList.toggle('mail-view', isMail);
  $('#search').placeholder = { mail: tr('Поиск: письма, календарь, контакты'), calendar: tr('Поиск по календарю'), contacts: tr('Поиск людей в Exchange') }[state.view];
  renderConnection();
  $('#demo-banner').hidden = !state.demo;
  restoreFocus();
}
function welcome() {
  $('#workspace').innerHTML = `<div class="welcome"><div class="hero-symbol">✳</div><div class="eyebrow">${tr("Пространство для важного")}</div><h1>${tr("Меньше шума.")}<br>${tr("Больше ясности.")}</h1><p>${tr("Почта, встречи и люди — в одном спокойном рабочем пространстве. Подключите корпоративный Exchange и начните свой день с Aster.")}</p><div class="welcome-actions"><button class="primary" data-action="connect">${icon('plus')}${tr("Подключить OWA")}</button><button class="secondary" data-action="demo">${tr("Посмотреть демо")} ${icon('chevron')}</button></div><div class="welcome-foot">${icon('shield')}${tr("Прямое подключение к вашему серверу · Без облака Aster")}</div></div>`;
}
async function loadView(append = false) {
  renderSidebar(); clearError();
  const generation = ++state.generation;
  if (!ready()) return welcome();
  state.mailLoading = state.view === 'mail' ? generation : 0;
  const keepMail = state.view === 'mail' && state.mailViewKey === JSON.stringify([state.folder, state.query, state.filter]) && Boolean($('#messages'));
  if (!append && !keepMail) $('#workspace').innerHTML = `<div class="loading">${icon('refresh')}${tr("Загружаем")} ${state.view === 'mail' ? tr('почту') : state.view === 'calendar' ? tr('календарь') : tr('контакты')}…</div>`;
  $('#status').textContent = tr('Обновление…');
  try {
    if (state.view === 'mail') {
      const offset = append ? state.offset : 0;
      let result;
      if (state.demo) {
        result = state.query ? demoMailSearch(state.query) : { items: structuredClone(window.asterDemo.messages.filter(message => message.folder === state.folder)), more: false };
      } else result = state.query ? await searchMailbox(state.query, state.filter, offset) : await api('messages', { folder: state.folder, filter: state.filter, offset });
      if (generation !== state.generation) return;
      if (state.filter !== 'all' && result.related) result.related = result.related.mail?.error ? { mail: result.related.mail } : null;
      state.messages = append ? [...state.messages, ...result.items] : result.items; state.more = result.more; state.offset = (append ? state.offset : 0) + result.items.length;
      if (!append) { state.selected = null; state.searchObjects = state.query ? result.related : null; }
      state.mailViewKey = JSON.stringify([state.folder, state.query, state.filter]);
      renderMail();
      if (!state.demo && !state.query && !append) void refreshMailFolders(generation);
    } else if (state.view === 'calendar') {
      const requestedMode = calendarMode();
      const { start, end } = window.asterCalendar.range(state.week, requestedMode, timeZone);
      const events = state.demo ? structuredClone(window.asterDemo.events).filter(e => new Date(e.start) < end && new Date(e.end) > start) : await api('calendar', { start: start.toISOString(), end: end.toISOString() });
      if (generation !== state.generation) return;
      if (requestedMode !== calendarMode()) return loadView();
      state.events = events; renderCalendar();
    } else {
      const result = state.demo ? { items: structuredClone(state.query ? window.asterDemo.directory : window.asterDemo.contacts).filter(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(state.query.toLowerCase())), more: false } : await api('contacts', { query: state.query, offset: append ? state.contacts.length : 0 });
      if (generation !== state.generation) return;
      state.contacts = append ? [...state.contacts, ...result.items] : result.items; state.more = result.more; renderContacts(); void refreshColleagues();
    }
    if (generation === state.generation) $('#status').textContent = state.demo ? tr('Демо · изменения сохраняются только до перезапуска') : `${tr("Обновлено")} ${time(new Date())} ${tr("· Прямое подключение к Exchange")}`;
  } catch (error) {
    if (generation !== state.generation) return;
    showError(error);
    if (error.connectionError) {
      state.recoverView = generation;
      if (!append && !keepMail) $('#workspace').innerHTML = tr('<div class="loading">Ожидаем соединения с OWA…</div>');
      return;
    }
    if (!append && !keepMail) $('#workspace').innerHTML = `<div class="empty">${icon('globe')}<h2>${tr("Не удалось загрузить данные")}</h2><p>${tr("Проверьте подключение и повторите запрос. Письма на сервере не затронуты.")}</p><button class="secondary" data-action="refresh">${icon('refresh')}${tr("Повторить")}</button></div>`;
  } finally { if (state.mailLoading === generation) state.mailLoading = 0; }
}
function filteredMessages() { return state.messages.filter(m => state.filter === 'all' || (state.filter === 'unread' ? !m.read : m.flagged)); }
function renderMail() {
  if (state.view !== 'mail') return;
  document.body.classList.toggle('reader-open', Boolean(state.selected));
  const title = state.query ? `${tr("Результаты поиска")}` : systemFolders.find(f => f[0] === state.folder)?.[1] || (state.demo ? window.asterDemo.folders : state.folders).find(f => f.id === state.folder)?.name || tr('Письма');
  $('#workspace').innerHTML = `<div class="mail-list"><div class="list-heading"><div><h1>${esc(title)}</h1><small>${state.query ? esc(`«${state.query}${tr("» · весь ящик")}`) : tr('Всё важное — на своём месте')}</small></div><span class="muted" id="mail-count">${filteredMessages().length}${state.more ? '+' : ''}</span></div><div class="list-filters">${[['all', state.query ? tr('Все объекты') : tr('Все письма')], ['unread', tr('Непрочитанные')], ['flagged', tr('Избранное')]].map(([id, text]) => `<button class="${state.filter === id ? 'active' : ''}" data-action="filter" data-filter="${id}">${text}</button>`).join('')}</div><div id="mail-batch-toolbar"></div><div class="messages" id="messages"></div>${state.more ? tr('<button class="secondary load-more" data-action="more">Загрузить ещё</button>') : ''}</div><article class="reader" id="reader"></article>`;
  renderMessages();
  if (state.selected) renderReader(); else $('#reader').innerHTML = `<div class="empty">${icon('mail')}<h2>${tr("Место для ваших мыслей")}</h2><p>${tr("Выберите письмо, чтобы прочитать его, или напишите новое.")}</p></div>`;
}
function renderMessages() {
  if (state.view !== 'mail' || !$('#messages')) return;
  const restoreFocus = preserveListFocus($('#messages'));
  let previousDay = '';
  const items = filteredMessages();
  syncMailSelection(items);
  if ($('#mail-count')) $('#mail-count').textContent = `${items.length}${state.more ? '+' : ''}`;
  if (state.query && state.searchObjects) $('#messages').querySelectorAll('[data-search-kind]').forEach(element => {
    if (state.searchObjects[element.dataset.searchKind]) state.searchObjects[element.dataset.searchKind].expanded = element.open;
  });
  const related = renderSearchObjects();
  $('#messages').innerHTML = related + (state.query ? tr('<h3 class="search-mail-heading">Письма</h3>') : '') + (items.map((m, i) => {
    const key = dayKey(m.date), label = key === dayKey(new Date()) ? tr('Сегодня') : dateFormat(m.date, { day: 'numeric', month: 'long' });
    const heading = key !== previousDay ? `<div class="day-label">${esc(label)}</div>` : ''; previousDay = key;
    return `${heading}<div class="message-row ${!m.read ? 'unread' : ''} ${state.selected?.id === m.id ? 'selected' : ''}" data-id="${esc(m.id)}"><input class="mail-select" type="checkbox" data-mail-select="${esc(m.id)}" aria-label="${tr("Выбрать письмо:")} ${esc(m.subject)}" ${mailSelection.has(m.id) ? 'checked' : ''} ${mailBatchBusy ? 'disabled' : ''}><button draggable="false" class="message-open" data-action="message" data-id="${esc(m.id)}" aria-label="${esc(`${m.read ? tr('Прочитано') : tr('Непрочитано')}. ${m.from.name || m.from.email}: ${m.subject}`)}">${!m.read ? '<i class="unread-dot"></i>' : ''}${avatar(m.from.name || m.from.email, i, m.from.email)}<div class="message-copy"><div class="row-top"><span class="sender">${esc(m.from.name || m.from.email || tr('Неизвестный отправитель'))}</span><time class="date">${esc(time(m.date))}</time></div><div class="subject">${!m.read ? tr('<span class="unread-badge">Новое</span>') : ''}${esc(m.subject)}</div><div class="preview">${esc(m.preview || m.text || '')}</div>${m.hasAttachments || m.flagged || m.meeting ? `<div class="message-meta">${m.hasAttachments ? icon('clip') : ''}${m.flagged ? `<span class="starred">${icon('star')}</span>` : ''}${m.meeting ? tr('<span class="tag">Приглашение</span>') : ''}</div>` : ''}</div></button><div class="message-quick-actions"><button class="icon-button ${m.flagged ? 'starred' : ''}" data-action="mail-star" data-id="${esc(m.id)}" aria-label="${m.flagged ? tr('Убрать из избранного') : tr('В избранное')}" aria-pressed="${Boolean(m.flagged)}">${icon('star')}</button><button class="icon-button ${m.importance === 'High' ? 'important' : ''}" data-action="mail-important" data-id="${esc(m.id)}" aria-label="${m.importance === 'High' ? tr('Обычная важность') : tr('Пометить важным')}" aria-pressed="${m.importance === 'High'}">${icon('important')}</button></div></div>`;
  }).join('') || `<div class="empty"><p>${state.filter === 'unread' ? tr('Непрочитанных писем нет') : state.filter === 'flagged' ? tr('Избранных писем нет') : tr('Здесь пока нет писем')}</p></div>`);
  restoreFocus();
  renderMailBatchToolbar();
}
function applyMessageRead(message, read, folderKey) {
  const summary = state.messages.find(item => item.id === message.id);
  const before = summary?.read ?? message.read;
  message.read = read;
  if (before !== read && summary && state.filter === 'unread') state.offset = Math.max(0, state.offset + (read ? -1 : 1));
  if (summary) Object.assign(summary, { read, changeKey: message.changeKey });
  if (state.selected?.id === message.id) Object.assign(state.selected, { read, changeKey: message.changeKey });
  if (state.demo) { const demo = window.asterDemo.messages.find(item => item.id === message.id); if (demo) demo.read = read; }
  if (before !== read && !state.demo) {
    const folder = state.folders.find(folder => message.parentId ? folder.id === message.parentId : folder.id === folderKey || folder.wellKnown === folderKey);
    if (folder) folder.unread = Math.max(0, (folder.unread || 0) + (read ? -1 : 1));
  }
}
async function markMessageRead(message, folderKey) {
  if (readingMessages.has(message.id)) return readingMessages.get(message.id);
  if (folderKey === 'drafts') return;
  if (message.read) { applyMessageRead(message, true, folderKey); return; }
  const pending = (async () => {
    if (!state.demo) {
      const updated = await api('change', { ref: ref(message), field: 'IsRead', value: true });
      message.changeKey = updated.changeKey || message.changeKey;
    }
    applyMessageRead(message, true, folderKey);
  })();
  readingMessages.set(message.id, pending);
  try { await pending; } finally { readingMessages.delete(message.id); }
}
async function openMessage(id, generation = state.generation, { markRead = true } = {}) {
  const summary = state.messages.find(m => m.id === id);
  if (!summary) return;
  const sequence = ++messageOpenSequence, folderKey = state.query ? null : state.folder;
  state.selected = summary; document.body.classList.add('reader-open'); renderMessages();
  $('#reader').innerHTML = `<div class="loading">${icon('refresh')}${tr("Открываем письмо…")}</div>`;
  try {
    const detail = state.demo ? structuredClone(summary) : await api('message', ref(summary));
    if (generation !== state.generation || sequence !== messageOpenSequence) return;
    state.recoverMessage = null;
    const selected = { ...summary, ...detail };
    state.selected = selected;
    const marking = !markRead || isDraftMessage(selected) ? Promise.resolve() : markMessageRead(selected, folderKey);
    renderReader();
    try { await marking; }
    catch (error) { showError(Object.assign(new Error(`${tr("Письмо открыто, но не удалось отметить его прочитанным:")} ${error.message}`), { connectionError: error.connectionError === true })); }
    if (generation !== state.generation || sequence !== messageOpenSequence) return;
    renderMessages(); renderSidebar(); renderReader();
    if (selected.meeting?.id && !selected.meeting.cancelled) {
      try {
        const meeting = state.demo ? window.asterDemo.events.find(e => e.id === selected.meeting.id) : await api('event', ref(selected.meeting));
        if (meeting) Object.assign(selected.meeting, { ...meeting, statusLoaded: true });
      } catch (error) { selected.meeting.statusError = error.message; }
      if (state.selected === selected && generation === state.generation) renderReader();
    }
  } catch (error) {
    if (generation !== state.generation || sequence !== messageOpenSequence) return;
    showError(error);
    if (error.connectionError) { state.recoverMessage = { id, generation }; $('#reader').innerHTML = `<div class="loading">${tr("Ожидаем соединения с OWA…")}</div>`; return; }
    $('#reader').innerHTML = `<div class="empty-state"><h2>${tr("Не удалось открыть письмо")}</h2><p>${esc(error.message)}</p><button class="secondary" data-action="retry-message" data-id="${esc(id)}">${tr("Повторить загрузку")}</button></div>`;
  }
}
function isDraftMessage(message) {
  return message?.isDraft === true || message?.folder === 'drafts' || state.folder === 'drafts' && !state.query || state.folders.some(folder => folder.wellKnown === 'drafts' && (folder.id === message?.parentId || !state.query && folder.id === state.folder));
}
function rsvpButtons(id, changeKey, cancelled = false, response, isOrganizer = false, statusError = '') {
  if (cancelled) return tr('<p class="form-note" role="status">Встреча отменена организатором. Ответ не требуется.</p>');
  if (statusError) return `<p class="form-note" role="status">${tr("Не удалось проверить ответ:")} ${esc(statusError)}${tr(". Обновите письмо.")}</p>`;
  if (response === undefined) return tr('<p class="form-note" role="status">Проверяем ваш ответ в календаре Exchange…</p>');
  const status = window.asterEvents.responseState({ response, isOrganizer });
  if (status === 'organizer') return tr('<p class="form-note">Вы организатор встречи.</p>');
  const current = { accepted: 'AcceptItem', tentative: 'TentativelyAcceptItem', declined: 'DeclineItem' }[status];
  const buttons = [['AcceptItem', tr('Принять')], ['TentativelyAcceptItem', tr('Под вопросом')], ['DeclineItem', tr('Отклонить')]].map(([value, name]) => `<button class="secondary" data-action="rsvp" data-response="${value}" data-id="${esc(id)}" data-key="${esc(changeKey || '')}" ${value === current ? 'disabled aria-current="true"' : ''}>${name}${value === current ? ' ✓' : ''}</button>`).join('');
  return `<div class="rsvp ${current ? 'rsvp-answered' : ''}">${current ? `<span class="rsvp-status">${esc(responseName(response))}</span><details class="rsvp-change"><summary>${tr("Изменить ответ")}</summary><div class="rsvp-menu">${buttons}</div></details>` : buttons}</div>`;
}

let demoImageData;
async function demoContentImages(html) {
  const images = {}, doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('img').forEach(img => { const src = img.getAttribute('src'); if (src?.startsWith('data:image/')) images[src] = src; });
  if (doc.querySelector('img[src="cid:demo-logo"]')) {
    demoImageData ||= new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').drawImage(img, 0, 0); resolve(canvas.toDataURL('image/png')); };
      img.onerror = () => reject(new Error(tr('Демоизображение недоступно'))); img.src = '../assets/icon.png';
    });
    images['cid:demo-logo'] = await demoImageData;
  }
  return { images, errors: {} };
}
function renderReader() {
  const m = state.selected;
  if (!m || state.view !== 'mail' || !$('#reader')) return;
  $('#reader').innerHTML = `<div class="reader-toolbar"><button type="button" class="icon-button" data-mail-find aria-label="${tr("Найти в письме")}" title="${tr("Найти в письме · Cmd/Ctrl+F")}">${icon('search')}</button><button class="secondary back-to-list" data-action="back-to-list">${icon('reply')}${tr("К письмам")}</button><button class="icon-button" data-mail-move aria-label="${tr("Переместить в папку")}" title="${tr("Переместить в папку")}">${icon('folder')}</button><button class="icon-button" data-action="archive" title="${tr("В архив")}" aria-label="${tr("В архив")}">${icon('archive')}</button><button class="icon-button" data-action="delete" title="${tr("В корзину")}" aria-label="${tr("В корзину")}">${icon('trash')}</button><span class="toolbar-divider"></span><button class="icon-button ${m.flagged ? 'starred' : ''}" data-action="flag" title="${tr("Избранное")}" aria-label="${tr("Избранное")}">${icon('star')}</button><button class="icon-button ${m.importance === 'High' ? 'important' : ''}" data-action="important" title="${tr("Важность")}" aria-label="${m.importance === 'High' ? tr('Обычная важность') : tr('Пометить важным')}">${icon('important')}</button><button class="icon-button" data-action="unread" title="${tr("Отметить непрочитанным")}" aria-label="${tr("Отметить непрочитанным")}">${icon('mail')}</button><div class="reader-replies" aria-label="${tr("Действия с письмом")}">${isDraftMessage(m) ? tr('<button class="primary" data-action="edit-draft">Продолжить черновик</button>') : `<button class="secondary" data-action="reply">${icon('reply')}${tr("Ответить")}</button><button class="secondary" data-action="reply-all">${tr("Ответить всем")}</button><button class="secondary" data-action="forward">${tr("Переслать")} ${icon('send')}</button>`}</div><span class="reader-position">${state.messages.findIndex(v => v.id === m.id) + 1} ${tr("из")} ${state.messages.length}</span></div><div class="reader-scroll"><div class="reader-content">${m.meeting ? `<div class="eyebrow">${icon('calendar')}${tr("Приглашение на встречу")}</div>` : ''}<h2>${esc(m.subject)}</h2><div class="sender-detail">${avatar(m.from.name || m.from.email, 0, m.from.email)}<div><strong><button type="button" class="sender-person" data-action="open-mail-person" data-group="from" aria-label="${tr("Открыть контакт:")} ${esc(m.from.name || m.from.email)}">${esc(m.from.name || m.from.email)}</button></strong><small>${esc(m.from.email)}</small></div><time class="date">${esc(dateFormat(m.date, { day: 'numeric', month: 'long' }))}<br>${esc(time(m.date))}</time></div>${mailRecipientDetails(m)}${m.meeting?.id ? `<div class="meeting-banner"><strong>${esc(m.meeting.location || tr('Встреча'))}</strong><p>${esc(dateFormat(m.meeting.start, { day: 'numeric', month: 'long' }))} · ${esc(time(m.meeting.start))}–${esc(time(m.meeting.end))}</p>${rsvpButtons(m.meeting.id, m.meeting.changeKey, m.meeting.cancelled, m.meeting.response, m.meeting.isOrganizer, m.meeting.statusError)}</div>` : ''}${mailAttachments(m)}<div class="privacy-note">${icon('shield')}${tr("Картинки: встроенные и с сервера OWA · активное содержимое отключено")}</div><div id="message-body"></div></div></div>`;
  if (m.html) {
    window.asterRichContent.render($('#message-body'), m.html, {
      dark: state.theme === 'dark', title: tr('Содержимое письма'),
      loadImages: () => m.contentImages ||= state.demo ? demoContentImages(m.html) : api('contentImages', { ref: ref(m), kind: 'message' }),
      openLink: url => window.aster ? api('openLink', { url }).catch(showError) : toast(`${tr("Демо: ссылка")} ${url}`),
    });
  } else $('#message-body').innerHTML = `<div class="plain-body">${esc(m.text || m.preview || tr('Нет текстового содержимого'))}</div>`;
  window.asterMailFind.mount($('#reader'), `${state.account?.sessionId || 'demo'}:${m.id}`);
}
function calendarEvents(events, day) {
  const next = addDays(day, 1);
  return events.filter(e => new Date(e.start) < next && new Date(e.end) > day).sort((a, b) => a.start.localeCompare(b.start));
}
function quarterMarkup(start, events) {
  return `<div class="quarter">${Array.from({ length: 3 }, (_, month) => {
    const first = T.add(start, { months: month }, timeZone);
    const offset = (civil(first).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(civil(first).getUTCFullYear(), civil(first).getUTCMonth() + 1, 0)).getUTCDate();
    return `<section class="quarter-month"><h2>${esc(dateFormat(first, { month: 'long' }))}</h2><div class="month-grid">${[tr('Пн'), tr('Вт'), tr('Ср'), tr('Чт'), tr('Пт'), tr('Сб'), tr('Вс')].map(d => `<span class="weekday">${d}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({ length: count }, (_, i) => {
      const day = addDays(first, i);
      const daily = calendarEvents(events, day);
      const date = dayKey(day);
      return `<button class="month-day ${dayKey(day) === dayKey(new Date()) ? 'is-today' : ''} ${daily.length ? 'has-events' : ''}" data-action="calendar-day" data-date="${date}" aria-label="${esc(dateFormat(day, { day: 'numeric', month: 'long' }))}${tr(", встреч:")} ${daily.length}" title="${esc(daily.map(e => e.title).join(' · ') || tr('Нет встреч'))}"><span>${i + 1}</span><small>${daily.length || ''}</small></button>`;
    }).join('')}</div></section>`;
  }).join('')}</div>`;
}
function renderCalendar() {
  const previousScroll = document.querySelector('.timeline-scroll')?.scrollTop;
  const mode = calendarMode(); renderedCalendarMode = mode;
  const { start, end } = calendarRange();
  const events = state.events.filter(e => !state.query || `${e.title} ${e.location} ${e.preview}`.toLowerCase().includes(state.query.toLowerCase()));
  const title = mode === 'day' ? dateFormat(start, { day: 'numeric', month: 'long', year: 'numeric' }) : mode === 'quarter' ? `${Math.floor(civil(start).getUTCMonth() / 3) + 1}${tr("-й квартал ·")} ${civil(start).getUTCFullYear()}` : dateFormat(start, { month: 'long', year: 'numeric' });
  const period = mode === 'day' ? tr('день') : mode === 'quarter' ? tr('квартал') : tr('неделю');
  const grid = mode === 'quarter' ? quarterMarkup(start, events) : timelineMarkup(start, mode, events);
  $('#workspace').innerHTML = `<div class="calendar-view"><div class="page-header"><div><h1>${esc(title)}</h1><p>${mode === 'day' ? tr('Встречи выбранного дня.') : tr('Ваши встречи в удобном масштабе.')}</p></div><div class="calendar-controls"><select id="calendar-mode" aria-label="${tr("Вид календаря")}">${[['auto', `${tr("Авто ·")} ${window.asterCalendar.mode('auto', $('#workspace').clientWidth) === 'day' ? tr('день') : tr('неделя')}`], ['day', tr('День')], ['week', tr('Неделя')], ['quarter', tr('Квартал')]].map(([value, label]) => `<option value="${value}" ${calendarPreference === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="secondary" data-action="today">${tr("Сегодня")}</button><div class="calendar-arrows"><button class="icon-button flip" data-action="calendar-prev" aria-label="${mode === 'week' ? tr('Предыдущая неделя') : `${tr("Предыдущий")} ${period}`}">${icon('chevron')}</button><button class="icon-button" data-action="calendar-next" aria-label="${mode === 'week' ? tr('Следующая неделя') : `${tr("Следующий")} ${period}`}">${icon('chevron')}</button></div><button class="primary" data-action="new-event">${icon('plus')}${tr("Встреча")}</button></div></div>${grid}<div class="calendar-legend" aria-label="${tr("Цвета встреч")}"><span class="pending">${tr("Без ответа / под вопросом")}</span><span class="accepted">${tr("Принято")}</span><span class="organized">${tr("Вы организатор")}</span><span class="declined">${tr("Отклонено")}</span></div><div class="calendar-caption"><span>${icon('clock')} ${esc(T.zone(timeZone))}</span><span>${events.length} ${tr("встреч за")} ${period}</span><span>${esc(dateFormat(start, { day: 'numeric', month: 'short' }))} — ${esc(dateFormat(new Date(end - 1), { day: 'numeric', month: 'short' }))}</span></div></div>`;
  restoreCalendarScroll(start, mode, previousScroll);
}
function colleaguesKey() { return `aster-colleagues:${state.demo ? 'demo' : `${state.account?.server || ''}|${state.account?.username || ''}`}`; }
function colleagues() {
  try { const saved = JSON.parse(localPreferences.getItem(colleaguesKey()) || 'null'); return Array.isArray(saved) ? saved.filter(c => c && typeof c.email === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(c.email)).slice(0, 50) : state.demo ? window.asterDemo.contacts.slice(0, 4) : []; }
  catch { return []; }
}
let colleagueData = [], colleagueScope = '', colleagueUpdated = null, colleagueError = '', colleagueRequest = 0;
let directoryResults = [], directoryRequest = 0;
async function saveColleagues(list) { localPreferences.setItem(colleaguesKey(), JSON.stringify(list.map(c => ({ name: c.name, email: c.email, company: c.company || '' })))); await localSave; }
async function fetchAvailability(emails, start, end) {
  if (!state.demo) return api('availability', { emails: emails.join(','), start: start.toISOString(), end: end.toISOString() });
  return emails.map((email, i) => {
    const busy = new Date(start); busy.setHours(11 + i, 0, 0, 0);
    const finish = new Date(+busy + 3600000);
    const now = Date.now();
    return { email, start: start.toISOString(), end: end.toISOString(), blocks: [{ start: busy.toISOString(), end: finish.toISOString(), type: i === 2 ? 'Tentative' : 'Busy' }, ...(i === 1 ? [{ start: new Date(now - 15 * 60000).toISOString(), end: new Date(now + 45 * 60000).toISOString(), type: 'Busy' }] : [])] };
  });
}
function availabilityLabel(person, at = Date.now()) {
  const status = window.asterAvailability.status(person, at);
  if (status.kind === 'unknown') return { ...status, text: tr('Нет данных') };
  const until = dateFormat(status.until, { ...(dayKey(status.until) !== dayKey(new Date(at)) ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit' });
  const remaining = Math.max(1, Math.ceil((Date.parse(status.until) - at) / 60000));
  const duration = remaining < 60 ? `${remaining} ${tr("мин")}` : `${Math.floor(remaining / 60)} ${tr("ч")}${remaining % 60 ? ` ${remaining % 60} ${tr("мин")}` : ''}`;
  const name = status.type === 'OOF' ? tr('Нет на месте') : status.type === 'Tentative' ? tr('Под вопросом') : tr('Занят');
  return { ...status, text: status.kind === 'free' ? `${status.horizon ? tr('Свободен · проверено до') : tr('Свободен до')} ${until}` : `${name} ${tr("до")} ${until} ${tr("· ещё")} ${duration}` };
}
function renderColleagues() {
  if (state.view !== 'contacts' || !$('#colleagues-list') || !$('#colleagues-count') || !$('#colleagues-updated')) return;
  const list = colleagues();
  if (colleagueScope !== colleaguesKey()) { colleagueData = []; colleagueUpdated = null; colleagueError = ''; }
  const rows = list.map(c => { const p = colleagueData.find(p => p.email.toLowerCase() === c.email.toLowerCase()); return { ...c, status: availabilityLabel(p) }; });
  $('#colleagues-count').textContent = `${rows.filter(c => c.status.kind === 'free').length} ${tr("из")} ${list.length} ${tr("свободны")}`;
  $('#colleagues-list').innerHTML = rows.map(c => `<div class="colleague-row">${avatar(c.name, 0, c.email)}<div class="colleague-name"><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></div><span class="availability ${c.status.kind}" title="${esc(c.status.text)}"><i></i>${esc(c.status.text)}</span><button class="icon-button" data-action="plan-colleague" data-email="${esc(c.email)}" aria-label="${tr("Запланировать встречу:")} ${esc(c.name)}" title="${tr("Запланировать встречу")}">${icon('calendar')}</button><button class="icon-button" data-action="remove-colleague" data-email="${esc(c.email)}" aria-label="${tr("Убрать:")} ${esc(c.name)}" title="${tr("Убрать из коллег")}">${icon('close')}</button></div>`).join('') || tr('<p class="form-note">Добавьте людей из общего каталога Exchange кнопкой «+».</p>');
  $('#colleagues-updated').textContent = colleagueError ? `${tr("Не удалось обновить:")} ${colleagueError}` : `${state.demo ? tr('Вымышленные статусы · ') : ''}${colleagueUpdated ? `${tr("Обновлено")} ${time(colleagueUpdated)} ${tr("· проверка раз в минуту")}` : list.length ? tr('Проверяем занятость…') : tr('Избранные коллеги хранятся на этом компьютере.')}`;
}
async function refreshColleagues() {
  const scope = colleaguesKey(), list = colleagues(), request = ++colleagueRequest;
  colleagueScope = scope; colleagueData = []; colleagueError = ''; renderColleagues();
  if (!list.length) return;
  const start = new Date(Math.floor(Date.now() / 900000) * 900000), end = new Date(+start + 3 * 86400000);
  try {
    const result = await fetchAvailability(list.map(c => c.email), start, end);
    if (request !== colleagueRequest || scope !== colleaguesKey()) return;
    colleagueData = result; colleagueUpdated = new Date();
  } catch (error) { if (request !== colleagueRequest || scope !== colleaguesKey()) return; colleagueData = []; colleagueError = error.message; }
  renderColleagues();
}
function directoryModal() {
  if (!ready()) return connectModal();
  modal(tr('Добавить коллег'), tr('Найдите человека в общем каталоге Exchange и закрепите его в списке.'), `<form id="directory-form"><label class="field"><span>${tr("Имя или email")}</span><input name="query" required minlength="2" autocomplete="off" placeholder="${tr("Начните с имени коллеги")}"></label><button class="primary" type="submit">${icon('search')}${tr("Найти в Exchange")}</button>${formError()}</form><div id="directory-results" class="directory-results"></div>`);
}
async function searchDirectory(form) {
  const request = ++directoryRequest, query = form.elements.query.value.trim();
  await submitForm(form, async () => {
    const result = state.demo ? { items: window.asterDemo.directory.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase())) } : await api('contacts', { query });
    if (request !== directoryRequest || !$('#directory-results')) return;
    directoryResults = result.items.filter(c => c.email);
    $('#directory-results').innerHTML = directoryResults.map((c, i) => `<div class="directory-row">${avatar(c.name, 0, c.email)}<div><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></div><button class="secondary" data-action="add-colleague" data-index="${i}" ${colleagues().some(p => p.email.toLowerCase() === c.email.toLowerCase()) ? 'disabled' : ''}>${icon('plus')}${tr("Добавить")}</button></div>`).join('') || tr('<p class="form-note">По этому запросу людей с почтовым адресом не найдено.</p>');
  });
}
function plannerFingerprint(form) { return ['start', 'end', 'attendees'].map(name => form.elements[name].value).join('|'); }
async function runPlanner(button) {
  const form = $('#event-form'); if (!form) return;
  const box = $('#planner-results'), fingerprint = plannerFingerprint(form);
  let start, end;
  box.innerHTML = tr('<p class="form-note">Проверяем календарь участников…</p>'); button.disabled = true;
  try {
    start = T.fromWall(form.elements.start.value, timeZone); end = T.fromWall(form.elements.end.value, timeZone);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end - start > 86400000) throw new Error(tr('Укажите начало и окончание встречи в пределах суток.'));
    const emails = form.elements.attendees.value.split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const own = state.demo ? 'you@example.com' : state.account?.username;
    if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(own || '')) emails.push(own.toLowerCase());
    const unique = [...new Set(emails)];

    const from = window.asterCalendar.range(start, 'day', timeZone).start;
    const to = window.asterCalendar.range(end, 'day', timeZone).end;
    const people = unique.length ? await fetchAvailability(unique, from, to) : [];
    if (!unique.includes(own?.toLowerCase())) {
      const mine = await api('calendar', { start: from.toISOString(), end: to.toISOString() });
      people.push({ email: '__self__', start: from.toISOString(), end: to.toISOString(), blocks: mine.filter(e => !e.cancelled && !['Decline', 'Declined'].includes(e.response) && e.showAs !== 'Free').map(e => ({ start: e.start, end: e.end, type: 'Busy' })) });
    }
    if (!$('#event-form') || $('#event-form') !== form || plannerFingerprint(form) !== fingerprint) return;
    const duration = Math.ceil((end - start) / 60000);
    const free = window.asterAvailability.available(people, start, end);
    const suggestions = window.asterAvailability.suggestions(people, start, duration, Date.now(), timeZone);
    const unknown = people.some(p => window.asterAvailability.status(p, +start).kind === 'unknown');
    box.innerHTML = `<div class="planner-verdict ${free ? 'free' : 'busy'}">${free ? tr('Выбранное время свободно у всех проверенных участников') : unknown ? tr('Есть недоступные данные или пересечения — свободное время не подтверждено') : tr('Выбранное время пересекается с занятостью участников')}</div><div class="planner-people">${people.map(p => { const status = availabilityLabel(p, +start); return `<div><strong>${esc(colleagues().find(c => c.email.toLowerCase() === p.email.toLowerCase())?.name || (['__self__', own?.toLowerCase()].includes(p.email) ? tr('Вы') : p.email))}</strong><span class="availability ${status.kind}"><i></i>${esc(status.text)}</span></div>`; }).join('')}</div><h4>${tr("Общее свободное время ·")} ${esc(dateFormat(start, { day: 'numeric', month: 'long' }))}</h4><div class="planner-slots">${suggestions.map(slot => `<button type="button" class="secondary" data-action="planner-slot" data-start="${slot}" data-duration="${duration}">${esc(time(slot))}–${esc(time(new Date(Date.parse(slot) + duration * 60000)))}</button>`).join('') || tr('<p class="form-note">Общих интервалов с 09:00 до 18:00 не найдено. Выберите другой день или проверьте доступ к календарям.</p>')}</div><p class="form-note">${state.demo ? tr('Деморежим: занятость вымышлена. ') : ''}${tr("Проверка с шагом 15 минут, с учётом всей длительности встречи. Ваш календарь включён. Перед отправкой можно проверить время повторно.")}</p>`;
  } catch (error) { if (box.isConnected && plannerFingerprint(form) === fingerprint) box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; }
  finally { button.disabled = false; }
}

function renderContacts() {
  if (state.view !== 'contacts') return;
  $('#workspace').innerHTML = `<div class="contacts-view"><div class="page-header"><div><h1>${state.query ? tr('Люди в Exchange') : tr('Ваши контакты')}</h1><p>${state.query ? `${tr("Результаты для «")}${esc(state.query)}»` : tr('Люди, с которыми вы создаёте важное.')}</p></div><div class="contact-actions"><button class="secondary" data-action="directory">${icon('people')}${tr("Общий каталог")}</button><button class="primary" data-action="new-contact">${icon('plus')}${tr("Новый контакт")}</button></div></div><section class="colleagues-panel"><header><h2>${icon('people')}${tr("Коллеги")}</h2><span id="colleagues-count"></span><button class="icon-button" data-action="refresh-colleagues" aria-label="${tr("Обновить занятость")}" title="${tr("Обновить занятость")}">${icon('refresh')}</button><button class="icon-button" data-action="directory" aria-label="${tr("Добавить коллег")}" title="${tr("Добавить коллег")}">${icon('plus')}</button><button class="icon-button" data-action="toggle-colleagues" aria-label="${tr("Свернуть список коллег")}" aria-expanded="true">${icon('chevron')}</button></header><div id="colleagues-list"></div><p id="colleagues-updated" class="form-note"></p></section><div class="contacts-grid">${state.contacts.map((c, i) => `<button class="contact-card" data-action="contact" data-id="${esc(c.id)}">${avatar(c.name, i, c.email)}<strong>${esc(c.name)}</strong><p>${esc(c.company || tr('Контакт Exchange'))}</p><small>${esc(c.email || tr('Email не указан'))}</small></button>`).join('')}</div>${!state.contacts.length ? tr('<p class="form-note">Добавьте личный контакт или найдите коллегу в общем каталоге Exchange.</p>') : ''}${state.more ? tr('<button class="secondary load-more" data-action="more">Загрузить ещё</button>') : ''}</div>`;
  renderColleagues();
}
function connectModal() {
  const server = state.account?.server || '', protocol = 'https';
  modal(tr('Подключить Exchange'), tr('Адрес и логин вашего корпоративного OWA.'), `<form id="connect-form"><div class="server-address"><label class="field"><span>${tr("Протокол")}</span><select name="protocol"><option value="https" ${protocol === 'https' ? 'selected' : ''}>HTTPS</option><option value="custom">${tr("Свой · полный URL")}</option></select></label>${field('server', tr('Адрес OWA-сервера'), server.replace(/^https?:\/\//, ''), 'text', true)}</div><p id="protocol-note" class="form-note"></p>${field('username', tr('Логин · name@company.ru или DOMAIN\\login'), state.account?.username || '', 'text', true)}${field('password', tr('Пароль'), '', 'password', true)}<label class="checkbox"><input name="remember" type="checkbox">${tr("Запомнить пароль в защищённом системном хранилище")}</label><p class="form-note">${tr("Поддерживаются формы OWA и NTLM на том же сервере. Если нужен VPN, подключите его до входа. Для HTTPS сертификат должен быть доверен системой.")}</p>${formError()}${window.aster && !state.account ? tr('<button type="button" class="secondary" data-action="reset-local-data">Сбросить локальные настройки входа…</button>') : ''}<div class="modal-footer"><button type="button" class="secondary" data-action="demo">${tr("Посмотреть демо")}</button><button class="primary" type="submit">${tr("Подключиться")} ${icon('chevron')}</button></div></form>`);
  refreshProtocolNote();
}
function refreshProtocolNote() {
  const form = $('#connect-form'); if (!form) return;
  const protocol = form.elements.protocol.value;
  form.elements.server.placeholder = protocol === 'custom' ? 'https://mail.company.ru:8443/owa/' : 'mail.company.ru';
  $('#protocol-note').textContent = tr('Разрешён только HTTPS с доверенным сертификатом. Можно указать домен, порт и /owa/.');
}

async function compose(mode = 'new', contact = null) {
  if (modalBusy) return;
  const request = ++composeSequence, generation = state.generation, modalVersion = modalSequence;
  if (!ready()) return connectModal();
  let m = state.selected;
  const composeAccount = state.account, composeDemo = state.demo, draftMode = mode === 'draft';
  const current = () => request === composeSequence && generation === state.generation && modalVersion === modalSequence && composeAccount === state.account && composeDemo === state.demo && !modalBusy;
  if (draftMode) {
    if (!m || !isDraftMessage(m)) throw new Error(tr('Выберите черновик.'));
    m = state.demo ? structuredClone(m) : await api('editDraft', { action: 'read', ref: ref(m) });
  }
  if (!current()) return;
  const sent = state.folder === 'sentitems' || state.folders.some(folder => folder.wellKnown === 'sentitems' && (folder.id === state.folder || folder.id === m?.parentId));
  const source = !draftMode && syncSignature ? await getServerSignature() : null;
  const useServer = source && (mode === 'new' ? source.autoAddSignature : source.autoAddSignatureOnReply);
  const signatureText = draftMode || source ? '' : state.signature;
  if (!current()) return;
  if (draftMode && [...(m.to || []), ...(m.cc || []), ...(m.bcc || [])].some(person => !person.email)) throw new Error(tr('Черновик содержит получателя без SMTP-адреса. Откройте его в OWA, чтобы не потерять адресата.'));
  let recipients = draftMode ? { to: m.to.map(person => person.email).join(', '), cc: m.cc.map(person => person.email).join(', '), bcc: (m.bcc || []).map(person => person.email).join(', ') } : { to: contact?.email || '', cc: '', bcc: '' };
  if (mode.startsWith('reply')) {
    const identity = state.demo ? { emails: ['you@example.com'] } : await api('identity');
    if (mode === 'reply-all' && !sent && !identity.emails.length) throw new Error(tr('OWA не вернул ваш почтовый адрес. Для «Ответить всем» подключитесь с основным email вместо DOMAIN\\login.'));
    recipients = window.asterRecipients.reply(m, identity.emails, mode === 'reply-all', sent);
  }
  if (!current()) return;
  composeData = { kind: draftMode ? 'new' : mode, reference: !draftMode && mode !== 'new' && m ? ref(m) : null, attachments: [], signature: useServer ? source : null, draftReference: draftMode ? ref(m) : null, draftOriginal: draftMode ? m : null };
  const prefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
  modal(draftMode ? tr('Продолжить черновик') : mode === 'forward' ? tr('Переслать письмо') : mode.startsWith('reply') ? tr('Ответить') : tr('Новое письмо'), state.demo ? tr('Деморежим: письмо не будет отправлено на сервер.') : `${tr("Отправка через корпоративный Exchange по")} ${state.account?.server.startsWith('https:') ? 'HTTPS' : 'HTTP'}.`, `<form id="compose-form">${field('to', tr('Кому · адреса через запятую'), recipients.to)}${field('cc', tr('Копия'), recipients.cc)}${field('bcc', tr('Скрытая копия'), recipients.bcc || '')}${field('subject', tr('Тема'), draftMode ? m.subject : mode === 'new' ? '' : `${prefix}${m.subject.replace(/^(Re|Fwd):\s*/i, '')}`)}<div class="compose-message-area"><div class="compose-editor-field" id="compose-editor-field"></div>${!draftMode && mode !== 'new' && m ? `<details class="compose-history" open><summary>${tr("Предыдущая переписка ·")} ${esc(m.from.name || m.from.email)}</summary><button type="button" class="secondary" id="edit-history">${tr("Редактировать")}</button><p class="form-note">${tr("При редактировании сохраняются текст и форматирование; изображения из цитаты не переносятся.")}</p><div id="compose-history-body"></div></details>` : ''}</div>${useServer ? tr('<p class="form-note">Подпись OWA добавится при отправке:</p><div id="compose-signature-preview"></div>') : ''}<label class="attachment-picker">${icon('clip')}<input id="files" type="file" multiple aria-label="${tr("Прикрепить файлы")}"><span>${tr("Или перетащите файлы в окно письма")}</span></label><div id="picked-files" class="picked-files"></div><p class="form-note">${tr("Вложения до 20 МБ суммарно. Предыдущая переписка будет включена в письмо; пересылка сохраняет исходные вложения.")}</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="save-draft">${tr("Сохранить черновик")}</button><button class="primary" type="submit">${icon('send')}${tr("Отправить")}</button></div></form>`);
  $('#modal').classList.add('compose-dialog');
  const expand = document.createElement('button');
  expand.type = 'button'; expand.className = 'secondary'; expand.textContent = tr('Развернуть окно');
  expand.setAttribute('aria-pressed', 'false');
  expand.addEventListener('click', () => {
    const expanded = $('#modal').classList.toggle('compose-expanded');
    expand.setAttribute('aria-pressed', String(expanded));
    expand.textContent = expanded ? tr('Свернуть окно') : tr('Развернуть окно');
  });
  $('#modal .modal-header').insertBefore(expand, $('#modal .modal-header > button'));
  const dialog = $('#modal');
  dialog.ondragover = event => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = modalBusy ? 'none' : 'copy';
    if (!modalBusy) dialog.classList.add('compose-file-drop');
  };
  dialog.ondragleave = event => { if (!dialog.contains(event.relatedTarget)) dialog.classList.remove('compose-file-drop'); };
  dialog.ondrop = event => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault(); dialog.classList.remove('compose-file-drop');
    if (!modalBusy) addComposeFiles(event.dataTransfer.files);
  };

  composeData.editor = window.asterMailEditor.mount($('#compose-editor-field'), draftMode ? m.text || '' : signatureText ? `\n\n${signatureText}` : '', draftMode ? { html: m.html || undefined, preserveCidImages: true } : {});
  if (draftMode) {
    composeData.draftInitial = composeData.editor.read().bodyHtml;
    const note = document.createElement('p'); note.className = 'form-note';
    note.textContent = tr('Изменяется тот же серверный черновик. Подпись повторно не добавляется.');
    $('#picked-files').before(note);
    for (const attachment of m.attachments || []) {
      const row = document.createElement('p'); row.className = 'form-note';
      row.textContent = `${attachment.name} · ${bytes(attachment.size)} ${tr("· уже в черновике, сохранится при отправке")}`;
      $('#picked-files').before(row);
    }
  }
  if (useServer) renderSignaturePreview($('#compose-signature-preview'), source);
  if (!draftMode && mode !== 'new' && m) {
    const target = $('#compose-history-body');
    if (m.html) window.asterRichContent.render(target, m.html, { dark: state.theme === 'dark', title: tr('Предыдущая переписка'), loadImages: () => m.contentImages ||= state.demo ? demoContentImages(m.html) : api('contentImages', { ref: ref(m), kind: 'message' }), openLink: url => window.aster ? api('openLink', { url }).catch(showError) : toast(`${tr("Демо: ссылка")} ${url}`) });
    else target.textContent = m.text || m.preview || '';
    $('#edit-history').addEventListener('click', event => {
      markModalDirty();
      composeData.historyEditor = window.asterMailEditor.mount(target, m.text || m.preview || '', {
        id: 'compose-history-editor', label: tr('Предыдущая переписка'), html: m.html || undefined,
      });
      event.currentTarget.hidden = true;
    });

  }
  // File drops inside the script-free preview frame do not bubble to the dialog.
  for (const frame of $('#compose-form').querySelectorAll('iframe')) {
    frame.addEventListener('load', () => {
      frame.contentDocument?.addEventListener('dragover', dialog.ondragover);
      frame.contentDocument?.addEventListener('drop', dialog.ondrop);
    });
  }
}
function localDate(value) { return T.wall(value, timeZone).slice(0, 16); }
function eventModal(requestedStart) {
  if (!ready()) return connectModal();
  const start = requestedStart instanceof Date ? requestedStart : new Date(Math.ceil(Date.now() / 1800000) * 1800000), end = new Date(+start + 1800000);
  modal(tr('Новая встреча'), tr('Участники получат приглашения от вашего аккаунта Exchange.'), `<form id="event-form">${field('title', tr('Название встречи'), '', 'text', true)}<div class="form-row">${field('start', tr('Начало'), localDate(start), 'datetime-local', true)}${field('end', tr('Окончание'), localDate(end), 'datetime-local', true)}</div>${field('location', tr('Место или ссылка на встречу'))}${field('attendees', tr('Участники · email через запятую'))}${textField('body', tr('Описание и повестка'))}<section class="planner"><h3>${icon('clock')}${tr("Помощник планирования")}</h3>${colleagues().length ? `<details><summary>${tr("Добавить избранных коллег")}</summary><div class="planner-favorites">${colleagues().map(c => `<label class="checkbox"><input type="checkbox" name="planner-person" value="${esc(c.email)}">${esc(c.name)}</label>`).join('')}</div></details>` : ''}<button type="button" class="secondary" data-action="planner-check">${icon('calendar')}${tr("Проверить занятость и найти время")}</button><div id="planner-results" aria-live="polite"></div></section><p class="form-note">${tr("Часовой пояс:")} ${esc(T.zone(timeZone))}${tr(". Без участников событие сохранится только в вашем календаре.")}</p>${formError()}<div class="modal-footer"><button class="primary" type="submit">${icon('calendar')}${tr("Создать и отправить приглашения")}</button></div></form>`);
}
function contactModal() {
  if (!ready()) return connectModal();
  modal(tr('Новый контакт'), tr('Сохранится в личных контактах Exchange.'), `<form id="contact-form">${field('name', tr('Имя'), '', 'text', true)}${field('email', 'Email', '', 'email', true)}${field('company', tr('Компания / команда'))}${field('phone', tr('Телефон'), '', 'tel')}${formError()}<div class="modal-footer"><button class="primary" type="submit">${tr("Сохранить контакт")}</button></div></form>`);
}
function selectSettingsTab(selected) {
  const form = selected.closest('form');
  for (const tab of form.querySelectorAll('[role="tab"]')) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    form.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
  }
}
async function settingsModal() {
  if (window.aster) notificationPreferences = await api('notificationSettings');
  const zones = [...new Set([T.zone(), T.zone(timeZone), 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort();
  const p = notificationPreferences;
  const checkbox = (name, text, value) => `<label class="checkbox"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${text}</label>`;
  modal(tr('Настройки Aster'), tr('Спокойное пространство, настроенное под вас.'), `<form id="settings-form">
    <div class="settings-tabs" role="tablist" aria-label="${tr("Разделы настроек")}">
      ${[['general', tr('Общие')], ['signature', tr('Подпись')], ['notifications', tr('Уведомления')], ['account', tr('Аккаунт')]].map(([id, label], index) => `<button type="button" id="settings-tab-${id}" role="tab" aria-controls="settings-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-action="settings-tab">${label}</button>`).join('')}
    </div>
    <div class="settings-panels">
    <section id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" tabindex="0">
    <h3 class="settings-section-title">${tr("Оформление и навигация")}</h3>
    <label class="field"><span>${tr('Язык интерфейса')}</span><select name="language"><option value="ru" ${window.asterI18n.language === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${window.asterI18n.language === 'en' ? 'selected' : ''}>English</option></select></label>
    <label class="field"><span>${tr("Оформление")}</span><select name="theme"><option value="light" ${state.theme === 'light' ? 'selected' : ''}>${tr("Светлое")}</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>${tr("Тёмное")}</option></select></label>
    <h3 class="settings-heading">${tr("Дата и время")}</h3>
    <label class="field"><span>${tr("Часовой пояс")}</span><select name="timeZone"><option value="system" ${timeZone === 'system' ? 'selected' : ''}>${tr("Как на компьютере ·")} ${esc(T.zone())}</option>${zones.map(zone => `<option value="${esc(zone)}" ${timeZone === zone ? 'selected' : ''}>${esc(zone.replaceAll('_', ' '))}</option>`).join('')}</select></label>
    <p class="form-note">${tr("Пояс применяется к календарю, письмам, виджету и времени создания встреч. Отсчёт до встречи не зависит от пояса отображения. «Как на компьютере» следует системным настройкам.")}</p>
    <h3 class="settings-heading">${tr("Навигация")}</h3>
    <label class="field"><span>${tr("Размещение карточек разделов")}</span><select name="navigationPlacement"><option value="sidebar" ${navigationPlacement === 'sidebar' ? 'selected' : ''}>${tr("Слева · под папками, над аккаунтом")}</option><option value="bottom" ${navigationPlacement === 'bottom' ? 'selected' : ''}>${tr("Внизу окна · горизонтальная панель")}</option></select></label>
    </section>
    <section id="settings-panel-signature" role="tabpanel" aria-labelledby="settings-tab-signature" tabindex="0" hidden>
    <h3 class="settings-section-title">${tr("Подпись в письмах")}</h3>
    ${checkbox('syncSignature', tr('Использовать подпись из OWA'), syncSignature)}
    ${textField('signature', tr('Подпись для новых писем и ответов'), syncSignature ? serverSignature?.text || '' : state.signature)}
    <button class="secondary" type="button" data-action="refresh-signature">${tr("Обновить подпись из OWA")}</button>
    <div id="signature-preview"></div>
    <p id="signature-status" class="form-note" role="status">${tr("Подпись загружается с сервера при создании письма. Настройки сервера не изменяются.")}</p>
    </section>
    <section id="settings-panel-notifications" role="tabpanel" aria-labelledby="settings-tab-notifications" tabindex="0" hidden>
    <h3 class="settings-section-title">${tr("Уведомления и звуки")}</h3>
    ${checkbox('notifyMail', tr('Всплывающие уведомления о новых письмах'), p.mail)}
    ${checkbox('notifyMeetings', tr('Напоминания о встречах'), p.meetings)}
    <label class="field"><span>${tr("Напоминать о встрече")}</span><select name="minutes">${[0, 5, 10, 15, 30].map(n => `<option value="${n}" ${p.minutes === n ? 'selected' : ''}>${n ? `${tr("За")} ${n} ${tr("минут")}` : tr('В момент начала')}</option>`).join('')}</select></label>
    ${checkbox('notifySounds', tr('Звук нового письма и отдельный звук встречи'), p.sounds)}
    ${checkbox('notifyPreview', tr('Показывать отправителя, тему и текст в уведомлениях'), p.preview)}
    <div class="sound-tests"><button type="button" class="secondary" data-action="test-notification" data-kind="mail">${icon('mail')}${tr("Проверить письмо")}</button><button type="button" class="secondary" data-action="test-notification" data-kind="meeting">${icon('calendar')}${tr("Проверить встречу")}</button></div>
    <p class="form-note">${tr("Оригинальные звуки Aster — CC0: можно свободно использовать и изменять.")} ${window.aster ? tr('Проверка показывает баннер и воспроизводит звук. На macOS Aster играет звук напрямую, с обычной громкостью аудиовыхода.') : tr('В браузере проверяются звук и плашка с вымышленным письмом. Системные уведомления доступны в приложении.')}</p>
    <p class="form-note">${tr("Разрешите баннеры и звуки для Aster Mail в системных настройках macOS → Уведомления. Почта проверяется каждые 15 секунд независимо от календаря. Плашка в клиенте остаётся до открытия или закрытия. Для постоянных системных уведомлений macOS выберите стиль «Предупреждения». После закрытия окна Aster остаётся в строке меню; после полного выхода и во время сна проверки не выполняются.")}</p>
    ${p.lastMailPoll ? `<p class="form-note">${tr("Последняя проверка почты:")} ${esc(time(p.lastMailPoll))}</p>` : ''}${p.lastPoll ? `<p class="form-note">${tr("Последняя проверка календаря:")} ${esc(time(p.lastPoll))}</p>` : ''}${p.error ? `<p class="form-error">${esc(p.error)}</p>` : ''}
    </section>
    <section id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" tabindex="0" hidden>
    <h3 class="settings-section-title">${tr("Аккаунт Exchange")}</h3>
    <p class="form-note">${state.account ? `${tr("Аккаунт:")} ${esc(state.account.username)} · ${esc(state.account.server)}` : state.demo ? tr('Сейчас открыт демонстрационный аккаунт.') : tr('Аккаунт Exchange пока не подключён.')}</p>
    <button class="secondary ${state.account ? 'danger' : ''}" type="button" data-action="${state.account ? 'disconnect' : 'connect'}">${state.account ? tr('Выйти и удалить пароль') : tr('Подключить Exchange')}</button>
    <h3 class="settings-heading">${tr("Данные на компьютере")}</h3>
    <p class="form-note">${tr("Подпись, коллеги и настройки сохраняются зашифрованными и удаляются при выходе. Кэш почты хранится только в памяти текущей сессии (до 24 МиБ). При открытии вложения создаётся временная копия для системного приложения; при выходе из аккаунта или завершении Aster она удаляется. При выходе кэш очищается.")}</p>
    <h3 class="settings-heading">${tr("Приложение")}</h3>
    <button class="secondary" type="button" data-action="updates">${tr("Обновления Aster Mail")}</button>
    </section>
    </div>
    <div class="settings-footer">${formError()}<div class="modal-footer"><button class="secondary" type="button" data-action="close">${tr("Отмена")}</button><button class="primary" type="submit">${tr("Сохранить")}</button></div></div></form>`);
  $('#modal').classList.add('settings-dialog');
  $('#settings-form').addEventListener('keydown', event => {
    if (!event.target.matches('[role="tab"]')) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectSettingsTab(tabs[next]);
    tabs[next].focus();
  });
  if (syncSignature) await refreshSignatureField();
}
async function submitForm(form, operation) {
  if (modalBusy) return;
  const active = document.activeElement;
  modalBusy = true; form.classList.add('busy'); form.inert = true; form.setAttribute('aria-busy', 'true');
  const errorBox = form.querySelector('.form-error[role="alert"]');
  errorBox.textContent = '';
  try { await operation(Object.fromEntries(new FormData(form))); }
  catch (error) { errorBox.textContent = error.message; }
  finally {
    modalBusy = false; form.classList.remove('busy'); form.inert = false; form.removeAttribute('aria-busy');
    if (form.isConnected && $('#modal').open && form.contains(active)) active.focus({ preventScroll: true });
  }
}
async function sendCompose(save) {
  const form = $('#compose-form'); if (!form) return;
  if (!save && !form.reportValidity()) return;
  await submitForm(form, async data => {
    Object.assign(data, composeData.editor.read());
    const draft = composeData.draftOriginal;
    if (draft && data.bodyHtml === composeData.draftInitial) {
      data.bodyHtml = draft.html || ''; data.body = draft.text || '';
    }
    if (!save && ![data.to, data.cc, data.bcc].some(value => value?.trim())) throw new Error(tr('Укажите получателя.'));
    const inline = [];
    if (composeData.signature) {
      const signature = composeData.signature;
      if (Object.keys(signature.errors || {}).length) throw new Error(tr('Не удалось загрузить картинки подписи. Обновите подпись в настройках или отключите синхронизацию перед отправкой.'));
      if (signature.html) {
        const doc = new DOMParser().parseFromString(signature.html, 'text/html');
        doc.querySelectorAll('img').forEach((img, index) => {
          const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(img.getAttribute('src') || '');
          if (!match) throw new Error(tr('Изображение подписи не загружено'));
          const contentId = `aster-signature-${index}-${Date.now()}@aster.local`;
          inline.push({ name: `signature-${index}.${match[1].split('/')[1]}`, type: match[1], content: match[2], inline: true, contentId });
          img.setAttribute('src', `cid:${contentId}`);
        });
        data.bodyHtml += doc.body.innerHTML;
      }
      if (!signature.html) data.bodyHtml += `<div style="white-space:pre-wrap">${esc(signature.text)}</div>`;
      data.body += `\n\n${signature.text}`;
    }
    if (composeData.historyEditor) {
      const history = composeData.historyEditor.read();
      data.body += `\n\n${history.body}`;
      data.bodyHtml += `<blockquote>${history.bodyHtml}</blockquote>`;
      data.replaceBody = true;
    }
    const files = composeData.attachments;
    if (files.reduce((n, f) => n + f.size, 0) + (draft?.attachments || []).reduce((n, file) => n + file.size, 0) > 20 * 1024 * 1024) throw new Error(tr('Суммарный размер вложений превышает 20 МБ'));
    const attachments = inline.concat(await Promise.all(files.map(async file => ({ name: file.name, type: file.type || 'application/octet-stream', content: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }) }))));
    if (state.demo) {
      const addresses = value => (value || '').split(/[,;\n]/).map(email => email.trim()).filter(Boolean).map(email => ({ name: '', email }));
      if (draft) window.asterDemo.messages = window.asterDemo.messages.filter(message => message.id !== draft.id);
      const storedAttachments = (draft?.attachments || []).concat(attachments.map((attachment, index) => ({ id: `demo-file-${Date.now()}-${index}`, name: attachment.name, size: Math.floor(attachment.content.length * 3 / 4), type: attachment.type, contentId: attachment.contentId || '', inline: attachment.inline === true })));
      window.asterDemo.messages.unshift({
        id: draft?.id || `demo-${Date.now()}`, changeKey: `demo-${Date.now()}`, subject: data.subject || tr('(Без темы)'),
        from: { name: tr('Вы'), email: 'you@example.com' }, to: addresses(data.to), cc: addresses(data.cc), bcc: addresses(data.bcc),
        date: new Date().toISOString(), preview: data.body.slice(0, 130), text: data.body,
        contentImages: { images: { ...(draft?.contentImages?.images || {}), ...Object.fromEntries(inline.map(a => [`cid:${a.contentId}`, `data:${a.type};base64,${a.content}`])) }, errors: {} },
        html: data.bodyHtml + (composeData.reference && !composeData.historyEditor && state.selected ? `<blockquote>${window.asterRichContent.sanitize(state.selected.html || `<div style="white-space:pre-wrap">${esc(state.selected.text || '')}</div>`).body.innerHTML}</blockquote>` : ''),
        read: true, isDraft: save, flagged: false, attachments: storedAttachments, hasAttachments: !!storedAttachments.length, folder: save ? 'drafts' : 'sentitems',
      });
    } else {
      const { signature, editor, historyEditor, draftReference, draftOriginal, draftInitial, ...outgoing } = composeData;
      if (draftReference) await api('editDraft', { ...data, action: save ? 'save' : 'send', ref: draftReference, attachments });
      else await api(save ? 'draft' : 'send', { ...data, ...outgoing, attachments });
    }
    $('#modal').close(); toast(state.demo ? `${tr("Демо: письмо")} ${save ? tr('сохранено в черновиках') : tr('добавлено в отправленные')}` : save ? tr('Черновик сохранён в Exchange') : tr('Письмо отправлено'));
    if (composeData.draftReference || ['sentitems', 'drafts'].includes(state.folder) || state.folders.some(folder => ['sentitems', 'drafts'].includes(folder.wellKnown) && folder.id === state.folder)) await loadView();
  });
}
async function handleAction(button) {
  if (button.dataset.action === 'connection') {
    if (modalBusy) return;
    if ($('#modal').open && !confirmDiscardChanges()) return;
    return !state.account || connectionState.status === 'auth-required' ? connectModal() : settingsModal();
  }
  const { action } = button.dataset;
  if (action.startsWith('mini-') || action === 'folder-branch') return handleSidebarAction(button);
  if (action.startsWith('meeting-')) return handleMeetingAction(button);
  if (action === 'back-to-list') { state.selected = null; renderMail(); return; }
  if (action === 'toggle-sidebar') {
    sidebarCollapsed = !sidebarCollapsed;
    localPreferences.setItem('aster-sidebar-collapsed', String(sidebarCollapsed));
    renderSidebar(); return;
  }
  if (action === 'close') { if (!modalBusy) { if (!confirmDiscardChanges()) return; $('#modal').close(); } return; }
  if (action === 'view') { state.view = button.dataset.view; state.query = ''; $('#search').value = ''; return loadView(); }
  if (action === 'connect') return connectModal();
  if (action === 'reset-local-data') {
    if (modalBusy || state.account) return;
    return submitForm($('#connect-form'), async () => {
      if (await api('resetLocalData')) toast(tr('Локальные настройки сброшены. Подключитесь заново.'));
    });
  }
  if (action === 'retry-message') return openMessage(button.dataset.id);
  if (action === 'edit-draft') return compose('draft');
  if (action === 'demo') {
    if (state.account) throw new Error(tr('Сначала выйдите из аккаунта в настройках, чтобы открыть демо.'));
    $('#modal').close(); state.demo = true; state.folder = 'inbox'; state.view = 'mail'; state.query = ''; state.filter = 'all'; $('#search').value = ''; return loadView();
  }
  if (action === 'updates') return updatesModal();
  if (action === 'settings') return settingsModal();
  if (action === 'settings-tab') return selectSettingsTab(button);
  if (action === 'refresh-signature') {
    $('#settings-form').elements.syncSignature.checked = true;
    return refreshSignatureField();
  }
  if (action === 'test-notification') {
    if (window.aster) { await api('testNotification', { kind: button.dataset.kind }); toast(tr('Тест отправлен в системный центр уведомлений')); }
    else { playSound(button.dataset.kind); if (button.dataset.kind === 'mail') renderMailAlerts([{ id: 'test-mail', title: tr('Анна Новикова'), body: tr('Материалы к встрече\nДобрый день! Отправляю документы для обсуждения завтра.') }]); else toast(tr('Проверка звука встречи')); }
    return;
  }
  if (action === 'theme') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'; localPreferences.setItem('aster-theme', state.theme); document.body.classList.toggle('dark', state.theme === 'dark');
    if (state.selected) renderReader();
    if (activeMeeting && $('#modal').open && $('#modal').dataset.meetingCard === 'true') renderMeetingBody(activeMeeting);
    if (window.aster) notificationPreferences = await api('saveNotifications', { ...notificationPreferences, theme: state.theme });
    return;
  }
  if (action === 'disconnect') {
    try { await api('disconnect'); } finally { applyAccount(null); $('#modal').close(); $('#modal-content').replaceChildren(); await loadView(); }
    return;
  }
  if (action === 'folder') { state.view = 'mail'; state.folder = button.dataset.folder; state.query = ''; state.filter = 'all'; $('#search').value = ''; return loadView(); }
  if (action === 'refresh') { if (window.aster && !state.demo) await api('clearMailCache'); return loadView(); }
  if (action === 'more') return loadView(true);
  if (action === 'filter') { state.filter = button.dataset.filter; return loadView(); }
  if (action === 'mail-star' || action === 'mail-important') { button.disabled = true; try { await toggleMailProperty(button.dataset.id, action === 'mail-star' ? 'Flag' : 'Importance'); } finally { button.disabled = false; } return; }
  if (action === 'important') return toggleMailProperty(state.selected.id, 'Importance');
  if (action === 'message') return openMessage(button.dataset.id);
  if (action === 'compose') return compose();
  if (['reply', 'reply-all', 'forward'].includes(action)) return compose(action);
  if (action === 'save-draft') return sendCompose(true);
  if (action === 'new-event') return eventModal();
  if (action === 'new-contact') return contactModal();
  if (action === 'calendar-day') { state.week = calendarDate(button.dataset.date); calendarPreference = 'day'; localPreferences.setItem('aster-calendar-view', calendarPreference); return loadView(); }
  if (action === 'today' || ['calendar-prev', 'calendar-next'].includes(action)) {
    if (action === 'today') {
      state.week = new Date();
      if ($('#workspace').clientWidth < 700) { calendarPreference = 'auto'; localPreferences.setItem('aster-calendar-view', calendarPreference); }
    } else state.week = window.asterCalendar.move(state.week, calendarMode(), action === 'calendar-next' ? 1 : -1, timeZone);
    return loadView();
  }
  if (action === 'event') { const e = state.events.find(e => e.id === button.dataset.id); if (e) return openMeeting(e); return; }
  if (action === 'directory') return directoryModal();
  if (action === 'add-colleague' || action === 'pin-contact') {
    const c = action === 'add-colleague' ? directoryResults[Number(button.dataset.index)] : state.contacts.find(c => c.id === button.dataset.id);
    if (!c?.email) throw new Error(tr('У контакта не указан email'));
    const list = colleagues();
    if (!list.some(p => p.email.toLowerCase() === c.email.toLowerCase())) {
      if (list.length >= 50) throw new Error(tr('Можно закрепить до 50 коллег'));
      await saveColleagues([...list, c]);
    }
    button.disabled = true; toast(tr('Коллега добавлен')); renderColleagues(); void refreshColleagues(); return;
  }
  if (action === 'remove-colleague') { await saveColleagues(colleagues().filter(c => c.email !== button.dataset.email)); renderColleagues(); return; }
  if (action === 'refresh-colleagues') return refreshColleagues();
  if (action === 'toggle-colleagues') { const list = $('#colleagues-list'); list.hidden = !list.hidden; button.setAttribute('aria-expanded', String(!list.hidden)); button.setAttribute('aria-label', list.hidden ? tr('Развернуть список коллег') : tr('Свернуть список коллег')); return; }
  if (action === 'plan-colleague') { eventModal(); $('#event-form').elements.attendees.value = button.dataset.email; return; }
  if (action === 'planner-check') return runPlanner(button);
  if (action === 'planner-slot') {
    const form = $('#event-form'); if (!form) return;
    form.elements.start.value = localDate(new Date(button.dataset.start));
    form.elements.end.value = localDate(new Date(Date.parse(button.dataset.start) + Number(button.dataset.duration) * 60000));
    return runPlanner(form.querySelector('[data-action="planner-check"]'));
  }
  if (action === 'contact') {
    const c = state.contacts.find(c => c.id === button.dataset.id); if (!c) return;
    return openContactCard(c);
  }
  if (action === 'search-more-objects') return moreSearchObjects(button);
  if (action === 'search-object') {
    const kind = button.dataset.kind, item = state.searchObjects?.[kind]?.items?.[Number(button.dataset.index)];
    if (!item) return;
    if (kind === 'calendar') return openMeeting(item);
    if (kind === 'contacts') return openContactCard(item);
    return;
  }
  if (action === 'open-mail-person') return openMailPerson(button);
  if (action === 'write-card-contact' || action === 'pin-card-contact') {
    const context = currentContactCard();
    if (!context) return;
    if (action === 'write-card-contact') return compose('new', context.person);
    const list = colleagues(), person = context.person;
    if (!person.email) return;
    if (!list.some(value => value.email.toLowerCase() === person.email.toLowerCase())) {
      if (list.length >= 50) throw new Error(tr('Можно закрепить до 50 коллег'));
      await saveColleagues([...list, person]);
    }
    if (currentContactCard() === context) { button.disabled = true; button.textContent = tr('В коллегах'); }
    renderColleagues(); void refreshColleagues(); toast(tr('Коллега добавлен')); return;
  }
  if (action === 'write-contact') return compose('new', state.contacts.find(c => c.id === button.dataset.id));
  if (action === 'rsvp') {
    const buttons = [...button.closest('.rsvp').querySelectorAll('button')];
    const disabled = buttons.map(b => b.disabled);
    buttons.forEach(b => { b.disabled = true; });
    try {
      const scope = $('#modal').dataset.meetingCard === 'true' ? meetingScope() : 'single';
      const result = state.demo ? { status: 'sent' } : await api('respond', { ref: { id: button.dataset.id, changeKey: button.dataset.key }, response: button.dataset.response, scope });
      if (result.status === 'cancelled') {
        const event = state.events.find(e => e.id === button.dataset.id); if (event) event.cancelled = true;
        if (state.selected?.meeting?.id === button.dataset.id) state.selected.meeting.cancelled = true;
        button.closest('.rsvp').outerHTML = rsvpButtons(button.dataset.id, '', true);
        toast(tr('Встреча отменена организатором. Ответ не отправлен.'));
      } else {
        const response = { AcceptItem: 'Accept', TentativelyAcceptItem: 'Tentative', DeclineItem: 'Decline' }[button.dataset.response];
        const selected = state.events.find(e => e.id === button.dataset.id);
        if (selected) selected.response = response;
        if (state.selected?.meeting?.id === button.dataset.id) { state.selected.meeting.response = response; renderReader(); }
        if (state.demo) for (const e of window.asterDemo.events.filter(e => scope === 'series' && selected?.seriesId ? e.seriesId === selected.seriesId : e.id === button.dataset.id)) e.response = response;
        if ($('#modal').open) $('#modal').close();
        if (state.view === 'calendar') await loadView();
        toast(state.demo ? tr('Демо: ответ на приглашение принят') : tr('Ответ отправлен организатору'));
      }
    } catch (error) {
      if ($('#modal').open && $('#modal .form-error')) $('#modal .form-error').textContent = error.message;
      else throw error;
    } finally { buttons.forEach((b, i) => { b.disabled = disabled[i]; }); } return;
  }
  if (action === 'open-attachment' && state.selected) {
    button.disabled = true;
    try {
      if (state.demo) toast(tr('Демо: открытие вымышленных вложений недоступно'));
      else await api('openAttachment', { id: button.dataset.id, ref: ref(state.selected) });
    } finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (action === 'attachment') {
    if (state.demo) { const blob = new Blob([tr('Это демонстрационное вложение Aster Mail. Реальные файлы загружаются из Exchange.')], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Aster-demo.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    else await api('attachment', { id: button.dataset.id, name: button.dataset.name }); return;
  }
  if (action === 'link') { if (window.aster) await api('openLink', { url: button.dataset.url }); else toast(tr('Открытие внешних ссылок доступно в настольном клиенте')); return; }
  if (['archive', 'delete', 'flag', 'unread'].includes(action) && state.selected) {
    const m = state.selected; button.disabled = true;
    try {
      if (action === 'flag' || action === 'unread') {
        if (readingMessages.has(m.id)) await readingMessages.get(m.id);
        const field = action === 'flag' ? 'Flag' : 'IsRead', value = action === 'flag' ? !m.flagged : false;
        if (!state.demo) { const updated = await api('change', { ref: ref(m), field, value }); m.changeKey = updated.changeKey; }
        const prop = action === 'flag' ? 'flagged' : 'read'; m[prop] = value;
        const listItem = state.messages.find(x => x.id === m.id);
        if (action === 'unread') { m.read = listItem?.read ?? true; applyMessageRead(m, false, state.query ? null : state.folder); }
        else if (listItem) Object.assign(listItem, { [prop]: value, changeKey: m.changeKey });
        if (state.demo) window.asterDemo.messages.find(x => x.id === m.id)[prop] = value;
        renderMail(); renderSidebar();
      } else {
        const folder = action === 'archive' ? 'archive' : 'deleteditems';
        if (!state.demo) await api('move', { ref: ref(m), folder }); else window.asterDemo.messages.find(x => x.id === m.id).folder = folder;
        toast(action === 'archive' ? tr('Письмо перемещено в архив') : tr('Письмо перемещено в корзину')); await loadView();
      }
    } finally { button.disabled = false; }
  }
}
document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button || button.disabled) return; handleAction(button).catch(showError); });
$('#modal').addEventListener('cancel', event => { if (modalBusy || !confirmDiscardChanges()) event.preventDefault(); });
const sidebarResize = $('#sidebar-resize');
let sidebarDrag = null;
sidebarResize.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  sidebarDrag = { x: event.clientX, collapsed: sidebarCollapsed };
  sidebarResize.setPointerCapture(event.pointerId);
  document.body.classList.add('sidebar-dragging');
});
sidebarResize.addEventListener('pointermove', event => {
  if (!sidebarDrag) return;
  const delta = event.clientX - sidebarDrag.x;
  const collapsed = sidebarDrag.collapsed ? delta < 32 : delta <= -32;
  if (collapsed !== sidebarCollapsed) { sidebarCollapsed = collapsed; renderSidebar(); }
});
function finishSidebarDrag(event) {
  if (!sidebarDrag) return;
  if (event.type === 'pointercancel') { sidebarCollapsed = sidebarDrag.collapsed; renderSidebar(); }
  sidebarDrag = null; document.body.classList.remove('sidebar-dragging');
  localPreferences.setItem('aster-sidebar-collapsed', String(sidebarCollapsed));
}
sidebarResize.addEventListener('pointerup', finishSidebarDrag);
sidebarResize.addEventListener('pointercancel', finishSidebarDrag);
sidebarResize.addEventListener('lostpointercapture', finishSidebarDrag);
sidebarResize.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); sidebarCollapsed = ['ArrowLeft', 'Home'].includes(event.key);
  localPreferences.setItem('aster-sidebar-collapsed', String(sidebarCollapsed)); renderSidebar();
});
document.addEventListener('input', event => {
  if (event.target.closest('#connect-form') && event.target.name === 'server') {
    const form = $('#connect-form'), match = /^(https?):\/\//i.exec(event.target.value.trim());
    if (match) form.elements.protocol.value = 'custom';
    refreshProtocolNote();
  }
  const form = event.target.closest('#event-form');
  if (form && $('#planner-results') && ['start', 'end', 'attendees'].includes(event.target.name)) $('#planner-results').innerHTML = tr('<p class="form-note">Данные изменились. Проверьте занятость повторно.</p>');
});
document.addEventListener('change', event => {
  if (event.target.name === 'protocol') refreshProtocolNote();
  if (event.target.name === 'allDay' && event.target.closest('#event-form')) {
    const form = $('#event-form');
    if (event.target.checked && form.elements.start.value) {
      const start = calendarDate(form.elements.start.value.slice(0, 10)), end = addDays(start, 1);
      form.elements.start.value = localDate(start); form.elements.end.value = localDate(end);
    }
    if ($('#planner-results')) $('#planner-results').textContent = tr('Время изменилось. Проверьте занятость повторно.');
  }
  if (event.target.name !== 'planner-person') return;
  const form = $('#event-form'), input = form.elements.attendees;
  const emails = input.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).filter(email => email.toLowerCase() !== event.target.value.toLowerCase());
  if (event.target.checked) emails.push(event.target.value);
  input.value = emails.join(', '); $('#planner-results').innerHTML = tr('<p class="form-note">Состав участников изменился. Проверьте занятость.</p>');
});
document.addEventListener('change', event => { if (event.target.id === 'calendar-mode') { calendarPreference = event.target.value; localPreferences.setItem('aster-calendar-view', calendarPreference); loadView(); } });
function addComposeFiles(files) {
  const combined = composeData.attachments.concat([...files]);
  if (combined.reduce((total, file) => total + file.size, 0) + (composeData.draftOriginal?.attachments || []).reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) {
    $('#compose-form .form-error[role="alert"]').textContent = tr('Суммарный размер вложений превышает 20 МБ');
    return;
  }
  composeData.attachments = combined;
  if (files.length) markModalDirty();
  $('#compose-form .form-error[role="alert"]').textContent = '';
  $('#picked-files').replaceChildren(...combined.map((file, index) => {
    const row = document.createElement('div'), remove = document.createElement('button');
    row.textContent = `${file.name} · ${bytes(file.size)} `;
    remove.type = 'button'; remove.textContent = tr('Удалить'); remove.className = 'secondary';
    remove.setAttribute('aria-label', `${tr("Удалить вложение")} ${file.name}`);
    remove.addEventListener('click', () => { if (!modalBusy) { composeData.attachments.splice(index, 1); markModalDirty(); addComposeFiles([]); } });
    row.append(remove); return row;
  }));
}
document.addEventListener('change', event => {
  if (event.target.id !== 'files') return;
  if (!modalBusy) addComposeFiles(event.target.files);
  event.target.value = '';
});
document.addEventListener('change', event => { if (event.target.name === 'syncSignature') refreshSignatureField().catch(showError); });
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'search-form') { state.query = $('#search').value.trim(); if (state.view === 'calendar') renderCalendar(); else loadView(); return; }
  if (form.id === 'meeting-reminder-form') { submitMeetingReminder(form); return; }
  if (form.id === 'meeting-message-form') { submitMeetingMessage(form); return; }
  if (form.id === 'event-form' && form.dataset.editing === 'true') { submitMeetingEdit(form); return; }
  if (form.id === 'directory-form') { searchDirectory(form); return; }
  if (form.id === 'compose-form') { sendCompose(false); return; }
  if (form.id === 'settings-form') {
    submitForm(form, async data => {
      const next = { mail: Boolean(data.notifyMail), meetings: Boolean(data.notifyMeetings), sounds: Boolean(data.notifySounds), preview: Boolean(data.notifyPreview), minutes: Number(data.minutes), timeZone: data.timeZone, theme: data.theme, language: data.language };
      T.zone(next.timeZone);
      notificationPreferences = window.aster ? await api('saveNotifications', next) : next;
      applyLanguage(next.language);
      timeZone = next.timeZone; localPreferences.setItem('aster-time-zone', timeZone);
      miniMonthCursor = null;
      if (data.syncSignature) await getServerSignature();
      syncSignature = Boolean(data.syncSignature); localPreferences.setItem('aster-signature-sync', String(syncSignature));
      if (!syncSignature) state.signature = data.signature;
      state.theme = data.theme;
      navigationPlacement = data.navigationPlacement === 'bottom' ? 'bottom' : 'sidebar';
      localPreferences.setItem('aster-navigation-placement', navigationPlacement);
      renderSidebar();
      localPreferences.setItem('aster-signature', state.signature); localPreferences.setItem('aster-theme', state.theme);
      await localSave;
      document.body.classList.toggle('dark', state.theme === 'dark'); $('#modal').close(); toast(tr('Настройки сохранены'));
      if (ready()) await loadView(); else welcome();
    }); return;
  }
  if (form.id === 'connect-form') submitForm(form, async data => {
    const connected = await api('connect', { ...data, ...window.asterServer.address(data.protocol, data.server), remember: Boolean(data.remember) });
    form.elements.password.value = ''; data.password = '';
    applyAccount(connected);
    state.demo = false; state.messages = []; state.selected = null; state.contacts = []; state.events = []; state.folders = [];
    state.query = ''; $('#search').value = ''; $('#modal').close();
    await loadView();
  });
  if (form.id === 'event-form') submitForm(form, async data => {
    data.start = T.fromWall(data.start, timeZone).toISOString(); data.end = T.fromWall(data.end, timeZone).toISOString();
    if (new Date(data.end) <= new Date(data.start)) throw new Error(tr('Окончание должно быть позже начала'));
    if (state.demo) window.asterDemo.events.push({ id: `demo-event-${Date.now()}`, title: data.title, start: data.start, end: data.end, location: data.location, preview: data.body, isOrganizer: true, response: 'Organizer', organizer: { name: tr('Вы'), email: 'you@example.com' } }); else await api('createEvent', data);
    state.week = new Date(data.start); state.view = 'calendar'; state.query = ''; $('#search').value = ''; $('#modal').close(); toast(state.demo ? tr('Демо: встреча создана') : tr('Встреча создана в Exchange')); await loadView();
  });
  if (form.id === 'contact-form') submitForm(form, async data => {
    if (state.demo) window.asterDemo.contacts.push({ id: `c-${Date.now()}`, ...data }); else await api('createContact', data);
    state.view = 'contacts'; state.query = ''; $('#search').value = ''; $('#modal').close(); toast(state.demo ? tr('Демо: контакт добавлен') : tr('Контакт сохранён в Exchange')); await loadView();
  });
});
function applyAccount(value) {
  connectionState = { status: value ? 'connected' : 'disconnected' };
  state.recoverView = null; state.recoverMessage = null;
  window.asterMailFind?.reset();
  state.generation++; messageOpenSequence++; readingMessages.clear();
  localValues = value?.localData || {}; localSave = Promise.resolve();
  const { localData, notifications, ...identity } = value || {};
  state.account = value ? identity : null; state.demo = false;
  mailSelection.clear(); mailSelectionScope = '';
  state.messages = []; state.selected = null; state.contacts = []; state.events = []; state.folders = [];
  state.folder = 'inbox'; state.view = 'mail'; state.filter = 'all'; state.offset = 0; state.more = false;
  state.signature = localPreferences.getItem('aster-signature') || '';
  state.theme = localPreferences.getItem('aster-theme') || 'light';
  if (notifications?.language) applyLanguage(notifications.language);
  notificationPreferences = notifications || { mail: true, meetings: true, sounds: true, minutes: 15, preview: false };
  timeZone = notificationPreferences.timeZone || 'system';
  calendarPreference = localPreferences.getItem('aster-calendar-view') || 'auto';
  navigationPlacement = localPreferences.getItem('aster-navigation-placement') === 'bottom' ? 'bottom' : 'sidebar';
  syncSignature = localPreferences.getItem('aster-signature-sync') === 'true';
  sidebarCollapsed = localPreferences.getItem('aster-sidebar-collapsed') === 'true';
  serverSignature = null; composeData = null; activeMeeting = null; meetingEdit = null; meetingRequest++;
  moveRuleContext = null; mailDrag = null; mailPeopleChoices = []; contactCardContext = null; state.searchObjects = null;
  colleagueData = []; directoryResults = []; directoryRequest++; colleagueRequest++;
  state.query = ''; $('#search').value = ''; renderMailAlerts([]);
  $('#people-search-suggestions')?.replaceChildren();
  document.body.classList.toggle('dark', state.theme === 'dark'); renderSidebar();
}
async function boot() {
  if (window.aster) await api('setLanguage', { language: window.asterI18n.language });
  renderSidebar(); welcome();
  if (window.aster) {
    window.aster.onUpdate(receiveUpdate);
    receiveUpdate(await api('updateState'));
    const savedSettings = await api('notificationSettings');
    timeZone = savedSettings.timeZone || 'system';
    notificationPreferences = savedSettings;
    window.aster.onSound(playSound);
    window.aster.onMailAlerts(renderMailAlerts);
    window.aster.onInbox(snapshot => { void receiveInbox(snapshot); });
    window.aster.onConnection?.(receiveConnection);
    renderMailAlerts(await api('mailAlerts'));
    window.aster.onNavigate(async data => {
      try {
      if (!['mail', 'calendar'].includes(data.view)) return;
      if ($('#modal').open) { toast(tr('Сначала завершите работу с открытым окном. Уведомление сохранено в клиенте.')); return; }
      state.filter = 'all';
      state.view = data.view; state.folder = 'inbox'; state.query = ''; $('#search').value = '';
      if (data.date) state.week = new Date(data.date);
      if (data.eventId) calendarPreference = 'day';
      await loadView();
      if (data.id) {
        if (!state.messages.some(m => m.id === data.id)) state.messages.push(await api('message', { id: data.id }));
        await openMessage(data.id); await api('dismissMailAlert', { id: data.id });
      }
      if (data.eventId && state.view === 'calendar') {
        const button = [...document.querySelectorAll('[data-action="event"]')].find(button => button.dataset.id === data.eventId);
        if (button) await handleAction(button).catch(showError);
      }
      } catch (error) { showError(error); }
    });
    try { const restored = await api('restore'); if (restored) { applyAccount(restored); await loadView(); } }
    catch (error) { showError(error); }
  }
}
function preserveListFocus(container) {
  const active = document.activeElement;
  if (!container?.contains(active)) return () => {};
  const identity = { ...active.dataset };
  const buttons = [...container.querySelectorAll('button,input[type="checkbox"]')], index = buttons.indexOf(active);
  return () => {
    const replacements = [...container.querySelectorAll('button,input[type="checkbox"]')];
    const replacement = active.isConnected ? active : replacements.find(button => Object.entries(identity).every(([key, value]) => button.dataset[key] === value)) || replacements[Math.min(index, replacements.length - 1)];
    replacement?.focus({ preventScroll: true });
  };
}
let modalDirty = false;
function setModalDirty(value) {
  modalDirty = value;
  window.aster?.setUnsavedChanges?.(value);
}
function markModalDirty() { setModalDirty(true); }
function confirmDiscardChanges() {
  return !modalDirty || confirm(tr('Закрыть без сохранения изменений?'));
}
for (const name of ['input', 'change']) document.addEventListener(name, event => {
  if (event.target.closest('#compose-form, #event-form, #meeting-message-form, #meeting-reminder-form')) setModalDirty(true);
});
$('#modal').addEventListener('close', () => { setModalDirty(false); resumeConnectionReads(); });
document.addEventListener('click', event => {
  if (event.target.closest('[data-action="planner-slot"]') && $('#event-form')) setModalDirty(true);
  if (!event.target.closest('[data-action="meeting-return"]') || !modalDirty) return;
  if (modalBusy || !confirmDiscardChanges()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  setModalDirty(false);
}, true);
window.addEventListener('beforeunload', event => {
  if (!modalDirty || window.aster) return;
  event.preventDefault(); event.returnValue = '';
});
new ResizeObserver(() => {
  if (state.view === 'calendar' && ready() && $('#calendar-mode') && calendarMode() !== renderedCalendarMode) void loadView();
}).observe($('#workspace'));
setInterval(() => { if (state.view === 'contacts' && ready()) void refreshColleagues(); }, 60000);
boot();

/* global DOMPurify */
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const initials = name => (name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
const avatar = (name, tone = 0) => `<div class="avatar tone-${tone % 5}">${esc(initials(name))}</div>`;
const dateFormat = (value, options) => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('ru-RU', options).format(new Date(value)) : '';
const time = value => dateFormat(value, { hour: '2-digit', minute: '2-digit' });
const dayKey = value => { const d = new Date(value); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const bytes = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
const ref = value => ({ id: value.id, changeKey: value.changeKey });
const systemFolders = [
  ['inbox', 'Входящие', 'inbox'], ['sentitems', 'Отправленные', 'send'], ['drafts', 'Черновики', 'file'],
  ['archive', 'Архив', 'archive'], ['deleteditems', 'Корзина', 'trash'], ['junkemail', 'Нежелательная почта', 'shield'],
];
const state = { demo: false, account: null, view: 'mail', folder: 'inbox', folders: [], messages: [], selected: null, filter: 'all', query: '', more: false, offset: 0, week: new Date(), events: [], contacts: [], generation: 0, signature: localStorage.getItem('aster-signature') || '', theme: localStorage.getItem('aster-theme') || 'light' };
let toastTimer, composeData, modalBusy = false;
let calendarPreference = localStorage.getItem('aster-calendar-view') || 'auto';
let renderedCalendarMode;
let navigationPlacement = localStorage.getItem('aster-navigation-placement') === 'bottom' ? 'bottom' : 'sidebar';
const calendarMode = () => window.asterCalendar.mode(calendarPreference, $('#workspace').clientWidth);
const calendarRange = () => window.asterCalendar.range(state.week, calendarMode());
let syncSignature = localStorage.getItem('aster-signature-sync') === 'true';
let serverSignature = null;
let sidebarCollapsed = localStorage.getItem('aster-sidebar-collapsed') === 'true';
document.body.classList.toggle('desktop', Boolean(window.aster));
async function getServerSignature() {
  const value = state.demo ? { html: '<p>С уважением,<br><b>Команда Aster</b></p>', text: 'С уважением,\nКоманда Aster', autoAddSignature: true, autoAddSignatureOnReply: true } : await api('signature');
  const html = DOMPurify.sanitize(value.html || '', { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'svg', 'math'] });
  let text = value.text || '';
  if (!text && html) {
    const document = new DOMParser().parseFromString(DOMPurify.sanitize(html, { FORBID_TAGS: ['img'] }), 'text/html');
    document.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    document.querySelectorAll('p,div,tr,li').forEach(el => el.append('\n'));
    text = document.body.textContent.trim();
  }
  serverSignature = { ...value, html, text };
  return serverSignature;
}
async function refreshSignatureField() {
  const form = $('#settings-form'); if (!form) return;
  const input = form.elements.signature, checkbox = form.elements.syncSignature, status = $('#signature-status');
  input.readOnly = checkbox.checked;
  if (!checkbox.checked) { input.value = state.signature; status.textContent = 'Используется локальная подпись.'; return; }
  status.textContent = 'Загружаем подпись из OWA…';
  try {
    const signature = await getServerSignature();
    if (!$('#settings-form') || !checkbox.checked) return;
    input.value = signature.text;
    status.textContent = signature.text || signature.html ? 'Подпись загружена из OWA. Форматирование сохранится при отправке; настройки OWA для новых писем и ответов учитываются.' : 'На сервере сохранена пустая подпись.';
  } catch (error) {
    checkbox.checked = false; input.readOnly = false; input.value = state.signature;
    status.textContent = `Не удалось получить подпись: ${error.message}`;
  }
}
let notificationPreferences = { mail: true, meetings: true, sounds: true, minutes: 15, preview: false };
function playSound(kind) {
  if (!['mail', 'meeting'].includes(kind)) return;
  const audio = new Audio(`../assets/sounds/aster-${kind}.wav`);
  audio.volume = 0.65;
  audio.play().catch(() => toast('Звук заблокирован системой. Проверьте настройки звука и уведомлений.'));
}
document.body.classList.toggle('dark', state.theme === 'dark');
async function api(operation, data = {}) {
  if (!window.aster) throw new Error('Подключение OWA доступно в настольном приложении. В браузере можно открыть деморежим.');
  const result = await window.aster.invoke(operation, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function showError(error) { $('#error').textContent = error.message || error; $('#error').hidden = false; $('#status').textContent = 'Не удалось завершить операцию'; }
function clearError() { $('#error').hidden = true; }
function modal(title, description, body) {
  if (modalBusy) return;
  delete $('#modal').dataset.eventId;
  $('#modal-content').innerHTML = `<div class="modal-header"><div><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="Закрыть">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if (!$('#modal').open) $('#modal').showModal();
}
function field(name, label, value = '', type = 'text', required = false) {
  return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
}
function textField(name, label, value = '', cls = '') { return `<label class="field"><span>${esc(label)}</span><textarea name="${name}" class="${cls}">${esc(value)}</textarea></label>`; }
function formError() { return '<div class="form-error" role="alert"></div>'; }
function ready() { return state.demo || state.account; }
function renderSidebar() {
  const dock = $('.bottom-dock');
  $('.statusbar').prepend(dock);
  const isMail = state.view === 'mail';
  const unreadCount = state.demo ? window.asterDemo.messages.filter(m => m.folder === 'inbox' && !m.read).length : null;
  const folderButtons = systemFolders.map(([id, name, symbol]) => `<button class="folder ${isMail && state.folder === id ? 'active' : ''}" data-action="folder" data-folder="${id}" title="${name}" aria-label="${name}">${icon(symbol)}<span class="folder-label">${name}</span>${id === 'inbox' && unreadCount ? `<span class="count">${unreadCount}</span>` : ''}</button>`).join('');
  const custom = state.folders.map(f => `<button class="folder ${isMail && state.folder === f.id ? 'active' : ''}" data-action="folder" data-folder="${esc(f.id)}" title="${esc(f.name)}" aria-label="${esc(f.name)}">${icon('folder')}<span class="folder-label">${esc(f.name)}</span>${f.unread ? `<span class="count">${f.unread}</span>` : ''}</button>`).join('');
  $('#sidebar').innerHTML = `<div class="wordmark"><span class="brand-star" aria-hidden="true">✳</span><span class="brand-text">aster<span> mail</span></span></div><button class="primary sidebar-compose" data-action="compose" aria-label="Написать письмо" title="Написать письмо">${icon('plus')}<span>Написать письмо</span></button>
    <div class="sidebar-scroll"><div class="nav-caption">Почта</div><nav class="folder-list" aria-label="Папки почты">${folderButtons}</nav><div class="sidebar-divider"></div><div class="nav-caption">Папки Exchange</div><div class="custom-folders">${custom || '<div class="folder muted sidebar-placeholder">Появятся после подключения</div>'}</div>
    </div><div id="sidebar-dock"></div><button class="account-card" data-action="settings" title="Настройки аккаунта" aria-label="Настройки аккаунта"><div class="account-avatar">${esc(initials(state.account?.username || 'Aster'))}</div><div class="account-info"><strong>${esc(state.account?.username || (state.demo ? 'Демоаккаунт' : 'Ваш аккаунт'))}</strong><small>${state.account ? esc(new URL(state.account.server).hostname) : state.demo ? 'Вымышленные данные' : 'Подключить Exchange'}</small></div></button>`;
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
  toggle.setAttribute('aria-label', hidden ? 'Раскрыть меню папок' : 'Свернуть меню папок');
  toggle.title = hidden ? 'Раскрыть меню папок' : 'Свернуть меню папок';
  $('#sidebar-resize').setAttribute('aria-valuenow', hidden ? '0' : '1');
  const create = $('#quick-create');
  create.dataset.action = { mail: 'compose', calendar: 'new-event', contacts: 'new-contact' }[state.view];
  create.innerHTML = `${icon('plus')}<span>${{ mail: 'Написать', calendar: 'Встреча', contacts: 'Контакт' }[state.view]}</span>`;
  create.setAttribute('aria-label', { mail: 'Написать', calendar: 'Создать встречу', contacts: 'Новый контакт' }[state.view]);
  document.body.classList.toggle('mail-view', isMail);
  $('#search').placeholder = { mail: 'Поиск по почтовому ящику', calendar: 'Поиск по календарю', contacts: 'Поиск людей в Exchange' }[state.view];
  $('#connection').innerHTML = `<i></i>${state.demo ? 'Деморежим' : state.account ? 'Exchange · HTTPS' : 'Не подключено'}`;
  $('#demo-banner').hidden = !state.demo;
}
function welcome() {
  $('#workspace').innerHTML = `<div class="welcome"><div class="hero-symbol">✳</div><div class="eyebrow">Пространство для важного</div><h1>Меньше шума.<br>Больше ясности.</h1><p>Почта, встречи и люди — в одном спокойном рабочем пространстве. Подключите корпоративный Exchange и начните свой день с Aster.</p><div class="welcome-actions"><button class="primary" data-action="connect">${icon('plus')}Подключить OWA</button><button class="secondary" data-action="demo">Посмотреть демо ${icon('chevron')}</button></div><div class="welcome-foot">${icon('shield')}Прямое подключение к вашему серверу · Без облака Aster</div></div>`;
}
async function loadView(append = false) {
  renderSidebar(); clearError();
  const generation = ++state.generation;
  if (!ready()) return welcome();
  if (!append) $('#workspace').innerHTML = `<div class="loading">${icon('refresh')}Загружаем ${state.view === 'mail' ? 'почту' : state.view === 'calendar' ? 'календарь' : 'контакты'}…</div>`;
  $('#status').textContent = 'Обновление…';
  try {
    if (state.view === 'mail') {
      let result;
      if (state.demo) {
        const matches = window.asterDemo.messages.filter(m => state.query ? `${m.subject} ${m.preview} ${m.from.name} ${m.from.email}`.toLowerCase().includes(state.query.toLowerCase()) : m.folder === state.folder);
        result = { items: structuredClone(matches), more: false };
      } else result = await api(state.query ? 'search' : 'messages', { folder: state.folder, query: state.query, offset: append ? state.offset : 0 });
      if (generation !== state.generation) return;
      state.messages = append ? [...state.messages, ...result.items] : result.items; state.more = result.more; state.offset = state.messages.length;
      if (!append) state.selected = null;
      renderMail();
      if (state.messages.length && !append && matchMedia('(min-width: 901px)').matches) await openMessage(state.messages[0].id, generation);
    } else if (state.view === 'calendar') {
      const requestedMode = calendarMode();
      const { start, end } = window.asterCalendar.range(state.week, requestedMode);
      const events = state.demo ? structuredClone(window.asterDemo.events).filter(e => new Date(e.start) < end && new Date(e.end) > start) : await api('calendar', { start: start.toISOString(), end: end.toISOString() });
      if (generation !== state.generation) return;
      if (requestedMode !== calendarMode()) return loadView();
      state.events = events; renderCalendar();
    } else {
      const result = state.demo ? { items: structuredClone(window.asterDemo.contacts).filter(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(state.query.toLowerCase())), more: false } : await api('contacts', { query: state.query, offset: append ? state.contacts.length : 0 });
      if (generation !== state.generation) return;
      state.contacts = append ? [...state.contacts, ...result.items] : result.items; state.more = result.more; renderContacts(); void refreshColleagues();
    }
    if (generation === state.generation) $('#status').textContent = state.demo ? 'Демо · изменения сохраняются только до перезапуска' : `Обновлено ${time(new Date())} · Прямое подключение к Exchange`;
  } catch (error) {
    if (generation !== state.generation) return;
    showError(error);
    if (!append) $('#workspace').innerHTML = `<div class="empty">${icon('globe')}<h2>Не удалось загрузить данные</h2><p>Проверьте подключение и повторите запрос. Письма на сервере не затронуты.</p><button class="secondary" data-action="refresh">${icon('refresh')}Повторить</button></div>`;
  }
}
function filteredMessages() { return state.messages.filter(m => state.filter === 'all' || (state.filter === 'unread' ? !m.read : m.flagged)); }
function renderMail() {
  document.body.classList.toggle('reader-open', Boolean(state.selected));
  const title = state.query ? `Результаты поиска` : systemFolders.find(f => f[0] === state.folder)?.[1] || state.folders.find(f => f.id === state.folder)?.name || 'Письма';
  $('#workspace').innerHTML = `<div class="mail-list"><div class="list-heading"><div><h1>${esc(title)}</h1><small>${state.query ? esc(`«${state.query}» · весь ящик`) : 'Всё важное — на своём месте'}</small></div><span class="muted">${state.messages.length}${state.more ? '+' : ''}</span></div><div class="list-filters">${[['all', 'Все письма'], ['unread', 'Непрочитанные'], ['flagged', 'Избранное']].map(([id, text]) => `<button class="${state.filter === id ? 'active' : ''}" data-action="filter" data-filter="${id}">${text}</button>`).join('')}</div><div class="messages" id="messages"></div>${state.more ? '<button class="secondary load-more" data-action="more">Загрузить ещё</button>' : ''}</div><article class="reader" id="reader"></article>`;
  renderMessages();
  if (state.selected) renderReader(); else $('#reader').innerHTML = `<div class="empty">${icon('mail')}<h2>Место для ваших мыслей</h2><p>Выберите письмо, чтобы прочитать его, или напишите новое.</p></div>`;
}
function renderMessages() {
  let previousDay = '';
  const items = filteredMessages();
  $('#messages').innerHTML = items.map((m, i) => {
    const key = dayKey(m.date), label = key === dayKey(new Date()) ? 'Сегодня' : dateFormat(m.date, { day: 'numeric', month: 'long' });
    const heading = key !== previousDay ? `<div class="day-label">${esc(label)}</div>` : ''; previousDay = key;
    return `${heading}<button class="message-row ${!m.read ? 'unread' : ''} ${state.selected?.id === m.id ? 'selected' : ''}" data-action="message" data-id="${esc(m.id)}" aria-label="${esc(`${m.from.name || m.from.email}: ${m.subject}`)}">${!m.read ? '<i class="unread-dot"></i>' : ''}${avatar(m.from.name || m.from.email, i)}<div class="message-copy"><div class="row-top"><span class="sender">${esc(m.from.name || m.from.email || 'Неизвестный отправитель')}</span><time class="date">${esc(time(m.date))}</time></div><div class="subject">${esc(m.subject)}</div><div class="preview">${esc(m.preview || m.text || '')}</div>${m.hasAttachments || m.flagged || m.meeting ? `<div class="message-meta">${m.hasAttachments ? icon('clip') : ''}${m.flagged ? `<span class="starred">${icon('star')}</span>` : ''}${m.meeting ? '<span class="tag">Приглашение</span>' : ''}</div>` : ''}</div></button>`;
  }).join('') || '<div class="empty"><p>Здесь пока нет писем</p></div>';
}
async function openMessage(id, generation = state.generation) {
  const summary = state.messages.find(m => m.id === id);
  if (!summary) return;
  state.selected = summary; document.body.classList.add('reader-open'); renderMessages();
  $('#reader').innerHTML = `<div class="loading">${icon('refresh')}Открываем письмо…</div>`;
  try {
    const detail = state.demo ? structuredClone(summary) : await api('message', ref(summary));
    if (generation !== state.generation || state.selected?.id !== id) return;
    state.selected = { ...summary, ...detail }; renderReader();
    if (!summary.read && state.folder !== 'drafts') {
      if (!state.demo) {
        const updated = await api('change', { ref: ref(state.selected), field: 'IsRead', value: true });
        summary.changeKey = updated.changeKey;
        if (state.selected?.id === id) state.selected.changeKey = updated.changeKey;
      }
      summary.read = true;
      if (state.selected?.id === id) state.selected.read = true;
      if (state.demo) window.asterDemo.messages.find(m => m.id === id).read = true;
      if (state.selected?.id === id && generation === state.generation) { renderMessages(); renderSidebar(); }
    }
  } catch (error) { if (generation === state.generation) showError(error); }
}
function rsvpButtons(id, changeKey, cancelled = false) {
  if (cancelled) return '<p class="form-note" role="status">Встреча отменена организатором. Ответ не требуется.</p>';
  return `<div class="rsvp">${[['AcceptItem', 'Принять'], ['TentativelyAcceptItem', 'Под вопросом'], ['DeclineItem', 'Отклонить']].map(([response, name]) => `<button class="secondary" data-action="rsvp" data-response="${response}" data-id="${esc(id)}" data-key="${esc(changeKey || '')}">${name}</button>`).join('')}</div>`;
}
function renderReader() {
  const m = state.selected;
  if (!m) return;
  $('#reader').innerHTML = `<div class="reader-toolbar"><button class="secondary back-to-list" data-action="back-to-list">${icon('reply')}К письмам</button><button class="icon-button" data-action="archive" title="В архив" aria-label="В архив">${icon('archive')}</button><button class="icon-button" data-action="delete" title="В корзину" aria-label="В корзину">${icon('trash')}</button><span class="toolbar-divider"></span><button class="icon-button ${m.flagged ? 'starred' : ''}" data-action="flag" title="Избранное" aria-label="Избранное">${icon('star')}</button><button class="icon-button" data-action="unread" title="Отметить непрочитанным" aria-label="Отметить непрочитанным">${icon('mail')}</button><span class="reader-position">${state.messages.findIndex(v => v.id === m.id) + 1} из ${state.messages.length}</span></div><div class="reader-scroll"><div class="reader-content"><div class="eyebrow">${icon(m.meeting ? 'calendar' : 'mail')}${m.meeting ? 'Приглашение на встречу' : 'Личная переписка'}</div><h2>${esc(m.subject)}</h2><div class="sender-detail">${avatar(m.from.name || m.from.email)}<div><strong>${esc(m.from.name || m.from.email)}</strong><small>${esc(m.from.email)} · кому: ${esc(m.to?.map(a => a.name || a.email).join(', ') || 'вам')}</small></div><time class="date">${esc(dateFormat(m.date, { day: 'numeric', month: 'long' }))}<br>${esc(time(m.date))}</time></div>${m.meeting?.id ? `<div class="meeting-banner"><strong>${esc(m.meeting.location || 'Встреча')}</strong><p>${esc(dateFormat(m.meeting.start, { day: 'numeric', month: 'long' }))} · ${esc(time(m.meeting.start))}–${esc(time(m.meeting.end))}</p>${rsvpButtons(m.meeting.id, m.meeting.changeKey, m.meeting.cancelled)}</div>` : ''}<div class="privacy-note">${icon('shield')}Внешние изображения и активное содержимое заблокированы</div><div id="message-body"></div>${m.attachments?.length ? `<div class="attachments">${m.attachments.map(a => `<button class="attachment" data-action="attachment" data-id="${esc(a.id)}" data-name="${esc(a.name)}">${icon('file')}<span><strong>${esc(a.name)}</strong><small>${bytes(a.size || 0)} · Скачать</small></span></button>`).join('')}</div>` : ''}<div class="reply-actions"><button class="secondary" data-action="reply">${icon('reply')}Ответить</button><button class="secondary" data-action="reply-all">Ответить всем</button><button class="secondary" data-action="forward">Переслать ${icon('send')}</button></div></div></div>`;
  if (m.html) {
    const clean = DOMPurify.sanitize(m.html, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'svg', 'math'], FORBID_ATTR: ['style', 'background', 'srcset', 'action'] });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    doc.querySelectorAll('img').forEach(img => { const alt = doc.createElement('span'); alt.textContent = img.alt ? `[${img.alt}]` : '[Изображение заблокировано]'; img.replaceWith(alt); });
    const links = [];
    doc.querySelectorAll('a').forEach(a => { const href = a.getAttribute('href'); a.removeAttribute('href'); if (/^https?:\/\//i.test(href || '')) links.push(href); });
    const iframe = document.createElement('iframe'); iframe.className = 'email-frame'; iframe.title = 'Содержимое письма'; iframe.setAttribute('sandbox', '');
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:13px/1.9 -apple-system,BlinkMacSystemFont,sans-serif;color:#4d5063;margin:0 7px 0 0;overflow-wrap:anywhere}p{margin:0 0 18px}h3{font-size:13px;font-weight:600;margin:24px 0 12px}ul{padding-left:20px}li{padding:3px 0}a{color:#7760d6}table{max-width:100%;border-collapse:collapse}td{padding:5px;border:1px solid #eee}blockquote{border-left:2px solid #ddd;padding-left:15px;color:#888}</style></head><body>${doc.body.innerHTML}</body></html>`;
    // No same-origin permission: an email cannot inspect the app or invoke its IPC bridge.
    iframe.style.height = `${Math.min(800, Math.max(340, doc.body.textContent.length / 2.4))}px`;
    $('#message-body').append(iframe);
    if (links.length) {
      const container = document.createElement('div'); container.className = 'picked-files'; container.innerHTML = `<p>Ссылки в письме</p>${[...new Set(links)].map(url => `<button class="secondary" data-action="link" data-url="${esc(url)}">${icon('globe')}${esc(url.slice(0, 70))}</button>`).join(' ')}`; $('#message-body').append(container);
    }
  } else $('#message-body').innerHTML = `<div class="plain-body">${esc(m.text || m.preview || 'Нет текстового содержимого')}</div>`;
}
function calendarEvents(events, day) {
  const next = new Date(day); next.setDate(next.getDate() + 1);
  return events.filter(e => new Date(e.start) < next && new Date(e.end) > day).sort((a, b) => a.start.localeCompare(b.start));
}
function quarterMarkup(start, events) {
  return `<div class="quarter">${Array.from({ length: 3 }, (_, month) => {
    const first = new Date(start); first.setMonth(first.getMonth() + month);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return `<section class="quarter-month"><h2>${esc(dateFormat(first, { month: 'long' }))}</h2><div class="month-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<span class="weekday">${d}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({ length: count }, (_, i) => {
      const day = new Date(first); day.setDate(i + 1);
      const daily = calendarEvents(events, day);
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return `<button class="month-day ${dayKey(day) === dayKey(new Date()) ? 'is-today' : ''} ${daily.length ? 'has-events' : ''}" data-action="calendar-day" data-date="${date}" aria-label="${esc(dateFormat(day, { day: 'numeric', month: 'long' }))}, встреч: ${daily.length}" title="${esc(daily.map(e => e.title).join(' · ') || 'Нет встреч')}"><span>${i + 1}</span><small>${daily.length || ''}</small></button>`;
    }).join('')}</div></section>`;
  }).join('')}</div>`;
}
function renderCalendar() {
  const mode = calendarMode(); renderedCalendarMode = mode;
  const { start, end } = calendarRange();
  const events = state.events.filter(e => !state.query || `${e.title} ${e.location} ${e.preview}`.toLowerCase().includes(state.query.toLowerCase()));
  const title = mode === 'day' ? dateFormat(start, { day: 'numeric', month: 'long', year: 'numeric' }) : mode === 'quarter' ? `${Math.floor(start.getMonth() / 3) + 1}-й квартал · ${start.getFullYear()}` : dateFormat(start, { month: 'long', year: 'numeric' });
  const period = mode === 'day' ? 'день' : mode === 'quarter' ? 'квартал' : 'неделю';
  const grid = mode === 'quarter' ? quarterMarkup(start, events) : `<div class="week ${mode === 'day' ? 'day-view' : ''}">${Array.from({ length: mode === 'day' ? 1 : 7 }, (_, i) => {
    const day = new Date(start); day.setDate(day.getDate() + i);
    const daily = calendarEvents(events, day);
    return `<div class="week-day ${dayKey(day) === dayKey(new Date()) ? 'today' : ''}"><div class="day-heading">${esc(dateFormat(day, { weekday: mode === 'day' ? 'long' : 'short' }))}<span class="day-number">${day.getDate()}</span></div>${daily.map(e => `<button class="event-card" data-action="event" data-id="${esc(e.id)}"><time>${e.allDay ? 'Весь день' : `${esc(time(e.start))} — ${esc(time(e.end))}`}</time><strong>${esc(e.title)}</strong><small>${esc(e.location || 'Рабочий календарь')}</small></button>`).join('') || '<div class="no-events">Нет встреч</div>'}</div>`;
  }).join('')}</div>`;
  $('#workspace').innerHTML = `<div class="calendar-view"><div class="page-header"><div><h1>${esc(title)}</h1><p>${mode === 'day' ? 'Встречи выбранного дня.' : 'Ваши встречи в удобном масштабе.'}</p></div><div class="calendar-controls"><select id="calendar-mode" aria-label="Вид календаря">${[['auto', `Авто · ${window.asterCalendar.mode('auto', $('#workspace').clientWidth) === 'day' ? 'день' : 'неделя'}`], ['day', 'День'], ['week', 'Неделя'], ['quarter', 'Квартал']].map(([value, label]) => `<option value="${value}" ${calendarPreference === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="secondary" data-action="today">Сегодня</button><div class="calendar-arrows"><button class="icon-button flip" data-action="calendar-prev" aria-label="${mode === 'week' ? 'Предыдущая неделя' : `Предыдущий ${period}`}">${icon('chevron')}</button><button class="icon-button" data-action="calendar-next" aria-label="${mode === 'week' ? 'Следующая неделя' : `Следующий ${period}`}">${icon('chevron')}</button></div><button class="primary" data-action="new-event">${icon('plus')}Встреча</button></div></div>${grid}<div class="calendar-caption"><span>${icon('clock')} ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</span><span>${events.length} встреч за ${period}</span><span>${esc(dateFormat(start, { day: 'numeric', month: 'short' }))} — ${esc(dateFormat(new Date(end - 1), { day: 'numeric', month: 'short' }))}</span></div></div>`;
}
function colleaguesKey() { return `aster-colleagues:${state.demo ? 'demo' : `${state.account?.server || ''}|${state.account?.username || ''}`}`; }
function colleagues() {
  try { const saved = JSON.parse(localStorage.getItem(colleaguesKey()) || 'null'); return Array.isArray(saved) ? saved.filter(c => c && typeof c.email === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(c.email)).slice(0, 50) : state.demo ? window.asterDemo.contacts.slice(0, 4) : []; }
  catch { return []; }
}
let colleagueData = [], colleagueScope = '', colleagueUpdated = null, colleagueError = '', colleagueRequest = 0;
let directoryResults = [], directoryRequest = 0;
function saveColleagues(list) { localStorage.setItem(colleaguesKey(), JSON.stringify(list.map(c => ({ name: c.name, email: c.email, company: c.company || '' })))); }
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
  if (status.kind === 'unknown') return { ...status, text: 'Нет данных' };
  const until = dateFormat(status.until, { ...(dayKey(status.until) !== dayKey(new Date(at)) ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit' });
  const remaining = Math.max(1, Math.ceil((Date.parse(status.until) - at) / 60000));
  const duration = remaining < 60 ? `${remaining} мин` : `${Math.floor(remaining / 60)} ч${remaining % 60 ? ` ${remaining % 60} мин` : ''}`;
  const name = status.type === 'OOF' ? 'Нет на месте' : status.type === 'Tentative' ? 'Под вопросом' : 'Занят';
  return { ...status, text: status.kind === 'free' ? `${status.horizon ? 'Свободен · проверено до' : 'Свободен до'} ${until}` : `${name} до ${until} · ещё ${duration}` };
}
function renderColleagues() {
  if (!$('#colleagues-list')) return;
  const list = colleagues();
  if (colleagueScope !== colleaguesKey()) { colleagueData = []; colleagueUpdated = null; colleagueError = ''; }
  const rows = list.map(c => { const p = colleagueData.find(p => p.email.toLowerCase() === c.email.toLowerCase()); return { ...c, status: availabilityLabel(p) }; });
  $('#colleagues-count').textContent = `${rows.filter(c => c.status.kind === 'free').length} из ${list.length} свободны`;
  $('#colleagues-list').innerHTML = rows.map(c => `<div class="colleague-row">${avatar(c.name)}<div class="colleague-name"><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></div><span class="availability ${c.status.kind}" title="${esc(c.status.text)}"><i></i>${esc(c.status.text)}</span><button class="icon-button" data-action="plan-colleague" data-email="${esc(c.email)}" aria-label="Запланировать встречу: ${esc(c.name)}" title="Запланировать встречу">${icon('calendar')}</button><button class="icon-button" data-action="remove-colleague" data-email="${esc(c.email)}" aria-label="Убрать: ${esc(c.name)}" title="Убрать из коллег">${icon('close')}</button></div>`).join('') || '<p class="form-note">Добавьте людей из общего каталога Exchange кнопкой «+».</p>';
  $('#colleagues-updated').textContent = colleagueError ? `Не удалось обновить: ${colleagueError}` : `${state.demo ? 'Вымышленные статусы · ' : ''}${colleagueUpdated ? `Обновлено ${time(colleagueUpdated)} · проверка раз в минуту` : list.length ? 'Проверяем занятость…' : 'Избранные коллеги хранятся на этом компьютере.'}`;
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
  modal('Добавить коллег', 'Найдите человека в общем каталоге Exchange и закрепите его в списке.', `<form id="directory-form"><label class="field"><span>Имя или email</span><input name="query" required minlength="2" autocomplete="off" placeholder="Начните с имени коллеги"></label><button class="primary" type="submit">${icon('search')}Найти в Exchange</button>${formError()}</form><div id="directory-results" class="directory-results"></div>`);
}
async function searchDirectory(form) {
  const request = ++directoryRequest, query = form.elements.query.value.trim();
  await submitForm(form, async () => {
    const result = state.demo ? { items: window.asterDemo.contacts.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase())) } : await api('contacts', { query });
    if (request !== directoryRequest || !$('#directory-results')) return;
    directoryResults = result.items.filter(c => c.email);
    $('#directory-results').innerHTML = directoryResults.map((c, i) => `<div class="directory-row">${avatar(c.name)}<div><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></div><button class="secondary" data-action="add-colleague" data-index="${i}" ${colleagues().some(p => p.email.toLowerCase() === c.email.toLowerCase()) ? 'disabled' : ''}>${icon('plus')}Добавить</button></div>`).join('') || '<p class="form-note">По этому запросу людей с почтовым адресом не найдено.</p>';
  });
}
function plannerFingerprint(form) { return ['start', 'end', 'attendees'].map(name => form.elements[name].value).join('|'); }
async function runPlanner(button) {
  const form = $('#event-form'); if (!form) return;
  const box = $('#planner-results'), fingerprint = plannerFingerprint(form);
  const start = new Date(form.elements.start.value), end = new Date(form.elements.end.value);
  box.innerHTML = '<p class="form-note">Проверяем календарь участников…</p>'; button.disabled = true;
  try {
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end - start > 86400000) throw new Error('Укажите начало и окончание встречи в пределах суток.');
    const emails = form.elements.attendees.value.split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const own = state.demo ? 'you@example.com' : state.account?.username;
    if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(own || '')) emails.push(own.toLowerCase());
    const unique = [...new Set(emails)];
    
    const from = new Date(start); from.setHours(0, 0, 0, 0);
    const to = new Date(end); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    const people = unique.length ? await fetchAvailability(unique, from, to) : [];
    if (!unique.includes(own?.toLowerCase())) {
      const mine = await api('calendar', { start: from.toISOString(), end: to.toISOString() });
      people.push({ email: '__self__', start: from.toISOString(), end: to.toISOString(), blocks: mine.filter(e => !e.cancelled && !['Decline', 'Declined'].includes(e.response) && e.showAs !== 'Free').map(e => ({ start: e.start, end: e.end, type: 'Busy' })) });
    }
    if (!$('#event-form') || $('#event-form') !== form || plannerFingerprint(form) !== fingerprint) return;
    const duration = Math.ceil((end - start) / 60000);
    const free = window.asterAvailability.available(people, start, end);
    const suggestions = window.asterAvailability.suggestions(people, start, duration);
    const unknown = people.some(p => window.asterAvailability.status(p, +start).kind === 'unknown');
    box.innerHTML = `<div class="planner-verdict ${free ? 'free' : 'busy'}">${free ? 'Выбранное время свободно у всех проверенных участников' : unknown ? 'Есть недоступные данные или пересечения — свободное время не подтверждено' : 'Выбранное время пересекается с занятостью участников'}</div><div class="planner-people">${people.map(p => { const status = availabilityLabel(p, +start); return `<div><strong>${esc(colleagues().find(c => c.email.toLowerCase() === p.email.toLowerCase())?.name || (['__self__', own?.toLowerCase()].includes(p.email) ? 'Вы' : p.email))}</strong><span class="availability ${status.kind}"><i></i>${esc(status.text)}</span></div>`; }).join('')}</div><h4>Общее свободное время · ${esc(dateFormat(start, { day: 'numeric', month: 'long' }))}</h4><div class="planner-slots">${suggestions.map(slot => `<button type="button" class="secondary" data-action="planner-slot" data-start="${slot}" data-duration="${duration}">${esc(time(slot))}–${esc(time(new Date(Date.parse(slot) + duration * 60000)))}</button>`).join('') || '<p class="form-note">Общих интервалов с 09:00 до 18:00 не найдено. Выберите другой день или проверьте доступ к календарям.</p>'}</div><p class="form-note">${state.demo ? 'Деморежим: занятость вымышлена. ' : ''}Проверка с шагом 15 минут, с учётом всей длительности встречи. Ваш календарь включён. Перед отправкой можно проверить время повторно.</p>`;
  } catch (error) { if (box.isConnected && plannerFingerprint(form) === fingerprint) box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; }
  finally { button.disabled = false; }
}

function renderContacts() {
  $('#workspace').innerHTML = `<div class="contacts-view"><div class="page-header"><div><h1>${state.query ? 'Люди в Exchange' : 'Ваши контакты'}</h1><p>${state.query ? `Результаты для «${esc(state.query)}»` : 'Люди, с которыми вы создаёте важное.'}</p></div><div class="contact-actions"><button class="secondary" data-action="directory">${icon('people')}Общий каталог</button><button class="primary" data-action="new-contact">${icon('plus')}Новый контакт</button></div></div><section class="colleagues-panel"><header><h2>${icon('people')}Коллеги</h2><span id="colleagues-count"></span><button class="icon-button" data-action="refresh-colleagues" aria-label="Обновить занятость" title="Обновить занятость">${icon('refresh')}</button><button class="icon-button" data-action="directory" aria-label="Добавить коллег" title="Добавить коллег">${icon('plus')}</button><button class="icon-button" data-action="toggle-colleagues" aria-label="Свернуть список коллег" aria-expanded="true">${icon('chevron')}</button></header><div id="colleagues-list"></div><p id="colleagues-updated" class="form-note"></p></section><div class="contacts-grid">${state.contacts.map((c, i) => `<button class="contact-card" data-action="contact" data-id="${esc(c.id)}">${avatar(c.name, i)}<strong>${esc(c.name)}</strong><p>${esc(c.company || 'Контакт Exchange')}</p><small>${esc(c.email || 'Email не указан')}</small></button>`).join('')}</div>${!state.contacts.length ? '<p class="form-note">Добавьте личный контакт или найдите коллегу в общем каталоге Exchange.</p>' : ''}${state.more ? '<button class="secondary load-more" data-action="more">Загрузить ещё</button>' : ''}</div>`;
  renderColleagues();
}
function connectModal() {
  modal('Подключить Exchange', 'Используйте тот же адрес и логин, что в mac-owa-widget. Пароль отправляется только вашему серверу по HTTPS.', `<form id="connect-form">${field('server', 'Адрес OWA-сервера', state.account?.server || '', 'url', true)}${field('username', 'Логин · name@company.ru или DOMAIN\\login', state.account?.username || '', 'text', true)}${field('password', 'Пароль', '', 'password', true)}<label class="checkbox"><input name="remember" type="checkbox">Запомнить пароль в защищённом системном хранилище</label><p class="form-note">Поддерживаются формы OWA и NTLM на том же сервере. Если для работы нужен VPN, подключите его до входа. Сертификат должен быть доверен системой.</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="demo">Посмотреть демо</button><button class="primary" type="submit">Подключиться ${icon('chevron')}</button></div></form>`);
  $('input[name="server"]').placeholder = 'https://mail.company.ru/owa/';
}
async function compose(mode = 'new', contact = null) {
  if (!ready()) return connectModal();
  const source = syncSignature ? await getServerSignature() : null;
  const useServer = source && (mode === 'new' ? source.autoAddSignature : source.autoAddSignatureOnReply);
  const signatureText = source ? (useServer ? source.text : '') : state.signature;
  const m = state.selected;
  composeData = { kind: mode, reference: mode !== 'new' && m ? ref(m) : null, attachments: [], signature: useServer ? { html: source.html, text: source.text } : null };
  const recipients = mode === 'reply-all' ? [...new Set([m.from.email, ...(m.to || []).map(a => a.email), ...(m.cc || []).map(a => a.email)].filter(e => e && e.toLowerCase() !== state.account?.username?.toLowerCase()))].join(', ') : mode === 'reply' ? m.from.email : contact?.email || '';
  const prefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
  modal(mode === 'forward' ? 'Переслать письмо' : mode.startsWith('reply') ? 'Ответить' : 'Новое письмо', state.demo ? 'Деморежим: письмо не будет отправлено на сервер.' : 'Отправка через корпоративный Exchange по HTTPS.', `<form id="compose-form">${field('to', 'Кому · адреса через запятую', recipients, 'text', true)}${field('cc', 'Копия')}${field('subject', 'Тема', mode === 'new' ? '' : `${prefix}${m.subject.replace(/^(Re|Fwd):\s*/i, '')}`)}${textField('body', 'Сообщение', signatureText ? `\n\n${signatureText}` : '', 'compose-text')}<label class="attachment-picker">${icon('clip')}<input id="files" type="file" multiple aria-label="Прикрепить файлы"></label><div id="picked-files" class="picked-files"></div><p class="form-note">Вложения до 20 МБ суммарно. Для ответа и пересылки Exchange добавит исходное письмо; пересылка сохраняет исходные вложения.</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="save-draft">Сохранить черновик</button><button class="primary" type="submit">${icon('send')}Отправить</button></div></form>`);
}
function localDate(value) { const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function eventModal() {
  if (!ready()) return connectModal();
  const start = new Date(); start.setHours(start.getHours() + 1, 0, 0, 0); const end = new Date(start.getTime() + 3600000);
  modal('Новая встреча', 'Участники получат приглашения от вашего аккаунта Exchange.', `<form id="event-form">${field('title', 'Название встречи', '', 'text', true)}<div class="form-row">${field('start', 'Начало', localDate(start), 'datetime-local', true)}${field('end', 'Окончание', localDate(end), 'datetime-local', true)}</div>${field('location', 'Место или ссылка на встречу')}${field('attendees', 'Участники · email через запятую')}${textField('body', 'Описание и повестка')}<section class="planner"><h3>${icon('clock')}Помощник планирования</h3>${colleagues().length ? `<details><summary>Добавить избранных коллег</summary><div class="planner-favorites">${colleagues().map(c => `<label class="checkbox"><input type="checkbox" name="planner-person" value="${esc(c.email)}">${esc(c.name)}</label>`).join('')}</div></details>` : ''}<button type="button" class="secondary" data-action="planner-check">${icon('calendar')}Проверить занятость и найти время</button><div id="planner-results" aria-live="polite"></div></section><p class="form-note">Часовой пояс: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}. Без участников событие сохранится только в вашем календаре.</p>${formError()}<div class="modal-footer"><button class="primary" type="submit">${icon('calendar')}Создать и отправить приглашения</button></div></form>`);
}
function contactModal() {
  if (!ready()) return connectModal();
  modal('Новый контакт', 'Сохранится в личных контактах Exchange.', `<form id="contact-form">${field('name', 'Имя', '', 'text', true)}${field('email', 'Email', '', 'email', true)}${field('company', 'Компания / команда')}${field('phone', 'Телефон', '', 'tel')}${formError()}<div class="modal-footer"><button class="primary" type="submit">Сохранить контакт</button></div></form>`);
}
async function settingsModal() {
  if (window.aster) notificationPreferences = await api('notificationSettings');
  const p = notificationPreferences;
  const checkbox = (name, text, value) => `<label class="checkbox"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${text}</label>`;
  modal('Настройки Aster', 'Спокойное пространство, настроенное под вас.', `<form id="settings-form">
    <p class="form-note">${state.account ? `Аккаунт: ${esc(state.account.username)} · ${esc(state.account.server)}` : state.demo ? 'Сейчас открыт демонстрационный аккаунт.' : 'Аккаунт Exchange пока не подключён.'}</p>
    ${checkbox('syncSignature', 'Использовать подпись из OWA', syncSignature)}
    ${textField('signature', 'Подпись для новых писем и ответов', syncSignature ? serverSignature?.text || '' : state.signature)}
    <button class="secondary" type="button" data-action="refresh-signature">Обновить подпись из OWA</button>
    <p id="signature-status" class="form-note" role="status">Подпись загружается с сервера при создании письма. Настройки сервера не изменяются.</p>
    <label class="field"><span>Оформление</span><select name="theme"><option value="light" ${state.theme === 'light' ? 'selected' : ''}>Светлое</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Тёмное</option></select></label>
    <h3 class="settings-heading">Навигация</h3>
    <label class="field"><span>Размещение карточек разделов</span><select name="navigationPlacement"><option value="sidebar" ${navigationPlacement === 'sidebar' ? 'selected' : ''}>Слева · под папками, над аккаунтом</option><option value="bottom" ${navigationPlacement === 'bottom' ? 'selected' : ''}>Внизу окна · горизонтальная панель</option></select></label>
    <h3 class="settings-heading">Уведомления и звуки</h3>
    ${checkbox('notifyMail', 'Всплывающие уведомления о новых письмах', p.mail)}
    ${checkbox('notifyMeetings', 'Напоминания о встречах', p.meetings)}
    <label class="field"><span>Напоминать о встрече</span><select name="minutes">${[0, 5, 10, 15, 30].map(n => `<option value="${n}" ${p.minutes === n ? 'selected' : ''}>${n ? `За ${n} минут` : 'В момент начала'}</option>`).join('')}</select></label>
    ${checkbox('notifySounds', 'Звук нового письма и отдельный звук встречи', p.sounds)}
    ${checkbox('notifyPreview', 'Показывать отправителя и тему в уведомлении', p.preview)}
    <div class="sound-tests"><button type="button" class="secondary" data-action="test-notification" data-kind="mail">${icon('mail')}Проверить письмо</button><button type="button" class="secondary" data-action="test-notification" data-kind="meeting">${icon('calendar')}Проверить встречу</button></div>
    <p class="form-note">Оригинальные звуки Aster — CC0: можно свободно использовать и изменять. ${window.aster ? 'Проверка показывает баннер и воспроизводит звук. На macOS Aster играет звук напрямую, с обычной громкостью аудиовыхода.' : 'В браузере проверяется только звук. Системные уведомления доступны в приложении.'}</p>
    <p class="form-note">Разрешите баннеры и звуки для Aster Mail в системных настройках macOS → Уведомления. Проверка Exchange — раз в минуту. После закрытия окна Aster остаётся в строке меню; после полного выхода и во время сна проверки не выполняются.</p>
    ${p.lastPoll ? `<p class="form-note">Последняя фоновая проверка: ${esc(time(p.lastPoll))}</p>` : ''}${p.error ? `<p class="form-error">${esc(p.error)}</p>` : ''}
    <p class="form-note">Подпись хранится на этом компьютере. Письма и вложения не сохраняются для офлайн-доступа в версии 0.1.</p>
    ${formError()}<div class="modal-footer"><button class="secondary ${state.account ? 'danger' : ''}" type="button" data-action="${state.account ? 'disconnect' : 'connect'}">${state.account ? 'Выйти и удалить пароль' : 'Подключить Exchange'}</button><button class="primary" type="submit">Сохранить</button></div></form>`);
  if (syncSignature) await refreshSignatureField();
}
async function submitForm(form, operation) {
  if (modalBusy) return;
  modalBusy = true; form.classList.add('busy'); form.querySelector('.form-error').textContent = '';
  try { await operation(Object.fromEntries(new FormData(form))); }
  catch (error) { form.querySelector('.form-error').textContent = error.message; }
  finally { modalBusy = false; form.classList.remove('busy'); }
}
async function sendCompose(save) {
  const form = $('#compose-form'); if (!form) return;
  if (!save && !form.reportValidity()) return;
  await submitForm(form, async data => {
    if (composeData.signature?.html && (!composeData.signature.text || data.body.endsWith(composeData.signature.text))) {
      const prefix = composeData.signature.text ? data.body.slice(0, -composeData.signature.text.length) : data.body;
      data.bodyHtml = `<div style="white-space:pre-wrap">${esc(prefix)}</div>${composeData.signature.html}`;
    }
    const files = [...$('#files').files];
    if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) throw new Error('Суммарный размер вложений превышает 20 МБ');
    const attachments = await Promise.all(files.map(async file => ({ name: file.name, type: file.type || 'application/octet-stream', content: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }) })));
    if (state.demo) {
      window.asterDemo.messages.unshift({ id: `demo-${Date.now()}`, subject: data.subject || '(Без темы)', from: { name: 'Вы', email: 'you@example.com' }, to: data.to.split(',').map(email => ({ name: '', email: email.trim() })), cc: [], date: new Date().toISOString(), preview: data.body.slice(0, 130), text: data.body, read: true, flagged: false, attachments: attachments.map((a, i) => ({ id: `demo-file-${i}`, name: a.name, size: files[i].size })), hasAttachments: !!attachments.length, folder: save ? 'drafts' : 'sentitems' });
    } else await api(save ? 'draft' : 'send', { ...data, ...composeData, attachments });
    $('#modal').close(); toast(state.demo ? `Демо: письмо ${save ? 'сохранено в черновиках' : 'добавлено в отправленные'}` : save ? 'Черновик сохранён в Exchange' : 'Письмо отправлено');
    if (state.folder === 'sentitems' || state.folder === 'drafts') await loadView();
  });
}
async function handleAction(button) {
  const { action } = button.dataset;
  if (action === 'back-to-list') { state.selected = null; renderMail(); return; }
  if (action === 'toggle-sidebar') {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('aster-sidebar-collapsed', String(sidebarCollapsed));
    renderSidebar(); return;
  }
  if (action === 'close') { if (!modalBusy) { if ($('#compose-form') && !confirm('Закрыть письмо без сохранения?')) return; $('#modal').close(); } return; }
  if (action === 'view') { state.view = button.dataset.view; state.query = ''; $('#search').value = ''; return loadView(); }
  if (action === 'connect') return connectModal();
  if (action === 'demo') {
    if (state.account) throw new Error('Сначала выйдите из аккаунта в настройках, чтобы открыть демо.');
    $('#modal').close(); state.demo = true; state.folder = 'inbox'; state.view = 'mail'; state.query = ''; state.filter = 'all'; $('#search').value = ''; return loadView();
  }
  if (action === 'settings') return settingsModal();
  if (action === 'refresh-signature') {
    $('#settings-form').elements.syncSignature.checked = true;
    return refreshSignatureField();
  }
  if (action === 'test-notification') {
    if (window.aster) { await api('testNotification', { kind: button.dataset.kind }); toast('Тест отправлен в системный центр уведомлений'); }
    else { playSound(button.dataset.kind); toast('Проверка звука. Баннеры работают в настольном приложении.'); }
    return;
  }
  if (action === 'theme') { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('aster-theme', state.theme); document.body.classList.toggle('dark', state.theme === 'dark'); return; }
  if (action === 'disconnect') {
    await api('disconnect'); state.account = null; state.demo = false; state.messages = []; state.selected = null; state.contacts = []; state.events = []; state.folders = []; $('#modal').close(); return loadView();
  }
  if (action === 'folder') { state.view = 'mail'; state.folder = button.dataset.folder; state.query = ''; state.filter = 'all'; $('#search').value = ''; return loadView(); }
  if (action === 'refresh') return loadView();
  if (action === 'more') return loadView(true);
  if (action === 'filter') { state.filter = button.dataset.filter; return renderMail(); }
  if (action === 'message') return openMessage(button.dataset.id);
  if (action === 'compose') return compose();
  if (['reply', 'reply-all', 'forward'].includes(action)) return compose(action);
  if (action === 'save-draft') return sendCompose(true);
  if (action === 'new-event') return eventModal();
  if (action === 'new-contact') return contactModal();
  if (action === 'calendar-day') { state.week = new Date(`${button.dataset.date}T00:00:00`); calendarPreference = 'day'; localStorage.setItem('aster-calendar-view', calendarPreference); return loadView(); }
  if (action === 'today' || ['calendar-prev', 'calendar-next'].includes(action)) {
    if (action === 'today') {
      state.week = new Date();
      if ($('#workspace').clientWidth < 700) { calendarPreference = 'auto'; localStorage.setItem('aster-calendar-view', calendarPreference); }
    } else state.week = window.asterCalendar.move(state.week, calendarMode(), action === 'calendar-next' ? 1 : -1);
    return loadView();
  }
  if (action === 'event') {
    const e = state.events.find(e => e.id === button.dataset.id); if (!e) return;
    modal(e.title, `${dateFormat(e.start, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(e.start)}–${time(e.end)}`, `<div class="event-details"><p>${esc(e.location)}</p><p>Организатор: ${esc(e.organizer?.name || e.organizer?.email || 'Не указан')}</p><div id="event-body">Загружаем описание…</div></div><div id="event-rsvp">${rsvpButtons(e.id, e.changeKey, e.cancelled)}</div>${formError()}`);
    $('#modal').dataset.eventId = e.id;
    const detail = state.demo ? { body: e.preview, attendees: [] } : await api('event', ref(e));
    if ($('#event-body') && $('#modal').dataset.eventId === e.id) {
      $('#event-body').innerHTML = `<pre>${esc(detail.body || 'Нет описания')}</pre>${detail.attendees.length ? `<p>Участники: ${esc(detail.attendees.map(a => a.name || a.email).join(', '))}</p>` : ''}`;
      e.cancelled ||= detail.cancelled;
      $('#event-rsvp').innerHTML = rsvpButtons(e.id, detail.ref?.changeKey || e.changeKey, e.cancelled);
    }
    return;
  }
  if (action === 'directory') return directoryModal();
  if (action === 'add-colleague' || action === 'pin-contact') {
    const c = action === 'add-colleague' ? directoryResults[Number(button.dataset.index)] : state.contacts.find(c => c.id === button.dataset.id);
    if (!c?.email) throw new Error('У контакта не указан email');
    const list = colleagues();
    if (!list.some(p => p.email.toLowerCase() === c.email.toLowerCase())) {
      if (list.length >= 50) throw new Error('Можно закрепить до 50 коллег');
      saveColleagues([...list, c]);
    }
    button.disabled = true; toast('Коллега добавлен'); renderColleagues(); void refreshColleagues(); return;
  }
  if (action === 'remove-colleague') { saveColleagues(colleagues().filter(c => c.email !== button.dataset.email)); renderColleagues(); return; }
  if (action === 'refresh-colleagues') return refreshColleagues();
  if (action === 'toggle-colleagues') { const list = $('#colleagues-list'); list.hidden = !list.hidden; button.setAttribute('aria-expanded', String(!list.hidden)); button.setAttribute('aria-label', list.hidden ? 'Развернуть список коллег' : 'Свернуть список коллег'); return; }
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
    modal('Контакт', '', `<div class="contact-detail">${avatar(c.name)}<h2>${esc(c.name)}</h2><p>${esc(c.company)}</p><p>${esc(c.email)}</p><p>${esc(c.phone)}</p><button class="secondary" data-action="pin-contact" data-id="${esc(c.id)}">${icon('plus')}Добавить в коллеги</button><button class="primary" data-action="write-contact" data-id="${esc(c.id)}">${icon('mail')}Написать письмо</button></div>`); return;
  }
  if (action === 'write-contact') return compose('new', state.contacts.find(c => c.id === button.dataset.id));
  if (action === 'rsvp') {
    const buttons = [...button.closest('.rsvp').querySelectorAll('button')];
    buttons.forEach(b => { b.disabled = true; });
    try {
      const result = state.demo ? { status: 'sent' } : await api('respond', { ref: { id: button.dataset.id, changeKey: button.dataset.key }, response: button.dataset.response });
      if (result.status === 'cancelled') {
        const event = state.events.find(e => e.id === button.dataset.id); if (event) event.cancelled = true;
        if (state.selected?.meeting?.id === button.dataset.id) state.selected.meeting.cancelled = true;
        button.closest('.rsvp').outerHTML = rsvpButtons(button.dataset.id, '', true);
        toast('Встреча отменена организатором. Ответ не отправлен.');
      } else {
        if ($('#modal').open) $('#modal').close();
        toast(state.demo ? 'Демо: ответ на приглашение принят' : 'Ответ отправлен организатору');
      }
    } catch (error) {
      if ($('#modal').open && $('#modal .form-error')) $('#modal .form-error').textContent = error.message;
      else throw error;
    } finally { buttons.forEach(b => { b.disabled = false; }); } return;
  }
  if (action === 'attachment') {
    if (state.demo) { const blob = new Blob(['Это демонстрационное вложение Aster Mail. Реальные файлы загружаются из Exchange.'], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Aster-demo.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    else await api('attachment', { id: button.dataset.id, name: button.dataset.name }); return;
  }
  if (action === 'link') { if (window.aster) await api('openLink', { url: button.dataset.url }); else toast('Открытие внешних ссылок доступно в настольном клиенте'); return; }
  if (['archive', 'delete', 'flag', 'unread'].includes(action) && state.selected) {
    const m = state.selected; button.disabled = true;
    try {
      if (action === 'flag' || action === 'unread') {
        const field = action === 'flag' ? 'Flag' : 'IsRead', value = action === 'flag' ? !m.flagged : false;
        if (!state.demo) { const updated = await api('change', { ref: ref(m), field, value }); m.changeKey = updated.changeKey; }
        const prop = action === 'flag' ? 'flagged' : 'read'; m[prop] = value;
        const listItem = state.messages.find(x => x.id === m.id); if (listItem) listItem[prop] = value;
        if (state.demo) window.asterDemo.messages.find(x => x.id === m.id)[prop] = value;
        renderMail();
      } else {
        const folder = action === 'archive' ? 'archive' : 'deleteditems';
        if (!state.demo) await api('move', { ref: ref(m), folder }); else window.asterDemo.messages.find(x => x.id === m.id).folder = folder;
        toast(action === 'archive' ? 'Письмо перемещено в архив' : 'Письмо перемещено в корзину'); await loadView();
      }
    } finally { button.disabled = false; }
  }
}
document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button || button.disabled) return; handleAction(button).catch(showError); });
$('#modal').addEventListener('cancel', event => { if (modalBusy || ($('#compose-form') && !confirm('Закрыть письмо без сохранения?'))) event.preventDefault(); });
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
  localStorage.setItem('aster-sidebar-collapsed', String(sidebarCollapsed));
}
sidebarResize.addEventListener('pointerup', finishSidebarDrag);
sidebarResize.addEventListener('pointercancel', finishSidebarDrag);
sidebarResize.addEventListener('lostpointercapture', finishSidebarDrag);
sidebarResize.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); sidebarCollapsed = ['ArrowLeft', 'Home'].includes(event.key);
  localStorage.setItem('aster-sidebar-collapsed', String(sidebarCollapsed)); renderSidebar();
});
document.addEventListener('input', event => {
  const form = event.target.closest('#event-form');
  if (form && ['start', 'end', 'attendees'].includes(event.target.name)) $('#planner-results').innerHTML = '<p class="form-note">Данные изменились. Проверьте занятость повторно.</p>';
});
document.addEventListener('change', event => {
  if (event.target.name !== 'planner-person') return;
  const form = $('#event-form'), input = form.elements.attendees;
  const emails = input.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).filter(email => email.toLowerCase() !== event.target.value.toLowerCase());
  if (event.target.checked) emails.push(event.target.value);
  input.value = emails.join(', '); $('#planner-results').innerHTML = '<p class="form-note">Состав участников изменился. Проверьте занятость.</p>';
});
document.addEventListener('change', event => { if (event.target.id === 'calendar-mode') { calendarPreference = event.target.value; localStorage.setItem('aster-calendar-view', calendarPreference); loadView(); } });
document.addEventListener('change', event => { if (event.target.id === 'files') $('#picked-files').textContent = [...event.target.files].map(f => `${f.name} · ${bytes(f.size)}`).join(' / '); });
document.addEventListener('change', event => { if (event.target.name === 'syncSignature') refreshSignatureField().catch(showError); });
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'search-form') { state.query = $('#search').value.trim(); if (state.view === 'calendar') renderCalendar(); else loadView(); return; }
  if (form.id === 'directory-form') { searchDirectory(form); return; }
  if (form.id === 'compose-form') { sendCompose(false); return; }
  if (form.id === 'settings-form') {
    submitForm(form, async data => {
      const next = { mail: Boolean(data.notifyMail), meetings: Boolean(data.notifyMeetings), sounds: Boolean(data.notifySounds), preview: Boolean(data.notifyPreview), minutes: Number(data.minutes) };
      notificationPreferences = window.aster ? await api('saveNotifications', next) : next;
      if (data.syncSignature) await getServerSignature();
      syncSignature = Boolean(data.syncSignature); localStorage.setItem('aster-signature-sync', String(syncSignature));
      if (!syncSignature) state.signature = data.signature;
      state.theme = data.theme;
      navigationPlacement = data.navigationPlacement === 'bottom' ? 'bottom' : 'sidebar';
      localStorage.setItem('aster-navigation-placement', navigationPlacement);
      renderSidebar();
      localStorage.setItem('aster-signature', state.signature); localStorage.setItem('aster-theme', state.theme);
      document.body.classList.toggle('dark', state.theme === 'dark'); $('#modal').close(); toast('Настройки сохранены');
    }); return;
  }
  if (form.id === 'connect-form') submitForm(form, async data => {
    state.account = await api('connect', { ...data, remember: Boolean(data.remember) });
    state.demo = false; state.messages = []; state.selected = null; state.contacts = []; state.events = []; state.folders = [];
    state.query = ''; $('#search').value = ''; $('#modal').close();
    await loadView();
    try { state.folders = await api('folders'); renderSidebar(); } catch { toast('Системные папки доступны. Дополнительные папки загрузить не удалось.'); }
  });
  if (form.id === 'event-form') submitForm(form, async data => {
    data.start = new Date(data.start).toISOString(); data.end = new Date(data.end).toISOString();
    if (new Date(data.end) <= new Date(data.start)) throw new Error('Окончание должно быть позже начала');
    if (state.demo) window.asterDemo.events.push({ id: `demo-event-${Date.now()}`, title: data.title, start: data.start, end: data.end, location: data.location, preview: data.body, organizer: { name: 'Вы', email: 'you@example.com' } }); else await api('createEvent', data);
    state.week = new Date(data.start); state.view = 'calendar'; state.query = ''; $('#search').value = ''; $('#modal').close(); toast(state.demo ? 'Демо: встреча создана' : 'Встреча создана в Exchange'); await loadView();
  });
  if (form.id === 'contact-form') submitForm(form, async data => {
    if (state.demo) window.asterDemo.contacts.push({ id: `c-${Date.now()}`, ...data }); else await api('createContact', data);
    state.view = 'contacts'; state.query = ''; $('#search').value = ''; $('#modal').close(); toast(state.demo ? 'Демо: контакт добавлен' : 'Контакт сохранён в Exchange'); await loadView();
  });
});
async function boot() {
  renderSidebar(); welcome();
  if (window.aster) {
    window.aster.onSound(playSound);
    window.aster.onNavigate(async data => {
      if (!['mail', 'calendar'].includes(data.view)) return;
      state.view = data.view; state.folder = 'inbox'; state.query = ''; $('#search').value = '';
      if (data.date) state.week = new Date(data.date);
      if (data.eventId) calendarPreference = 'day';
      await loadView();
      if (data.id && state.messages.some(m => m.id === data.id)) await openMessage(data.id);
      if (data.eventId && state.view === 'calendar') {
        const button = [...document.querySelectorAll('[data-action="event"]')].find(button => button.dataset.id === data.eventId);
        if (button) await handleAction(button).catch(showError);
      }
    });
    try { const restored = await api('restore'); if (restored) { state.account = restored; await loadView(); try { state.folders = await api('folders'); renderSidebar(); } catch { /* System folders remain usable. */ } } }
    catch (error) { showError(error); }
  }
}
new ResizeObserver(() => {
  if (state.view === 'calendar' && ready() && $('#calendar-mode') && calendarMode() !== renderedCalendarMode) void loadView();
}).observe($('#workspace'));
setInterval(() => { if (state.view === 'contacts' && ready()) void refreshColleagues(); }, 60000);
boot();

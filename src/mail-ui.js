function mailAttachments(message) {
  if (!message.attachments?.length) return '';
  const card = file => {
    const extension = /\.([a-z0-9]{1,8})$/i.exec(file.name || '')?.[1].toUpperCase() || 'FILE';
    const type = /^(PDF)$/.test(extension) ? 'pdf' : /^(DOCX?|ODT|RTF)$/.test(extension) ? 'document' : /^(XLSX?|CSV|ODS)$/.test(extension) ? 'sheet' : /^(JPE?G|PNG|GIF|WEBP|HEIC)$/.test(extension) ? 'image' : /^(ZIP|RAR|7Z|TAR|GZ)$/.test(extension) ? 'archive' : 'file';
    return `<article class="mail-attachment"><span class="file-extension extension-${type}">${esc(extension)}</span><div><button type="button" class="attachment-open" data-action="open-attachment" data-id="${esc(file.id)}" aria-label="Открыть вложение: ${esc(file.name)}" title="Открыть в системном приложении">${esc(file.name)}</button><small>${bytes(file.size || 0)}</small><button type="button" data-action="attachment" data-id="${esc(file.id)}" data-name="${esc(file.name)}" aria-label="Сохранить как: ${esc(file.name)}">Сохранить как…</button></div></article>`;
  };
  const files = message.attachments;
  return `<section class="mail-attachments-top attachments-count-${Math.min(files.length, 4)}" aria-label="Вложения письма"><div class="mail-attachment-grid attachment-preview">${files.slice(0, 3).map(card).join('')}</div>${files.length > 1 ? `<details class="attachment-more"><summary><span class="attachment-expand">Все вложения (${files.length})</span><span class="attachment-collapse">Свернуть вложения</span></summary><div class="mail-attachment-grid attachment-rest">${files.slice(1).map(card).join('')}</div></details>` : ''}</section>`;
}
function renderSignaturePreview(target, signature) {
  if (!target) return;
  if (!signature.html) { target.textContent = signature.text; return; }
  window.asterRichContent.render(target, signature.html, { dark: state.theme === 'dark', title: 'Подпись OWA', loadImages: async () => ({ images: signature.images || {}, errors: signature.errors || {} }), openLink: url => window.aster ? api('openLink', { url }).catch(showError) : undefined });
  if (Object.keys(signature.errors || {}).length) { const note = document.createElement('p'); note.className = 'form-error'; note.textContent = 'Не все картинки подписи доступны. Обновите подпись перед отправкой.'; target.append(note); }
}
async function toggleMailProperty(id, field) {
  const message = state.messages.find(item => item.id === id); if (!message) return;
  if (readingMessages.has(id)) await readingMessages.get(id);
  const key = field === 'Flag' ? 'flagged' : 'importance', value = field === 'Flag' ? !message.flagged : message.importance === 'High' ? 'Normal' : 'High';
  if (!state.demo) { const updated = await api('change', { ref: ref(message), field, value }); message.changeKey = updated.changeKey || message.changeKey; }
  if (field === 'Flag' && message.flagged && state.filter === 'flagged') state.offset = Math.max(0, state.offset - 1);
  message[key] = value;
  if (state.selected?.id === id) Object.assign(state.selected, { [key]: value, changeKey: message.changeKey });
  if (state.demo) window.asterDemo.messages.find(item => item.id === id)[key] = value;
  renderMessages(); if (state.selected?.id === id) renderReader();
}
let moveRuleContext;
function ruleAfterMove(message, folder) {
  const name = systemFolders.find(f => f[0] === folder)?.[1] || (state.demo ? window.asterDemo.folders : state.folders).find(f => f.id === folder)?.name || 'Выбранная папка';
  moveRuleContext = { sender: message.from.email, folder };
  modal('Письмо перемещено', `Папка: ${name}. Настроить автоматический перенос новых писем?`, `<form id="mail-rule-form">${field('name', 'Название правила', `Письма от ${message.from.name || message.from.email}`.slice(0, 100), 'text', true)}${field('sender', 'Отправитель', message.from.email, 'email', true)}${field('subject', 'Тема содержит · необязательно')}<p class="form-note">Все новые входящие письма от этого адреса будут перемещаться в выбранную папку на сервере Exchange. Если указать фрагмент темы, должны совпасть оба условия. Старые письма не обрабатываются. Правило добавляется после существующих; их настройки сохраняются.</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="close">Без правила</button><button class="primary" type="submit">Создать правило на сервере</button></div></form>`);
}
let mailMoveContext;
document.addEventListener('click', event => {
  if (!event.target.closest('[data-mail-move]') || !state.selected || $('#modal').open) return;
  const message = state.selected;
  mailMoveContext = { id: message.id, generation: state.generation };
  const choices = [];
  const visit = (nodes, path = '') => {
    for (const node of nodes) {
      const label = path ? `${path} / ${node.name}` : node.name;
      if ((state.query || node.key !== state.folder) && node.id !== message.parentId) choices.push(`<option value="${esc(node.key)}">${esc(label)}</option>`);
      visit(node.children, label);
    }
  };
  visit(window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders));
  modal('Переместить письмо', message.subject, `<form id="mail-move-form"><label class="field"><span>Папка назначения</span><select name="folder" required>${choices.join('')}</select></label>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="close">Отмена</button><button type="submit" class="primary">Переместить</button></div></form>`);
  $('#mail-move-form select').focus();
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'mail-move-form') return;
  event.preventDefault();
  const context = mailMoveContext;
  void submitForm(event.target, async data => {
    if (!context || context.generation !== state.generation) throw new Error('Папка изменилась. Откройте перенос заново.');
    await moveDroppedMail(context.id, data.folder);
    $('#modal').close();
  });
});
async function moveDroppedMail(id, destination) {
  const message = state.messages.find(item => item.id === id);
  if (!message || (!state.query && destination === state.folder)) return;
  const snapshot = structuredClone(message);
  if (readingMessages.has(id)) await readingMessages.get(id);
  if (state.demo) window.asterDemo.messages.find(item => item.id === id).folder = destination;
  else await api('move', { ref: ref(message), folder: destination });
  await loadView();
  if (!$('#modal').open) ruleAfterMove(snapshot, destination); else toast('Письмо перемещено');
}
// Pointer capture also works inside macOS webviews that do not expose HTML drag sessions.
let mailDrag = null, suppressMailClick = false;
function clearMailDrag() {
  document.querySelectorAll('.folder-drop-target,.mail-dragging').forEach(el => el.classList.remove('folder-drop-target', 'mail-dragging'));
  mailDrag = null;
}
document.addEventListener('pointerdown', event => {
  const row = event.target.closest('.message-row[data-id]');
  if (!row || event.button !== 0 || event.pointerType === 'touch' || event.target.closest('.message-quick-actions,.mail-select') || $('#modal').open) return;
  mailDrag = { id: row.dataset.id, row, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
  (event.target.closest('.message-open') || row).setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!mailDrag || event.pointerId !== mailDrag.pointer) return;
  if (!mailDrag.moved && Math.hypot(event.clientX - mailDrag.x, event.clientY - mailDrag.y) < 8) return;
  mailDrag.moved = true; mailDrag.row.classList.add('mail-dragging'); event.preventDefault();
  document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
  document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-action="folder"]')?.classList.add('folder-drop-target');
});
document.addEventListener('pointerup', event => {
  if (!mailDrag || event.pointerId !== mailDrag.pointer) return;
  const drag = mailDrag, folder = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-action="folder"]');
  clearMailDrag();
  if (!drag.moved) return;
  suppressMailClick = true; setTimeout(() => { suppressMailClick = false; }, 0);
  event.preventDefault();
  if (folder) void moveDroppedMail(drag.id, folder.dataset.folder).catch(showError);
});
document.addEventListener('pointercancel', clearMailDrag);
document.addEventListener('click', event => { if (suppressMailClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
document.addEventListener('submit', event => {
  if (event.target.id !== 'mail-rule-form') return;
  event.preventDefault(); const context = moveRuleContext;
  submitForm(event.target, async data => {
    if (!state.demo) await api('createMailRule', { ...data, folder: context.folder });
    $('#modal').close(); toast(state.demo ? 'Демо: серверное правило не создавалось' : 'Правило создано в Exchange');
  });
});

// Replace the polled first page and retain only the known contiguous older tail.
function mergeInboxPage(current, page) {
  const head = page.items;
  if (!page.more || current.length <= 50 || !head.length) return [...head];
  const boundary = current.findIndex(message => message.id === head[head.length - 1].id);
  if (boundary < 0) return [...head];
  const seen = new Set(head.map(message => message.id));
  return [...head, ...current.slice(boundary + 1).filter(message => !seen.has(message.id))];
}
async function receiveInbox(snapshot) {
  if (state.demo || !state.account?.sessionId || snapshot.sessionId !== state.account.sessionId || mailWrites) return;
  const generation = state.generation, account = state.account, epoch = mailWriteEpoch;
  let inbox = state.folders.find(folder => folder.wellKnown === 'inbox' || folder.id === snapshot.inbox?.id);
  if (!inbox && snapshot.inbox) { inbox = { ...snapshot.inbox, name: 'Входящие', wellKnown: 'inbox' }; state.folders.push(inbox); renderSidebar(); }
  if (inbox && snapshot.inbox && (inbox.unread !== snapshot.inbox.unread || inbox.total !== snapshot.inbox.total)) {
    Object.assign(inbox, snapshot.inbox); renderSidebar();
  }
  if (state.mailLoading || state.view !== 'mail' || state.query || !['inbox', inbox?.id].includes(state.folder) || !$('#messages')) return;
  try {
    const page = state.filter === 'all' ? snapshot.page : await api('messages', { folder: state.folder, filter: state.filter, offset: 0, refresh: true });
    if (account !== state.account || generation !== state.generation || epoch !== mailWriteEpoch || mailWrites || !$('#messages')) return;
    const next = mergeInboxPage(state.messages, page);
    if (JSON.stringify(next) === JSON.stringify(state.messages) && state.more === page.more) return;
    const list = $('#messages'), atTop = list.scrollTop < 2;
    const anchor = [...list.querySelectorAll('.message-row')].find(row => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
    const anchorId = anchor?.dataset.id, top = anchor?.getBoundingClientRect().top;
    state.messages = next; state.offset = next.length; state.more = page.more;
    // Keep the reader, selected message and any compose dialog mounted.
    renderMessages();
    const remaining = [...list.querySelectorAll('.message-row')].find(row => row.dataset.id === anchorId);
    if (atTop) list.scrollTop = 0;
    else if (remaining) list.scrollTop += remaining.getBoundingClientRect().top - top;
    const more = document.querySelector('.mail-list .load-more');
    if (more) more.hidden = !state.more;
    else if (state.more) list.insertAdjacentHTML('afterend', '<button class="secondary load-more" data-action="more">Загрузить ещё</button>');
    $('#status').textContent = `Обновлено ${time(new Date())} · Прямое подключение к Exchange`;
  } catch { /* Keep readable mail on a transient refresh error; the next poll retries the read. */ }
}

async function refreshMailFolders(generation) {
  const account = state.account, epoch = mailWriteEpoch;
  try {
    const folders = await api('folders');
    if (account !== state.account || generation !== state.generation) return;
    // Keep local read counts when a mailbox write overtook the folder read.
    if (epoch !== mailWriteEpoch || mailWrites) for (const folder of folders) {
      const known = state.folders.find(previous => previous.id === folder.id);
      if (known) folder.unread = known.unread;
      else if (folder.wellKnown === 'inbox') folder.unread = undefined;
    }
    state.folders = folders; renderSidebar();
  } catch { /* System folders and the message list remain usable. */ }
}

function mailRecipientDetails(message) {
  const groups = [['to', 'Кому'], ['cc', 'Копия'], ['bcc', 'Скрытая копия']];
  if (!groups.some(([key]) => message[key]?.length)) return '<small>Получатели не указаны</small>';
  return `<div class="mail-recipient-groups" aria-label="Получатели письма">${groups.map(([key, label]) => {
    const people = message[key] || [];
    if (!people.length) return key === 'to' ? '<div class="recipient-empty">Кому: не указано</div>' : '';
    return `<details class="mail-recipients" open><summary><span>${label} · ${people.length}</span></summary><div class="mail-recipient-list">${people.map((person, index) => `<button type="button" class="mail-person" data-action="open-mail-person" data-group="${key}" data-index="${index}" aria-label="Открыть контакт: ${esc(person.name || person.email)}">${avatar(person.name || person.email, index, person.email)}<span><strong>${esc(person.name || person.email || 'Участник')}</strong><small>${esc(person.email || 'Адрес не указан')}</small></span>${icon('people')}</button>`).join('')}</div></details>`;
  }).join('')}</div>`;
}
let mailPeopleChoices = [];
async function openMailPerson(button) {
  const group = button.dataset.group, index = Number(button.dataset.index);
  const person = group === 'from' ? state.selected?.from : group === 'choice' ? mailPeopleChoices[index] : state.selected?.[group]?.[index];
  if (!person || !['from', 'choice', 'to', 'cc', 'bcc'].includes(group)) return;
  return openContactCard(person, true);
}
let contactCardContext = null;
function currentContactCard() {
  const context = contactCardContext;
  return context && context.account === state.account && context.generation === state.generation && context.modal === modalSequence && $('#modal').open ? context : null;
}
function contactCardBody(person, note = '') {
  const canWrite = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(person.email || '');
  const pinned = colleagues().some(value => value.email.toLowerCase() === person.email?.toLowerCase());
  return `<div class="contact-detail">${avatar(person.name || person.email, 0, person.email)}<h2>${esc(person.name || person.email || 'Контакт')}</h2><p>${esc(person.email || 'Email не указан в письме')}</p><p data-contact-field="company" ${person.company ? '' : 'hidden'}>${esc(person.company || '')}</p><p data-contact-field="phone" ${person.phone ? '' : 'hidden'}>${esc(person.phone || '')}</p><p class="form-note" role="status" data-contact-field="status">${esc(note)}</p><div class="contact-card-actions"><button type="button" class="secondary" data-action="pin-card-contact" ${!canWrite || pinned ? 'disabled' : ''}>${icon('plus')}${pinned ? 'В коллегах' : 'Добавить в коллеги'}</button><button type="button" class="primary" data-action="write-card-contact" ${canWrite ? '' : 'disabled'}>${icon('mail')}Написать письмо</button></div></div>`;
}
async function openContactCard(person, lookup = false) {
  if (modalBusy) return;
  const local = [...(state.demo ? window.asterDemo.contacts : state.contacts), ...colleagues()].find(value => person.email && value.email?.toLowerCase() === person.email.toLowerCase());
  const base = { ...person, ...(local || {}) };
  modal('Контакт', '', contactCardBody(base, lookup ? 'Загружаем сведения из справочника…' : ''));
  const context = contactCardContext = { person: base, account: state.account, generation: state.generation, modal: modalSequence };
  if (!lookup) return;
  const query = person.email || person.name || '';
  const update = (value, note) => {
    if (currentContactCard() !== context) return;
    context.person = value;
    // Keep the dialog and focusable actions mounted during a directory read.
    const detail = $('#modal-content .contact-detail');
    for (const [field, text] of Object.entries({ company: value.company || '', phone: value.phone || '', status: note })) {
      const element = detail.querySelector(`[data-contact-field="${field}"]`);
      element.textContent = text; element.hidden = !text;
    }
    detail.querySelector('h2').textContent = value.name || value.email || 'Контакт';
  };
  if (query.trim().length < 2 || query.length > 254) { update(base, 'Недостаточно данных для поиска в справочнике.'); return; }
  try {
    const result = state.demo ? { items: window.asterRecipients.matches(window.asterDemo.directory, query) } : await api('contacts', { query });
    if (currentContactCard() !== context) return;
    const exact = result.items.find(candidate => person.email && candidate.email?.toLowerCase() === person.email.toLowerCase());
    if (exact) { update({ ...base, ...exact, company: exact.company || base.company || '', phone: exact.phone || base.phone || '' }, 'Сведения из справочника Exchange'); return; }
    if (!person.email && result.items.length) {
      mailPeopleChoices = result.items;
      modal('Выберите контакт', 'В письме не указан SMTP-адрес. Уточните получателя по справочнику.', `<div class="mail-recipient-list">${mailPeopleChoices.map((candidate, i) => `<button type="button" class="mail-person" data-action="open-mail-person" data-group="choice" data-index="${i}">${avatar(candidate.name, i, candidate.email)}<span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.email)}</small></span></button>`).join('')}</div>`);
      return;
    }
    update(base, 'Дополнительные сведения в справочнике не найдены.');
  } catch (error) { update(base, `Справочник недоступен: ${error.message}`); }
}

// Each result group has its own paging and error state; mail-only actions stay mail-only.
async function searchMailbox(query, filter, offset = 0) {
  const kinds = filter === 'all' && offset === 0 ? ['mail', 'calendar', 'contacts'] : ['mail'];
  const settled = await Promise.allSettled(kinds.map(kind => api('search', { kind, query: kind === 'mail' && filter === 'unread' ? `(${query}) AND read:no` : query, offset })));
  const groups = {};
  for (let i = 0; i < kinds.length; i++) groups[kinds[i]] = settled[i].status === 'fulfilled' ? settled[i].value : { items: [], more: false, error: settled[i].reason.message, connectionError: settled[i].reason.connectionError === true };
  if (settled.every(result => result.status === 'rejected')) throw settled[0].reason;
  return { ...groups.mail, related: offset === 0 ? groups : null };
}
function demoMailSearch(query) {
  const contains = value => String(value || '').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'));
  const personText = person => `${person?.name || ''} ${person?.email || ''}`;
  return {
    items: structuredClone(window.asterDemo.messages.filter(message => contains([message.subject, message.text, message.html?.replace(/<[^>]*>/g, ' '), message.preview, ...[message.from, ...message.to || [], ...message.cc || [], ...message.bcc || []].map(personText), ...message.attachments.map(file => file.name), message.meeting?.location].join(' ')))), more: false,
    related: { calendar: { items: structuredClone(window.asterDemo.events.filter(event => contains([event.title, event.body, event.html?.replace(/<[^>]*>/g, ' '), event.preview, event.location, personText(event.organizer), ...(event.attendees || []).map(personText)].join(' ')))), more: false }, contacts: { items: structuredClone(window.asterDemo.contacts.filter(person => contains([personText(person), person.company, person.phone].join(' ')))), more: false } },
  };
}
function renderSearchObjects() {
  if (!state.query || !state.searchObjects) return '';
  return ['calendar', 'contacts', 'mail'].map(kind => {
    const group = state.searchObjects[kind];
    if (!group || kind === 'mail' && !group.error) return '';
    const label = { calendar: 'Календарь', contacts: 'Личные контакты', mail: 'Письма' }[kind];
    const rows = kind === 'mail' ? '' : group.items.map((item, index) => `<button type="button" class="search-object" data-action="search-object" data-kind="${kind}" data-index="${index}">${icon(kind === 'calendar' ? 'calendar' : 'people')}<span><strong>${esc(item.title || item.name || item.email || 'Без названия')}</strong><small>${esc(kind === 'calendar' ? `${item.start ? dateFormat(item.start, { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + time(item.start) : 'Дата не указана'}${item.recurring ? ' · Повторяется' : ''} · ${item.location || ''}` : [item.email, item.company].filter(Boolean).join(' · '))}</small></span></button>`).join('');
    return `<details class="search-object-group" data-search-kind="${kind}" ${group.expanded || !state.messages.length || group.error ? 'open' : ''}><summary>${label}${kind === 'mail' ? '' : ` · ${group.items.length}${group.more ? '+' : ''}`}</summary>${rows}${group.error ? `<p class="search-source-error" role="status">Поиск не завершён: ${esc(group.error)}</p><button type="button" class="secondary" data-action="search-more-objects" data-kind="${kind}">Повторить</button>` : !group.items.length ? '<p class="form-note">Совпадений нет</p>' : ''}${group.more && !group.error ? `<button type="button" class="secondary" data-action="search-more-objects" data-kind="${kind}">Ещё: ${label.toLowerCase()}</button>` : ''}</details>`;
  }).join('');
}
async function moreSearchObjects(button) {
  const kind = button.dataset.kind;
  if (kind === 'mail') return loadView();
  const group = state.searchObjects?.[kind], generation = state.generation, query = state.query;
  if (!group || !['calendar', 'contacts'].includes(kind)) return;
  button.disabled = true;
  try {
    const result = await api('search', { kind, query, offset: group.nextOffset || 0 });
    if (generation !== state.generation || query !== state.query || group !== state.searchObjects?.[kind]) return;
    const items = new Map([...group.items, ...result.items].map(item => [item.id, item]));
    state.searchObjects[kind] = { ...result, items: [...items.values()], expanded: true };
  } catch (error) { if (generation === state.generation && group === state.searchObjects?.[kind]) group.error = error.message; }
  finally { if (generation === state.generation) renderMessages(); }
}

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
  const people = groups.flatMap(([key]) => message[key] || []);
  if (!people.length) return '<small>Получатели не указаны</small>';
  const names = people.slice(0, 2).map(person => person.name || person.email).join(', ');
  return `<details class="mail-recipients"><summary><span>Получатели · ${people.length}</span><span class="recipient-summary-names">${esc(names)}${people.length > 2 ? ` и ещё ${people.length - 2}` : ''}</span></summary><div class="mail-recipient-list">${groups.map(([key, label]) => message[key]?.length ? `<div class="recipient-group-label">${label}</div>${message[key].map((person, index) => `<button type="button" class="mail-person" data-action="write-mail-person" data-group="${key}" data-index="${index}" aria-label="Написать: ${esc(person.name || person.email)}">${avatar(person.name || person.email, index, person.email)}<span><strong>${esc(person.name || person.email || 'Участник')}</strong><small>${esc(person.email || 'Найти адрес в Exchange')}</small></span>${icon('mail')}</button>`).join('')}` : '').join('')}</div></details>`;
}
let mailPeopleChoices = [];
async function writeMailPerson(button) {
  const group = button.dataset.group, index = Number(button.dataset.index);
  const person = group === 'from' ? state.selected?.from : group === 'choice' ? mailPeopleChoices[index] : state.selected?.[group]?.[index];
  if (!person) return;
  if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(person.email || '')) return compose('new', person);
  const account = state.account, message = state.selected;
  button.disabled = true;
  try {
    const result = state.demo ? { items: window.asterRecipients.matches(window.asterDemo.directory, person.name || '') } : await api('contacts', { query: person.name || '' });
    if (account !== state.account || message !== state.selected) return;
    mailPeopleChoices = result.items.filter(candidate => candidate.email);
    if (!mailPeopleChoices.length) throw new Error('Адрес не найден в справочнике Exchange. Уточните email у получателя.');
    // A name can belong to several people; always let the user choose the actual address.
    modal('Выберите адрес', person.name || '', `<div class="mail-recipient-list">${mailPeopleChoices.map((candidate, i) => `<button type="button" class="mail-person" data-action="write-mail-person" data-group="choice" data-index="${i}">${avatar(candidate.name, i, candidate.email)}<span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.email)}</small></span>${icon('mail')}</button>`).join('')}</div>`);
  } finally { button.disabled = false; }
}

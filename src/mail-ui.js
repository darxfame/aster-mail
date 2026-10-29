function mailAttachments(message) {
  if (!message.attachments?.length) return '';
  return `<section class="mail-attachments-top" aria-label="Вложения письма">${message.attachments.map(file => {
    const extension = /\.([a-z0-9]{1,8})$/i.exec(file.name || '')?.[1].toUpperCase() || 'FILE';
    const type = /^(PDF)$/.test(extension) ? 'pdf' : /^(DOCX?|ODT|RTF)$/.test(extension) ? 'document' : /^(XLSX?|CSV|ODS)$/.test(extension) ? 'sheet' : /^(JPE?G|PNG|GIF|WEBP|HEIC)$/.test(extension) ? 'image' : /^(ZIP|RAR|7Z|TAR|GZ)$/.test(extension) ? 'archive' : 'file';
    return `<article class="mail-attachment"><span class="file-extension extension-${type}">${esc(extension)}</span><div><strong title="${esc(file.name)}">${esc(file.name)}</strong><small>${bytes(file.size || 0)}</small><button type="button" data-action="attachment" data-id="${esc(file.id)}" data-name="${esc(file.name)}" aria-label="Сохранить как: ${esc(file.name)}">Сохранить как…</button></div></article>`;
  }).join('')}</section>`;
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
  if (!row || event.button !== 0 || event.pointerType === 'touch' || event.target.closest('.message-quick-actions') || $('#modal').open) return;
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

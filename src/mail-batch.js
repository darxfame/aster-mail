/* Bulk mail uses the existing OWA operations; selection never means the whole mailbox. */
let mailSelection = new Set(), mailSelectionScope = '', mailSelectionAnchor, mailBatchBusy = false;
function mailSelectionKey() {
  return JSON.stringify([state.account?.sessionId || (state.demo ? 'demo' : ''), state.view, state.folder, state.query, state.filter, state.mailSearch?.criteria.folder]);
}
function syncMailSelection(items) {
  const scope = mailSelectionKey();
  if (scope !== mailSelectionScope) { mailSelection.clear(); mailSelectionScope = scope; }
  const visible = new Set(items.map(message => message.id));
  for (const id of mailSelection) if (!visible.has(id)) mailSelection.delete(id);
  if (!mailSelection.size || !visible.has(mailSelectionAnchor)) mailSelectionAnchor = undefined;
}
function focusMailSelectionRow(id) {
  const button = [...document.querySelectorAll('#messages .message-open')].find(row => row.dataset.id === id);
  button?.focus();
}
function selectMailMessage(id, selected = true) {
  if (mailBatchBusy) return;
  if (selected && !mailSelection.has(id) && mailSelection.size >= 100) return toast(tr('За один раз можно выбрать до 100 писем.'));
  if (selected) mailSelection.add(id);
  else mailSelection.delete(id);
  mailSelectionAnchor = id;
  renderMessages();
  focusMailSelectionRow(id);
}
function selectMailRange(from, to, order) {
  const first = order.indexOf(mailSelectionAnchor), start = first < 0 ? order.indexOf(from) : first, end = order.indexOf(to);
  if (start < 0 || end < 0) return;
  if (Math.abs(end - start) >= 100) return toast(tr('За один раз можно выбрать до 100 писем.'));
  mailSelectionAnchor = order[start];
  mailSelection = new Set(order.slice(Math.min(start, end), Math.max(start, end) + 1));
  renderMessages();
  focusMailSelectionRow(to);
}
function renderMailBatchToolbar() {
  const target = $('#mail-batch-toolbar'); if (!target) return;
  const count = mailSelection.size;
  if (!count) { target.replaceChildren(); return; }
  const restoreFocus = preserveListFocus(target);
  const fullySelected = filteredMessages().slice(0, 100).every(message => mailSelection.has(message.id));
  const disabled = mailBatchBusy ? 'disabled' : '';
  const actions = [['read', tr('Прочитать')], ['unread', tr('Не прочитано')], ['move', tr('В папку…')], ['archive', tr('В архив')], ['trash', tr('В корзину')]];
  target.innerHTML = `<div class="mail-selection-bar"><label><input type="checkbox" data-mail-select-all aria-label="${tr("Выбрать загруженные письма, до 100")}" ${fullySelected ? 'checked' : ''} ${disabled}> <span>${tr("Выбрано:")} ${count}</span></label><button type="button" data-mail-batch="clear" ${disabled}>${tr("Снять выбор")}</button></div>
    <div class="mail-batch-actions" role="group" aria-label="${tr("Действия с выбранными письмами")}">${actions.map(([action, label]) => `<button type="button" class="secondary" data-mail-batch="${action}" ${disabled}>${label}</button>`).join('')}</div>
    <p class="mail-batch-note" role="status">${mailBatchBusy ? tr('Обрабатываем выбранные письма…') : tr('Выбраны только загруженные письма. Удаление переносит в корзину.')}</p>`;
  const all = target.querySelector('[data-mail-select-all]');
  if (all) all.indeterminate = !fullySelected;
  restoreFocus();
}
function mailBatchMoveDialog() {
  const choices = [];
  const visit = (nodes, path = '') => {
    for (const node of nodes) {
      const label = path ? `${path} / ${node.name}` : node.name;
      if (state.query || ![node.key, node.id].includes(state.folder)) choices.push(`<option value="${esc(node.key)}">${esc(label)}</option>`);
      visit(node.children, label);
    }
  };
  visit(window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders));
  const context = { scope: mailSelectionKey(), ids: [...mailSelection] };
  modal(tr('Переместить выбранные письма'), `${tr("Выбрано:")} ${context.ids.length}`, `<form id="mail-batch-move-form"><label class="field"><span>${tr("Папка назначения")}</span><select name="folder" required>${choices.join('')}</select></label>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="close">${tr("Отмена")}</button><button type="submit" class="primary">${tr("Переместить")}</button></div></form>`);
  const form = $('#mail-batch-move-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (context.scope !== mailSelectionKey() || context.ids.join('\n') !== [...mailSelection].join('\n')) {
      form.querySelector('.form-error').textContent = tr('Выбор изменился. Откройте перенос заново.'); return;
    }
    const folder = form.elements.folder.value;
    $('#modal').close(); void runMailBatch('move', folder).catch(showError);
  });
  form.elements.folder.focus();
}
async function runMailBatch(action, folder, explicitIds) {
  const ids = explicitIds ? [...explicitIds] : [...mailSelection];
  if (mailBatchBusy || !ids.length) return;
  const account = state.account, scope = mailSelectionKey(), generation = state.generation;
  const clearProcessedSelection = () => { if (explicitIds) for (const id of ids) mailSelection.delete(id); else mailSelection.clear(); };
  mailBatchBusy = true; renderMessages();
  try {
    await Promise.allSettled(ids.map(id => readingMessages.get(id)).filter(Boolean));
    if (account !== state.account || scope !== mailSelectionKey() || generation !== state.generation) return;
    const refs = ids.map(id => state.messages.find(message => message.id === id)).filter(Boolean).map(ref);
    if (refs.length !== ids.length) throw new Error(tr('Список писем изменился. Выберите письма заново.'));
    let result;
    if (state.demo) {
      for (const item of refs) {
        const message = window.asterDemo.messages.find(message => message.id === item.id);
        if (action === 'read' || action === 'unread') message.read = action === 'read';
        else message.folder = action === 'archive' ? 'archive' : action === 'trash' ? 'deleteditems' : folder;
      }
      result = { results: refs.map(item => ({ id: item.id, status: 'done' })) };
    } else result = await api('mailBatch', { action, refs, folder });
    if (account !== state.account || scope !== mailSelectionKey() || generation !== state.generation) return;
    const done = result.results.filter(item => item.status === 'done').length;
    const uncertain = result.results.find(item => item.status === 'uncertain');
    const skipped = result.results.filter(item => item.status === 'skipped').length;
    // Never leave an unconfirmed write preselected for an accidental repeated operation.
    clearProcessedSelection();
    const note = `${tr("Выполнено:")} ${done} ${tr("из")} ${refs.length}.${uncertain ? ` ${tr("Не подтверждено: 1. Не обработано:")} ${skipped}. ${errorText(uncertain.error, 'mailBatch')}` : ''}`;
    if (uncertain) showError(Object.assign(new Error(note), { userFacing: true })); else toast(note);
    if (explicitIds && !uncertain && ['read', 'unread'].includes(action)) {
      for (const item of result.results.filter(item => item.status === 'done')) {
        const message = state.messages.find(message => message.id === item.id);
        if (message) { message.changeKey = item.changeKey || message.changeKey; applyMessageRead(message, action === 'read', state.query ? null : state.folder); }
      }
      renderMessages(); renderSidebar();
    } else await loadView();
    if (uncertain && account === state.account && scope === mailSelectionKey()) showError(Object.assign(new Error(note), { userFacing: true }));
  } catch (error) {
    if (account === state.account && scope === mailSelectionKey()) {
      clearProcessedSelection();
      showError(Object.assign(new Error(`${errorText(error)}${tr("\nРезультат операций может быть неизвестен. Проверьте выбранные письма в OWA перед повтором.")}`), { userFacing: true }));
    }
  } finally {
    mailBatchBusy = false;
    if (state.view === 'mail') renderMessages();
  }
}
document.addEventListener('change', event => {
  if (mailBatchBusy) return;
  const box = event.target;
  if (box.hasAttribute('data-mail-select-all')) {
    const anchor = mailSelectionAnchor || [...mailSelection][0];
    mailSelection.clear();
    mailSelectionAnchor = undefined;
    if (box.checked) for (const message of filteredMessages().slice(0, 100)) mailSelection.add(message.id);
    if (box.checked && filteredMessages().length > 100) toast(tr('Выбраны первые 100 загруженных писем.'));
    renderMessages();
    if (anchor !== undefined && !mailSelection.size) focusMailSelectionRow(anchor);
  } else if (box.hasAttribute('data-mail-select')) {
    if (box.checked && mailSelection.size >= 100) { box.checked = false; toast(tr('За один раз можно выбрать до 100 писем.')); return; }
    const id = box.dataset.mailSelect;
    if (box.checked) { mailSelection.add(id); mailSelectionAnchor = id; } else mailSelection.delete(id);
    renderMessages();
    if (!mailSelection.size) focusMailSelectionRow(id);
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-mail-batch]'); if (!button || mailBatchBusy) return;
  const action = button.dataset.mailBatch;
  if (action === 'clear') {
    const anchor = mailSelectionAnchor || [...mailSelection][0];
    mailSelection.clear(); renderMessages(); focusMailSelectionRow(anchor); return;
  }
  if (action === 'move') { mailBatchMoveDialog(); return; }
  void runMailBatch(action).catch(showError);
});
document.addEventListener('click', event => {
  if (mailBatchBusy && event.target.closest('.message-open,.message-quick-actions,[data-mail-move],[data-action="archive"],[data-action="delete"],[data-action="flag"],[data-action="unread"],[data-action="important"]')) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
function mailRangeClickTarget(event) {
  return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
    event.target.closest('#messages .message-open, #messages .mail-select');
}
document.addEventListener('mousedown', event => {
  if (event.button === 0 && mailRangeClickTarget(event)) event.preventDefault();
});
document.addEventListener('click', event => {
  const mac = window.aster?.platform ? window.aster.platform === 'darwin' : navigator.platform.startsWith('Mac');
  const toggle = event.button === 0 && !event.shiftKey && !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
  const row = toggle && event.target.closest('#messages .message-open');
  if (row && !mailBatchBusy) {
    event.preventDefault(); event.stopImmediatePropagation();
    selectMailMessage(row.dataset.id, !mailSelection.has(row.dataset.id));
    return;
  }
  const target = mailRangeClickTarget(event);
  if (!target || mailBatchBusy) return;
  const order = [...document.querySelectorAll('#messages .message-open')].map(button => button.dataset.id);
  const id = target.closest('.message-row').dataset.id;
  const focused = document.activeElement.closest('.message-row')?.dataset.id;
  event.preventDefault(); event.stopImmediatePropagation();
  selectMailRange(order.includes(focused) ? focused : order.includes(state.selected?.id) ? state.selected.id : id, id, order);
}, true);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      mailBatchBusy || state.view !== 'mail' || document.querySelector('dialog[open]')) return;
  const row = event.target.closest('#messages .message-open, #messages .mail-select')?.closest('.message-row');
  if (event.key === 'Escape' && mailSelection.size && (row || event.target.closest('#mail-batch-toolbar'))) {
    const id = row?.dataset.id || mailSelectionAnchor || [...mailSelection][0];
    event.preventDefault(); mailSelection.clear(); renderMessages(); focusMailSelectionRow(id); return;
  }
  if (!event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || !$('#messages')?.getClientRects().length) return;
  const from = row?.dataset.id || (event.target === $('#reader') ? state.selected?.id : undefined);
  if (!from) return;
  const order = [...document.querySelectorAll('#messages .message-open')].map(button => button.dataset.id);
  const index = order.indexOf(from);
  if (index < 0) return;
  event.preventDefault();
  const to = order[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (to !== undefined) selectMailRange(from, to, order);
});

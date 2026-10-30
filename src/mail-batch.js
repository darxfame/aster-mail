/* Bulk mail uses the existing OWA operations; selection never means the whole mailbox. */
let mailSelection = new Set(), mailSelectionScope = '', mailBatchBusy = false;
function mailSelectionKey() {
  return JSON.stringify([state.account?.sessionId || (state.demo ? 'demo' : ''), state.view, state.folder, state.query, state.filter]);
}
function syncMailSelection(items) {
  const scope = mailSelectionKey();
  if (scope !== mailSelectionScope) { mailSelection.clear(); mailSelectionScope = scope; }
  const visible = new Set(items.map(message => message.id));
  for (const id of mailSelection) if (!visible.has(id)) mailSelection.delete(id);
}
function renderMailBatchToolbar() {
  const target = $('#mail-batch-toolbar'); if (!target) return;
  const restoreFocus = preserveListFocus(target);
  const count = mailSelection.size;
  target.innerHTML = `<div class="mail-selection-bar"><label><input type="checkbox" data-mail-select-all aria-label="${tr("Выбрать загруженные письма, до 100")}" ${count && filteredMessages().slice(0, 100).every(message => mailSelection.has(message.id)) ? 'checked' : ''} ${mailBatchBusy || !filteredMessages().length ? 'disabled' : ''}> <span>${count ? `${tr("Выбрано:")} ${count}` : tr('Выбрать письма')}</span></label>${count ? '<button type="button" data-mail-batch="clear" ' + (mailBatchBusy ? 'disabled' : '') + tr('>Снять выбор</button>') : ''}</div>${count ? `<div class="mail-batch-actions" role="group" aria-label="${tr("Действия с выбранными письмами")}">${[['read',tr('Прочитать')],['unread',tr('Не прочитано')],['move',tr('В папку…')],['archive',tr('В архив')],['trash',tr('В корзину')]].map(([action, label]) => `<button type="button" class="secondary" data-mail-batch="${action}" ${mailBatchBusy ? 'disabled' : ''}>${label}</button>`).join('')}</div>` : ''}<p class="mail-batch-note" role="status">${mailBatchBusy ? tr('Обрабатываем выбранные письма…') : count ? tr('Выбраны только загруженные письма. Удаление переносит в корзину.') : ''}</p>`;
  const all = target.querySelector('[data-mail-select-all]');
  if (all) all.indeterminate = count > 0 && !filteredMessages().slice(0, 100).every(message => mailSelection.has(message.id));
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
async function runMailBatch(action, folder) {
  if (mailBatchBusy || !mailSelection.size) return;
  const account = state.account, scope = mailSelectionKey(), generation = state.generation;
  const ids = [...mailSelection];
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
    mailSelection.clear();
    const note = `${tr("Выполнено:")} ${done} ${tr("из")} ${refs.length}.${uncertain ? ` ${tr("Не подтверждено: 1. Не обработано:")} ${skipped}. ${errorText(uncertain.error, 'mailBatch')}` : ''}`;
    if (uncertain) showError(Object.assign(new Error(note), { userFacing: true })); else toast(note);
    await loadView();
    if (uncertain && account === state.account && scope === mailSelectionKey()) showError(Object.assign(new Error(note), { userFacing: true }));
  } catch (error) {
    if (account === state.account && scope === mailSelectionKey()) {
      mailSelection.clear();
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
    mailSelection.clear();
    if (box.checked) for (const message of filteredMessages().slice(0, 100)) mailSelection.add(message.id);
    if (box.checked && filteredMessages().length > 100) toast(tr('Выбраны первые 100 загруженных писем.'));
    renderMessages();
  } else if (box.hasAttribute('data-mail-select')) {
    if (box.checked && mailSelection.size >= 100) { box.checked = false; toast(tr('За один раз можно выбрать до 100 писем.')); return; }
    if (box.checked) mailSelection.add(box.dataset.mailSelect); else mailSelection.delete(box.dataset.mailSelect);
    renderMailBatchToolbar();
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-mail-batch]'); if (!button || mailBatchBusy) return;
  const action = button.dataset.mailBatch;
  if (action === 'clear') { mailSelection.clear(); renderMessages(); return; }
  if (action === 'move') { mailBatchMoveDialog(); return; }
  void runMailBatch(action).catch(showError);
});
document.addEventListener('click', event => {
  if (mailBatchBusy && event.target.closest('.message-open,.message-quick-actions,[data-mail-move],[data-action="archive"],[data-action="delete"],[data-action="flag"],[data-action="unread"],[data-action="important"]')) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);

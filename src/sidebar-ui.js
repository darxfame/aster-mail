let miniMonthCursor, miniMonthAnchor;
const collapsedFolderBranches = new Set();
function renderFolderTree() {
  const roots = window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders);
  const render = (nodes, depth = 0) => nodes.map(node => {
    const open = !collapsedFolderBranches.has(node.key);
    const unread = state.demo ? window.asterDemo.messages.filter(message => message.folder === node.key && !message.read).length : node.unread;
    return `<div class="folder-branch" style="--folder-depth:${Math.min(depth, 8)}"><div class="folder-row">${node.children.length ? `<button class="folder-disclosure" data-action="folder-branch" data-id="${esc(node.key)}" aria-label="${open ? 'Свернуть' : 'Развернуть'} подпапки: ${esc(node.name)}" aria-expanded="${open}">${icon('chevron')}</button>` : '<span class="folder-disclosure-placeholder"></span>'}<button class="folder ${state.view === 'mail' && state.folder === node.key ? 'active' : ''}" data-action="folder" data-folder="${esc(node.key)}" title="${esc(node.name)}" aria-label="${esc(node.name)}">${icon(node.symbol)}<span class="folder-label">${esc(node.name)}</span>${unread ? `<span class="count">${unread}</span>` : ''}</button></div>${node.children.length && open ? `<div class="folder-children">${render(node.children, depth + 1)}</div>` : ''}</div>`;
  }).join('');
  return render(roots);
}
function miniMonthHTML() {
  const anchor = dayKey(state.week);
  if (!miniMonthCursor || miniMonthAnchor !== anchor) { miniMonthCursor = window.asterCalendar.range(state.week, 'month', timeZone).start; miniMonthAnchor = anchor; }
  const month = miniMonthCursor, first = addDays(month, -(civil(month).getUTCDay() + 6) % 7);
  const selected = window.asterCalendar.range(state.week, calendarMode(), timeZone), mode = calendarMode();
  return `<div class="mini-calendar-collapsed"><button class="folder" data-action="mini-expand" aria-label="Открыть календарик месяца" title="Открыть календарик месяца">${icon('calendar')}</button></div><section class="mini-calendar" aria-label="Календарик месяца"><header><button class="mini-month-arrow" data-action="mini-prev" aria-label="Предыдущий месяц">${icon('chevron')}</button><strong>${esc(dateFormat(month, { month: 'long', year: 'numeric' }))}</strong><button class="mini-month-arrow" data-action="mini-next" aria-label="Следующий месяц">${icon('chevron')}</button></header><div class="mini-month-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<span class="mini-weekday">${day}</span>`).join('')}${Array.from({ length: 42 }, (_, i) => {
    const day = addDays(first, i);
    const date = dayKey(day);
    return `<button data-action="mini-day" data-date="${date}" class="${civil(day).getUTCMonth() !== civil(month).getUTCMonth() ? 'outside-month' : ''} ${mode === 'week' && day >= selected.start && day < selected.end ? 'selected-week' : ''} ${dayKey(day) === anchor ? 'selected-day' : ''} ${dayKey(day) === dayKey(new Date()) ? 'mini-today' : ''}" aria-label="${esc(dateFormat(day, { day: 'numeric', month: 'long', year: 'numeric' }))}" aria-pressed="${dayKey(day) === anchor}">${civil(day).getUTCDate()}</button>`;
  }).join('')}</div><button class="mini-today-button" data-action="today" aria-label="Вернуться к сегодняшней дате">Сегодня</button><div class="mini-calendar-source"><span></span>Мой календарь Exchange</div></section>`;
}
async function handleSidebarAction(button) {
  const { action } = button.dataset;
  if (action === 'folder-branch') { const key = button.dataset.id; if (collapsedFolderBranches.has(key)) collapsedFolderBranches.delete(key); else collapsedFolderBranches.add(key); return renderSidebar(); }
  if (action === 'mini-expand') { sidebarCollapsed = false; localStorage.setItem('aster-sidebar-collapsed', 'false'); return renderSidebar(); }
  if (action === 'mini-prev' || action === 'mini-next') { miniMonthCursor = T.add(miniMonthCursor, { months: action === 'mini-next' ? 1 : -1 }, timeZone); return renderSidebar(); }
  if (action === 'mini-day') { state.week = calendarDate(button.dataset.date); return loadView(); }
}

let folderMenu, folderEdit, folderTask = false;
function closeFolderMenu(restoreFocus = false) { const opener = folderMenu?.opener; folderMenu?.remove(); folderMenu = null; if (restoreFocus === true) opener?.focus(); }
function showFolderMenu(button, x, y) {
  if ($('#modal').open) return;
  closeFolderMenu();
  const key = button.dataset.folder;
  const item = (state.demo ? window.asterDemo.folders : state.folders).find(item => item.id === key || item.wellKnown === key);
  const folder = { ...item, key, id: item?.id || key, name: item?.name || button.title, wellKnown: item?.wellKnown || (systemFolders.some(([id]) => id === key) ? key : '') };
  const account = state.account, demo = state.demo;
  const entries = [['read', 'Прочитать всё'], ['create', 'Создать подпапку…'], ['root', 'Новая папка в корне…'], ['rename', 'Переименовать…'], ['trash', 'Переместить в корзину…'], ['refresh', 'Обновить папки']];
  folderMenu = document.createElement('div'); folderMenu.opener = button; folderMenu.className = 'folder-context-menu'; folderMenu.setAttribute('role', 'menu'); folderMenu.setAttribute('aria-label', `Папка: ${folder.name}`);
  folderMenu.innerHTML = entries.map(([action, text]) => `<button type="button" role="menuitem" tabindex="-1" data-folder-operation="${action}" ${folder.wellKnown && ['rename', 'trash'].includes(action) ? 'disabled title="Системная папка"' : ''}>${esc(text)}</button>`).join('');
  document.body.append(folderMenu);
  const bounds = folderMenu.getBoundingClientRect();
  folderMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
  folderMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
  folderMenu.onclick = event => {
    const item = event.target.closest('[data-folder-operation]'); if (!item || item.disabled) return;
    const action = item.dataset.folderOperation; closeFolderMenu();
    if (state.account !== account || state.demo !== demo || folderTask) return;
    if (action === 'read' || action === 'refresh') { void performFolderAction({ folder, action, account, demo }).catch(showError); return; }
    folderEdit = { folder, action: action === 'root' ? 'create' : action, parent: action === 'root' ? 'msgfolderroot' : key, account, demo };
    const trash = action === 'trash';
    modal(trash ? 'Переместить папку в корзину?' : action === 'rename' ? 'Переименовать папку' : 'Создать папку', folder.name,
      `<form id="folder-operation-form">${trash ? '<p class="form-note">Папка вместе с письмами и подпапками будет перемещена в «Корзину». Её можно восстановить в OWA; безвозвратного удаления нет.</p>' : field('name', 'Название папки', action === 'rename' ? folder.name : '', 'text', true)}${formError()}<div class="modal-footer"><button class="secondary" type="button" data-action="close">Отмена</button><button class="primary" type="submit">${trash ? 'Переместить в корзину' : action === 'rename' ? 'Переименовать' : 'Создать папку'}</button></div></form>`);
    $('#folder-operation-form input')?.focus();
  };
  folderMenu.querySelector('button:not(:disabled)').focus();
}
async function performFolderAction(edit, name) {
  if (folderTask) return;
  if (state.account !== edit.account || state.demo !== edit.demo) throw new Error('Аккаунт изменился. Откройте меню папки заново.');
  if (['create', 'rename'].includes(edit.action) && (typeof name !== 'string' || !name.trim() || name.trim().length > 255 || /[\x00-\x1f]/.test(name))) throw new Error('Укажите название папки от 1 до 255 символов');
  folderTask = true;
  try {
    const key = edit.folder.key;
    if (state.demo) {
      const folder = window.asterDemo.folders.find(item => item.id === edit.folder.id);
      if (edit.action === 'read') for (const message of window.asterDemo.messages.filter(message => message.folder === key)) message.read = true;
      if (edit.action === 'rename') folder.name = name.trim();
      if (edit.action === 'trash') folder.parentId = 'folder-deleteditems';
      if (edit.action === 'create') window.asterDemo.folders.push({ id: `demo-folder-${Date.now()}`, name: name.trim(), parentId: edit.parent === 'msgfolderroot' ? 'mail-root' : edit.folder.id, unread: 0 });
    } else if (edit.action === 'refresh') await api('clearMailCache');
    else await api('folderOperation', { action: edit.action, folder: edit.action === 'create' ? edit.parent : key, name, expectedChangeKey: edit.folder.changeKey });
    if (state.account !== edit.account || state.demo !== edit.demo) return;
    if (edit.action === 'trash') state.folder = 'inbox';
    if (!state.demo) state.folders = await api('folders');
    if ($('#folder-operation-form')) $('#modal').close();
    await loadView();
    toast({ read: 'Все письма в папке отмечены прочитанными', create: 'Папка создана', rename: 'Папка переименована', trash: 'Папка перемещена в корзину', refresh: 'Папки обновлены' }[edit.action]);
  } finally { folderTask = false; }
}
document.addEventListener('contextmenu', event => {
  const button = event.target.closest('.folder[data-folder]'); if (!button) return;
  event.preventDefault(); showFolderMenu(button, event.clientX, event.clientY);
});
document.addEventListener('pointerdown', event => { if (folderMenu && !folderMenu.contains(event.target)) closeFolderMenu(); });
window.addEventListener('blur', closeFolderMenu);
document.addEventListener('keydown', event => {
  const button = event.target.closest('.folder[data-folder]');
  if (button && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
    event.preventDefault(); const bounds = button.getBoundingClientRect(); showFolderMenu(button, bounds.right, bounds.top); return;
  }
  if (!folderMenu) return;
  if (event.key === 'Escape') { event.preventDefault(); closeFolderMenu(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...folderMenu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'folder-operation-form') return;
  event.preventDefault(); const edit = folderEdit;
  void submitForm(event.target, data => performFolderAction(edit, data.name));
});

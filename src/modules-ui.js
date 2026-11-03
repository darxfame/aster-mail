const modulePermissionNames = () => ({ ui: tr('Открытие собственных панелей'), network: tr('Доступ к указанным сервисам'), storage: tr('Защищённые настройки модуля'), 'calendar.read': tr('Чтение основного календаря'), 'meeting.draft': tr('Заполнение черновика встречи'), events: tr('События приложения и модулей') });
let connectedModules = [], moduleMountState = '', moduleMountBusy = false;
function moduleSettingsMarkup() {
  return `<p class="form-note">${tr('Модули работают в песочнице. Разрешения включаются отдельно для каждого аккаунта.')}</p><button type="button" class="secondary" data-action="module-import" ${!window.aster || !state.account ? 'disabled' : ''}>${tr('Подключить модуль')}</button> <button type="button" class="secondary" data-action="module-github" ${!window.aster || !state.account ? 'disabled' : ''}>${tr('Подключить с GitHub')}</button><div id="module-list" aria-live="polite"></div>`;
}
async function refreshModuleList() {
  const container = document.querySelector('#module-list');
  await loadModuleContributions();
  if (!container?.isConnected) return;
  container.innerHTML = connectedModules.length ? connectedModules.map(item => `<article class="module-card" data-module="${esc(item.id)}"><strong>${esc(item.name)} · ${esc(item.version)}</strong>${item.source ? `<p class="form-note">${esc(item.source.repository)} · ${esc(item.source.commit.slice(0, 12))}</p>` : ''}<p class="form-note">${tr('Разрешения:')} ${esc((item.permissions || []).map(value => modulePermissionNames()[value]).join(', '))}<br>${tr('Сетевые адреса:')} ${esc((item.networkOrigins || []).join(', '))}</p><p>${item.error ? tr('Файлы модуля изменились. Требуется повторная установка.') : item.enabled ? tr('Включён') : tr('Выключен')}</p><div class="module-actions"><button type="button" class="secondary" data-action="module-configure" data-enabled="${!item.enabled}" ${item.error ? 'disabled' : ''}>${item.enabled ? tr('Выключить') : tr('Включить')}</button>${item.enabled ? item.views.filter(view => view.slot === 'panel').map(view => `<button type="button" class="secondary" data-action="module-panel" data-view="${esc(view.id)}">${esc(view.title)}</button>`).join('') : ''}<button type="button" class="secondary danger" data-action="module-remove">${tr('Удалить')}</button></div></article>`).join('') : `<p class="form-note">${tr('Подключённых модулей пока нет.')}</p>`;
}
async function handleModuleAction(button) {
  if (button.disabled) return;
  const action = button.dataset.action, row = button.closest('[data-module]'), id = row?.dataset.module || button.dataset.module;
  if (action === 'module-github') return moduleGitHubDialog();
  if (action === 'module-panel') return openModulePanel(id, button.dataset.view);
  button.disabled = true;
  const form = button.closest('#event-form');
  if (form && modalBusy) { button.disabled = false; return; }
  if (form) { modalBusy = true; form.inert = true; }
  try {
    if (action === 'module-import') await api('moduleImport');
    else if (action === 'module-remove') { if (!confirm(tr('Удалить модуль и его сохранённые настройки?'))) return; await api('moduleRemove', { id }); }
    else if (action === 'module-configure') await api('moduleConfigure', { id, enabled: button.dataset.enabled === 'true' });
    else if (action === 'module-invoke') { await api('moduleInvoke', { id, command: button.dataset.command, editorId: form?.dataset.moduleEditor, draft: moduleDraft(form) }); return; }
    await refreshModuleList();
  } finally { button.disabled = false; if (form) { form.inert = false; modalBusy = false; } }
}
function moduleButtons(slot) {
  return connectedModules.filter(item => item.enabled && !item.error).flatMap(item => item.commands.filter(command => command.slot === slot).map(command => `<button type="button" class="secondary" data-action="module-invoke" data-module="${esc(item.id)}" data-command="${esc(command.id)}">${esc(command.title)}</button>`)).join('');
}
function moduleViewSlot(item, view) { return `<section class="module-view-part"><strong>${esc(view.title)}</strong><div class="module-view-slot" data-module="${esc(item.id)}" data-view="${esc(view.id)}" style="height:${view.height}px"></div></section>`; }
function moduleMeetingControls() { return '<div id="meeting-module-contributions"></div>'; }
function renderModuleContributions() {
  for (const slot of ['topbar', 'calendar']) {
    const parent = document.querySelector(slot === 'topbar' ? '.topbar' : '.calendar-toolbar'); if (!parent) continue;
    parent.querySelector('.module-command-menu')?.remove(); const buttons = moduleButtons(slot);
    if (buttons) { const menu = document.createElement('details'); menu.className = 'module-command-menu'; menu.innerHTML = `<summary aria-label="${tr('Модули')}" title="${tr('Модули')}">⋯</summary><div>${buttons}</div>`; parent.append(menu); }
  }
  const container = document.querySelector('#meeting-module-contributions');
  if (container) {
    const form = container.closest('form'); form.dataset.moduleEditor ||= crypto.randomUUID();
    container.innerHTML = moduleButtons('meeting.create') + connectedModules.filter(item => item.enabled && !item.error).flatMap(item => item.views.filter(view => view.slot === 'meeting.create').map(view => moduleViewSlot(item, view))).slice(0, 4).join('');
  }
}
async function loadModuleContributions() {
  connectedModules = window.aster && state.account ? await api('moduleCatalog') : [];
  renderModuleContributions();
}
function openModulePanel(id, viewId) {
  const item = connectedModules.find(item => item.id === id && item.enabled), view = item?.views.find(view => view.id === viewId);
  if (!view || !confirmDiscardChanges()) return;
  modal(item.name, view.title, moduleViewSlot(item, view));
}
function receiveModuleAction(data) {
  if (data.sessionId !== state.account?.sessionId || !connectedModules.some(item => item.id === data.id && item.enabled)) return;
  if (data.method === 'ui.openView') return openModulePanel(data.id, data.input.view);
  if (!['meeting.openDraft', 'meeting.patchDraft'].includes(data.method)) return;
  if (data.method === 'meeting.openDraft') { if (modalBusy || !confirmDiscardChanges()) return; eventModal(); }
  const form = document.querySelector('#event-form');
  if (!form || form.dataset.editing === 'true' || data.method === 'meeting.patchDraft' && data.editorId !== form.dataset.moduleEditor) return;
  const entries = Object.entries(data.input).map(([key, value]) => [key, ['start', 'end'].includes(key) ? T.wall(value, timeZone).slice(0, 16) : value]);
  if (entries.some(([key, value]) => form.elements[key]?.value && form.elements[key].value !== value) && !confirm(tr('Модуль предлагает заменить заполненные поля встречи. Применить?'))) return;
  for (const [key, value] of entries) if (form.elements[key]) form.elements[key].value = value;
  markModalDirty();
}
async function syncModuleMounts() {
  if (isComposeWindow || !window.aster || !state.account || moduleMountBusy) return;
  const modal = document.querySelector('#modal');
  const views = [...document.querySelectorAll('.module-view-slot')].filter(slot => !modal.open || modal.contains(slot)).map(slot => {
    const rect = slot.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
    for (let parent = slot.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left + parent.clientLeft); top = Math.max(top, clip.top + parent.clientTop);
        right = Math.min(right, clip.left + parent.clientLeft + parent.clientWidth); bottom = Math.min(bottom, clip.top + parent.clientTop + parent.clientHeight);
      }
    }
    right = Math.max(left, right); bottom = Math.max(top, bottom);
    return { id: slot.dataset.module, view: slot.dataset.view, editorId: slot.closest('#event-form')?.dataset.moduleEditor, draft: moduleDraft(slot.closest('#event-form')), bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, clip: { x: left, y: top, width: right - left, height: bottom - top } };
  }).filter(Boolean).slice(0, 4);
  const key = JSON.stringify([state.account.sessionId, views]); if (key === moduleMountState) return;
  moduleMountState = key; moduleMountBusy = true;
  try { await api('moduleMounts', { views }); } catch (error) { showError(error); } finally { moduleMountBusy = false; }
}
setInterval(() => { void syncModuleMounts(); }, 300);

function unmountModuleViews() {
  moduleMountState = '';
  if (!isComposeWindow && window.aster && state.account) void api('moduleMounts', { views: [] }).catch(() => {});
}

function moduleDraft(form) {
  if (!form) return undefined;
  const data = { title: form.elements.title.value.slice(0, 1000), location: form.elements.location.value.slice(0, 2000), body: form.elements.body.value.slice(0, 8000), timeZone: T.zone(timeZone), start: null, end: null, truncated: form.elements.body.value.length > 8000 };
  try { data.start = T.fromWall(form.elements.start.value, timeZone).toISOString(); data.end = T.fromWall(form.elements.end.value, timeZone).toISOString(); } catch { /* Incomplete editing is valid UI state. */ }
  return data;
}

function moduleGitHubDialog() {
  if (!window.aster || !state.account || !confirmDiscardChanges()) return;
  modal(tr('Модуль с GitHub'), tr('Будут загружены только файлы пакета. Скрипты установки и сборки не запускаются.'), `<form id="module-github-form">${field('url', tr('Репозиторий GitHub'), '', 'url', true)}${field('ref', tr('Ветка, тег или commit (пусто — основная ветка)'))}${field('directory', tr('Папка модуля в репозитории (пусто — корень)'))}<p class="form-note">${tr('Поддерживаются публичные репозитории с module.json API 1. Перед установкой покажем точный commit, SHA-256 и разрешения.')}</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="close">${tr('Отмена')}</button><button type="submit" class="primary">${tr('Проверить и подключить')}</button></div></form>`);
}
async function installModuleFromGitHub(form) {
  if (modalBusy) return;
  let success = false;
  modalBusy = true; form.inert = true; form.classList.add('busy');
  try { await api('moduleImportGitHub', Object.fromEntries(new FormData(form))); success = true; }
  catch (error) { if (form.isConnected) form.querySelector('[role="alert"]').textContent = errorText(error); }
  finally { modalBusy = false; form.inert = false; form.classList.remove('busy'); }
  if (success && form.isConnected) { await settingsModal(); const tab = document.querySelector('#settings-tab-modules'); if (tab) selectSettingsTab(tab); }
}

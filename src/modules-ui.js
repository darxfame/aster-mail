const modulePermissionNames = () => ({ ui: tr('Открытие собственных панелей'), network: tr('Доступ к указанным сервисам'), storage: tr('Защищённые настройки модуля'), 'calendar.read': tr('Чтение основного календаря'), 'meeting.draft': tr('Заполнение черновика встречи'), 'meeting.launch': tr('Запуск приложения встречи по нажатию «Подключиться»'), 'auth.session': tr('Корпоративный вход в отдельное пространство сервиса'), events: tr('События приложения и модулей') });
let connectedModules = [], moduleMountState = '', moduleMountBusy = false;
function moduleSettingsMarkup() {
  return `<p class="form-note">${tr('Установленные модули работают в песочнице. Их настройки доступны без входа в Exchange.')}</p><p class="form-note">${tr('Модули автора и предложения сообщества — в репозитории Aster Mail Modules.')}</p><p><button type="button" class="secondary" data-action="link" data-url="https://github.com/darxfame/aster-mail-modules">${tr('Модули автора · предложить свой модуль')}</button></p><button type="button" class="primary" data-action="module-approved-list">${tr('Каталог одобренных модулей')}</button> <button type="button" class="secondary" data-action="module-import" ${!window.aster ? 'disabled' : ''}>${tr('Подключить модуль')}</button> <button type="button" class="secondary" data-action="module-github" ${!window.aster ? 'disabled' : ''}>${tr('Подключить с GitHub')}</button><div id="module-list" aria-live="polite"></div>`;
}
async function refreshModuleList() {
  const container = document.querySelector('#module-list');
  if (!container) return;
  const refreshId = crypto.randomUUID(); container.dataset.refreshId = refreshId;
  await loadModuleContributions();
  if (!container.isConnected || container.dataset.refreshId !== refreshId) return;
  container.innerHTML = connectedModules.length ? connectedModules.map(item => `<article class="module-catalog-row" data-module="${esc(item.id)}"><div><h3>${esc(item.name)}<span class="module-version">${esc(item.version)}</span></h3><details><summary>${tr('Разрешения и сведения о модуле')}</summary>${item.source ? `<p class="form-note">${esc(item.source.repository)} · ${esc(item.source.commit.slice(0, 12))}</p>` : ''}<p class="form-note">${tr('Разрешения:')} ${esc((item.permissions || []).map(value => (modulePermissionNames()[value] || value)).join(', '))}</p></details><p>${item.error ? tr('Файлы модуля изменились. Требуется повторная установка.') : item.enabled ? tr('Включён') : tr('Выключен')}</p></div><div class="module-actions"><button type="button" class="secondary" data-action="module-configure" data-enabled="${!item.enabled}" ${item.error ? 'disabled' : ''}>${item.enabled ? tr('Выключить') : tr('Включить')}</button>${item.enabled ? item.views.filter(view => view.slot === 'panel').map(view => `<button type="button" class="secondary" data-action="module-panel" data-view="${esc(view.id)}">${esc(view.title)}</button>`).join('') : ''}<button type="button" class="secondary danger" data-action="module-remove">${tr('Удалить')}</button></div></article>`).join('') : `<p class="form-note">${tr('Подключённых модулей пока нет.')}</p>`;
  if (!window.aster || !connectedModules.length) return;
  const note = document.createElement('p'); note.className = 'form-note'; note.setAttribute('role', 'status'); note.textContent = tr('Проверяем обновления модулей…'); container.append(note);
  try {
    const catalog = await api('moduleAuthorCatalog');
    if (!container.isConnected || container.dataset.refreshId !== refreshId) return;
    for (const row of container.querySelectorAll('[data-module]')) {
      const installed = connectedModules.find(item => item.id === row.dataset.module), next = catalog.modules.find(item => item.manifest.id === installed?.id);
      if (!next || !moduleVersionNewer(next.manifest.version, installed.version)) continue;
      const update = document.createElement('div'); update.className = 'module-update';
      update.innerHTML = `<p class="form-note">${tr('Доступно обновление:')} ${esc(next.manifest.version)}</p><button type="button" class="primary" data-action="module-approved-connect" data-id="${esc(next.manifest.id)}" data-digest="${esc(next.digest)}" data-revision="${esc(catalog.revision)}" ${next.compatible === false ? 'disabled' : ''}>${tr(next.compatible === false ? 'Для этой версии модуля требуется обновить Aster Mail.' : 'Обновить с сохранением настроек')}</button>`;
      row.querySelector('.module-actions').prepend(update);
    }
    note.remove();
  } catch {
    if (container.isConnected && container.dataset.refreshId === refreshId) note.innerHTML = `${tr('Не удалось проверить обновления модулей.')} <button type="button" class="secondary" data-action="module-check-updates">${tr('Повторить')}</button>`;
  }
}
function moduleCommandFeedback(form, message, failed = false) {
  if (!form) { toast(message); return; }
  if (!form.isConnected) return;
  const status = form.querySelector('#meeting-module-status');
  if (!status) return;
  status.textContent = message; status.className = failed ? 'form-error' : 'form-note'; status.hidden = false;
  status.setAttribute('role', failed ? 'alert' : 'status');
  if (failed) status.scrollIntoView({ block: 'nearest' });
}
async function handleModuleAction(button) {
  if (button.disabled) return;
  const action = button.dataset.action, row = button.closest('[data-module]'), id = row?.dataset.module || button.dataset.module;
  if (action === 'module-approved-list') return moduleAuthorCatalog();
  if (action === 'module-approved-connect') return connectApprovedModule(button);
  if (action === 'module-approved-cancel') return resetModuleConfirmation(button.closest('.module-catalog-row'));
  if (action === 'module-github') return moduleGitHubDialog();
  if (action === 'module-panel') return openModulePanel(id, button.dataset.view);
  const form = button.closest('#event-form');
  if (form?.dataset.editing === 'true') return;
  button.disabled = true;
  if (form && modalBusy) { button.disabled = false; return; }
  if (form) { modalBusy = true; form.inert = true; }
  try {
    if (action === 'module-import') await api('moduleImport');
    else if (action === 'module-remove') { if (!confirm(tr('Удалить модуль и его сохранённые настройки?'))) return; await api('moduleRemove', { id }); }
    else if (action === 'module-configure') await api('moduleConfigure', { id, enabled: button.dataset.enabled === 'true' });
    else if (action === 'module-invoke') {
      const status = form?.querySelector('#meeting-module-status'); if (status) status.hidden = true;
      const result = await api('moduleInvoke', { id, command: button.dataset.command, editorId: form?.dataset.moduleEditor, draft: moduleDraft(form) });
      if (typeof result?.message === 'string' && result.message.trim()) moduleCommandFeedback(form, result.message.slice(0, 1000), Boolean(result.error));
      else if (result?.error) moduleCommandFeedback(form, tr('Не удалось выполнить действие модуля. Проверьте его настройки в разделе «Модули».'), true);
      return;
    }
    await refreshModuleList();
  } catch (error) {
    if (!form) throw error;
    moduleCommandFeedback(form, `${errorText(error)} ${tr('Проверьте настройки модуля в разделе «Модули» и повторите действие.')}`, true);
  } finally { button.disabled = false; if (form) { form.inert = false; modalBusy = false; } }
}
function moduleButtons(slot) {
  return connectedModules.filter(item => item.enabled && !item.error).flatMap(item => item.commands.filter(command => command.slot === slot).map(command => `<button type="button" class="secondary" data-action="module-invoke" data-module="${esc(item.id)}" data-command="${esc(command.id)}">${esc(tr(command.title))}</button>`)).join('');
}
function moduleViewSlot(item, view) { return `<section class="module-view-part"><strong>${esc(view.title)}</strong><div class="module-view-slot" data-module="${esc(item.id)}" data-view="${esc(view.id)}" style="height:${view.height}px"></div></section>`; }
function moduleMeetingControls() { return '<div id="meeting-module-contributions"></div><p id="meeting-module-status" class="form-note" role="status" hidden></p>'; }
function renderModuleContributions() {
  for (const slot of ['topbar', 'calendar']) {
    const parent = document.querySelector(slot === 'topbar' ? '.topbar' : '.calendar-toolbar'); if (!parent) continue;
    parent.querySelector('.module-command-menu')?.remove(); const buttons = moduleButtons(slot);
    if (buttons) { const menu = document.createElement('details'); menu.className = 'module-command-menu'; menu.innerHTML = `<summary aria-label="${tr('Модули')}" title="${tr('Модули')}">⋯</summary><div>${buttons}</div>`; parent.append(menu); }
  }
  const container = document.querySelector('#meeting-module-contributions');
  if (container) {
    const form = container.closest('form');
    if (form.dataset.editing === 'true') { container.replaceChildren(); return; }
    form.dataset.moduleEditor ||= crypto.randomUUID();
    container.innerHTML = moduleButtons('meeting.create') + connectedModules.filter(item => item.enabled && !item.error).flatMap(item => item.views.filter(view => view.slot === 'meeting.create').map(view => moduleViewSlot(item, view))).slice(0, 4).join('');
  }
}
async function loadModuleContributions() {
  connectedModules = window.aster ? await api('moduleCatalog') : [];
  renderModuleContributions();
}
function openModulePanel(id, viewId) {
  const item = connectedModules.find(item => item.id === id && item.enabled), view = item?.views.find(view => view.id === viewId);
  if (!view || !confirmDiscardChanges()) return;
  modal(item.name, view.title, moduleViewSlot(item, view));
}
function receiveModuleAction(data) {
  if (!connectedModules.some(item => item.id === data.id && item.enabled && data.sessionId === (item.sessionId || state.account?.sessionId))) return;
  if (data.method === 'ui.openView') return openModulePanel(data.id, data.input.view);
  if (!['meeting.openDraft', 'meeting.patchDraft'].includes(data.method)) return;
  if (data.method === 'meeting.openDraft') { if (modalBusy || !confirmDiscardChanges()) return; eventModal(); }
  const form = document.querySelector('#event-form');
  if (!form || form.dataset.editing === 'true' || data.method === 'meeting.patchDraft' && data.editorId !== form.dataset.moduleEditor) return;
  const entries = Object.entries(data.input).map(([key, value]) => [key, ['start', 'end'].includes(key) ? T.wall(value, timeZone).slice(0, 16) : value]);
  if (entries.some(([key, value]) => form.elements[key]?.value && form.elements[key].value !== value && !(key === 'body' && value.startsWith(form.elements[key].value + '\n\n'))) && !confirm(tr('Модуль предлагает заменить заполненные поля встречи. Применить?'))) return;
  for (const [key, value] of entries) if (form.elements[key]) form.elements[key].value = value;
  markModalDirty();
}
async function syncModuleMounts() {
  if (isComposeWindow || !window.aster || !connectedModules.some(item => item.enabled) || moduleMountBusy) return;
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
  const key = JSON.stringify([connectedModules.find(item => item.enabled)?.sessionId || state.account?.sessionId, views]); if (key === moduleMountState) return;
  moduleMountState = key; moduleMountBusy = true;
  try { await api('moduleMounts', { views }); } catch (error) { showError(error); } finally { moduleMountBusy = false; }
}
setInterval(() => { void syncModuleMounts(); }, 300);

function unmountModuleViews() {
  moduleMountState = '';
  if (!isComposeWindow && window.aster) void api('moduleMounts', { views: [] }).catch(() => {});
}

function moduleDraft(form) {
  if (!form) return undefined;
  const data = { title: form.elements.title.value.slice(0, 1000), location: form.elements.location.value.slice(0, 2000), body: form.elements.body.value.slice(0, 8000), timeZone: T.zone(timeZone), start: null, end: null, truncated: form.elements.body.value.length > 8000 };
  try { data.start = T.fromWall(form.elements.start.value, timeZone).toISOString(); data.end = T.fromWall(form.elements.end.value, timeZone).toISOString(); } catch { /* Incomplete editing is valid UI state. */ }
  return data;
}

function moduleGitHubDialog() {
  if (!window.aster || !confirmDiscardChanges()) return;
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

async function moduleAuthorCatalog() {
  if (modalBusy || !confirmDiscardChanges()) return;
  modal(tr('Каталог одобренных модулей'), tr('Источник: darxfame/aster-mail-modules'), `<div id="module-author-catalog" aria-live="polite"><p class="form-note">${tr('Загружаем каталог…')}</p></div><div class="modal-footer"><button type="button" class="secondary" data-action="module-approved-list">${tr('Обновить список')}</button><button type="button" class="secondary" data-action="close">${tr('Закрыть')}</button></div>`);
  const container = document.querySelector('#module-author-catalog'), account = state.account;
  if (!window.aster) { container.textContent = tr('Каталог доступен в настольном клиенте, в том числе в деморежиме.'); return; }
  try {
    const [catalogResult, installedResult] = await Promise.allSettled([api('moduleAuthorCatalog'), api('moduleCatalog')]);
    if (catalogResult.status === 'rejected') throw catalogResult.reason;
    const catalog = catalogResult.value, installed = installedResult.status === 'fulfilled' ? installedResult.value : [];
    if (!container.isConnected || state.account !== account) return;
    container.innerHTML = `${installedResult.status === 'rejected' ? `<p class="form-error" role="alert">${esc(errorText(installedResult.reason))}</p>` : ''}<p class="form-note">${tr('Подключите модуль, чтобы открыть его настройки. Вход в Exchange для этого не нужен.')}</p><div class="module-catalog-list">` + (catalog.modules.map(item => {
      const m = item.manifest, existing = installed.find(value => value.id === m.id), update = existing && moduleVersionNewer(m.version, existing.version);
      return `<article class="module-catalog-row"><div><h3>${esc(m.name)}<span class="module-version">${esc(m.version)}</span></h3>${item.description !== m.name ? `<p>${esc(item.description)}</p>` : ''}<details><summary>${tr('Разрешения и сведения о модуле')}</summary><p>${tr('Разрешения:')} ${esc(m.permissions.map(value => (modulePermissionNames()[value] || value)).join(', '))}</p><p>${esc(item.directory || '/')}<br>commit: ${esc(item.commit)}<br>SHA-256: ${esc(item.digest)}</p></details></div><div class="module-catalog-actions"><button type="button" class="primary" data-action="module-approved-connect" data-id="${esc(m.id)}" data-digest="${esc(item.digest)}" data-revision="${esc(catalog.revision)}" ${existing && !update || item.compatible === false ? 'disabled' : ''}>${item.compatible === false ? tr('Для этой версии модуля требуется обновить Aster Mail.') : update ? tr('Обновить с сохранением настроек') : existing ? tr('Уже подключён') : tr('Подключить')}</button></div></article>`;
    }).join('') || `<p class="form-note">${tr(catalog.published === false ? 'Каталог ещё не опубликован автором.' : 'Одобренных модулей пока нет.')}</p>`) + '</div>';
  } catch (error) { if (container.isConnected && state.account === account) container.textContent = errorText(error); }
}
function resetModuleConfirmation(row) {
  const button = row?.querySelector('[data-action="module-approved-connect"]');
  if (button?.dataset.confirmLabel) button.textContent = button.dataset.confirmLabel;
  if (button) { delete button.dataset.confirmed; delete button.dataset.confirmAccount; delete button.dataset.confirmLabel; }
  row?.querySelector('.module-confirm-note')?.remove();
  row?.querySelector('[data-action="module-approved-cancel"]')?.remove();
}
async function connectApprovedModule(button) {
  if (modalBusy || !window.aster) return;
  const row = button.closest('.module-catalog-row');
  if (button.dataset.confirmed !== 'true') {
    document.querySelectorAll('.module-catalog-row').forEach(resetModuleConfirmation);
    button.dataset.confirmed = 'true'; button.dataset.confirmAccount = state.account?.sessionId || '';
    button.dataset.confirmLabel = button.textContent; button.textContent = tr('Подтвердить подключение');
    // Installation itself authorizes the capabilities disclosed in the optional details.
    const note = document.createElement('p'); note.className = 'module-confirm-note'; note.setAttribute('role', 'status');
    note.textContent = tr('Подключить этот модуль?'); row.querySelector('div').append(note);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.dataset.action = 'module-approved-cancel'; cancel.textContent = tr('Отмена'); button.after(cancel);
    return;
  }
  if (button.dataset.confirmAccount !== (state.account?.sessionId || '')) return moduleAuthorCatalog();
  const container = button.closest('#module-author-catalog, #module-list'), account = state.account;
  modalBusy = true; container.inert = true; container.setAttribute('aria-busy', 'true'); button.textContent = tr('Подключаем модуль…');
  let success = false;
  try { await api('moduleInstallApproved', { id: button.dataset.id, digest: button.dataset.digest, revision: button.dataset.revision }); success = true; }
  catch (error) { if (container.isConnected && state.account === account) { const message = document.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = errorText(error); container.append(message); } }
  finally { modalBusy = false; container.inert = false; container.removeAttribute('aria-busy'); button.textContent = tr('Подтвердить подключение'); }
  if (success && container.isConnected && state.account === account) {
    if (container.id === 'module-list') await refreshModuleList();
    else { await loadModuleContributions(); await moduleAuthorCatalog(); }
  }
}

function moduleVersionNewer(next, previous) {
  const a = next.split('.').map(BigInt), b = previous.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

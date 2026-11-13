let updateSnapshot = { installed: '0.2.25', status: 'idle', autoCheck: true, available: null, error: '' };
const promptedUpdateVersions = new Set();
let updatePromptsReady = false;
let updateInstallAttempt = 0, updateOpening = false;
function maybePromptUpdate() {
  const value = updateSnapshot;
  if (!updatePromptsReady || !window.aster || !value.autoCheck || !value.available || value.error || !['available', 'ready'].includes(value.status) || promptedUpdateVersions.has(value.available.version)) return;
  const dialog = document.querySelector('#modal');
  if (document.visibilityState === 'hidden' || dialog.open || modalBusy || modalDirty) return;
  promptedUpdateVersions.add(value.available.version);
  modal(tr('Доступно обновление Aster Mail'), `${tr('Установлена версия')} ${value.installed} · ${tr('Доступна версия')} ${value.available.version}`, `<p class="form-note">${tr(value.available.restart ? 'Кнопка «Обновить и перезапустить» скачает и проверит обновление, затем перезапустит Aster. Перед выходом приложение проверит несохранённые изменения.' : 'Кнопка «Обновить приложение» скачает, проверит и откроет установщик. Завершите установку по его инструкциям; приложение не закрывается автоматически.')}</p><div id="updates-panel" data-install-flow="true"></div><div class="modal-footer"><button type="button" class="secondary" data-action="close">${tr('Позже')}</button></div>`);
  renderUpdates();
}
function enableUpdatePrompts() { updatePromptsReady = true; maybePromptUpdate(); }
function updateStatus(value) {
  if (value.installing) return tr('Подготавливаем обновление…');
  if (value.staged) return tr('Обновление подготовлено. Оно установится при выходе из приложения.');
  if (value.status === 'checking') return tr('Проверяем GitHub…');
  if (value.status === 'downloading' && value.retryAt) return tr('Соединение прервалось. Повторяем загрузку…');
  if (value.status === 'downloading') return `${tr("Загрузка установщика ·")} ${value.progress}% · ${bytes(value.received || 0)} / ${bytes(value.available?.size || 0)}${value.speed ? ` · ${bytes(value.speed)}${tr('/с')}` : ''}`;
  if (value.status === 'paused') return `${tr('Загрузка приостановлена')} · ${value.progress}% · ${bytes(value.received || 0)} / ${bytes(value.available?.size || 0)}`;
  if (value.status === 'ready') return tr('Установщик загружен, SHA-256 проверен');
  if (value.available) return `${tr("Доступна версия")} ${value.available.version}`;
  if (value.status === 'current') return tr('У вас актуальная версия');
  return tr('Обновления ещё не проверялись');
}
function receiveUpdate(value) {
  updateSnapshot = value;
  const button = document.querySelector('.statusbar .version');
  if (button) {
    button.textContent = value.available ? `${value.installed} · ${value.status === 'ready' ? tr('Установить') : tr('Обновление')}` : value.installed;
    button.classList.toggle('update-available', Boolean(value.available));
    button.title = updateStatus(value);
  }
  renderUpdates();
  maybePromptUpdate();
}
function renderUpdates() {
  const panel = document.querySelector('#updates-panel'); if (!panel) return;
  const focused = panel.contains?.(document.activeElement) ? document.activeElement.dataset.update : null;
  const value = updateSnapshot, busy = updateOpening || value.installing || ['checking', 'downloading'].includes(value.status);
  panel.innerHTML = `<p class="update-status" role="status">${esc(updateStatus(value))}</p>
    ${value.lastChecked ? `<p class="form-note">${tr("Последняя проверка:")} ${esc(new Date(value.lastChecked).toLocaleString(window.asterI18n.locale))}</p>` : ''}
    ${value.status === 'downloading' ? `<progress max="100" value="${value.progress}" aria-label="${tr("Загрузка обновления")}"></progress>` : ''}
    ${value.available?.notes ? `<details class="update-notes"><summary>${tr("Что нового в")} ${esc(value.available.version)}</summary><pre>${esc(value.available.notes)}</pre></details>` : ''}
    ${value.error ? `<p class="form-error" role="alert">${esc(errorText(value.error))}</p>` : ''}
    <div class="update-actions"><button class="secondary" data-update="checkUpdates" ${busy || value.staged ? 'disabled' : ''}>${tr("Проверить обновления")}</button>
    ${value.available ? `<button class="primary" data-update="${panel.dataset.installFlow || value.available.restart ? 'installUpdate' : value.status === 'ready' ? 'openUpdateInstaller' : 'downloadUpdate'}" ${busy ? 'disabled' : ''}>${value.status === 'paused' ? tr('Продолжить загрузку') : value.available.restart ? tr('Обновить и перезапустить') : panel.dataset.installFlow ? tr('Обновить приложение') : value.status === 'ready' ? tr('Открыть установщик') : tr('Скачать установщик')}</button>` : ''}
    ${value.status === 'downloading' ? `<button class="secondary" data-update="pauseUpdateDownload">${tr('Пауза')}</button>` : ''}
    ${['downloading', 'paused'].includes(value.status) ? `<button class="secondary" data-update="cancelUpdateDownload">${tr('Отменить загрузку')}</button>` : ''}</div>`;
  if (focused) (panel.querySelector(`[data-update="${focused}"]:not(:disabled)`) || panel.querySelector('[data-update="downloadUpdate"]:not(:disabled),[data-update="installUpdate"]:not(:disabled)'))?.focus({ preventScroll: true });
}
async function updatesModal() {
  const previousModal = modalSequence;
  if (window.aster) updateSnapshot = await api('updateState');
  if (modalBusy || modalDirty || modalSequence !== previousModal) return;
  if (updateSnapshot.available) promptedUpdateVersions.add(updateSnapshot.available.version);
  modal(tr('Обновления Aster Mail'), `${tr("Установлена версия")} ${updateSnapshot.installed}`, `<label class="checkbox"><input id="automatic-updates" type="checkbox" ${updateSnapshot.autoCheck ? 'checked' : ''} ${window.aster ? '' : 'disabled'}>${tr("Проверять при запуске и каждые 6 часов")}</label>
    <p class="form-note">${tr("Установщик загружается из GitHub Releases, его SHA-256 сверяется с данными GitHub. Загрузка и установка запускаются вами.")}</p>
    <p class="form-note">${tr("На macOS и Windows нажмите «Обновить и перезапустить». Настройки и аккаунт сохраняются. Для старых macOS-релизов без ZIP остаётся ручная установка DMG.")}</p>
    <p class="form-note">${tr("Приложение на macOS пока без Developer ID и нотариализации; при первом переносе сохранённых данных возможен запрос Keychain. На Windows возможны системные запросы разрешения на установку.")}</p>
    ${window.aster ? '<div id="updates-panel"></div>' : tr('<p class="form-note">Проверка и загрузка доступны в настольном приложении.</p>')}`);
  renderUpdates();
}
async function openDownloadedUpdate() {
  updateOpening = true; renderUpdates();
  try { return await api('openUpdateInstaller'); }
  finally { updateOpening = false; renderUpdates(); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-update]'); if (!button || button.disabled) return;
  button.disabled = true;
  if (['pauseUpdateDownload', 'cancelUpdateDownload'].includes(button.dataset.update)) updateInstallAttempt++;
  const version = modalSequence, dialog = document.querySelector('#modal');
  try {
    if (button.dataset.update === 'installUpdate') {
      const attempt = ++updateInstallAttempt;
      if (updateSnapshot.status !== 'ready') receiveUpdate(await api('downloadUpdate'));
      if (attempt === updateInstallAttempt && updateSnapshot.status === 'ready' && !updateSnapshot.error && dialog.open && version === modalSequence) receiveUpdate(await openDownloadedUpdate());
    } else receiveUpdate(await (button.dataset.update === 'openUpdateInstaller' ? openDownloadedUpdate() : api(button.dataset.update)));
  }
  catch (error) { toast(errorText(error)); renderUpdates(); }
});
document.addEventListener('close', () => {
  updateInstallAttempt++;
  if (updateOpening) void api('cancelUpdateInstall').catch(() => {});
  setTimeout(maybePromptUpdate, 0);
}, true);
document.addEventListener('visibilitychange', maybePromptUpdate);
window.addEventListener('focus', maybePromptUpdate);
document.addEventListener('change', async event => {
  if (event.target.id !== 'automatic-updates') return;
  event.target.disabled = true;
  try { receiveUpdate(await api('saveUpdatePreferences', { autoCheck: event.target.checked })); }
  catch (error) { event.target.checked = updateSnapshot.autoCheck; toast(errorText(error)); }
  finally { event.target.disabled = false; }
});

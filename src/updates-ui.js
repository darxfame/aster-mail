let updateSnapshot = { installed: '0.1.25', status: 'idle', autoCheck: true, available: null, error: '' };
const promptedUpdateVersions = new Set();
let updatePromptsReady = false;
function maybePromptUpdate() {
  const value = updateSnapshot;
  if (!updatePromptsReady || !window.aster || !value.autoCheck || !value.available || value.error || !['available', 'ready'].includes(value.status) || promptedUpdateVersions.has(value.available.version)) return;
  const dialog = document.querySelector('#modal');
  if (document.visibilityState === 'hidden' || dialog.open || modalBusy || modalDirty) return;
  promptedUpdateVersions.add(value.available.version);
  modal(tr('Доступно обновление Aster Mail'), `${tr('Установлена версия')} ${value.installed} · ${tr('Доступна версия')} ${value.available.version}`, `<p class="form-note">${tr('Кнопка «Обновить приложение» скачает, проверит и откроет установщик. Завершите установку по его инструкциям; приложение не закрывается автоматически.')}</p><div id="updates-panel" data-install-flow="true"></div><div class="modal-footer"><button type="button" class="secondary" data-action="close">${tr('Позже')}</button></div>`);
  renderUpdates();
}
function enableUpdatePrompts() { updatePromptsReady = true; maybePromptUpdate(); }
function updateStatus(value) {
  if (value.status === 'checking') return tr('Проверяем GitHub…');
  if (value.status === 'downloading') return `${tr("Загрузка установщика ·")} ${value.progress}%`;
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
  const value = updateSnapshot, busy = ['checking', 'downloading'].includes(value.status);
  panel.innerHTML = `<p class="update-status" role="status">${esc(updateStatus(value))}</p>
    ${value.lastChecked ? `<p class="form-note">${tr("Последняя проверка:")} ${esc(new Date(value.lastChecked).toLocaleString(window.asterI18n.locale))}</p>` : ''}
    ${value.status === 'downloading' ? `<progress max="100" value="${value.progress}" aria-label="${tr("Загрузка обновления")}"></progress>` : ''}
    ${value.available?.notes ? `<details class="update-notes"><summary>${tr("Что нового в")} ${esc(value.available.version)}</summary><pre>${esc(value.available.notes)}</pre></details>` : ''}
    ${value.error ? `<p class="form-error" role="alert">${esc(value.error)}</p>` : ''}
    <div class="update-actions"><button class="secondary" data-update="checkUpdates" ${busy ? 'disabled' : ''}>${tr("Проверить обновления")}</button>
    ${value.available ? `<button class="primary" data-update="${panel.dataset.installFlow ? 'installUpdate' : value.status === 'ready' ? 'openUpdateInstaller' : 'downloadUpdate'}" ${busy ? 'disabled' : ''}>${panel.dataset.installFlow ? tr('Обновить приложение') : value.status === 'ready' ? tr('Открыть установщик') : tr('Скачать установщик')}</button>` : ''}</div>`;
}
async function updatesModal() {
  const previousModal = modalSequence;
  if (window.aster) updateSnapshot = await api('updateState');
  if (modalBusy || modalDirty || modalSequence !== previousModal) return;
  if (updateSnapshot.available) promptedUpdateVersions.add(updateSnapshot.available.version);
  modal(tr('Обновления Aster Mail'), `${tr("Установлена версия")} ${updateSnapshot.installed}`, `<label class="checkbox"><input id="automatic-updates" type="checkbox" ${updateSnapshot.autoCheck ? 'checked' : ''} ${window.aster ? '' : 'disabled'}>${tr("Проверять при запуске и каждые 6 часов")}</label>
    <p class="form-note">${tr("Установщик загружается из GitHub Releases, его SHA-256 сверяется с данными GitHub. Загрузка и установка запускаются вами.")}</p>
    <p class="form-note">${tr("На macOS откройте DMG, завершите Aster через ⌘Q и перенесите новую версию в «Программы». На Windows откройте EXE и следуйте установщику. Приложение не закрывается автоматически. Настройки и аккаунт остаются на компьютере.")}</p>
    <p class="form-note">${tr("Установщики не подписаны Developer ID / сертификатом Windows. SHA-256 проверяет целостность файла и не заменяет подпись издателя. Версию 0.1.8 нужно один раз обновить вручную.")}</p>
    ${window.aster ? '<div id="updates-panel"></div>' : tr('<p class="form-note">Проверка и загрузка доступны в настольном приложении.</p>')}`);
  renderUpdates();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-update]'); if (!button || button.disabled) return;
  button.disabled = true;
  const version = modalSequence, dialog = document.querySelector('#modal');
  try {
    if (button.dataset.update === 'installUpdate') {
      if (updateSnapshot.status !== 'ready') receiveUpdate(await api('downloadUpdate'));
      if (updateSnapshot.status === 'ready' && !updateSnapshot.error && dialog.open && version === modalSequence) receiveUpdate(await api('openUpdateInstaller'));
    } else receiveUpdate(await api(button.dataset.update));
  }
  catch (error) { toast(error.message); renderUpdates(); }
});
document.addEventListener('close', () => { setTimeout(maybePromptUpdate, 0); }, true);
document.addEventListener('visibilitychange', maybePromptUpdate);
window.addEventListener('focus', maybePromptUpdate);
document.addEventListener('change', async event => {
  if (event.target.id !== 'automatic-updates') return;
  event.target.disabled = true;
  try { receiveUpdate(await api('saveUpdatePreferences', { autoCheck: event.target.checked })); }
  catch (error) { event.target.checked = updateSnapshot.autoCheck; toast(error.message); }
  finally { event.target.disabled = false; }
});

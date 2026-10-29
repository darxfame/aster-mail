let updateSnapshot = { installed: '0.1.11', status: 'idle', autoCheck: true, available: null, error: '' };
function updateStatus(value) {
  if (value.status === 'checking') return 'Проверяем GitHub…';
  if (value.status === 'downloading') return `Загрузка установщика · ${value.progress}%`;
  if (value.status === 'ready') return 'Установщик загружен, SHA-256 проверен';
  if (value.available) return `Доступна версия ${value.available.version}`;
  if (value.status === 'current') return 'У вас актуальная версия';
  return 'Обновления ещё не проверялись';
}
function receiveUpdate(value) {
  updateSnapshot = value;
  const button = document.querySelector('.statusbar .version');
  if (button) {
    button.textContent = value.available ? `${value.installed} · ${value.status === 'ready' ? 'Установить' : 'Обновление'}` : value.installed;
    button.classList.toggle('update-available', Boolean(value.available));
    button.title = updateStatus(value);
  }
  renderUpdates();
}
function renderUpdates() {
  const panel = document.querySelector('#updates-panel'); if (!panel) return;
  const value = updateSnapshot, busy = ['checking', 'downloading'].includes(value.status);
  panel.innerHTML = `<p class="update-status" role="status">${esc(updateStatus(value))}</p>
    ${value.lastChecked ? `<p class="form-note">Последняя проверка: ${esc(new Date(value.lastChecked).toLocaleString('ru-RU'))}</p>` : ''}
    ${value.status === 'downloading' ? `<progress max="100" value="${value.progress}" aria-label="Загрузка обновления"></progress>` : ''}
    ${value.available?.notes ? `<details class="update-notes"><summary>Что нового в ${esc(value.available.version)}</summary><pre>${esc(value.available.notes)}</pre></details>` : ''}
    ${value.error ? `<p class="form-error" role="alert">${esc(value.error)}</p>` : ''}
    <div class="update-actions"><button class="secondary" data-update="checkUpdates" ${busy ? 'disabled' : ''}>Проверить обновления</button>
    ${value.available ? `<button class="primary" data-update="${value.status === 'ready' ? 'openUpdateInstaller' : 'downloadUpdate'}" ${busy ? 'disabled' : ''}>${value.status === 'ready' ? 'Открыть установщик' : 'Скачать установщик'}</button>` : ''}</div>`;
}
async function updatesModal() {
  if (window.aster) updateSnapshot = await api('updateState');
  modal('Обновления Aster Mail', `Установлена версия ${updateSnapshot.installed}`, `<label class="checkbox"><input id="automatic-updates" type="checkbox" ${updateSnapshot.autoCheck ? 'checked' : ''} ${window.aster ? '' : 'disabled'}>Проверять при запуске и каждые 6 часов</label>
    <p class="form-note">Установщик загружается из GitHub Releases, его SHA-256 сверяется с данными GitHub. Загрузка и установка запускаются вами.</p>
    <p class="form-note">На macOS откройте DMG, завершите Aster через ⌘Q и перенесите новую версию в «Программы». На Windows откройте EXE и следуйте установщику. Приложение не закрывается автоматически. Настройки и аккаунт остаются на компьютере.</p>
    <p class="form-note">Установщики не подписаны Developer ID / сертификатом Windows. SHA-256 проверяет целостность файла и не заменяет подпись издателя. Версию 0.1.8 нужно один раз обновить вручную.</p>
    ${window.aster ? '<div id="updates-panel"></div>' : '<p class="form-note">Проверка и загрузка доступны в настольном приложении.</p>'}`);
  renderUpdates();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-update]'); if (!button || button.disabled) return;
  button.disabled = true;
  try { receiveUpdate(await api(button.dataset.update)); }
  catch (error) { toast(error.message); renderUpdates(); }
});
document.addEventListener('change', async event => {
  if (event.target.id !== 'automatic-updates') return;
  event.target.disabled = true;
  try { receiveUpdate(await api('saveUpdatePreferences', { autoCheck: event.target.checked })); }
  catch (error) { event.target.checked = updateSnapshot.autoCheck; toast(error.message); }
  finally { event.target.disabled = false; }
});

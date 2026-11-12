(function (root) {
  const text = value => root.asterI18n.text(value);
  const until = state => root.asterTime.format(state.presentationUntil, { hour: '2-digit', minute: '2-digit' }, state.timeZone || 'system');
  root.asterPresentation = {
    label(state) { return state.presentationMode ? state.presentationUntil ? `${text('Презентация: до')} ${until(state)}` : text('Презентация: включена') : state.privacyActive ? text('Автоскрытие: вкл.') : text('Презентация: выкл.'); },
    description(state) {
      if (state.presentationMode) return `${text('Уведомления приостановлены до')} ${until(state)}. ${text('Время встреч остаётся видно; названия и описание скрыты.')}`;
      if (state.privacyActive) return state.privacyReason === 'checking' ? text('Проверяем выбранные приложения. Содержимое временно скрыто.') : `${text('Автоскрытие: запущено выбранное приложение')} ${(state.privacyApplications || []).join(', ')}. ${text('Время встреч остаётся видно; названия и описание скрыты.')}`;
      return text('Скрытие выключено. Названия и описание встреч доступны.');
    },
  };
})(window);
let presentationSnapshot = { presentationMode: false, privacyActive: false, presentationUntil: 0 };
function receivePresentation(snapshot) {
  presentationSnapshot = { ...presentationSnapshot, ...snapshot };
  for (const button of document.querySelectorAll('[data-presentation-toggle]')) {
    button.textContent = window.asterPresentation.label(presentationSnapshot);
    button.setAttribute('aria-checked', String(Boolean(presentationSnapshot.presentationMode)));
    button.title = window.asterPresentation.description(presentationSnapshot);
  }
  const status = document.querySelector('#presentation-status');
  if (status) status.textContent = window.asterPresentation.description(presentationSnapshot);
}

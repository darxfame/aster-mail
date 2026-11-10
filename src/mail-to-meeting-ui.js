let mailToMeetingRequest = 0;
async function meetingFromMail(button) {
  const message = state.selected;
  if (!message || isDraftMessage(message) || modalBusy || $('#modal').open) return;
  const account = state.account, generation = state.generation, sequence = messageOpenSequence, dialog = modalSequence;
  const request = ++mailToMeetingRequest;
  const current = () => account === state.account && generation === state.generation && sequence === messageOpenSequence && state.selected === message && modalSequence === dialog && request === mailToMeetingRequest;
  button.disabled = true;
  try {
    let identity = { emails: [] }, identityError = '';
    try { identity = state.demo ? { emails: ['you@example.com'] } : await api('identity'); }
    catch (error) { identityError = errorText(error); }
    if (!current()) return;
    const sent = message.folder === 'sentitems' || !state.query && state.folder === 'sentitems' || state.folders.some(folder => folder.wellKnown === 'sentitems' && (message.parentId === folder.id || !state.query && state.folder === folder.id));
    const draft = window.asterMailToMeeting.draft(message, {
      ownEmails: identity.emails || [], sent, address: state.demo ? '' : account.server,
      text: meetingPlainBody({ html: message.html, body: message.text, preview: message.preview }),
      received: dateFormat(message.date, { dateStyle: 'medium', timeStyle: 'short' }),
    });
    eventModal();
    const form = $('#event-form');
    if (!form || form.dataset.editing === 'true') return;
    for (const key of ['title', 'attendees', 'body']) form.elements[key].value = draft[key];
    const note = document.createElement('p'); note.className = 'form-note'; note.setAttribute('role', 'status');
    note.textContent = [tr('Встреча подготовлена из письма. Проверьте время, участников и текст перед отправкой. Вложения не переносятся.'), draft.sourceUrl ? tr('Ссылка на исходное письмо относится к вашему ящику; у других участников может не быть доступа.') : '', draft.unknownIdentity ? tr('Адрес аккаунта не определён. Добавьте участников вручную.') : '', draft.omittedRecipients ? tr('Некоторые адреса недоступны. Проверьте список участников.') : '', draft.truncated ? tr('Текст письма сокращён до 16000 символов.') : '', identityError].filter(Boolean).join(' ');
    form.prepend(note);
    markModalDirty(); form.elements.title.focus();
  } finally { if (button.isConnected) button.disabled = false; }
}

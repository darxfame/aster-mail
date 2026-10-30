function composeMessageSnapshot(message) {
  if (!message) return null;
  return Object.fromEntries(['id', 'changeKey', 'parentId', 'from', 'to', 'cc', 'bcc', 'subject', 'html', 'text', 'preview', 'attachments', 'folder', 'isDraft'].filter(key => message[key] !== undefined).map(key => [key, message[key]]));
}
// Transfer only the current draft, in memory, after the new editor acknowledges it.
async function detachCompose(mode) {
  if (modalBusy || !window.aster) return;
  const form = $('#compose-form'), generation = state.generation;
  modalBusy = true; form.inert = true;
  try {
    const { editor, historyEditor, attachments, ...data } = composeData;
    if (data.draftOriginal) data.draftOriginal = composeMessageSnapshot(data.draftOriginal);
    const files = await Promise.all(attachments.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error(tr('Не удалось прочитать вложение')));
      reader.onload = () => resolve({ name: file.name, type: file.type, content: reader.result.split(',')[1] });
      reader.readAsDataURL(file);
    })));
    if (generation !== state.generation) throw new Error(tr('Сессия аккаунта завершена'));
    await api('detachCompose', { demo: state.demo, preferences: { theme: state.theme, timeZone, interfaceScale, debugErrors: notificationPreferences.debugErrors === true }, snapshot: {
      mode, fields: Object.fromEntries(new FormData(form)), data, files, body: editor.read(), history: historyEditor?.read(),
      selected: composeMessageSnapshot(state.selected), dirty: modalDirty,
    } });
    setModalDirty(false); $('#modal').close();
  } catch (error) { form.querySelector('[role="alert"]').textContent = errorText(error); }
  finally { modalBusy = false; form.inert = false; }
}
async function bootComposeWindow() {
  const context = await api('composeContext');
  if (!context) throw new Error(tr('Не удалось открыть окно письма'));
  const { snapshot, preferences = {} } = context;
  applyLanguage(context.language);
  state.account = context.account; state.demo = context.demo; state.selected = snapshot.selected;
  notificationPreferences.debugErrors = preferences.debugErrors === true;
  state.theme = preferences.theme || 'light'; timeZone = preferences.timeZone || 'system';
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.body.classList.add('compose-window');
  await compose(snapshot.mode, null, snapshot);
  document.title = `${snapshot.fields.subject || tr('Новое письмо')} · Aster Mail`;
  setModalDirty(snapshot.dirty === true);
  const dialog = $('#modal');
  dialog.addEventListener('close', () => { void api('closeCompose').catch(showError); });
  // Escape uses the same explicit discard protection as the close button.
  dialog.addEventListener('cancel', event => { if (modalBusy || !confirmDiscardChanges()) event.preventDefault(); });
  await api('composeReady');
}

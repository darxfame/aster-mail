function undoSendSeconds() {
  const seconds = Number(localPreferences.getItem('aster-undo-send-seconds'));
  return [5, 10, 20, 30].includes(seconds) ? seconds : 0;
}

async function waitForComposeSend(form) {
  const seconds = undoSendSeconds();
  if (!seconds) return true;
  const notice = document.createElement('div');
  notice.className = 'compose-send-delay';
  const status = document.createElement('span'), undo = document.createElement('button');
  status.setAttribute('role', 'status');
  status.textContent = `${tr('Письмо будет отправлено через')} ${seconds} ${tr('сек.')}`;
  const countdown = document.createElement('span');

  countdown.setAttribute('aria-hidden', 'true');
  const deadline = Date.now() + seconds * 1000;
  const updateCountdown = () => { countdown.textContent = `${tr('Письмо будет отправлено через')} ${Math.max(1, Math.ceil((deadline - Date.now()) / 1000))} ${tr('сек.')}`; };
  updateCountdown();
  undo.type = 'button'; undo.className = 'secondary'; undo.textContent = tr('Отменить отправку');
  notice.append(status, countdown, undo);
  form.after(notice);
  undo.focus();
  const tick = setInterval(updateCountdown, 250);
  let timer;
  try {
    return await new Promise(resolve => {
      timer = setTimeout(() => resolve(true), seconds * 1000);
      undo.addEventListener('click', () => resolve(false), { once: true });
    });
  } finally {
    clearTimeout(timer); clearInterval(tick);
    notice.remove();
  }
}

function composeMessageSnapshot(message) {
  if (!message) return null;
  return Object.fromEntries(['id', 'changeKey', 'parentId', 'from', 'to', 'cc', 'bcc', 'subject', 'html', 'text', 'preview', 'attachments', 'folder', 'isDraft'].filter(key => message[key] !== undefined).map(key => [key, message[key]]));
}
function readComposeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(tr('Не удалось прочитать вложение')));
    reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', content: reader.result.split(',')[1] });
    reader.readAsDataURL(file);
  });
}
async function readComposeInlineImages(images) {
  return Promise.all(images.map(async ({ file, contentId }) => ({ ...await readComposeFile(file), inline: true, contentId })));
}
// Transfer only the current draft, in memory, after the new editor acknowledges it.
async function detachCompose(mode) {
  if (modalBusy || !window.aster) return;
  const form = $('#compose-form'), generation = state.generation;
  if (!window.asterRecipients.commit(form)) return;
  modalBusy = true; form.inert = true;
  try {
    const { editor, historyEditor, attachments, sourceMessage, ...data } = composeData;
    closeAttachmentPreview();
    if (data.draftOriginal) data.draftOriginal = composeMessageSnapshot(data.draftOriginal);
    const images = [];
    const body = editor.read('', images);
    if ([...attachments, ...images.map(image => image.file)].reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) throw new Error(tr('Суммарный размер вложений превышает 20 МБ'));
    const [files, inlineImages] = await Promise.all([Promise.all(attachments.map(readComposeFile)), readComposeInlineImages(images)]);
    if (generation !== state.generation) throw new Error(tr('Сессия аккаунта завершена'));
    await api('detachCompose', { demo: state.demo, preferences: { theme: state.theme, timeZone, interfaceScale, debugErrors: notificationPreferences.debugErrors === true, undoSendSeconds: undoSendSeconds() }, snapshot: {
      mode, fields: Object.fromEntries(new FormData(form)), data, files, body, inlineImages, history: historyEditor?.read(),
      selected: composeMessageSnapshot(sourceMessage || state.selected), recipientPeople: window.asterRecipients.composePeople(form), dirty: modalDirty, quickReplies: state.demo ? demoQuickReplies : undefined,
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
  if (state.demo) demoQuickReplies = window.asterQuickReplies.normalize(snapshot.quickReplies || []);
  notificationPreferences.debugErrors = preferences.debugErrors === true;
  localValues['aster-undo-send-seconds'] = String(preferences.undoSendSeconds || 0);
  state.theme = preferences.theme || 'light'; timeZone = preferences.timeZone || 'system';
  applyTheme();
  if (window.aster?.onThemeChanged) await syncThemePreferences().catch(showError);
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

let attachmentPreviewRequest = 0;
function closeAttachmentPreview() {
  attachmentPreviewRequest++;
  const dialog = document.querySelector('#attachment-preview');
  if (dialog) { dialog.close(); dialog.remove(); if (window.aster) void api('composeAttachment', { action: 'close' }).catch(() => {}); }
}
function composeAttachmentCard(file, source = null) {
  const row = document.createElement('div'); row.className = 'compose-attachment-card';
  const info = document.createElement('span');
  info.textContent = `${file.name} · ${bytes(file.size)}`;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
  button.textContent = tr('Предпросмотр'); button.setAttribute('aria-label', `${tr('Предпросмотр вложения:')} ${file.name}`);
  button.addEventListener('click', () => { void previewComposeAttachment(file, source, button); });
  row.append(info, button); return row;
}
async function composeAttachmentPayload(file, source) {
  if (source) return { source, id: file.id };
  if (file.size > 20 * 1024 * 1024) throw new Error(tr('Некорректное или слишком большое вложение'));
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error(tr('Не удалось прочитать вложение')));
    reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(file);
  });
  return { file: { name: file.name, type: file.type, content } };
}
async function previewComposeAttachment(file, source, opener) {
  closeAttachmentPreview();
  const request = attachmentPreviewRequest, generation = state.generation, compose = composeData, account = state.account;
  const meeting = source?.kind === 'event' ? activeMeeting : null;
  const dialog = document.createElement('dialog'); dialog.id = 'attachment-preview'; dialog.className = 'attachment-preview-dialog';
  dialog.setAttribute('aria-label', `${tr('Предпросмотр вложения:')} ${file.name}`);
  const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button'), body = document.createElement('div');
  title.textContent = file.name; close.type = 'button'; close.className = 'secondary'; close.textContent = tr('Закрыть предпросмотр');
  close.addEventListener('click', closeAttachmentPreview);
  header.append(title, close); body.className = 'attachment-preview-body'; body.textContent = tr('Загружаем предпросмотр…');
  dialog.append(header, body); document.body.append(dialog);
  dialog.addEventListener('close', () => { if (request === attachmentPreviewRequest) { attachmentPreviewRequest++; if (window.aster) void api('composeAttachment', { action: 'close' }).catch(() => {}); } dialog.remove(); opener?.isConnected && opener.focus(); });
  dialog.showModal();
  const current = () => request === attachmentPreviewRequest && generation === state.generation && state.account === account && dialog.open && (meeting ? activeMeeting === meeting && $('#modal').open && $('#modal').dataset.meetingCard === 'true' : compose === composeData && $('#compose-form'));
  try {
    let result;
    if (meeting && state.demo) {
      result = file.type?.startsWith('image/') ? { kind: 'image' }
        : /\.(txt|log|md|csv|json)$/i.test(file.name) ? { kind: 'text', text: file.previewText || tr('Это демонстрационное вложение Aster Mail. Реальные файлы загружаются из Exchange.') } : { kind: 'external' };
    } else if (!window.aster) {
      if (!source && /\.(txt|log|md|csv|json)$/i.test(file.name)) result = { kind: 'text', text: await file.slice(0, 100000).text(), truncated: file.size > 100000 };
      else result = { kind: 'external' };
    } else {
      const payload = await composeAttachmentPayload(file, source);
      if (!current()) return;
      result = await api('composeAttachment', { ...payload, action: 'preview' });
    }
    if (!current()) return;
    body.replaceChildren();
    if (result.kind === 'image') {
      const image = document.createElement('img'); image.alt = file.name;
      if (meeting && state.demo) image.src = '../assets/icon.png';
      else {
        const raster = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.dataURL);
        if (!raster) throw new Error(tr('Повреждённый или неподдерживаемый файл изображения'));
        image.src = `data:image/${raster[1]};base64,${raster[2]}`;
      }
      body.append(image);
    } else if (result.kind === 'text') {
      const pre = document.createElement('pre'); pre.textContent = result.text; body.append(pre);
      if (result.truncated) { const note = document.createElement('p'); note.textContent = tr('Показаны первые 100 КБ файла.'); body.append(note); }
    } else if (result.kind === 'pdf') {
      const note = document.createElement('p'); note.textContent = tr('PDF открыт в отдельном окне предпросмотра.'); body.append(note);
    } else {
      const note = document.createElement('p'); note.textContent = tr('Этот документ можно открыть в системном приложении.'); body.append(note);
    }
  } catch (error) { if (current()) body.textContent = errorText(error); }
  if (current()) {
    const open = document.createElement('button'); open.type = 'button'; open.className = 'secondary'; open.textContent = tr('Открыть в системном приложении');
    open.addEventListener('click', async () => {
      if (!current()) return;
      open.disabled = true;
      try {
        if (meeting && state.demo) { toast(tr('Демо: открытие вымышленных вложений недоступно')); return; }
        if (!window.aster) { toast(tr('Открытие вложений доступно в настольном приложении.')); return; }
        const payload = await composeAttachmentPayload(file, source);
        if (current()) await api('composeAttachment', { ...payload, action: 'open' });
      } catch (error) { if (current()) { const note = document.createElement('p'); note.className = 'form-error'; note.textContent = errorText(error); body.append(note); } }
      finally { if (current()) open.disabled = false; }
    });
    body.append(open);
  }
}

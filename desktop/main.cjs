const { app, BrowserWindow, ipcMain, net, session, safeStorage, shell, dialog, Menu, Notification, Tray, nativeImage, screen, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Updates } = require('./updates.cjs');
const { AttachmentFiles, safeName } = require('./attachment-files.cjs');
let attachmentFiles;
const { writeAttachment } = require('./attachment-trust.cjs');
let attachmentCleanupError = '';
let updates;
const { OWAClient } = require('./owa.cjs');
const { createTransport } = require('./transport.cjs');
const { LocalStore } = require('./local-store.cjs');
const { fetchContentImage } = require('./content-images.cjs');
let localStore, connection, accountEpoch = 0;
const { normalizeServer } = require('./protocol.cjs');
const { NotificationTracker, preferences, mailAlert } = require('./notifications.cjs');
const { httpsURL, meetingLink, upcomingMeetings, countdown, pollingRange } = require('./meetings.cjs');
let widgetWindow, widgetEvents = [], widgetDetail = null;
let window, client, account, tray, createWindow, quitting = false;
let unsavedChanges = false, resettingLocalData = false;
let notificationSettings = preferences(), tracker = new NotificationTracker(), polling = false, mailPolling = false;
let lastPoll = null, lastPollError = '', lastMailPoll = null, lastMailError = '';
const activeNotifications = new Set();
let mailAlerts = [];
function publishMailAlerts() {
  if (window && !window.isDestroyed()) window.webContents.send('aster-mail-alerts', mailAlerts);
}
function queueMailAlert(message) {
  const alert = mailAlert(message, notificationSettings.preview);
  mailAlerts = [alert, ...mailAlerts.filter(item => item.id !== alert.id)].slice(0, 20);
  publishMailAlerts();
  return alert;
}
async function pollMail() {
  if (!client || mailPolling) return;
  mailPolling = true;
  const active = client, revision = client.mailCache.generation;
  try {
    const page = await active.messages({ folder: 'inbox', offset: 0, refresh: true });
    if (active !== client) return;
    let inbox = null;
    try { inbox = await active.inboxStatus(); } catch { /* New mail can still appear if the count request fails. */ }
    if (active !== client || revision !== active.mailCache.generation) return;
    if (window && !window.isDestroyed()) window.webContents.send('aster-inbox', { sessionId: active.syncId, page, inbox });
    lastMailPoll = new Date().toISOString(); lastMailError = '';
    const fresh = tracker.newMail(page.items);
    if (!notificationSettings.mail) return;
    for (const message of [...fresh].reverse()) queueMailAlert(message);
    if (fresh.length) {
      const alert = mailAlert(fresh[0], notificationSettings.preview);
      notify('mail', fresh.length > 1 ? `${alert.title} · ещё ${fresh.length - 1}` : alert.title, alert.body, alert.navigation);
    }
  } catch (error) { if (active === client) lastMailError = error.message; }
  finally { mailPolling = false; }
}
const page = path.join(__dirname, '../src/index.html');
const settingsFile = () => path.join(app.getPath('userData'), 'notifications.json');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (createWindow) reveal(); });

function confirmDiscardChanges() {
  if (!unsavedChanges) return true;
  const response = dialog.showMessageBoxSync(window, { type: 'warning', message: 'Есть несохранённые изменения', detail: 'Сохраните письмо или встречу перед выходом. Продолжить без сохранения?', buttons: ['Остаться', 'Не сохранять'], defaultId: 0, cancelId: 0 });
  if (response !== 1) return false;
  unsavedChanges = false;
  return true;
}
async function resetLocalData() {
  if (client || connection || resettingLocalData) throw new Error('Сначала завершите подключение к аккаунту');
  resettingLocalData = true;
  try {
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Сбросить локальные данные?', detail: 'Сохранённый пароль, подпись, коллеги и настройки будут удалены с этого компьютера. Письма и календарь в Exchange сохранятся.', buttons: ['Отмена', 'Сбросить'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return false;
    ++accountEpoch;
    const results = await Promise.allSettled([localStore.clear(), attachmentFiles.clear()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    attachmentCleanupError = ''; return true;
  } finally { resettingLocalData = false; }
}

function reveal(navigation) {
  if (!window || window.isDestroyed()) createWindow();
  window.show(); window.focus();
  if (navigation) {
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => window.webContents.send('aster-navigate', navigation));
    else window.webContents.send('aster-navigate', navigation);
  }
}
function widgetState() {
  const events = upcomingMeetings(widgetEvents).slice(0, 5).map(event => ({ ...event, joinUrl: meetingLink(event) }));
  const calendarEvents = widgetEvents.filter(event => !event.cancelled).map(event => ({ ...event, joinUrl: meetingLink(event) }));
  return { connected: Boolean(client), secure: account?.server.startsWith('https:') !== false, events, calendarEvents, range: pollingRange(), countdown: countdown(events[0]), timeZone: notificationSettings.timeZone, theme: notificationSettings.theme, lastPoll, error: lastMailError || lastPollError };
}
function refreshWidget() {
  const state = widgetState();
  if (tray) {
    if (process.platform === 'darwin') tray.setTitle(client ? state.countdown.label : '');
    tray.setToolTip(state.events[0] ? `${state.events[0].title} · ${state.countdown.detail}` : 'Aster Mail · ближайшие встречи');
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('aster-widget-update', state);
}
function toggleWidget() {
  if (widgetWindow?.isVisible()) { widgetWindow.hide(); return; }
  const bounds = tray.getBounds(), area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const width = Math.min(360, area.width - 16), height = Math.min(520, area.height - 16);
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = new BrowserWindow({ width, height, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, title: 'Aster · ближайшие встречи', backgroundColor: '#f8f6fc',
      webPreferences: { preload: path.join(__dirname, 'widget-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    widgetWindow.loadFile(path.join(__dirname, '../src/widget.html'));
    widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    widgetWindow.webContents.on('will-navigate', event => event.preventDefault());
    widgetWindow.on('blur', () => widgetWindow.hide());
    widgetWindow.once('ready-to-show', () => { widgetWindow.show(); widgetWindow.focus(); });
  }
  widgetWindow.setSize(width, height);
  const x = Math.max(area.x, Math.min(bounds.x + bounds.width / 2 - width / 2, area.x + area.width - width));
  const y = bounds.y + bounds.height + height + 8 < area.y + area.height ? bounds.y + bounds.height + 8 : Math.max(area.y, bounds.y - height - 8);
  widgetWindow.setPosition(Math.round(x), Math.round(y));
  if (!widgetWindow.webContents.isLoading()) { refreshWidget(); widgetWindow.show(); widgetWindow.focus(); }
}
function notify(kind, title, body, navigation) {
  if (!Notification.isSupported()) { lastPollError = 'Системные уведомления недоступны'; return; }
  // Play our sound explicitly; system notification audio can be suppressed independently.
  const notification = new Notification({ title, body, silent: true,
    timeoutType: kind === 'mail' ? 'never' : 'default', groupId: `aster-${kind}`, icon: path.join(__dirname, '../assets/icon.png'),
  });
  activeNotifications.add(notification);
  notification.on('click', () => reveal(navigation));
  notification.on('close', () => activeNotifications.delete(notification));
  notification.on('failed', () => { activeNotifications.delete(notification); lastPollError = 'macOS не показала уведомление. Проверьте разрешение для Aster Mail в настройках системы.'; });
  notification.show();
  if (notificationSettings.sounds) {
    if (process.platform === 'darwin') {
      const sound = app.isPackaged ? path.join(process.resourcesPath, `aster-${kind}.wav`) : path.join(__dirname, `../assets/sounds/aster-${kind}.wav`);
      const player = spawn('/usr/bin/afplay', [sound], { stdio: 'ignore' });
      player.on('error', () => { lastPollError = 'Не удалось воспроизвести звук уведомления'; });
      player.on('exit', code => { if (code) lastPollError = 'Не удалось воспроизвести звук уведомления'; });
    } else if (window && !window.isDestroyed()) window.webContents.send('aster-sound', kind);
  }
}
async function pollNotifications() {
  void pollMail();
  if (!client || polling) return;
  polling = true;
  const active = client;
  let error = '';
  try {
    if (active === client) {
      try {
        const events = await active.calendar(pollingRange());
        if (active !== client) return;
        const next = upcomingMeetings(events)[0];
        if (next) {
          const key = `${next.id}:${next.start}`;
          if (!widgetDetail || widgetDetail.key !== key || Date.now() - widgetDetail.at > 300000) {
            try {
              const data = await active.event({ id: next.id, changeKey: next.changeKey });
              if (active !== client) return;
              widgetDetail = { key, at: Date.now(), data };
            } catch { /* The calendar preview and location remain available. */ }
          }
          if (active !== client) return;
          if (widgetDetail?.key === key) Object.assign(next, { body: widgetDetail.data.body, joinUrl: widgetDetail.data.joinUrl || next.joinUrl, cancelled: widgetDetail.data.cancelled });
        }
        widgetEvents = events;
        for (const event of notificationSettings.meetings ? tracker.reminders(events, notificationSettings.minutes) : []) {
          const minutes = Math.max(0, Math.ceil((new Date(event.start) - Date.now()) / 60000));
          notify('meeting', minutes ? `Встреча через ${minutes} мин.` : 'Встреча начинается', notificationSettings.preview ? event.title : 'Откройте рабочий календарь.', { view: 'calendar', date: event.start });
        }
      } catch (e) { error ||= e.message; }
    }
    if (active === client) { lastPoll = new Date().toISOString(); lastPollError = error; refreshWidget(); }
  } finally { polling = false; }
}


function retireAccount() {
  const previous = connection;
  connection = null; client = null; account = null;
  if (previous) {
    previous.controller.abort(); previous.account.password = '';
    previous.client?.mailCache.clear(); previous.client?.photoCache?.clear();
  }
  mailAlerts = []; publishMailAlerts();
  tracker = new NotificationTracker(); lastPoll = null; lastPollError = ''; lastMailPoll = null; lastMailError = '';
  notificationSettings = preferences(); widgetEvents = []; widgetDetail = null; refreshWidget();
  for (const n of activeNotifications) n.close(); activeNotifications.clear();
  return Promise.all([attachmentFiles?.clear(), ...(previous ? [previous.session.clearStorageData(), previous.images.clearStorageData()] : [])]);
}
async function connect(data, remember, restoring = false) {
  if (resettingLocalData) throw new Error('Дождитесь завершения сброса локальных данных');
  if (typeof data.username !== 'string' || !data.username.trim() || typeof data.password !== 'string' || !data.password) throw new Error('Укажите логин и пароль');
  const credentials = { server: normalizeServer(data.server), username: data.username.trim(), password: data.password };
  if (remember) localStore.requireEncryption();
  const epoch = ++accountEpoch;
  const retired = retireAccount();
  const current = { account: credentials, controller: new AbortController(),
    session: session.fromPartition(`aster-${crypto.randomUUID()}`, { cache: false }),
    images: session.fromPartition(`aster-images-${crypto.randomUUID()}`, { cache: false }) };
  connection = current; account = credentials;
  const assertCurrent = () => { if (epoch !== accountEpoch || connection !== current) throw new Error('Сессия аккаунта завершена'); };
  const transport = createTransport(net, credentials, current.session, current.controller.signal);
  const candidate = new OWAClient(credentials, transport,
    async () => { assertCurrent(); return (await current.session.cookies.get({ url: `${credentials.server}/owa/`, name: 'X-OWA-CANARY' }))[0]?.value; },
    () => { assertCurrent(); return current.session.clearStorageData({ storages: ['cookies'] }); },
    url => fetchContentImage(url, credentials.server, current.images, current.controller.signal));
  current.client = candidate;
  candidate.onConnectionState = status => {
    if (client !== candidate || !candidate.syncId || current.health === status) return;
    current.health = status;
    if (window && !window.isDestroyed()) window.webContents.send('aster-connection', { sessionId: candidate.syncId, status });
  };
  try {
    await retired; assertCurrent();
    await candidate.authenticate(); assertCurrent();
    const saved = await localStore.load(`${credentials.server}|${credentials.username.toLowerCase()}`, assertCurrent); assertCurrent();
    if (remember) await localStore.saveCredentials(credentials, assertCurrent);
    else if (!restoring) await localStore.removeCredentials(assertCurrent);
    assertCurrent();
    candidate.syncId = crypto.randomUUID(); client = candidate;
    notificationSettings = preferences(saved.notifications);
    refreshWidget(); void pollNotifications();
    return { server: credentials.server, username: credentials.username, sessionId: candidate.syncId, localData: saved.values || {}, notifications: notificationSettings };
  } catch (error) {
    if (connection === current) { ++accountEpoch; await retireAccount(); }
    throw error;
  }
}

const methods = new Set(['mailBatch', 'editDraft', 'folderOperation', 'identity', 'clearMailCache', 'folders', 'messages', 'search', 'message', 'change', 'move', 'send', 'draft', 'calendar', 'event', 'createEvent', 'respond', 'contacts', 'createContact', 'signature', 'personPhoto', 'createMailRule', 'availability', 'eventDetails', 'updateEvent', 'eventMessage', 'eventImage', 'contentImages']);
function validate(operation, data) {
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > 30_000_000) throw new Error('Invalid request');
  if (['message', 'event', 'eventDetails', 'joinEvent'].includes(operation) && (typeof data.id !== 'string' || data.id.length > 16000)) throw new Error('Invalid item reference');
  if (['change', 'move', 'respond'].includes(operation) && typeof data.ref?.id !== 'string') throw new Error('Invalid item reference');
  if (['editDraft', 'updateEvent', 'eventMessage', 'eventImage', 'contentImages'].includes(operation) && (typeof data.ref?.id !== 'string' || data.ref.id.length > 16000)) throw new Error('Invalid content reference');
  if (data.scope !== undefined && !['single', 'series'].includes(data.scope)) throw new Error('Invalid meeting scope');
  if (operation === 'change' && (data.field === 'Importance' ? !['High', 'Normal'].includes(data.value) : typeof data.value !== 'boolean')) throw new Error('Invalid value');
  if (operation === 'messages' && (typeof data.folder !== 'string' || !Number.isInteger(data.offset || 0) || (data.offset || 0) < 0)) throw new Error('Invalid folder or offset');
}
app.whenReady().then(async () => {
  app.setAppUserModelId('app.astermail.desktop');
  attachmentFiles = new AttachmentFiles(path.join(app.getPath('userData'), 'opened-attachments'), file => shell.openPath(file));
  try { await attachmentFiles.clear(); } catch (error) { attachmentCleanupError = error.message; }
  updates = new Updates({ directory: path.join(app.getPath('userData'), 'updates'), installed: app.getVersion(),
    // Node fetch has no access to Electron OWA cookies and supports manual redirects.
    fetch: (url, options) => globalThis.fetch(url, options), open: file => shell.openPath(file),
    changed: value => { if (window && !window.isDestroyed()) window.webContents.send('aster-update', value); },
  });
  await updates.initialize();
  localStore = new LocalStore(app.getPath('userData'), safeStorage);
  await fs.rm(settingsFile(), { force: true }); // Remove legacy plaintext notification settings.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Aster Mail', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  createWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().workArea;
    window = new BrowserWindow({ width: Math.min(1440, width), height: Math.min(940, height), minWidth: Math.min(1080, width), minHeight: Math.min(700, height), title: 'Aster Mail',
      backgroundColor: '#f7f8fb', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 },
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    window.loadFile(page);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-prevent-unload', event => { if (confirmDiscardChanges()) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.on('close', event => {
      if (!quitting && client) { event.preventDefault(); window.hide(); }
    });
  };
  ipcMain.on('aster-unsaved-changes', (event, value) => {
    if (event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && typeof value === 'boolean') unsavedChanges = value;
  });
  ipcMain.handle('aster', async (event, operation, data) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
      validate(operation, data);
      if (operation === 'resetLocalData') return { ok: true, value: await resetLocalData() };
      if (operation === 'updateState') return { ok: true, value: updates.snapshot() };
      if (operation === 'checkUpdates') return { ok: true, value: await updates.check() };
      if (operation === 'downloadUpdate') return { ok: true, value: await updates.download() };
      if (operation === 'openUpdateInstaller') return { ok: true, value: await updates.openInstaller() };
      if (operation === 'saveUpdatePreferences') return { ok: true, value: await updates.preferences(data.autoCheck) };
      if (operation === 'mailAlerts') return { ok: true, value: mailAlerts };
      if (operation === 'dismissMailAlert') { mailAlerts = mailAlerts.filter(item => item.id !== data.id); publishMailAlerts(); return { ok: true, value: true }; }
      if (operation === 'notificationSettings') return { ok: true, value: { ...notificationSettings, lastPoll, lastMailPoll, error: attachmentCleanupError || lastMailError || lastPollError, supported: Notification.isSupported() } };
      if (operation === 'saveNotifications') {
        require('../src/time.js').zone(data.timeZone);
        const before = notificationSettings, next = preferences(data);
        if (client) {
          const active = connection;
          if (data.sessionId !== client.syncId) throw new Error('Сессия аккаунта завершена');
          await localStore.save({ notifications: next }, () => { if (connection !== active) throw new Error('Сессия аккаунта завершена'); });
          if (connection !== active) throw new Error('Сессия аккаунта завершена');
        }
        notificationSettings = next;
        if (!before.mail && notificationSettings.mail) { tracker.mailSeen.clear(); tracker.baseline = null; }
        if (!notificationSettings.preview || !notificationSettings.mail) {
          mailAlerts = []; publishMailAlerts();
          for (const n of activeNotifications) n.close(); activeNotifications.clear();
        }
        refreshWidget(); void pollNotifications(); return { ok: true, value: notificationSettings };
      }
      if (operation === 'testNotification') {
        if (!['mail', 'meeting'].includes(data.kind)) throw new Error('Invalid sound');
        if (data.kind === 'mail') {
          const alert = queueMailAlert({ id: 'test-mail', from: { name: 'Анна Новикова · проверка' }, subject: 'Материалы к встрече', preview: 'Добрый день! Отправляю документы для обсуждения завтра.' });
          notify('mail', alert.title, alert.body, { view: 'mail' });
        } else notify('meeting', 'Встреча через 15 минут · проверка', 'Тестовое уведомление Aster Mail. Данные Exchange не использовались.', { view: 'calendar' });
        return { ok: true, value: true };
      }
      if (operation === 'connect') return { ok: true, value: await connect(data, Boolean(data.remember)) };
      if (operation === 'restore') {
        const epoch = accountEpoch;
        const saved = await localStore.loadCredentials(() => { if (epoch !== accountEpoch) throw new Error('Сессия аккаунта завершена'); });
        if (!saved) return { ok: true, value: null };
        return { ok: true, value: await connect(saved, false, true) };
      }
      if (operation === 'disconnect') {
        if (client && data.sessionId !== client.syncId) throw new Error('Сессия аккаунта завершена');
        ++accountEpoch;
        const retired = retireAccount();
        const results = await Promise.allSettled([retired, localStore.clear(), window.webContents.session.clearStorageData({ storages: ['localstorage', 'indexdb', 'cachestorage'] })]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        return { ok: true, value: true };
      }
      if (operation === 'openLink') {
        const url = new URL(data.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Неподдерживаемая ссылка');
        const answer = await dialog.showMessageBox(window, { type: 'question', message: 'Открыть ссылку в браузере?', detail: url.href.slice(0, 1500), buttons: ['Отмена', 'Открыть'], defaultId: 0, cancelId: 0 });
        if (answer.response === 1) await shell.openExternal(url.href);
        return { ok: true, value: true };
      }
      if (!client) throw new Error('Сначала подключите аккаунт OWA');
      const activeClient = client;
      if (data.sessionId !== activeClient.syncId) throw new Error('Сессия аккаунта завершена');
      if (operation === 'saveLocalData') {
        const active = connection;
        await localStore.save({ values: data.values }, () => { if (connection !== active) throw new Error('Сессия аккаунта завершена'); });
        return { ok: true, value: true };
      }
      if (operation === 'joinEvent') {
        const event = await activeClient.eventDetails(data);
        if (client !== activeClient) throw new Error('Сессия аккаунта завершена');
        const url = meetingLink(event);
        if (!url || event.cancelled) throw new Error('Ссылка на созвон недоступна');
        await shell.openExternal(url); return { ok: true, value: true };
      }
      if (operation === 'openAttachment') {
        if (typeof data.id !== 'string' || data.id.length > 16000 || typeof data.ref?.id !== 'string' || data.ref.id.length > 16000) throw new Error('Invalid attachment');
        const assertActive = () => { if (client !== activeClient) throw new Error('Сессия аккаунта завершена'); };
        const message = await activeClient.message({ ...data.ref, refresh: true }); assertActive();
        const file = message.attachments.find(file => file.id === data.id);
        if (!file) throw new Error('Вложение не найдено в письме. Обновите письмо.');
        return { ok: true, value: await attachmentFiles.open({ name: file.name, load: () => activeClient.attachment(file.id), assertActive }) };
      }
      if (operation === 'attachment') {
        if (typeof data.id !== 'string' || typeof data.name !== 'string') throw new Error('Invalid attachment');
        const result = await dialog.showSaveDialog(window, { defaultPath: safeName(data.name) });
        if (!result.canceled) {
          const bytes = await activeClient.attachment(data.id);
          if (client !== activeClient) throw new Error('Сессия аккаунта завершена');
          await writeAttachment(result.filePath, bytes, { assertActive: () => { if (client !== activeClient) throw new Error('Сессия аккаунта завершена'); } });
        }
        return { ok: true, value: !result.canceled };
      }
      if (operation === 'clearMailCache') { client.mailCache.clear(); return { ok: true, value: true }; }
      if (!methods.has(operation)) throw new Error('Unknown operation');
      const value = await activeClient[operation](data);
      if (client !== activeClient) throw new Error('Сессия аккаунта завершена');
      if (['respond', 'createEvent', 'updateEvent'].includes(operation)) { widgetDetail = null; void pollNotifications(); }
      return { ok: true, value };
    } catch (error) { return { ok: false, error: error.message, connectionError: error.connectionError === true }; }
  });
  createWindow();
  ipcMain.handle('aster-widget', async (event, operation, data) => {
    try {
      if (!widgetWindow || event.sender !== widgetWindow.webContents || event.senderFrame !== widgetWindow.webContents.mainFrame) throw new Error('Untrusted widget sender');
      if (operation === 'state') return { ok: true, value: widgetState() };
      if (operation === 'app') { widgetWindow.hide(); reveal(); return { ok: true }; }
      const meeting = widgetEvents.find(item => item.id === data?.id && !item.cancelled);
      if (!meeting) throw new Error('Встреча больше не доступна. Дождитесь обновления календаря.');
      if (operation === 'open') {
        widgetWindow.hide(); reveal({ view: 'calendar', date: meeting.start, eventId: meeting.id });
      } else if (operation === 'join') {
        if (['Decline', 'Declined'].includes(meeting.response)) throw new Error('Встреча отклонена. Измените ответ в карточке встречи.');
        const url = httpsURL(meetingLink(meeting));
        if (!url) throw new Error('Ссылка на созвон не найдена. Откройте карточку встречи.');
        widgetWindow.hide(); await shell.openExternal(url);
      } else throw new Error('Unknown widget operation');
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(image); tray.setToolTip('Aster Mail · почта и встречи');
  const trayMenu = Menu.buildFromTemplate([{ label: 'Открыть Aster Mail', click: () => reveal() }, { label: 'Проверить почту и встречи', click: () => { void pollNotifications(); } }, { type: 'separator' }, { label: 'Завершить Aster Mail', click: () => app.quit() }]);
  if (process.platform === 'darwin') tray.on('right-click', () => tray.popUpContextMenu(trayMenu));
  else tray.setContextMenu(trayMenu);
  tray.on('click', toggleWidget);
  refreshWidget();
  const attachmentTimer = setInterval(() => { attachmentFiles.cleanupExpired().then(() => { attachmentCleanupError = ''; }, error => { attachmentCleanupError = error.message; }); }, 60000); attachmentTimer.unref();
  const widgetTimer = setInterval(refreshWidget, 15000); widgetTimer.unref();
  const mailTimer = setInterval(() => { void pollMail(); }, 15000); mailTimer.unref();
  powerMonitor.on('resume', () => { void pollNotifications(); });
  const timer = setInterval(() => { void pollNotifications(); }, 60000); timer.unref();
  if (app.isPackaged) {
    const check = () => { if (updates.state.autoCheck) void updates.check(); };
    const firstCheck = setTimeout(check, 15000); firstCheck.unref();
    const updateTimer = setInterval(check, 6 * 60 * 60000); updateTimer.unref();
  }
  app.on('activate', () => { reveal(); void pollNotifications(); });
});
app.on('before-quit', event => {
  if (!confirmDiscardChanges()) { event.preventDefault(); return; }
  try { attachmentFiles?.clearSync(); } catch {
    const answer = dialog.showMessageBoxSync(window, { type: 'warning', message: 'Временные вложения не удалены', detail: 'Закройте файлы во внешних приложениях и повторите выход. Если выйти сейчас, удаление будет повторено при следующем запуске Aster.', buttons: ['Остаться', 'Выйти'], defaultId: 0, cancelId: 0 });
    if (answer !== 1) { event.preventDefault(); return; }
  }
  quitting = true; connection?.controller.abort();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { try { attachmentFiles?.clearSync(); } catch { /* The user has acknowledged locked copies before quitting; retry at startup. */ } });

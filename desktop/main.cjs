const i18n = require('../src/i18n.js');
const tr = i18n.text;
const errorMessage = require('../src/errors.js').message;
const { app, autoUpdater, BrowserWindow, ipcMain, net, session, safeStorage, shell, dialog, Menu, Notification, Tray, nativeImage, screen, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ComposeWindows } = require('./compose-windows.cjs');
let composeWindows, moduleHost, moduleProfile;
const { Updates, openInstallerFile } = require('./updates.cjs');
const { AttachmentFiles, safeName } = require('./attachment-files.cjs');
let attachmentFiles, attachmentPreviews;
const { AttachmentPreviews } = require('./attachment-previews.cjs');
const { writeAttachment } = require('./attachment-trust.cjs');
let attachmentCleanupError = '';
let updates, macUpdates, windowsUpdates, localEncryption, activeServerWrites = 0;
const { OWAClient } = require('./owa.cjs');
const { createTransport } = require('./transport.cjs');
const { LocalStore } = require('./local-store.cjs');
const { WaitingReplies } = require('./waiting-replies.cjs');
const { MailReminders, subjects: reminderSubjects } = require('./mail-reminders.cjs');
const { fetchContentImage, fetchImageResponse } = require('./content-images.cjs');
let localStore, connection, accountEpoch = 0, connectAttempt = 0;
const { normalizeServer } = require('./protocol.cjs');
const { NotificationTracker, preferences, mailAlert } = require('./notifications.cjs');
const { httpsURL, meetingLink, upcomingMeetings, nearestMeetings, countdown, pollingRange } = require('./meetings.cjs');
let widgetWindow, widgetEvents = [], widgetDetail = null;
let window, client, account, tray, createWindow, quitting = false;
let unsavedChanges = false, resettingLocalData = false;
let notificationSettings = preferences(), tracker = new NotificationTracker(), polling = false, mailPolling = false;
let lastPoll = null, lastPollError = '', lastMailPoll = null, lastMailError = '';
const activeNotifications = new Set();
const { SharingPrivacy } = require('./sharing-privacy.cjs');
let presentationMode = false, presentationUntil = 0, presentationTimer, lastPrivacyHidden = true;
const sharingPrivacy = new SharingPrivacy({ changed: syncNotificationPrivacy });
function privacyHidden() {
  if (presentationMode && presentationUntil && Date.now() >= presentationUntil) { presentationMode = false; presentationUntil = 0; }
  return presentationMode || notificationSettings.autoPrivacy && Boolean(notificationSettings.privacyApps?.length) && sharingPrivacy.active !== false;
}
function privacyState() {
  const hidden = privacyHidden();
  return { privacyActive: hidden, presentationMode, presentationUntil, privacyReason: presentationMode ? 'manual' : hidden ? sharingPrivacy.active === null ? 'checking' : 'application' : 'none',
    privacyApplications: require('../src/privacy-apps.js').applications.filter(app => (sharingPrivacy.matches || []).includes(app.id)).map(app => app.name) };
}
async function refreshPrivacy() {
  sharingPrivacy.configure(notificationSettings.autoPrivacy ? notificationSettings.privacyApps : []);
  if (notificationSettings.autoPrivacy) await sharingPrivacy.check(); syncNotificationPrivacy();
}
function syncNotificationPrivacy() {
  const hidden = privacyHidden();
  if (hidden !== lastPrivacyHidden) {
    lastPrivacyHidden = hidden;
    // Clearing is intentional: restoring privacy never replays old notifications.
    mailAlerts = []; publishMailAlerts();
    for (const n of activeNotifications) n.close(); activeNotifications.clear();
    refreshWidget(); updateTrayMenu();
  }
  if (typeof window !== 'undefined' && window && !window.isDestroyed()) window.webContents.send('aster-privacy', privacyState());
}
function setPresentation(enabled, minutes = 30) {
  if (typeof enabled !== 'boolean' || ![15, 30, 60, 120].includes(minutes)) throw new Error('Invalid presentation duration');
  clearTimeout(presentationTimer);
  presentationMode = enabled; presentationUntil = enabled ? Date.now() + minutes * 60000 : 0;
  if (enabled) { presentationTimer = setTimeout(() => setPresentation(false), minutes * 60000); presentationTimer.unref?.(); }
  syncNotificationPrivacy(); refreshWidget(); updateTrayMenu();
}
function togglePresentation() { setPresentation(!presentationMode); }
let dismissedMeetings = new Set();
let mailAlerts = [];
function mailWindowAlerts() {
  return process.platform === 'darwin' || privacyHidden() ? [] : mailAlerts;
}
function publishMailAlerts() {
  if (window && !window.isDestroyed()) window.webContents.send('aster-mail-alerts', mailWindowAlerts());
}
function queueMailAlert(message) {
  const alert = mailAlert(message, notificationSettings.preview && !privacyHidden());
  if (privacyHidden()) return alert;
  mailAlerts = [alert, ...mailAlerts.filter(item => item.id !== alert.id)].slice(0, 20);
  publishMailAlerts();
  return alert;
}
function dismissMailAlert(id) {
  mailAlerts = mailAlerts.filter(item => item.id !== id);
  for (const notification of activeNotifications) if (notification.asterNavigation?.view === 'mail' && notification.asterNavigation.id === id) { notification.close(); activeNotifications.delete(notification); }
  publishMailAlerts();
}
function publishConnectionHealth(active) {
  if (client !== active || connection?.client !== active || !active.syncId || !connection.health) return;
  if (window && !window.isDestroyed()) window.webContents.send('aster-connection', { sessionId: active.syncId, status: connection.health });
}
function publishWaitingReplyCount(active) {
  if (active !== client || !active?.syncId) return;
  try {
    const count = active.waitingReplies.entries().filter(entry => !entry.replyId).length;
    if (window && !window.isDestroyed()) window.webContents.send('aster-waiting-replies', { sessionId: active.syncId, count });
  } catch { /* A badge must never affect successful mail reads or local saves. */ }
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
    void active.waitingReplies?.scan(page.items).then(() => publishWaitingReplyCount(active)).catch(() => {});
    const fresh = tracker.newMail(page.items);
    if (!notificationSettings.mail) return;
    await refreshPrivacy();
    if (active !== client || revision !== active.mailCache.generation) return;
    for (const message of [...fresh].reverse()) queueMailAlert(message);
    if (fresh.length) {
      const alert = mailAlert(fresh[0], notificationSettings.preview);
      notify('mail', fresh.length > 1 ? `${alert.title} ${tr("· ещё")} ${fresh.length - 1}` : alert.title, alert.body, alert.navigation);
    }
  } catch (error) { if (active === client) lastMailError = error.message; }
  finally { mailPolling = false; publishConnectionHealth(active); }
}
const page = path.join(__dirname, '../src/index.html');
const settingsFile = () => path.join(app.getPath('userData'), 'notifications.json');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (createWindow) reveal(); });

function confirmDiscardChanges() {
  if (!unsavedChanges) return true;
  const response = dialog.showMessageBoxSync(window, { type: 'warning', message: tr('Есть несохранённые изменения'), detail: tr('Сохраните письмо или встречу перед выходом. Продолжить без сохранения?'), buttons: [tr('Остаться'), tr('Не сохранять')], defaultId: 0, cancelId: 0 });
  if (response !== 1) return false;
  unsavedChanges = false;
  return true;
}

// Squirrel closes windows before before-quit. Run the same guards before calling it.
function confirmQuit() {
  if (activeServerWrites || [...(composeWindows?.entries.values() || [])].some(entry => entry.busy)) {
    dialog.showMessageBoxSync(window, { type: 'info', message: tr('Дождитесь завершения отправки или сохранения'), buttons: [tr('Остаться')] });
    return false;
  }
  if (!confirmDiscardChanges() || composeWindows && !composeWindows.confirmAll()) return false;
  try { attachmentFiles?.clearSync(); } catch {
    return dialog.showMessageBoxSync(window, { type: 'warning', message: tr('Временные вложения не удалены'), detail: tr('Закройте файлы во внешних приложениях и повторите выход. Если выйти сейчас, удаление будет повторено при следующем запуске Aster.'), buttons: [tr('Остаться'), tr('Выйти')], defaultId: 0, cancelId: 0 }) === 1;
  }
  return true;
}
function retireForQuit() {
  quitting = true; moduleHost?.closeAll(); moduleProfile?.retire(); attachmentPreviews?.closeAll(); composeWindows?.destroyAll(); connection?.controller.abort();
}
async function resetLocalData() {
  if (client || connection || resettingLocalData) throw new Error(tr('Сначала завершите подключение к аккаунту'));
  resettingLocalData = true;
  try {
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: tr('Сбросить локальные данные?'), detail: tr('Сохранённый пароль, подпись, коллеги и настройки будут удалены с этого компьютера. Письма и календарь в Exchange сохранятся.'), buttons: [tr('Отмена'), tr('Сбросить')], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return false;
    ++accountEpoch;
    const results = await Promise.allSettled([localStore.clear(), attachmentFiles.clear(), moduleProfile.clear()]);
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
let trayMenuCurrent;
function updateTrayMenu() {
  if (!tray) return;
  const trayMenu = Menu.buildFromTemplate([{ label: tr('Открыть Aster Mail'), click: () => reveal() }, { label: tr('Проверить почту и встречи'), click: () => { void pollNotifications(); } }, { label: tr('Режим презентации: скрыть уведомления'), type: 'checkbox', checked: presentationMode, click: togglePresentation }, { type: 'separator' }, { label: tr('Завершить Aster Mail'), click: () => app.quit() }]);
  if (process.platform === 'darwin') trayMenuCurrent = trayMenu;
  else tray.setContextMenu(trayMenu);
}
function widgetState() {
  const hidden = privacyHidden();
  const project = event => ({ id: event.id, title: hidden ? tr('Встреча') : event.title, preview: hidden ? '' : require('./protocol.cjs').mailPreview(event.preview || event.body || event.html || '', Boolean(!event.preview && !event.body && event.html)), start: event.start, end: event.end, allDay: event.allDay, cancelled: event.cancelled, response: event.response, isOrganizer: event.isOrganizer, joinUrl: !hidden && Boolean(meetingLink(event)) });
  const calendarEvents = widgetEvents.filter(event => !event.cancelled).map(project);
  const events = upcomingMeetings(calendarEvents).slice(0, 5);
  return { connected: Boolean(client), secure: account?.server.startsWith('https:') !== false, events, calendarEvents, dismissedMeetings: hidden ? [] : [...dismissedMeetings], range: pollingRange(), countdown: countdown(events[0]), ...privacyState(), workSchedule: notificationSettings.workSchedule, interfaceScale: notificationSettings.interfaceScale, timeZone: notificationSettings.timeZone, theme: notificationSettings.theme, language: i18n.language, debugErrors: notificationSettings.debugErrors, lastPoll, error: errorMessage(lastMailError || lastPollError, { debug: notificationSettings.debugErrors }) };
}
function refreshWidget() {
  const state = widgetState();
  if (tray) {
    const nearest = nearestMeetings(state.calendarEvents);
    const multiple = nearest.length > 1;
    if (process.platform === 'darwin') tray.setTitle(client ? `${state.privacyActive ? '⏸ ' : ''}${multiple && state.countdown.active ? `${tr('Встречи')} · ${nearest.length}` : state.countdown.label}` : '');
    tray.setToolTip(state.privacyActive ? tr('Aster Mail · уведомления скрыты') : multiple ? `${tr('Встречи')} · ${nearest.length}\n${nearest.slice(0, 5).map(event => event.title).join('\n')}` : state.events[0] ? `${state.events[0].title} · ${state.countdown.detail}` : tr('Aster Mail · ближайшие встречи'));
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetWindow.isVisible()) resizeWidget(state);
    widgetWindow.webContents.send('aster-widget-update', state);
  }
}
function resizeWidget(state = widgetState()) {
  const anchor = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const bounds = require('./meetings.cjs').widgetBounds(state, anchor, area, notificationSettings.interfaceScale);
  const current = widgetWindow.getBounds();
  if (Object.keys(bounds).some(key => current[key] !== bounds[key])) widgetWindow.setBounds(bounds);
}
function toggleWidget() { void showWidget(); }
async function showWidget() {
  if (widgetWindow?.isVisible()) { widgetWindow.hide(); return; }
  await refreshPrivacy();
  const scale = notificationSettings.interfaceScale;
  const anchor = tray.getBounds(), area = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const { width, height } = require('./meetings.cjs').widgetBounds(widgetState(), anchor, area, scale);
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = new BrowserWindow({ width, height, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, title: tr('Aster · ближайшие встречи'), backgroundColor: '#f8f6fc',
      webPreferences: { preload: path.join(__dirname, 'widget-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    widgetWindow.setContentProtection(true);
    widgetWindow.loadFile(path.join(__dirname, '../src/widget.html'));
    widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    widgetWindow.webContents.on('will-navigate', event => event.preventDefault());
    widgetWindow.on('blur', () => widgetWindow.hide());
    widgetWindow.once('ready-to-show', () => { widgetWindow.show(); widgetWindow.focus(); });
  }
  widgetWindow.webContents.setZoomFactor(scale);
  resizeWidget();
  if (!widgetWindow.webContents.isLoading()) { refreshWidget(); widgetWindow.show(); widgetWindow.focus(); }
}
function notify(kind, title, body, navigation) {
  if (privacyHidden()) return false;
  if (!Notification.isSupported()) { lastPollError = tr('Системные уведомления недоступны'); return false; }
  // Play our sound explicitly; system notification audio can be suppressed independently.
  const notification = new Notification({ title, body, silent: true,
    timeoutType: kind === 'mail' ? 'never' : 'default', groupId: `aster-${kind}`, icon: path.join(__dirname, '../assets/icon.png'),
  });
  if (activeNotifications.size >= 20) { const oldest = activeNotifications.values().next().value; oldest.close(); activeNotifications.delete(oldest); }
  activeNotifications.add(notification);
  notification.asterNavigation = navigation;
  notification.on('click', () => { if (!navigation?.sessionId || navigation.sessionId === client?.syncId) reveal(navigation); });
  notification.on('close', () => activeNotifications.delete(notification));
  notification.on('failed', () => { activeNotifications.delete(notification); lastPollError = tr('macOS не показала уведомление. Проверьте разрешение для Aster Mail в настройках системы.'); });
  notification.show();
  if (notificationSettings.sounds) {
    const soundKind = kind === 'mail-reminder' ? 'mail' : kind;
    if (process.platform === 'darwin') {
      const sound = app.isPackaged ? path.join(process.resourcesPath, `aster-${soundKind}.wav`) : path.join(__dirname, `../assets/sounds/aster-${soundKind}.wav`);
      const player = spawn('/usr/bin/afplay', [sound], { stdio: 'ignore' });
      player.on('error', () => { lastPollError = tr('Не удалось воспроизвести звук уведомления'); });
      player.on('exit', code => { if (code) lastPollError = tr('Не удалось воспроизвести звук уведомления'); });
    } else if (window && !window.isDestroyed()) window.webContents.send('aster-sound', soundKind);
  }
  return true;
}
function closeMailReminderAlerts() {
  for (const alert of activeNotifications) if (alert.asterNavigation?.mailReminders) { alert.close(); activeNotifications.delete(alert); }
}
async function pollMailReminders() {
  const active = client;
  if (!active?.mailReminders || quitting) return;
  try {
    await refreshPrivacy();
    if (client !== active || quitting) return;
    await active.mailReminders.tick();
  } catch { /* Local reminders must never interrupt mail, calendar or login. */ }
}
async function pollNotifications() {
  void pollMail(); void pollMailReminders();
  if (!client || polling) return;
  polling = true;
  const active = client;
  let error = '';
  try {
    if (active === client) {
      try {
        const events = await active.calendar(pollingRange());
        if (active !== client) return;
        const focus = require('../src/events.js').focusMeetings(events, Date.now()).slice(0, 10);
        const details = new Map(widgetDetail?.records || []), retained = [];
        for (const next of focus) {
          const key = `${next.id}:${next.start}:${next.changeKey || ''}`;
          let detail = details.get(key);
          if (!detail || Date.now() - detail.at > 300000) {
            try {
              const data = await active.event({ id: next.id, changeKey: next.changeKey });
              if (active !== client) return;
              detail = { at: Date.now(), data };
            } catch { /* The calendar preview and location remain available. */ }
          }
          if (active !== client) return;
          if (detail) {
            retained.push([key, detail]);
            Object.assign(next, { body: detail.data.body, html: detail.data.html, joinUrl: detail.data.joinUrl || next.joinUrl, cancelled: detail.data.cancelled });
          }
        }
        widgetDetail = { records: retained };
        widgetEvents = events;
        const keys = new Set(events.map(event => `${event.id}:${event.start}`));
        dismissedMeetings = new Set([...dismissedMeetings].filter(key => keys.has(key)));
        await refreshPrivacy();
        if (active !== client) return;
        for (const event of notificationSettings.meetings ? tracker.reminders(events, notificationSettings.minutes, Date.now(), notificationSettings.meetingReminders, notificationSettings.meetingMinutes) : []) {
          if (!privacyHidden()) dismissedMeetings.delete(`${event.id}:${event.start}`);
          const minutes = Math.max(0, Math.ceil((new Date(event.start) - Date.now()) / 60000));
          notify('meeting', minutes ? `${tr("Встреча через")} ${minutes} ${tr("мин.")}` : tr('Встреча начинается'), notificationSettings.preview ? event.title : tr('Откройте рабочий календарь.'), { view: 'calendar', date: event.start, eventId: event.id });
        }
      } catch (e) { error ||= e.message; }
    }
    if (active === client) { lastPoll = new Date().toISOString(); lastPollError = error; refreshWidget(); }
  } finally { polling = false; }
}


function retireAccount() {
  moduleHost?.closeAll(); moduleProfile?.retire();
  attachmentPreviews?.closeAll();
  composeWindows?.destroyAll();
  const previous = connection;
  connection = null; client = null; account = null;
  if (previous) {
    previous.controller.abort(); previous.account.password = '';
    previous.client?.mailCache.clear(); previous.client?.photoCache?.clear(); previous.client?.waitingReplies?.cache.clear();
  }
  mailAlerts = []; publishMailAlerts();
  tracker = new NotificationTracker(); lastPoll = null; lastPollError = ''; lastMailPoll = null; lastMailError = '';
  notificationSettings = preferences(); dismissedMeetings.clear(); widgetEvents = []; widgetDetail = null; refreshWidget();
  for (const n of activeNotifications) n.close(); activeNotifications.clear();
  return Promise.all([attachmentFiles?.clear(), ...(previous ? [previous.session.clearStorageData(), previous.images.clearStorageData()] : [])]);
}
async function connect(data, remember, restoring = false) {
  if (resettingLocalData) throw new Error(tr('Дождитесь завершения сброса локальных данных'));
  if (typeof data.username !== 'string' || !data.username.trim() || typeof data.password !== 'string' || !data.password) throw new Error(tr('Укажите логин и пароль'));
  const credentials = { server: normalizeServer(data.server), username: data.username.trim(), password: data.password };
  const attempt = ++connectAttempt, startingEpoch = accountEpoch;
  if (remember) await localStore.requireEncryption();
  if (attempt !== connectAttempt || startingEpoch !== accountEpoch || resettingLocalData || quitting) throw new Error(tr('Сессия аккаунта завершена'));
  if (composeWindows && !composeWindows.confirmAll()) throw new Error(tr('Закрытие писем отменено'));
  const epoch = ++accountEpoch;
  const retired = retireAccount();
  const current = { account: credentials, controller: new AbortController(),
    session: session.fromPartition(`aster-${crypto.randomUUID()}`, { cache: false }),
    images: session.fromPartition(`aster-images-${crypto.randomUUID()}`, { cache: false }) };
  connection = current; account = credentials;
  const assertCurrent = () => { if (epoch !== accountEpoch || connection !== current) throw new Error(tr('Сессия аккаунта завершена')); };
  const transport = createTransport(net, credentials, current.session, current.controller.signal);
  const candidate = new OWAClient(credentials, transport,
    async () => { assertCurrent(); return (await current.session.cookies.get({ url: `${credentials.server}/owa/`, name: 'X-OWA-CANARY' }))[0]?.value; },
    () => { assertCurrent(); return current.session.clearStorageData({ storages: ['cookies'] }); },
    url => fetchContentImage(url, credentials.server, { fetch: (url, options) => fetchImageResponse(url, options, current.images, net) }, current.controller.signal));
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
    await localStore.saveLoginHint(credentials, assertCurrent);
    assertCurrent();
    candidate.syncId = crypto.randomUUID(); client = candidate;
    candidate.waitingReplies = new WaitingReplies(candidate, localStore, () => { if (client !== candidate || quitting || current.controller.signal.aborted) throw new Error(tr('Сессия аккаунта завершена')); });
    candidate.mailReminders = new MailReminders(localStore, {
      guard: () => { if (client !== candidate || quitting || current.controller.signal.aborted) throw new Error(tr('Сессия аккаунта завершена')); },
      available: () => !privacyHidden() && Notification.isSupported(),
      deliver: count => {
        if (client !== candidate || quitting || privacyHidden()) return false;
        try { return notify('mail-reminder', tr('Напоминание о письме'), count === 1 ? tr('Пора вернуться к письму. Откройте список напоминаний в Aster.') : `${tr('Писем к напоминанию:')} ${count}. ${tr('Откройте список напоминаний в Aster.')}`, { view: 'mail', mailReminders: true, sessionId: candidate.syncId }); }
        catch { return false; }
      },
    });
    notificationSettings = preferences({ ...saved.notifications, language: saved.notifications?.language || i18n.language });
    i18n.setLanguage(notificationSettings.language);
    updateTrayMenu();
    await refreshPrivacy(); refreshWidget(); void pollNotifications();
    return { server: credentials.server, username: credentials.username, sessionId: candidate.syncId, localData: saved.values || {}, notifications: notificationSettings };
  } catch (error) {
    if (connection === current) { ++accountEpoch; await retireAccount(); }
    throw error;
  }
}

async function installModuleBundle(bundle, guard) {
  guard();
  const source = bundle.source ? `${bundle.source.repository}\ncommit: ${bundle.source.commit}\n${bundle.source.directory}` : tr('Локальный пакет');
  const answer = await dialog.showMessageBox(window, { type: 'question', message: tr('Подключить модуль?'), detail: `${bundle.manifest.name} ${bundle.manifest.version}\n${source}\nSHA-256: ${bundle.digest}\n${tr('Разрешения:')} ${require('./modules.cjs').permissionSummary(bundle.manifest.permissions, bundle.manifest.authentication)}\n${tr('Сетевые адреса:')} ${bundle.manifest.networkOrigins.join(', ')}\n${tr('Дополнительные серверы с отдельным разрешением:')} ${(bundle.manifest.optionalOrigins || []).map(rule => rule.domain).join(', ')}\n${tr('Приложение встречи:')} ${require('./modules.cjs').meetingLaunchSummary(bundle.manifest)}\n${tr('Серверы входа:')} ${[...(bundle.manifest.authentication?.origins || []), ...(bundle.manifest.authentication?.identityOrigins || [])].join(', ')}\n${tr('Модуль будет доступен сразу после установки.')}`, buttons: [tr('Отмена'), tr('Подключить модуль')], defaultId: 0, cancelId: 0 });
  guard();
  if (answer.response !== 1) return;
  await moduleHost.install(bundle, true);
  guard();
}

const methods = new Set(['mailBatch', 'editDraft', 'folderOperation', 'identity', 'clearMailCache', 'folders', 'messages', 'search', 'message', 'change', 'move', 'send', 'draft', 'calendar', 'event', 'createEvent', 'respond', 'contacts', 'createContact', 'signature', 'personPhoto', 'createMailRule', 'availability', 'eventDetails', 'eventConflicts', 'updateEvent', 'removeEvent', 'eventMessage', 'eventImage', 'contentImages']);
const serverWrites = new Set(['send', 'draft', 'editDraft', 'mailBatch', 'folderOperation', 'change', 'move', 'createEvent', 'updateEvent', 'removeEvent', 'respond', 'createContact', 'createMailRule', 'saveAutoReplies']);
function validate(operation, data) {
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > 30_000_000) throw new Error('Invalid request');
  if (['message', 'event', 'eventDetails', 'joinEvent'].includes(operation) && (typeof data.id !== 'string' || data.id.length > 16000)) throw new Error('Invalid item reference');
  if (['change', 'move', 'respond'].includes(operation) && typeof data.ref?.id !== 'string') throw new Error('Invalid item reference');
  if (['editDraft', 'eventConflicts', 'updateEvent', 'removeEvent', 'eventMessage', 'eventImage', 'contentImages'].includes(operation) && (typeof data.ref?.id !== 'string' || data.ref.id.length > 16000)) throw new Error('Invalid content reference');
  if (data.scope !== undefined && !['single', 'series'].includes(data.scope)) throw new Error('Invalid meeting scope');
  if (operation === 'change' && (data.field === 'Importance' ? !['High', 'Normal'].includes(data.value) : typeof data.value !== 'boolean')) throw new Error('Invalid value');
  if (operation === 'messages' && (typeof data.folder !== 'string' || !Number.isInteger(data.offset || 0) || (data.offset || 0) < 0)) throw new Error('Invalid folder or offset');
}
app.whenReady().then(async () => {
  app.setAppUserModelId('app.astermail.desktop');
  localEncryption = process.platform === 'darwin' && app.isPackaged
    ? new (require('./keychain.cjs').KeychainEncryption)({ resourcesPath: process.resourcesPath, legacy: safeStorage })
    : safeStorage;
  const { ModuleHost } = require('./module-host.cjs');
  const packages = path.join(app.getPath('userData'), 'modules');
  moduleProfile = new (require('./module-profile.cjs').ModuleProfile)(path.join(app.getPath('userData'), 'module-profile'), packages, localEncryption, () => localStore?.data.modules || []);
  moduleHost = new ModuleHost({ electron: require('electron'), directory: packages,
    scope: () => connection && !client ? null : moduleProfile.scope(),
    save: (records, sessionId) => moduleProfile.save(records, sessionId),
    sdk: async (entry, method, input, context) => {
      const active = client;
      const guard = () => { moduleHost.current(entry); if (client !== active) throw new Error(tr('Сессия аккаунта завершена')); };
      guard();
      if (method === 'calendar.list') {
        if (!active) throw new Error(tr('Сначала подключите аккаунт OWA'));
        const start = Date.parse(input.start), end = Date.parse(input.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) throw new Error('Invalid calendar range');
        const events = await active.calendar({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }); guard();
        return require('./modules.cjs').bounded({ items: events.slice(0, 200).map(event => ({ id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay })), truncated: events.length > 200, complete: false }, 65536);
      }
      if (method === 'ui.context') return { language: i18n.language, theme: notificationSettings.theme, timeZone: require('../src/time.js').zone(notificationSettings.timeZone), interfaceScale: notificationSettings.interfaceScale };
      if (method === 'ui.openView') {
        if (!context) throw new Error(tr('Действие модуля требует открытого интерфейса'));
        if (!entry.bundle.manifest.views.some(view => view.id === input.view)) throw new Error('Unknown module view');
        guard(); window?.webContents.send('aster-module-action', { sessionId: entry.sessionId, id: entry.id, method, input }); return true;
      }
      if (!active) throw new Error(tr('Сначала подключите аккаунт OWA'));
      if (!context || !window || window.isDestroyed()) throw new Error(tr('Действие модуля требует открытого интерфейса'));
      if (method === 'meeting.getDraft' && context.editorId && context.draft) return require('./modules.cjs').bounded(context.draft);
      if (method === 'meeting.openDraft' && context.editorId) throw new Error('Use patchDraft for the active editor');
      if (method === 'meeting.openDraft' || method === 'meeting.patchDraft' && typeof context.editorId === 'string') {
        if (Object.keys(input).some(key => !['title', 'location', 'body', 'start', 'end'].includes(key)) || Object.values(input).some(value => typeof value !== 'string' || value.length > 8000)) throw new Error('Invalid meeting draft');
        for (const key of ['start', 'end']) if (input[key] !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])))) throw new Error('Invalid meeting instant');
        if (input.start && input.end && Date.parse(input.end) <= Date.parse(input.start)) throw new Error('Invalid meeting interval');
        guard(); window.webContents.send('aster-module-action', { sessionId: entry.sessionId, id: entry.id, method, editorId: context.editorId, input }); return true;
      }
      throw new Error('Unsupported module API');
    },
  });

  attachmentPreviews = new AttachmentPreviews({ BrowserWindow, session });
  attachmentFiles = new AttachmentFiles(path.join(app.getPath('userData'), 'opened-attachments'), file => shell.openPath(file));
  try { await attachmentFiles.clear(); } catch (error) { attachmentCleanupError = error.message; }
  updates = new Updates({ directory: path.join(app.getPath('userData'), 'updates'), installed: app.getVersion(),
    // Node fetch has no access to Electron OWA cookies and supports manual redirects.
    fetch: (url, options) => globalThis.fetch(url, options),
    open: async (file, signal, asset, handle) => {
      if (!asset.restart) return openInstallerFile(file, shell, { signal });
      if (windowsUpdates) { await windowsUpdates.install(file, signal); return ''; }
      if (!macUpdates) throw new Error(tr('Обновление с перезапуском доступно в установленном приложении'));
      await macUpdates.install(handle, asset, signal);
      return '';
    },
    changed: value => { if (window && !window.isDestroyed()) window.webContents.send('aster-update', value); },
  });
  if (process.platform === 'win32' && app.isPackaged) {
    windowsUpdates = new (require('./windows-updates.cjs').WindowsUpdates)({
      prepare: () => { if (!confirmQuit()) return false; quitting = true; return true; },
      cancelled: () => { quitting = false; },
      quit: () => { retireForQuit(); app.quit(); },
    });
  }
  if (process.platform === 'darwin' && app.isPackaged) {
    const { MacUpdates, applicationPath } = require('./mac-updates.cjs');
    macUpdates = new MacUpdates({ autoUpdater, appPath: applicationPath(process.resourcesPath),
      staged: () => updates.publish({ staged: true, status: 'ready' }),
      restart: signal => {
        signal.throwIfAborted();
        if (!confirmQuit()) return;
        signal.throwIfAborted();
        // Prevent new writes and close guards from asking twice after approval.
        retireForQuit(); autoUpdater.quitAndInstall();
      },
    });
  }
  await updates.initialize();
  localStore = new LocalStore(app.getPath('userData'), localEncryption);
  await fs.rm(settingsFile(), { force: true }); // Remove legacy plaintext notification settings.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Aster Mail', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  composeWindows = new ComposeWindows({ BrowserWindow, dialog, page, tr });
  createWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().workArea;
    window = new BrowserWindow({ width: Math.min(1440, width), height: Math.min(940, height), minWidth: Math.min(760, width), minHeight: Math.min(540, height), title: 'Aster Mail',
      backgroundColor: '#f7f8fb',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 12 } } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    window.loadFile(page);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-prevent-unload', event => { if (quitting || confirmDiscardChanges()) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.on('close', event => {
      if (!quitting && client) { event.preventDefault(); window.hide(); }
    });
  };
  ipcMain.on('aster-unsaved-changes', (event, value) => {
    const composeEntry = composeWindows.entries.get(event.sender);
    if (composeEntry && event.senderFrame === event.sender.mainFrame && typeof value === 'boolean') composeEntry.dirty = value;
    if (event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && typeof value === 'boolean') unsavedChanges = value;
  });
  ipcMain.handle('aster', async (event, operation, data) => {
    let composeEntry, composeWrite = false, serverWrite = false;
    const debugErrors = notificationSettings.debugErrors;
    try {
      if (composeWindows.entries.has(event.sender)) composeEntry = composeWindows.authorize(event.sender, event.senderFrame, operation, data?.sessionId);
      else if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
      validate(operation, data);
      if (quitting) throw new Error(tr('Приложение завершает работу'));
      serverWrite = serverWrites.has(operation) && !(operation === 'editDraft' && data.action === 'read');
      if (serverWrite) activeServerWrites++;
      if (composeEntry) {
        if (!composeEntry.demo && (!client || client.syncId !== composeEntry.sessionId)) throw new Error(tr('Сессия аккаунта завершена'));
        if (operation === 'composeContext') return { ok: true, value: composeEntry.context };
        if (operation === 'composeReady') { composeEntry.ready(); return { ok: true, value: true }; }
        if (operation === 'closeCompose') { if (!composeEntry.busy) composeEntry.window.close(); return { ok: true, value: true }; }
        if (['send', 'draft'].includes(operation) || operation === 'editDraft' && data.action !== 'read') {
          if (composeEntry.busy) throw new Error('Compose operation in progress');
          composeEntry.busy = true; composeWrite = true;
        }
      }
      if (operation === 'detachCompose') {
        if (!data.snapshot || !['new', 'reply', 'reply-all', 'forward', 'draft'].includes(data.snapshot.mode) || !data.snapshot.data || !Array.isArray(data.snapshot.files)) throw new Error('Invalid compose context');
        if (!data.demo && (!client || data.sessionId !== client.syncId)) throw new Error(tr('Сессия аккаунта завершена'));
        return { ok: true, value: await composeWindows.create({ snapshot: data.snapshot, demo: data.demo === true, account: data.demo ? null : { server: account.server, username: account.username, sessionId: client.syncId }, preferences: data.preferences, language: i18n.language }, window.webContents.getZoomFactor()) };
      }
      if (operation === 'setInterfaceScale') {
        if (typeof data.scale !== 'number' || !Number.isFinite(data.scale) || data.scale < 0.8 || data.scale > 2) throw new Error('Invalid interface scale');
        window.webContents.setZoomFactor(data.scale);
        if (process.platform === 'darwin') window.setWindowButtonPosition({ x: Math.round(22 * data.scale), y: Math.round(19 * data.scale - 7) });
        for (const entry of composeWindows.entries.values()) entry.window.webContents.setZoomFactor(data.scale);
        notificationSettings.interfaceScale = data.scale;
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.setZoomFactor(data.scale);
        refreshWidget();
        return { ok: true, value: data.scale };
      }
      if (operation === 'setLanguage') {
        if (!['ru', 'en'].includes(data.language)) throw new Error('Invalid language');
        i18n.setLanguage(data.language); updateTrayMenu(); refreshWidget();
        return { ok: true, value: i18n.language };
      }
      if (operation === 'resetLocalData') return { ok: true, value: await resetLocalData() };
      if (operation === 'updateState') return { ok: true, value: updates.snapshot() };
      if (operation === 'checkUpdates') return { ok: true, value: await updates.check() };
      if (operation === 'downloadUpdate') return { ok: true, value: await updates.download() };
      if (operation === 'pauseUpdateDownload') return { ok: true, value: await updates.pauseDownload() };
      if (operation === 'cancelUpdateDownload') return { ok: true, value: await updates.cancelDownload() };
      if (operation === 'cancelUpdateInstall') return { ok: true, value: updates.cancelInstall() };
      if (operation === 'openUpdateInstaller') return { ok: true, value: await updates.openInstaller() };
      if (operation === 'saveUpdatePreferences') {
        const value = await updates.preferences(data.autoCheck);
        if (app.isPackaged && data.autoCheck) void updates.checkAutomatically();
        return { ok: true, value };
      }
      if (operation === 'mailAlerts') return { ok: true, value: mailWindowAlerts() };
      if (operation === 'dismissMailAlert') { dismissMailAlert(data.id); return { ok: true, value: true }; }
      if (operation === 'notificationSettings') return { ok: true, value: { ...notificationSettings, lastPoll, lastMailPoll, error: errorMessage(attachmentCleanupError || lastMailError || lastPollError, { debug: notificationSettings.debugErrors }), supported: Notification.isSupported(), ...privacyState() } };
      if (operation === 'togglePresentation') { setPresentation(data.enabled ?? !presentationMode, data.minutes ?? 30); return { ok: true, value: privacyState() }; }
      if (operation === 'saveNotifications') {
        require('../src/work-schedule.js').normalize(data.workSchedule, true);
        require('../src/time.js').zone(data.timeZone);
        const before = notificationSettings, next = preferences({ ...data, meetingReminders: notificationSettings.meetingReminders });
        if (client) {
          const active = connection;
          if (data.sessionId !== client.syncId) throw new Error(tr('Сессия аккаунта завершена'));
          await localStore.save({ notifications: next }, () => { if (connection !== active) throw new Error(tr('Сессия аккаунта завершена')); });
          if (connection !== active) throw new Error(tr('Сессия аккаунта завершена'));
        }
        notificationSettings = next;
        i18n.setLanguage(next.language); updateTrayMenu();
        if (!before.mail && notificationSettings.mail) { tracker.mailSeen.clear(); tracker.baseline = null; }
        if (!notificationSettings.preview || !notificationSettings.mail) {
          mailAlerts = []; publishMailAlerts();
          for (const n of activeNotifications) n.close(); activeNotifications.clear();
        }
        await refreshPrivacy(); refreshWidget(); return { ok: true, value: notificationSettings };
      }
      if (operation === 'testNotification') {
        if (!['mail', 'meeting'].includes(data.kind)) throw new Error('Invalid sound');
        if (data.kind === 'mail') {
          const alert = queueMailAlert({ id: 'test-mail', from: { name: tr('Анна Новикова · проверка') }, subject: tr('Материалы к встрече'), preview: tr('Добрый день! Отправляю документы для обсуждения завтра.') });
          notify('mail', alert.title, alert.body, { view: 'mail' });
        } else notify('meeting', tr('Встреча через 15 минут · проверка'), tr('Тестовое уведомление Aster Mail. Данные Exchange не использовались.'), { view: 'calendar' });
        return { ok: true, value: true };
      }
      if (operation === 'connect') return { ok: true, value: await connect(data, Boolean(data.remember)) };
      if (operation === 'loginHint') {
        const epoch = accountEpoch;
        return { ok: true, value: await localStore.loadLoginHint(() => { if (epoch !== accountEpoch) throw new Error(tr('Сессия аккаунта завершена')); }) };
      }
      if (operation === 'restore') {
        if (client && account) return { ok: true, value: { server: account.server, username: account.username, sessionId: client.syncId, localData: localStore.data.values || {}, notifications: notificationSettings } };
        const epoch = accountEpoch;
        const guard = () => { if (epoch !== accountEpoch || quitting || resettingLocalData) throw new Error(tr('Сессия аккаунта завершена')); };
        await Promise.allSettled([localStore.migrate(guard), moduleProfile.store.migrate(guard)]);
        guard();
        const saved = await localStore.loadCredentials(() => { if (epoch !== accountEpoch) throw new Error(tr('Сессия аккаунта завершена')); });
        if (!saved) return { ok: true, value: null };
        return { ok: true, value: await connect(saved, false, true) };
      }
      if (operation === 'disconnect') {
        if (client && data.sessionId !== client.syncId) throw new Error(tr('Сессия аккаунта завершена'));
        if (!composeWindows.confirmAll()) throw new Error(tr('Закрытие писем отменено'));
        ++accountEpoch;
        const retired = retireAccount();
        const results = await Promise.allSettled([retired, localStore.clear(), window.webContents.session.clearStorageData({ storages: ['localstorage', 'indexdb', 'cachestorage'] })]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        return { ok: true, value: true };
      }
      if (operation === 'openLink') {
        const url = new URL(data.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(tr('Неподдерживаемая ссылка'));
        const answer = await dialog.showMessageBox(window, { type: 'question', message: tr('Открыть ссылку в браузере?'), detail: url.href.slice(0, 1500), buttons: [tr('Отмена'), tr('Открыть')], defaultId: 0, cancelId: 0 });
        if (answer.response === 1) await shell.openExternal(url.href);
        return { ok: true, value: true };
      }
      if (operation === 'composeAttachment') {
        if (!['preview', 'open', 'close'].includes(data.action)) throw new Error('Invalid attachment action');
        const active = client, epoch = accountEpoch;
        const sender = event.sender;
        let previewRevision;
        const assertActive = () => {
          if (epoch !== accountEpoch || client !== active || sender.isDestroyed() || composeEntry && !composeWindows.entries.has(sender)) throw new Error(tr('Сессия аккаунта завершена'));
          if (active ? data.sessionId !== active.syncId : data.source || composeEntry && !composeEntry.demo) throw new Error(tr('Сессия аккаунта завершена'));
          if (previewRevision !== undefined) attachmentPreviews.assertCurrent(sender, previewRevision);
        };
        assertActive();
        if (data.action === 'close') { attachmentPreviews.close(sender); return { ok: true, value: true }; }
        const revision = previewRevision = attachmentPreviews.begin(sender);
        const C = require('./compose-attachments.cjs');
        const sources = composeEntry ? composeEntry.attachmentSources : new Set([data.source?.id].filter(Boolean));
        const file = await C.resolve(data, { client: active, sources, assertActive, allowEvents: !composeEntry }); assertActive();
        if (data.action === 'preview') {
          attachmentPreviews.assertCurrent(sender, revision);
          const result = C.preview(file);
          if (result.kind === 'pdf') return { ok: true, value: await attachmentPreviews.open(file, { owner: sender, revision, assertActive, parent: composeEntry?.window || window }) };
          return { ok: true, value: result };
        }
        return { ok: true, value: await attachmentFiles.open({ name: file.name, load: async () => file.bytes, assertActive }) };
      }
      if (operation === 'moduleAuthorCatalog') return { ok: true, value: await require('./module-catalog.cjs').browse({ net, session }, event.sender, path.join(app.getPath('userData'), 'modules')) };
      if (operation === 'moduleInstallApproved') {
        const active = client, epoch = accountEpoch, sender = event.sender;
        const controller = new AbortController(), cancel = () => controller.abort();
        const guard = () => {
          if (controller.signal.aborted || resettingLocalData || client !== active || accountEpoch !== epoch || sender.isDestroyed() || active && data.sessionId !== active.syncId || !active && (connection || data.sessionId)) throw new Error(tr('Сессия аккаунта завершена'));
        };
        guard(); await moduleProfile.initialize(guard);
        sender.once('destroyed', cancel);
        connection?.controller.signal.addEventListener('abort', cancel, { once: true });
        const accountSignal = connection?.controller.signal;
        const Github = require('./module-github.cjs'), Catalog = require('./module-catalog.cjs');
        const isolated = session.fromPartition(`aster-module-catalog-${crypto.randomUUID()}`, { cache: false });
        try {
          const read = (url, limit, signal) => Github.getBytes(net, isolated, url, limit, signal);
          await Catalog.install(data, read, controller.signal, { install: async bundle => {
            guard();
            await moduleHost.install(bundle, true);
            guard();
          } }, guard);
          return { ok: true, value: true };
        } finally {
          sender.removeListener('destroyed', cancel); accountSignal?.removeEventListener('abort', cancel);
          await Promise.allSettled([isolated.closeAllConnections(), isolated.clearStorageData()]);
        }
      }
      const activeClient = client;
      if (activeClient ? data.sessionId !== activeClient.syncId : data.sessionId) throw new Error(tr('Сессия аккаунта завершена'));
      if (['moduleCatalog', 'moduleImport', 'moduleImportGitHub', 'moduleConfigure', 'moduleRemove', 'moduleInvoke', 'moduleMounts'].includes(operation)) {
        const epoch = accountEpoch, guard = () => { if (client !== activeClient || epoch !== accountEpoch || resettingLocalData || connection && !client) throw new Error(tr('Сессия аккаунта завершена')); };
        guard(); await moduleProfile.initialize(guard);
        if (operation === 'moduleImport') {
          const selected = await dialog.showOpenDialog(window, { title: tr('Подключить модуль'), properties: ['openDirectory'] }); guard();
          if (!selected.canceled && selected.filePaths.length === 1) {
            const bundle = await require('./modules.cjs').readPackage(selected.filePaths[0]); guard();
            await installModuleBundle(bundle, guard);
          }
        }
        if (operation === 'moduleImportGitHub') {
          const Github = require('./module-github.cjs');
          const isolated = session.fromPartition(`aster-module-install-${crypto.randomUUID()}`, { cache: false });
          try {
            const bundle = await Github.load({ url: data.url, ref: data.ref, directory: data.directory }, (url, limit, signal) => Github.getBytes(net, isolated, url, limit, signal), moduleHost.current().signal);
            guard(); await installModuleBundle(bundle, guard);
          } finally { await Promise.allSettled([isolated.closeAllConnections(), isolated.clearStorageData()]); }
        }
        if (operation === 'moduleConfigure') await moduleHost.configure(data.id, data.enabled);
        if (operation === 'moduleRemove') await moduleHost.remove(data.id);
        if (operation === 'moduleInvoke') {
          const value = await moduleHost.invoke(data.id, data.command, data.input || {}, data.editorId ? { editorId: data.editorId, draft: data.draft || null } : {}); guard(); return { ok: true, value };
        }
        if (operation === 'moduleMounts') { await moduleHost.mounts(window, data.views); guard(); return { ok: true, value: true }; }
        guard(); const catalog = await moduleHost.catalog(); guard();
        return { ok: true, value: catalog.map(item => ({ ...item, sessionId: moduleHost.current().sessionId })) };
      }
      if (!client) throw new Error(tr('Сначала подключите аккаунт OWA'));
      if (operation === 'contactHistory') {
        const guard = () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); };
        const value = await require('./contact-history.cjs').read(activeClient, data, guard); guard();
        return { ok: true, value };
      }
      if (['mailReminders', 'mailReminderSubjects', 'setMailReminder', 'removeMailReminder'].includes(operation)) {
        const reminders = activeClient.mailReminders;
        if (operation === 'setMailReminder') { const value = await reminders.set(data); closeMailReminderAlerts(); return { ok: true, value }; }
        if (operation === 'removeMailReminder') { await reminders.remove(data); closeMailReminderAlerts(); return { ok: true, value: true }; }
        const entries = reminders.entries();
        if (operation === 'mailReminderSubjects') {
          let titles = [], error = '';
          try { titles = await reminderSubjects(activeClient, entries); }
          catch (failure) { error = errorMessage(failure, { operation: 'mailReminderSubjects' }); }
          if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
          return { ok: true, value: { titles, error } };
        }
        return { ok: true, value: { entries, error: reminders.error, supported: Notification.isSupported(), privacyActive: privacyHidden() } };
      }
      if (['waitingReplies', 'waitingRepliesCount', 'refreshWaitingReplies', 'waitForReply', 'removeWaitingReply'].includes(operation)) {
        const waiting = activeClient.waitingReplies;
        if (operation === 'waitingRepliesCount') return { ok: true, value: waiting.entries().filter(entry => !entry.replyId).length };
        if (operation === 'waitForReply') { await waiting.track(data); publishWaitingReplyCount(activeClient); return { ok: true, value: true }; }
        if (operation === 'removeWaitingReply') { await waiting.remove(data); publishWaitingReplyCount(activeClient); return { ok: true, value: true }; }
        if (operation === 'refreshWaitingReplies') {
          const page = await activeClient.messages({ folder: 'inbox', offset: 0, refresh: true });
          if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
          await waiting.scan(page.items);
        }
        const value = await waiting.list();
        if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
        return { ok: true, value };
      }
      if (['quickReplies', 'saveQuickReplies'].includes(operation)) {
        const normalize = require('../src/quick-replies.js').normalize;
        if (operation === 'saveQuickReplies') {
          const replies = normalize(data.replies);
          if (activeClient.quickRepliesSaving || data.revision !== (activeClient.quickRepliesRevision || 0)) throw new Error(tr('Шаблоны изменились в другом окне. Обновите список перед сохранением.'));
          activeClient.quickRepliesSaving = true;
          try {
            await localStore.save({ quickReplies: replies }, () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); });
            if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
            activeClient.quickRepliesRevision = (activeClient.quickRepliesRevision || 0) + 1;
          } finally { activeClient.quickRepliesSaving = false; }
        }
        return { ok: true, value: { replies: normalize(localStore.data.quickReplies || []), revision: activeClient.quickRepliesRevision || 0 } };
      }
      if (['autoReplies', 'saveAutoReplies'].includes(operation)) {
        const guard = () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); };
        const replies = require('./auto-replies.cjs');
        return { ok: true, value: await (operation === 'autoReplies' ? replies.read(activeClient, guard) : replies.save(activeClient, data, guard)) };
      }
      if (operation === 'saveMeetingReminders') {
        const normalized = require('./notifications.cjs').meetingReminders([{ id: data.ref?.id, start: data.start, minutes: data.minutes }]);
        if (normalized.length !== 1 || typeof data.custom !== 'boolean') throw new Error(tr('Некорректное напоминание'));
        // Local schedules target an exact occurrence; changed/cancelled events are
        // filtered by the next poll. Saving must not require a network read.
        const entry = normalized[0];
        const remaining = notificationSettings.meetingReminders.filter(value => value.id !== entry.id || value.start !== entry.start);
        const next = preferences({ ...notificationSettings, meetingReminders: data.custom ? [...remaining, entry] : remaining });
        await localStore.save({ notifications: next }, () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); });
        if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
        notificationSettings = next;
        return { ok: true, value: next.meetingReminders };
      }
      if (operation === 'saveLocalData') {
        const active = connection;
        await localStore.save({ values: data.values }, () => { if (connection !== active) throw new Error(tr('Сессия аккаунта завершена')); });
        return { ok: true, value: true };
      }
      if (operation === 'joinEvent') {
        const event = await activeClient.eventDetails(data);
        if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
        const url = meetingLink(event);
        if (!url || event.cancelled) throw new Error(tr('Ссылка на созвон недоступна'));
        await moduleHost.openMeeting(url); return { ok: true, value: true };
      }
      if (operation === 'openAttachment') {
        if (typeof data.id !== 'string' || data.id.length > 16000 || typeof data.ref?.id !== 'string' || data.ref.id.length > 16000) throw new Error('Invalid attachment');
        const assertActive = () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); };
        const message = await activeClient.message({ ...data.ref, refresh: true }); assertActive();
        const file = message.attachments.find(file => file.id === data.id);
        if (!file) throw new Error(tr('Вложение не найдено в письме. Обновите письмо.'));
        return { ok: true, value: await attachmentFiles.open({ name: file.name, load: () => activeClient.attachment(file.id), assertActive }) };
      }
      if (operation === 'attachment') {
        if (typeof data.id !== 'string' || typeof data.name !== 'string') throw new Error('Invalid attachment');
        const result = await dialog.showSaveDialog(window, { defaultPath: safeName(data.name) });
        if (!result.canceled) {
          const bytes = await activeClient.attachment(data.id);
          if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
          await writeAttachment(result.filePath, bytes, { assertActive: () => { if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена')); } });
        }
        return { ok: true, value: !result.canceled };
      }
      if (operation === 'clearMailCache') { client.mailCache.clear(); return { ok: true, value: true }; }
      if (!methods.has(operation)) throw new Error('Unknown operation');
      const value = await activeClient[operation](data);
      if (client !== activeClient) throw new Error(tr('Сессия аккаунта завершена'));
      if (composeEntry && ['send', 'draft', 'editDraft'].includes(operation) && window && !window.isDestroyed()) window.webContents.send('aster-compose-saved');
      if (['respond', 'createEvent', 'updateEvent', 'removeEvent'].includes(operation)) {
        try { moduleHost.publish('calendar.changed', { operation }); } catch { /* Module delivery cannot change a successful Exchange write. */ }
        widgetDetail = null; void pollNotifications();
      }
      return { ok: true, value };
    } catch (error) { return { ok: false, error: errorMessage(error, { operation, debug: debugErrors }), userFacing: true, connectionError: error.connectionError === true }; }
    finally { if (composeWrite) composeEntry.busy = false; if (serverWrite) activeServerWrites--; }
  });
  createWindow();
  ipcMain.handle('aster-widget', async (event, operation, data) => {
    try {
      if (!widgetWindow || event.sender !== widgetWindow.webContents || event.senderFrame !== widgetWindow.webContents.mainFrame) throw new Error('Untrusted widget sender');
      if (operation === 'state') return { ok: true, value: widgetState() };
      if (operation === 'app') { widgetWindow.hide(); reveal(); return { ok: true }; }
      if (operation === 'presentation') { setPresentation(data?.id !== 'off', data?.id === 'off' ? 30 : Number(data?.id || 30)); return { ok: true }; }
      if (privacyHidden()) throw new Error(tr('Уведомления скрыты'));
      const meeting = widgetEvents.find(item => item.id === data?.id && !item.cancelled);
      if (!meeting) throw new Error(tr('Встреча больше не доступна. Дождитесь обновления календаря.'));
      if (operation === 'dismiss') {
        for (const notification of activeNotifications) if (notification.asterNavigation?.eventId === meeting.id) { notification.close(); activeNotifications.delete(notification); }
        dismissedMeetings.add(`${meeting.id}:${meeting.start}`);
        if (dismissedMeetings.size > 200) dismissedMeetings.delete(dismissedMeetings.values().next().value);
        refreshWidget();
      } else if (operation === 'open') {
        widgetWindow.hide(); reveal({ view: 'calendar', date: meeting.start, eventId: meeting.id });
      } else if (operation === 'join') {
        if (['Decline', 'Declined'].includes(meeting.response)) throw new Error(tr('Встреча отклонена. Измените ответ в карточке встречи.'));
        const url = httpsURL(meetingLink(meeting));
        if (!url) throw new Error(tr('Ссылка на созвон не найдена. Откройте карточку встречи.'));
        widgetWindow.hide(); await moduleHost.openMeeting(url);
      } else throw new Error('Unknown widget operation');
      return { ok: true };
    } catch (error) { return { ok: false, error: errorMessage(error, { operation, debug: notificationSettings.debugErrors }), userFacing: true }; }
  });
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(image); tray.setToolTip(tr('Aster Mail · почта и встречи'));
  updateTrayMenu();
  if (process.platform === 'darwin') tray.on('right-click', () => tray.popUpContextMenu(trayMenuCurrent));
  tray.on('click', toggleWidget);
  refreshWidget();
  const attachmentTimer = setInterval(() => { attachmentFiles.cleanupExpired().then(() => { attachmentCleanupError = ''; }, error => { attachmentCleanupError = error.message; }); }, 60000); attachmentTimer.unref();
  const privacyTimer = setInterval(() => { void refreshPrivacy(); }, 2000); privacyTimer.unref();
  void refreshPrivacy();
  const widgetTimer = setInterval(refreshWidget, 15000); widgetTimer.unref();
  const mailTimer = setInterval(() => { void pollMail(); void pollMailReminders(); }, 15000); mailTimer.unref();
  powerMonitor.on('resume', () => { sharingPrivacy.active = null; syncNotificationPrivacy(); void refreshPrivacy(); void pollNotifications(); if (app.isPackaged) void updates.checkAutomatically(); });
  const timer = setInterval(() => { void pollNotifications(); }, 60000); timer.unref();
  if (app.isPackaged) {
    void updates.checkAutomatically();
    const updateTimer = setInterval(() => { void updates.checkAutomatically(); }, 60000); updateTimer.unref();
  }
  app.on('activate', () => { reveal(); void pollNotifications(); if (app.isPackaged) void updates.checkAutomatically(); });
});
app.on('before-quit', event => {
  if (quitting) return;
  if (!confirmQuit()) { event.preventDefault(); return; }
  retireForQuit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { localEncryption?.close?.(); try { attachmentFiles?.clearSync(); } catch { /* The user has acknowledged locked copies before quitting; retry at startup. */ } });

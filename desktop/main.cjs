const { app, BrowserWindow, ipcMain, net, session, safeStorage, shell, dialog, Menu, Notification, Tray, nativeImage, screen, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Updates } = require('./updates.cjs');
let updates;
const { OWAClient } = require('./owa.cjs');
const { normalizeServer } = require('./protocol.cjs');
const { NotificationTracker, preferences, mailAlert } = require('./notifications.cjs');
const { httpsURL, meetingLink, upcomingMeetings, countdown, pollingRange } = require('./meetings.cjs');
let widgetWindow, widgetEvents = [], widgetDetail = null;
let window, client, account, accountSession, tray, createWindow, quitting = false;
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
  if (!client || mailPolling || !notificationSettings.mail) return;
  mailPolling = true;
  const active = client;
  try {
    const page = await active.messages({ folder: 'inbox', offset: 0 });
    if (active !== client || !notificationSettings.mail) return;
    lastMailPoll = new Date().toISOString(); lastMailError = '';
    const fresh = tracker.newMail(page.items);
    for (const message of [...fresh].reverse()) queueMailAlert(message);
    if (fresh.length) {
      const alert = mailAlert(fresh[0], notificationSettings.preview);
      notify('mail', fresh.length > 1 ? `${alert.title} · ещё ${fresh.length - 1}` : alert.title, alert.body, alert.navigation);
    }
  } catch (error) { if (active === client) lastMailError = error.message; }
  finally { mailPolling = false; }
}
const page = path.join(__dirname, '../src/index.html');
const credentialFile = () => path.join(app.getPath('userData'), 'account.enc');
const settingsFile = () => path.join(app.getPath('userData'), 'notifications.json');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (createWindow) reveal(); });

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
  const width = Math.min(440, area.width - 16), height = Math.min(670, area.height - 16);
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
            try { widgetDetail = { key, at: Date.now(), data: await active.event({ id: next.id, changeKey: next.changeKey }) }; } catch { /* The calendar preview and location remain available. */ }
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

function transport(url, options = {}) {
  return new Promise((resolve, reject) => {
    const credentials = account;
    const origin = normalizeServer(credentials.server, credentials.allowHttp === true);
    if (new URL(url).origin !== origin) return reject(new Error('Запрос к постороннему серверу заблокирован'));
    const req = net.request({ url, method: options.method || 'GET', session: accountSession, useSessionCookies: true, redirect: 'manual' });
    let attempts = 0, redirects = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => { finish(new Error('Сервер не ответил за 30 секунд. Проверьте VPN и подключение.')); req.abort(); }, 30000);
    req.on('login', (info, callback) => {
      if (info.isProxy || info.host !== new URL(origin).hostname || attempts++ > 0) return callback();
      callback(credentials.username, credentials.password);
    });
    req.on('redirect', (_status, _method, destination) => {
      if (++redirects > 5 || new URL(destination).origin !== origin) {
        finish(new Error('OWA перенаправляет на другой сервер. Межсерверный SSO пока не поддерживается.'));
        req.abort(); return;
      }
      req.followRedirect();
    });
    req.on('error', () => finish(new Error('Не удалось подключиться к OWA. Проверьте адрес, VPN и сертификат сервера.')));
    req.on('response', res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 30 * 1024 * 1024) { finish(new Error('Ответ превышает лимит 30 МБ')); req.abort(); }
        else chunks.push(chunk);
      });
      res.on('error', () => finish(new Error('Соединение прервано. Результат операции неизвестен; проверьте OWA перед повтором.')));
      res.on('end', () => { const buffer = Buffer.concat(chunks); finish(null, { status: res.statusCode, text: options.binary ? '' : buffer.toString('utf8'), buffer }); });
    });
    for (const [key, value] of Object.entries(options.headers || {})) req.setHeader(key, value);
    req.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 AsterMail/0.1');
    if (options.body) req.write(options.body);
    req.end();
  });
}
let imageSession;
async function fetchContentImage(url) {
  require('./content-images.cjs').sourceURL(url);
  imageSession ||= session.fromPartition(`aster-images-${crypto.randomUUID()}`, { cache: false });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    for (let redirect = 0; redirect <= 4; redirect++) {
      response = await imageSession.fetch(url, { credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = require('./content-images.cjs').sourceURL(new URL(response.headers.get('location'), url).href);
      if (url.startsWith('https:') && !next.startsWith('https:')) throw new Error('Небезопасное перенаправление изображения');
      await response.body?.cancel(); url = next;
    }
    if (!response.ok) throw new Error(`Изображение: HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) { controller.abort(); throw new Error('Неподдерживаемый формат изображения'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { controller.abort(); throw new Error('Изображение превышает 5 МБ'); }
      chunks.push(Buffer.from(chunk));
    }
    return { ContentType: type, Content: Buffer.concat(chunks).toString('base64') };
  } finally { clearTimeout(timer); }
}
async function connect(data, remember, restoring = false) {
  if (typeof data.username !== 'string' || !data.username.trim() || typeof data.password !== 'string' || !data.password) throw new Error('Укажите логин и пароль');
  client = null; mailAlerts = []; publishMailAlerts();
  account = { server: normalizeServer(data.server, data.allowHttp === true), allowHttp: data.allowHttp === true, username: data.username.trim(), password: data.password };
  // An in-memory partition prevents session cookies from being persisted to disk.
  accountSession = session.fromPartition(`aster-${crypto.randomUUID()}`, { cache: false });
  const candidate = new OWAClient(account, transport,
    async () => (await accountSession.cookies.get({ url: `${account.server}/owa/`, name: 'X-OWA-CANARY' }))[0]?.value,
    () => accountSession.clearStorageData({ storages: ['cookies'] }), fetchContentImage);
  try { await candidate.authenticate(); client = candidate; }
  catch (error) { account.password = ''; await accountSession.clearStorageData(); throw error; }
  if (remember) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('Безопасное хранилище недоступно. Снимите «Запомнить».');
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(credentialFile(), safeStorage.encryptString(JSON.stringify(account)), { mode: 0o600 });
  } else if (!restoring) await fs.rm(credentialFile(), { force: true });
  tracker = new NotificationTracker(); lastPoll = null; lastPollError = ''; lastMailPoll = null; lastMailError = '';
  widgetEvents = []; widgetDetail = null; refreshWidget();
  void pollNotifications();
  return { server: account.server, username: account.username };
}
const methods = new Set(['folders', 'messages', 'search', 'message', 'change', 'move', 'send', 'draft', 'calendar', 'event', 'createEvent', 'respond', 'contacts', 'createContact', 'signature', 'personPhoto', 'createMailRule', 'availability', 'eventDetails', 'updateEvent', 'eventMessage', 'eventImage', 'contentImages']);
function validate(operation, data) {
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > 30_000_000) throw new Error('Invalid request');
  if (['message', 'event', 'eventDetails', 'joinEvent'].includes(operation) && (typeof data.id !== 'string' || data.id.length > 16000)) throw new Error('Invalid item reference');
  if (['change', 'move', 'respond'].includes(operation) && typeof data.ref?.id !== 'string') throw new Error('Invalid item reference');
  if (['updateEvent', 'eventMessage', 'eventImage', 'contentImages'].includes(operation) && (typeof data.ref?.id !== 'string' || data.ref.id.length > 16000)) throw new Error('Invalid content reference');
  if (data.scope !== undefined && !['single', 'series'].includes(data.scope)) throw new Error('Invalid meeting scope');
  if (operation === 'change' && (data.field === 'Importance' ? !['High', 'Normal'].includes(data.value) : typeof data.value !== 'boolean')) throw new Error('Invalid value');
  if (operation === 'messages' && (typeof data.folder !== 'string' || !Number.isInteger(data.offset || 0) || (data.offset || 0) < 0)) throw new Error('Invalid folder or offset');
}
app.whenReady().then(async () => {
  app.setAppUserModelId('app.astermail.desktop');
  updates = new Updates({ directory: path.join(app.getPath('userData'), 'updates'), installed: app.getVersion(),
    // Node fetch has no access to Electron OWA cookies and supports manual redirects.
    fetch: (url, options) => globalThis.fetch(url, options), open: file => shell.openPath(file),
    changed: value => { if (window && !window.isDestroyed()) window.webContents.send('aster-update', value); },
  });
  await updates.initialize();
  try { const saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); notificationSettings = preferences(saved.previewVersion === 1 ? saved : { ...saved, preview: true });
    if (saved.previewVersion !== 1) await fs.writeFile(settingsFile(), JSON.stringify({ ...notificationSettings, previewVersion: 1 }), { mode: 0o600 }); } catch { /* Defaults on first launch. */ }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Aster Mail', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  createWindow = () => {
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1080, minHeight: 700, title: 'Aster Mail',
      backgroundColor: '#f7f8fb', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 },
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    window.loadFile(page);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.on('close', event => {
      if (!quitting && client) { event.preventDefault(); window.hide(); }
    });
  };
  ipcMain.handle('aster', async (event, operation, data) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
      validate(operation, data);
      if (operation === 'updateState') return { ok: true, value: updates.snapshot() };
      if (operation === 'checkUpdates') return { ok: true, value: await updates.check() };
      if (operation === 'downloadUpdate') return { ok: true, value: await updates.download() };
      if (operation === 'openUpdateInstaller') return { ok: true, value: await updates.openInstaller() };
      if (operation === 'saveUpdatePreferences') return { ok: true, value: await updates.preferences(data.autoCheck) };
      if (operation === 'mailAlerts') return { ok: true, value: mailAlerts };
      if (operation === 'dismissMailAlert') { mailAlerts = mailAlerts.filter(item => item.id !== data.id); publishMailAlerts(); return { ok: true, value: true }; }
      if (operation === 'notificationSettings') return { ok: true, value: { ...notificationSettings, lastPoll, lastMailPoll, error: lastMailError || lastPollError, supported: Notification.isSupported() } };
      if (operation === 'saveNotifications') {
        require('../src/time.js').zone(data.timeZone);
        const before = notificationSettings;
        notificationSettings = preferences(data);
        if (!before.mail && notificationSettings.mail) { tracker.mailSeen.clear(); tracker.baseline = null; }
        await fs.mkdir(app.getPath('userData'), { recursive: true });
        await fs.writeFile(settingsFile(), JSON.stringify({ ...notificationSettings, previewVersion: 1 }), { mode: 0o600 });
        if (!notificationSettings.preview || !notificationSettings.mail) { mailAlerts = []; publishMailAlerts(); }
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
        let encrypted;
        try { encrypted = await fs.readFile(credentialFile()); } catch (error) { if (error.code === 'ENOENT') return { ok: true, value: null }; throw error; }
        const saved = JSON.parse(safeStorage.decryptString(encrypted));
        return { ok: true, value: await connect(saved, false, true) };
      }
      if (operation === 'disconnect') {
        client = null; if (account) account.password = ''; account = null;
        if (accountSession) await accountSession.clearStorageData();
        mailAlerts = []; publishMailAlerts();
        tracker = new NotificationTracker(); lastPoll = null; lastPollError = ''; lastMailPoll = null; lastMailError = '';
        widgetEvents = []; widgetDetail = null; refreshWidget();
        for (const n of activeNotifications) n.close(); activeNotifications.clear();
        await fs.rm(credentialFile(), { force: true }); return { ok: true, value: true };
      }
      if (operation === 'openLink') {
        const url = new URL(data.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Неподдерживаемая ссылка');
        const answer = await dialog.showMessageBox(window, { type: 'question', message: 'Открыть ссылку в браузере?', detail: url.href.slice(0, 1500), buttons: ['Отмена', 'Открыть'], defaultId: 0, cancelId: 0 });
        if (answer.response === 1) await shell.openExternal(url.href);
        return { ok: true, value: true };
      }
      if (!client) throw new Error('Сначала подключите аккаунт OWA');
      if (operation === 'joinEvent') {
        const event = await client.eventDetails(data);
        const url = meetingLink(event);
        if (!url || event.cancelled) throw new Error('Ссылка на созвон недоступна');
        await shell.openExternal(url); return { ok: true, value: true };
      }
      if (operation === 'attachment') {
        if (typeof data.id !== 'string' || typeof data.name !== 'string') throw new Error('Invalid attachment');
        const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(data.name).replace(/[\\/:]/g, '_') });
        if (!result.canceled) await fs.writeFile(result.filePath, await client.attachment(data.id));
        return { ok: true, value: !result.canceled };
      }
      if (!methods.has(operation)) throw new Error('Unknown operation');
      const value = await client[operation](data);
      if (['respond', 'createEvent', 'updateEvent'].includes(operation)) { widgetDetail = null; void pollNotifications(); }
      return { ok: true, value };
    } catch (error) { return { ok: false, error: error.message }; }
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
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const crypto = require('node:crypto');
const M = require('./modules.cjs');
const tr = require('../src/i18n.js').text;

// Read only the provider's session envelope, in an isolated world on its exact origin.
function sessionScript(capture) {
  // Only JSON data from the validated manifest is interpolated, never module-provided code.
  return `(() => {
    try {
      const config = ${JSON.stringify(capture)};
      const raw = window[config.storage].getItem(config.key);
      if (!raw || raw.length > 16000) return null;
      const value = JSON.parse(raw);
      const read = path => path.reduce((item, key) => item && Object.hasOwn(item, key) ? item[key] : undefined, value);
      if (config.rejectPath && read(config.rejectPath)) return null;
      return { token: read(config.tokenPath), expiresAt: read(config.expiresAtPath) };
    } catch { return null; }
  })()`;
}
function sessionValue(value, origin, now = Date.now()) {
  if (!value || typeof value.token !== 'string' || !value.token || value.token.length > 4096 || /\s/.test(value.token) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now) return null;
  return { origin, token: value.token, expiresAt: new Date(value.expiresAt).toISOString() };
}
function allowedNavigation(value, origins) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && origins.includes(url.origin); } catch { return false; }
}
function authenticationStatus(host, entry) {
  host.current(entry);
  const session = host.records().find(item => item.id === entry.id)?.auth;
  const valid = sessionValue(session, session?.origin);
  return { connected: Boolean(valid), origin: valid?.origin || null, expiresAt: valid?.expiresAt || null, pending: Boolean(entry.authFlow), blockedOrigin: entry.authBlockedOrigin || null };
}
function closeAuthentication(entry) { entry.authFlow?.close(); }

async function signIn(host, entry, input) {
  host.current(entry);
  const definition = host.definition(entry);
  if (!entry.context || !definition.authentication?.origins.includes(input.origin)) throw new Error('Authentication not declared');
  if (entry.authFlow) { entry.authFlow.window.focus(); return authenticationStatus(host, entry); }
  const origin = input.origin, origins = [...definition.authentication.origins, ...definition.authentication.identityOrigins];
  const isolated = host.electron.session.fromPartition(`aster-module-auth-${crypto.randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false); isolated.on('will-download', event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !/^(https:|data:|blob:|about:)/.test(request.url) }));
  const preferences = { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false };
  const window = new host.electron.BrowserWindow({ width: 960, height: 740, title: `${tr('Корпоративный вход')} · ${origin}`, autoHideMenuBar: true, webPreferences: preferences });
  const windows = new Set(); let closed = false, reading = false, timer, interval;
  entry.authBlockedOrigin = null;
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); clearInterval(interval);
    if (entry.authFlow?.window === window) entry.authFlow = null;
    for (const item of windows) if (!item.isDestroyed()) item.destroy();
    void Promise.allSettled([isolated.clearStorageData(), isolated.closeAllConnections()]);
  };
  entry.authFlow = { window, close };
  const navigation = (event, value) => {
    const url = value || event.url;
    if (allowedNavigation(url, origins)) return;
    event.preventDefault();
    try { const parsed = new URL(url); entry.authBlockedOrigin = parsed.protocol === 'https:' ? parsed.origin : null; } catch { /* Never expose query strings from login redirects. */ }
  };
  const protect = item => {
    if (closed) { item.destroy(); return; }
    windows.add(item);
    item.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    item.webContents.on('will-frame-navigate', navigation); item.webContents.on('will-navigate', navigation); item.webContents.on('will-redirect', navigation);
    item.webContents.on('render-process-gone', close);
    item.webContents.on('will-attach-webview', event => event.preventDefault());
    item.webContents.setWindowOpenHandler(({ url }) => {
      if (windows.size >= 3 || url !== 'about:blank' && !allowedNavigation(url, origins)) { navigation({ preventDefault() {} }, url); return { action: 'deny' }; }
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: preferences, autoHideMenuBar: true } };
    });
    item.webContents.on('did-create-window', protect);
    item.on('closed', () => { windows.delete(item); if (item === window) close(); });
  };
  protect(window);
  interval = setInterval(async () => {
    if (reading || closed) return; reading = true;
    try {
      host.current(entry);
      for (const item of windows) {
        if (item.isDestroyed() || new URL(item.webContents.getURL() || 'about:blank').origin !== origin) continue;
        const frame = item.webContents.mainFrame;
        const raw = await item.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: sessionScript(entry.bundle.manifest.authentication.capture) }]);
        if (closed || item.isDestroyed() || item.webContents.mainFrame !== frame || new URL(item.webContents.getURL()).origin !== origin) continue;
        host.current(entry);
        const auth = sessionValue(raw, origin);
        if (!auth) continue;
        await host.update(records => { host.current(entry); if (closed) throw new Error('Authentication closed'); const record = records.find(record => record.id === entry.id && record.enabled); if (!record) throw new Error('Module disabled'); record.auth = auth; });
        close(); break;
      }
    } catch { if (entry.retired) close(); /* Polling never logs credentials or page contents. */ }
    finally { reading = false; }
  }, 700);
  timer = setTimeout(close, 5 * 60000);
  try { await window.loadURL(origin + entry.bundle.manifest.authentication.path); } catch { close(); throw new Error(tr('Не удалось открыть корпоративный вход')); }
  return authenticationStatus(host, entry);
}
module.exports = { sessionScript, sessionValue, allowedNavigation, authenticationStatus, closeAuthentication, signIn };

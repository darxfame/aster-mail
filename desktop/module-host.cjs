const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('./modules.cjs');
const tr = require('../src/i18n.js').text;
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
class ModuleHost {
  constructor({ electron, directory, scope, save, sdk }) {
    Object.assign(this, { electron, directory, scope, save, sdk });
    this.updating = new Set(); this.entries = new Map(); this.senders = new Map(); this.pending = new Map(); this.views = new Map(); this.mountRevisions = new WeakMap(); this.owners = new WeakSet(); this.saving = Promise.resolve();
    electron.ipcMain.handle('aster-module-api', async (event, method, input) => {
      try { return { ok: true, value: await this.receive(event, method, input) }; }
      catch (error) { return { ok: false, error: tr('Запрос модуля отклонён'), code: ['http-error', 'network-unknown', 'permission-denied', 'rate-limit'].includes(error.code) ? error.code : 'module-request-rejected', ...(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? { status: error.status } : {}) }; }
    });
    electron.ipcMain.on('aster-module-reply', (event, message) => {
      let sender;
      try { sender = this.sender(event); } catch { return; }
      const pending = this.pending.get(message?.id);
      if (pending && sender.entry === pending.entry && sender.role === 'runtime') {
        try { if (message.error) throw new Error(); pending.resolve(M.bounded(message.value)); }
        catch { pending.reject(new Error(tr('Ошибка выполнения модуля'))); }
      }
    });
  }
  current(entry) { const active = this.scope(); if (!active || active.signal.aborted || entry && (entry.retired || entry.sessionId !== active.sessionId)) throw new Error(tr('Сессия аккаунта завершена')); return active; }
  sender(event) { const sender = this.senders.get(event.sender); if (!sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted module sender'); this.current(sender.entry); return sender; }
  records() { return M.records(this.current().records || []); }
  update(action) {
    const sessionId = this.current().sessionId;
    const work = this.saving.then(async () => { if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена')); const next = this.records(); await action(next); const normalized = M.records(next); if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена')); await this.save(normalized, sessionId); return normalized; });
    this.saving = work.catch(() => {}); return work;
  }
  async bundle(record) { const bundle = await M.readPackage(M.recordDirectory(this.directory, record)); if (bundle.digest !== record.digest || bundle.manifest.id !== record.id || bundle.manifest.version !== record.version) throw new Error(tr('Файлы модуля изменились. Требуется повторная установка.')); return bundle; }
  async catalog() {
    const sessionId = this.current().sessionId, result = [];
    for (const record of this.records()) {
      try { const bundle = await this.bundle(record); result.push({ ...M.effectiveManifest(bundle.manifest, record.originGrants), source: record.source || null, digest: bundle.digest, enabled: record.enabled === true, error: false }); }
      catch { if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена')); this.stop(record.id); result.push({ id: record.id, name: record.id, version: record.version, enabled: false, error: true, commands: [], views: [] }); }
    }
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    return result;
  }
  definition(entry) { this.current(entry); const record = this.records().find(record => record.id === entry.id && record.enabled); if (!record) throw new Error(tr('Модуль выключен или не настроен')); return M.effectiveManifest(entry.bundle.manifest, record.originGrants); }
  // Called only by trusted user-initiated join handlers, never exposed through module RPC.
  async openMeeting(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid meeting link');
    const sessionId = this.current().sessionId;
    const catalog = await this.catalog();
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    const route = catalog.find(item => item.enabled && !item.error && M.meetingTarget(item, value));
    if (catalog.filter(item => item.enabled && !item.error && M.meetingTarget(item, value)).length > 1) throw new Error(tr('Для ссылки настроено несколько приложений. Отключите лишний модуль.'));
    const target = route ? M.meetingTarget(route, value) : value;
    // Check registration before launching; do not silently open a second target on failure.
    if (route && !await this.electron.app.getApplicationNameForProtocol(target)) throw new Error(tr('Приложение встречи не установлено. Откройте ссылку в браузере.'));
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    if (route && !this.records().some(item => item.id === route.id && item.enabled && item.digest === route.digest)) throw new Error(tr('Модуль выключен или не настроен'));
    await this.electron.shell.openExternal(target);
  }
  async install(bundle, enabled = false) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid module settings');
    if (this.records().some(record => record.id === bundle.manifest.id)) return this.upgrade(bundle, enabled);
    if (this.records().length >= 8) throw new Error(tr('Достигнут лимит подключённых модулей'));
    const sessionId = this.current().sessionId;
    await M.installPackage(this.directory, bundle);
    await this.bundle({ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest });
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    await this.update(records => records.push({ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, ...(bundle.source ? { source: bundle.source } : {}), enabled, settingsVersion: bundle.manifest.settingsVersion, data: {} }));
  }
  async upgrade(bundle, authorized = false) {
    const Settings = require('./module-settings.cjs'), equal = require('node:util').isDeepStrictEqual;
    const id = bundle.manifest.id, sessionId = this.current().sessionId;
    const original = this.records().find(record => record.id === id);
    if (!original || !Settings.newer(bundle.manifest.version, original.version)) throw new Error(tr('Для обновления нужна новая версия модуля'));
    let previous;
    try { previous = await this.bundle(original); }
    catch {
      if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
      // Recover opaque encrypted settings without executing an obsolete/corrupt package.
      // An empty capability baseline forces full consent for the replacement.
      previous = { manifest: { settingsVersion: original.settingsVersion ?? 1, permissions: [], networkOrigins: [], networkHeaders: [] } };
    }
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    if (this.updating.has(id)) throw new Error(tr('Модуль уже обновляется'));
    const assertIdle = () => { const entry = this.entries.get(id); if (entry?.context || entry?.calls || entry?.authFlow) throw new Error(tr('Завершите операцию модуля перед обновлением')); };
    assertIdle(); this.updating.add(id);
    try {
      const before = previous.manifest, after = bundle.manifest;
      const expanded = ['permissions', 'networkOrigins', 'networkHeaders', 'optionalOrigins'].some(key => (after[key] || []).some(value => !(before[key] || []).some(old => equal(old, value)))) || ['meetingLinks', 'authentication'].some(key => !equal(before[key], after[key])) || original.source?.repository !== bundle.source?.repository;
      if (expanded && !authorized) {
        const answer = await this.electron.dialog.showMessageBox({ type: 'question', message: tr('Подтвердить изменение возможностей модуля?'), detail: `${after.name} ${after.version}\n${M.permissionSummary(after.permissions, after.authentication)}\n${after.networkOrigins.join(', ')}\n${(after.optionalOrigins || []).map(rule => rule.domain).join(', ')}\n${M.meetingLaunchSummary(after)}\n${[...(after.authentication?.origins || []), ...(after.authentication?.identityOrigins || [])].join(', ')}\n${bundle.source?.repository || tr('Локальный пакет')}\n${tr('Настройки сохранятся и будут доступны новой версии модуля.')}`, buttons: [tr('Отмена'), tr('Обновить')], defaultId: 0, cancelId: 0 });
        if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
        if (answer.response !== 1) return false;
      }
      // Validate deterministic migration before stopping the old runtime or committing metadata.
      Settings.migrate(original.data, original.settingsVersion ?? before.settingsVersion, after);
      await M.installPackage(this.directory, bundle);
      await this.bundle({ id, version: bundle.manifest.version, digest: bundle.digest });
      if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
      assertIdle(); this.stop(id);
      await this.update(records => {
        const index = records.findIndex(record => record.id === id), current = records[index];
        if (!current || current.digest !== original.digest || current.version !== original.version) throw new Error(tr('Версия модуля изменилась. Обновите список.'));
        const data = Settings.migrate(current.data, current.settingsVersion ?? before.settingsVersion, after);
        const next = { ...current, version: after.version, digest: bundle.digest, data, settingsVersion: after.settingsVersion, originGrants: (current.originGrants || []).filter(value => M.optionalOriginMatches(after, value)) };
        if (bundle.source) next.source = bundle.source; else delete next.source;
        const auth = next.auth, effective = M.effectiveManifest(after, next.originGrants);
        if (auth && (!effective.authentication?.origins.includes(auth.origin) || !equal(before.authentication?.capture, after.authentication?.capture) || !equal(before.authentication?.authorization, after.authentication?.authorization) || before.authentication?.type !== after.authentication?.type)) delete next.auth;
        records[index] = next;
      });
      return true;
    } finally { this.updating.delete(id); }
  }
  async configure(id, enabled) {
    if (this.updating.has(id)) throw new Error(tr('Модуль уже обновляется'));
    if (typeof enabled !== 'boolean') throw new Error('Invalid module settings');
    const sessionId = this.current().sessionId;
    const record = this.records().find(record => record.id === id); if (!record) throw new Error(tr('Модуль не найден'));
    if (enabled) await this.bundle(record);
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    this.stop(id); await this.update(records => { records.find(record => record.id === id).enabled = enabled; });
  }
  async remove(id) {
    if (this.updating.has(id)) throw new Error(tr('Модуль уже обновляется'));
    const sessionId = this.current().sessionId;
    const record = this.records().find(record => record.id === id); if (!record) throw new Error(tr('Модуль не найден'));
    const directory = M.recordDirectory(this.directory, record);
    this.stop(id); await this.update(records => { const index = records.findIndex(record => record.id === id); if (index < 0) throw new Error(tr('Модуль не найден')); records.splice(index, 1); });
    if (this.current().sessionId === sessionId) await fs.rm(directory, { recursive: true, force: true });
  }
  stop(id) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.retired = true; entry.controller.abort(); this.entries.delete(id);
    require('./module-auth.cjs').closeAuthentication(entry);
    entry.readyReject?.(new Error(tr('Модуль остановлен')));
    for (const pending of this.pending.values()) if (pending.entry === entry) pending.reject(new Error(tr('Модуль остановлен')));
    for (const [key, view] of this.views) if (view.entry === entry) this.closeView(key);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    for (const [sender, info] of this.senders) if (info.entry === entry) this.senders.delete(sender);
    void entry.session.clearStorageData().catch(() => {}); void entry.network.clearStorageData().catch(() => {}); void entry.network.closeAllConnections().catch(() => {});
  }
  closeAll() { for (const id of [...this.entries.keys()]) this.stop(id); }
  protect(contents, entry, role) {
    this.senders.set(contents, { entry, role });
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault()); contents.on('will-frame-navigate', event => event.preventDefault()); contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('render-process-gone', () => { if (this.entries.get(entry.id) === entry) this.stop(entry.id); }); contents.once('destroyed', () => this.senders.delete(contents));
  }
  async denyProxy() {
    if (!this.proxyReady) {
      this.proxyReady = new Promise((resolve, reject) => {
        const server = require('node:http').createServer({ maxHeaderSize: 4096 }, (_request, response) => { response.writeHead(403, { Connection: 'close' }); response.end(); });
        this.proxy = server; server.maxConnections = 16;
        server.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
        server.on('upgrade', (_request, socket) => socket.destroy());
        server.on('clientError', (_error, socket) => socket.destroy());
        server.on('connection', socket => socket.setTimeout(1000, () => socket.destroy()));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => { server.unref(); resolve(server.address().port); });
      });
    }
    return this.proxyReady;
  }
  async configureProxy(isolated) {
    const proxyPort = await this.denyProxy();
    await isolated.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`, proxyBypassRules: '<-loopback>' });
    // setProxy updates preferences; synchronize Chromium's proxy service before checking it.
    await isolated.forceReloadProxyConfig();
    const route = await isolated.resolveProxy('https://example.test');
    if (route !== `PROXY 127.0.0.1:${proxyPort}`) throw new Error(`Module proxy policy unavailable: ${route}`);
  }
  async start(id) {
    if (this.updating.has(id)) throw new Error(tr('Модуль уже обновляется'));
    let entry = this.entries.get(id); if (entry) { await entry.ready; this.current(entry); return entry; }
    if (this.electron.app.commandLine.hasSwitch('no-sandbox')) throw new Error(tr('Песочница отключена. Запуск модулей запрещён.'));
    const active = this.current(), record = this.records().find(record => record.id === id && record.enabled === true);
    if (!record) throw new Error(tr('Модуль выключен или не настроен'));
    const bundle = await this.bundle(record); if (this.current().sessionId !== active.sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    if (this.entries.has(id)) return this.start(id);
    const isolated = this.electron.session.fromPartition(`aster-module-${crypto.randomUUID()}`, { cache: false });
    await this.configureProxy(isolated);
    if (this.current().sessionId !== active.sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    const network = this.electron.session.fromPartition(`aster-module-network-${crypto.randomUUID()}`, { cache: false });
    const webPreferences = { session: isolated, preload: path.join(__dirname, 'module-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, webviewTag: false, plugins: false, spellcheck: false, backgroundThrottling: false };
    const window = new this.electron.BrowserWindow({ show: false, width: 320, height: 240, webPreferences });
    entry = { id, sessionId: active.sessionId, bundle, session: isolated, network, window, webPreferences, controller: new AbortController(), retired: false, context: null, calls: 0 };
    entry.ready = new Promise((resolve, reject) => { entry.readyResolve = resolve; entry.readyReject = reject; });
    // Avoid an unhandled rejection if a module fails before its first command.
    entry.ready.catch(() => {}); this.entries.set(id, entry);
    isolated.protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (entry.retired || url.origin !== 'https://aster-module.invalid' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
      let bytes, type = 'text/html';
      if (url.pathname === '/host/runtime.html') bytes = Buffer.from('<!doctype html><meta charset="utf-8"><script type="module" src="/host/runtime.js"></script>');
      else if (url.pathname === '/host/bridge.js') { bytes = await fs.readFile(path.join(__dirname, '../src/module-bridge.js')); type = 'text/javascript'; }
      else if (url.pathname === '/host/runtime.js') { bytes = await fs.readFile(path.join(__dirname, 'module-runtime.mjs')); type = 'text/javascript'; }
      else if (url.pathname.startsWith('/package/')) { const name = decodeURIComponent(url.pathname.slice(9)); bytes = bundle.files.get(name); type = mime[path.extname(name)] || 'application/octet-stream'; }
      if (bytes && type === 'text/html') {
        const html = bytes.toString('utf8'), bridge = '<script src="/host/bridge.js"></script>';
        bytes = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, tag => tag + bridge) : /^\s*<!doctype[^>]*>/i.test(html) ? html.replace(/^(\s*<!doctype[^>]*>)/i, '$1' + bridge) : bridge + html);
      }
      return new Response(request.method === 'HEAD' ? null : bytes || null, { status: bytes ? 200 : 404, headers: { 'Content-Type': type, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    });
    isolated.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith('https://aster-module.invalid/') }));
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); isolated.setPermissionCheckHandler(() => false); isolated.on('will-download', event => event.preventDefault());
    this.protect(window.webContents, entry, 'runtime');
    const timer = setTimeout(() => { entry.readyReject(new Error(tr('Модуль не ответил вовремя'))); if (this.entries.get(id) === entry) this.stop(id); }, 15000);
    try { await window.loadURL(`https://aster-module.invalid/host/runtime.html?main=${encodeURIComponent(bundle.manifest.main)}`); await entry.ready; this.current(entry); return entry; }
    catch (error) { if (this.entries.get(id) === entry) this.stop(id); throw error; } finally { clearTimeout(timer); }
  }
  async invoke(id, command, input = {}, context = null) {
    const entry = await this.start(id); M.bounded(input); M.bounded(context);
    if (!entry.bundle.manifest.commands.some(item => item.id === command) || entry.context) throw new Error(tr('Дождитесь завершения операции модуля'));
    const safeContext = entry.bundle.manifest.permissions.includes('meeting.draft') && context?.editorId ? M.bounded({ editorId: String(context.editorId).slice(0, 100), draft: context.draft || null }) : {};
    entry.context = safeContext; const key = crypto.randomUUID();
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(tr('Модуль не ответил вовремя'))); this.stop(id); }, 30000);
        const finish = action => value => { clearTimeout(timer); this.pending.delete(key); action(value); };
        this.pending.set(key, { entry, resolve: finish(resolve), reject: finish(reject) });
        entry.window.webContents.send('aster-module-command', { id: key, command, input, context: safeContext });
      });
    } finally { entry.context = null; }
  }
  async receive(event, method, input) {
    const { entry, role } = this.sender(event); M.bounded(input);
    if (!entry.rateAt || Date.now() - entry.rateAt >= 1000) { entry.rateAt = Date.now(); entry.rateCalls = 0; }
    if (++entry.rateCalls > 40) throw Object.assign(new Error('Module rate limit exceeded'), { code: 'rate-limit' });
    if (++entry.calls > 32) { entry.calls--; throw new Error('Too many module requests'); }
    try {
      if (method === 'ready' && role === 'runtime') { entry.readyResolve(); return true; }
      if (method === 'command' && role !== 'runtime') return this.invoke(entry.id, input.command, input.input, this.senders.get(event.sender).context);
      let definition = entry.bundle.manifest;
      const permission = { 'network.requestOrigin': 'network', 'ui.context': 'ui', 'ui.openView': 'ui', 'network.request': 'network', 'storage.get': 'storage', 'storage.set': 'storage', 'calendar.list': 'calendar.read', 'meeting.getDraft': 'meeting.draft', 'meeting.openDraft': 'meeting.draft', 'meeting.patchDraft': 'meeting.draft', 'events.publish': 'events', 'auth.signIn': 'auth.session', 'auth.status': 'auth.session', 'auth.signOut': 'auth.session' }[method];
      if (!permission || !definition.permissions.includes(permission)) throw Object.assign(new Error(tr('Недостаточно разрешений модуля')), { code: 'permission-denied' });
      definition = this.definition(entry);
      if (method === 'network.requestOrigin') {
        if (!entry.context || typeof input.origin !== 'string') throw new Error('User action required');
        if (definition.networkOrigins.includes(input.origin)) return { granted: true, origin: input.origin };
        if (!M.optionalOriginMatches(entry.bundle.manifest, input.origin) || entry.originGrantPending) throw new Error(tr('Адрес сервиса не разрешён модулем'));
        if ((this.records().find(item => item.id === entry.id)?.originGrants || []).length >= 8) throw new Error(tr('Достигнут лимит дополнительных серверов модуля'));
        entry.originGrantPending = true;
        try {
          const answer = await this.electron.dialog.showMessageBox({ type: 'question', message: tr('Разрешить модулю доступ к серверу?'), detail: `${definition.name}\n${input.origin}\n${M.permissionSummary(definition.permissions, definition.authentication)}`, buttons: [tr('Отмена'), tr('Разрешить')], defaultId: 0, cancelId: 0 });
          this.current(entry);
          if (answer.response !== 1) return { granted: false, origin: input.origin };
          await this.update(records => { this.current(entry); const record = records.find(item => item.id === entry.id && item.enabled); if (!record) throw new Error(tr('Модуль выключен или не настроен')); record.originGrants = [...new Set([...(record.originGrants || []), input.origin])]; });
          return { granted: true, origin: input.origin };
        } finally { entry.originGrantPending = false; }
      }
      if (method === 'auth.status') return require('./module-auth.cjs').authenticationStatus(this, entry);
      if (method === 'auth.signIn') return await require('./module-auth.cjs').signIn(this, entry, input);
      if (method === 'auth.signOut') {
        if (!entry.context) throw new Error('User action required');
        require('./module-auth.cjs').closeAuthentication(entry);
        await this.update(records => { this.current(entry); const record = records.find(record => record.id === entry.id); if (record) delete record.auth; }); return true;
      }
      if (method === 'network.request') {
        let token = null;
        if (input.auth !== undefined) {
          const auth = this.records().find(record => record.id === entry.id)?.auth;
          if (input.auth !== 'session' || !definition.permissions.includes('auth.session') || !definition.authentication?.origins.includes(new URL(input.url).origin) || !auth || auth.origin !== new URL(input.url).origin || Date.parse(auth.expiresAt) <= Date.now() || input.bearer !== undefined || Object.keys(input.headers || {}).length) throw Object.assign(new Error('Service sign-in required'), { code: 'permission-denied' });
          token = auth.token;
        }
        return await M.requestJSON(this.electron.net, entry.network, definition, input, entry.controller.signal, token);
      }
      if (method === 'storage.get') { const record = this.records().find(record => record.id === entry.id); return M.bounded(record ? record.data : {}, 16000); }
      if (method === 'storage.set') { const value = M.bounded(input, 16000); await this.update(records => { this.current(entry); const record = records.find(record => record.id === entry.id); if (!record || !record.enabled) throw new Error(tr('Модуль остановлен')); record.data = value; }); this.current(entry); return true; }
      if (method === 'events.publish') { if (!/^[a-z][a-z0-9.-]{0,60}$/.test(input.topic)) throw new Error('Invalid module topic'); this.publish(`${entry.id}.${input.topic}`, input.data ?? null); return true; }
      return await this.sdk(entry, method, input, entry.context);
    } finally { entry.calls--; }
  }
  publish(topic, data) { const value = M.bounded({ topic, data }); for (const [sender, info] of this.senders) if (!info.entry.retired && info.entry.bundle.manifest.permissions.includes('events') && !sender.isDestroyed()) try { sender.send('aster-module-event', value); } catch { this.senders.delete(sender); } }
  closeView(key) { const info = this.views.get(key); if (!info) return; this.views.delete(key); if (!info.owner.isDestroyed()) info.owner.contentView.removeChildView(info.container); if (!info.view.webContents.isDestroyed()) info.view.webContents.close({ waitForBeforeUnload: false }); }
  async mounts(owner, mounts) {
    if (!Array.isArray(mounts) || mounts.length > 4) throw new Error('Invalid module views');
    const sessionId = this.current().sessionId, revision = (this.mountRevisions.get(owner) || 0) + 1;
    this.mountRevisions.set(owner, revision);
    const live = () => !owner.isDestroyed() && this.mountRevisions.get(owner) === revision && this.current().sessionId === sessionId;
    if (!this.owners.has(owner)) { this.owners.add(owner); owner.once('closed', () => { this.mountRevisions.set(owner, revision + 1); for (const [key, info] of this.views) if (info.owner === owner) this.closeView(key); }); }
    const keys = new Set(mounts.map(item => `${item.id}:${item.view}`));
    for (const [key, info] of this.views) if (info.owner === owner && !keys.has(key)) this.closeView(key);
    for (const item of mounts) {
      const entry = await this.start(item.id), definition = entry.bundle.manifest.views.find(view => view.id === item.view);
      if (!live()) return;
      if (!definition) throw new Error('Unknown module view');
      const key = `${item.id}:${item.view}`; let info = this.views.get(key);
      if (!info) {
        const view = new this.electron.WebContentsView({ webPreferences: entry.webPreferences });
        const container = new this.electron.View(); container.addChildView(view);
        info = { owner, view, entry, container }; this.views.set(key, info); this.protect(view.webContents, entry, 'view'); owner.contentView.addChildView(container);
        await view.webContents.loadURL(`https://aster-module.invalid/package/${definition.file}`);
      }
      if (!live()) { if (this.views.get(key) === info) this.closeView(key); return; }
      this.current(entry);
      this.senders.get(info.view.webContents).context = item.editorId ? { editorId: item.editorId, draft: item.draft || null } : {};
      const scale = owner.webContents.getZoomFactor(), [width, height] = owner.getContentSize();
      const bounds = item.bounds;
      if (!bounds || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(bounds[key]))) throw new Error('Invalid module bounds');
      const clip = item.clip || bounds;
      if (['x', 'y', 'width', 'height'].some(key => !Number.isFinite(clip[key]))) throw new Error('Invalid clipping bounds');
      const x = Math.max(0, Math.min(width, Math.round(clip.x * scale))), y = Math.max(0, Math.min(height, Math.round(clip.y * scale)));
      info.container.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(clip.width * scale))), height: Math.max(0, Math.min(height - y, Math.round(clip.height * scale))) });
      info.view.setBounds({ x: Math.min(0, Math.round(bounds.x * scale) - x), y: Math.min(0, Math.round(bounds.y * scale) - y), width: Math.max(0, Math.min(width, Math.round(bounds.width * scale))), height: Math.max(0, Math.min(height, Math.round(bounds.height * scale))) });
      info.view.webContents.setZoomFactor(scale);
    }
  }
}
module.exports = { ModuleHost, csp };

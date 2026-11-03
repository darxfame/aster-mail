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
    this.entries = new Map(); this.senders = new Map(); this.pending = new Map(); this.views = new Map(); this.mountRevisions = new WeakMap(); this.owners = new WeakSet(); this.saving = Promise.resolve();
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
      try { const bundle = await this.bundle(record); result.push({ ...bundle.manifest, source: record.source || null, digest: bundle.digest, enabled: record.enabled === true, error: false }); }
      catch { if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена')); this.stop(record.id); result.push({ id: record.id, name: record.id, version: record.version, enabled: false, error: true, commands: [], views: [] }); }
    }
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    return result;
  }
  async install(bundle) {
    if (this.records().some(record => record.id === bundle.manifest.id)) throw new Error(tr('Модуль уже подключён. Сначала удалите прежнюю версию.'));
    if (this.records().length >= 8) throw new Error(tr('Достигнут лимит подключённых модулей'));
    const sessionId = this.current().sessionId;
    await M.installPackage(this.directory, bundle);
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    await this.update(records => records.push({ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, ...(bundle.source ? { source: bundle.source } : {}), enabled: false, data: {} }));
  }
  async configure(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid module settings');
    const sessionId = this.current().sessionId;
    const record = this.records().find(record => record.id === id); if (!record) throw new Error(tr('Модуль не найден'));
    if (enabled) await this.bundle(record);
    if (this.current().sessionId !== sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    this.stop(id); await this.update(records => { records.find(record => record.id === id).enabled = enabled; });
  }
  async remove(id) {
    const sessionId = this.current().sessionId;
    const record = this.records().find(record => record.id === id); if (!record) throw new Error(tr('Модуль не найден'));
    const directory = M.recordDirectory(this.directory, record);
    this.stop(id); await this.update(records => { const index = records.findIndex(record => record.id === id); if (index < 0) throw new Error(tr('Модуль не найден')); records.splice(index, 1); });
    if (this.current().sessionId === sessionId) await fs.rm(directory, { recursive: true, force: true });
  }
  stop(id) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.retired = true; entry.controller.abort(); this.entries.delete(id);
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
  async start(id) {
    let entry = this.entries.get(id); if (entry) { await entry.ready; this.current(entry); return entry; }
    if (this.electron.app.commandLine.hasSwitch('no-sandbox')) throw new Error(tr('Песочница отключена. Запуск модулей запрещён.'));
    const active = this.current(), record = this.records().find(record => record.id === id && record.enabled === true);
    if (!record) throw new Error(tr('Модуль выключен или не настроен'));
    const bundle = await this.bundle(record); if (this.current().sessionId !== active.sessionId) throw new Error(tr('Сессия аккаунта завершена'));
    if (this.entries.has(id)) return this.start(id);
    const isolated = this.electron.session.fromPartition(`aster-module-${crypto.randomUUID()}`, { cache: false });
    const proxyPort = await this.denyProxy();
    await isolated.setProxy({ proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`, proxyBypassRules: '<-loopback>' });
    if ((await isolated.resolveProxy('https://example.test')) !== `PROXY 127.0.0.1:${proxyPort}`) throw new Error('Module proxy policy unavailable');
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
      else if (url.pathname === '/host/runtime.js') { bytes = await fs.readFile(path.join(__dirname, 'module-runtime.mjs')); type = 'text/javascript'; }
      else if (url.pathname.startsWith('/package/')) { const name = decodeURIComponent(url.pathname.slice(9)); bytes = bundle.files.get(name); type = mime[path.extname(name)] || 'application/octet-stream'; }
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
      const definition = entry.bundle.manifest;
      const permission = { 'ui.context': 'ui', 'ui.openView': 'ui', 'network.request': 'network', 'storage.get': 'storage', 'storage.set': 'storage', 'calendar.list': 'calendar.read', 'meeting.getDraft': 'meeting.draft', 'meeting.openDraft': 'meeting.draft', 'meeting.patchDraft': 'meeting.draft', 'events.publish': 'events' }[method];
      if (!permission || !definition.permissions.includes(permission)) throw Object.assign(new Error(tr('Недостаточно разрешений модуля')), { code: 'permission-denied' });
      if (method === 'network.request') return await M.requestJSON(this.electron.net, entry.network, definition, input, entry.controller.signal);
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

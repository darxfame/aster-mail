const tr = require('../src/i18n.js').text;
const crypto = require('node:crypto');
// PDF bytes stay in an isolated memory-only session, never in an OWA session.
class AttachmentPreviews {
  constructor({ BrowserWindow, session }) { Object.assign(this, { BrowserWindow, session }); this.windows = new Map(); this.revisions = new WeakMap(); }
  close(owner) {
    this.revisions.set(owner, (this.revisions.get(owner) || 0) + 1);
    for (const [window, entry] of this.windows) if (entry.owner === owner) window.destroy();
  }
  closeAll() { for (const entry of this.windows.values()) this.close(entry.owner); }
  begin(owner) { this.close(owner); return this.revisions.get(owner); }
  assertCurrent(owner, revision) {
    if (owner.isDestroyed() || this.revisions.get(owner) !== revision) throw new Error(tr('Предпросмотр закрыт'));
  }
  async open(file, { owner, revision, assertActive, parent }) {
    assertActive(); this.assertCurrent(owner, revision);
    if (!Buffer.isBuffer(file.bytes) || file.bytes.length > 20 * 1024 * 1024 || !/^%PDF-[12]\./.test(file.bytes.toString('ascii', 0, 8)) || !file.bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) throw new Error(tr('Некорректный PDF-документ'));
    // Bound the total memory used by simultaneous PDF previews.
    if (this.windows.size >= 2) this.windows.keys().next().value.destroy();
    const isolated = this.session.fromPartition(`aster-preview-${crypto.randomUUID()}`, { cache: false });
    const url = `https://aster-preview.invalid/${crypto.randomUUID()}/document.pdf`;
    let bytes = file.bytes;
    isolated.protocol.handle('https', request => request.url === url && ['GET', 'HEAD'].includes(request.method) ? new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; object-src 'self'; base-uri 'none'; form-action 'none'" } }) : new Response(null, { status: 403 }));
    isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((request, callback) => callback({ cancel: request.url !== url && !['chrome-extension:', 'chrome:', 'blob:', 'data:', 'about:'].some(scheme => request.url.startsWith(scheme)) }));
    isolated.on('will-download', event => event.preventDefault());
    const window = new this.BrowserWindow({ width: 920, height: 760, minWidth: 360, minHeight: 300, parent, show: false, title: `${file.name} · Aster`,
      webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, plugins: true, spellcheck: false } });
    this.windows.set(window, { owner });
    const retire = () => { if (!window.isDestroyed()) window.destroy(); };
    owner.once('destroyed', retire);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => { if (event.url !== url && !String(event.url || '').startsWith('chrome-extension:') && !String(event.url || '').startsWith('blob:')) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', retire);
    window.on('closed', () => {
      bytes = null; this.windows.delete(window); owner.removeListener('destroyed', retire);
      isolated.protocol.unhandle('https'); void isolated.clearStorageData().catch(() => {});
    });
    try {
      await window.loadURL(url);
      assertActive(); this.assertCurrent(owner, revision);
      if (window.isDestroyed()) throw new Error(tr('Предпросмотр закрыт'));
      window.show(); window.focus(); return { kind: 'pdf' };
    } catch (error) { retire(); throw error; }
  }
}
module.exports = { AttachmentPreviews };

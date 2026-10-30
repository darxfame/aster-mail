// Compose windows share the active transport, never credentials or account switching.
const path = require('node:path');
const allowed = new Set(['composeContext', 'composeReady', 'closeCompose', 'contacts', 'identity', 'signature', 'personPhoto', 'contentImages', 'openLink', 'send', 'draft', 'editDraft']);
class ComposeWindows {
  constructor({ BrowserWindow, dialog, page, tr }) {
    Object.assign(this, { BrowserWindow, dialog, page, tr });
    this.entries = new Map();
  }
  authorize(sender, frame, operation, sessionId) {
    const entry = this.entries.get(sender);
    if (!entry || frame !== sender.mainFrame || !allowed.has(operation) || sessionId && sessionId !== entry.sessionId) throw new Error('Untrusted compose request');
    return entry;
  }
  confirm(entry) {
    if (entry.busy) return false;
    if (!entry.dirty) return true;
    return this.dialog.showMessageBoxSync(entry.window, { type: 'warning', message: this.tr('Есть несохранённые изменения'), detail: this.tr('Сохраните письмо или встречу перед выходом. Продолжить без сохранения?'), buttons: [this.tr('Остаться'), this.tr('Не сохранять')], defaultId: 0, cancelId: 0 }) === 1;
  }
  confirmAll() { return [...this.entries.values()].every(entry => this.confirm(entry)); }
  destroyAll() { for (const entry of this.entries.values()) entry.window.destroy(); this.entries.clear(); }
  create(context, zoom) {
    // A server draft must have only one detached editor to avoid conflicting saves.
    const draftId = context.snapshot.data.draftReference?.id;
    if (draftId && [...this.entries.values()].some(entry => entry.draftId === draftId)) throw new Error(this.tr('Этот черновик уже открыт в отдельном окне'));
    const child = new this.BrowserWindow({ width: 960, height: 800, minWidth: 480, minHeight: 400, show: false, title: 'Aster Mail', backgroundColor: '#f7f8fb',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const sender = child.webContents;
    const entry = { window: child, sessionId: context.account?.sessionId, context, demo: context.demo, draftId, dirty: context.snapshot.dirty, busy: false };
    this.entries.set(child.webContents, entry);
    child.webContents.setZoomFactor(zoom);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', event => event.preventDefault());
    child.webContents.on('will-prevent-unload', event => { if (this.confirm(entry)) event.preventDefault(); });
    child.on('close', event => { if (entry.busy) event.preventDefault(); });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(this.tr('Не удалось открыть окно письма'))); child.destroy(); }, 30000);
      entry.ready = () => { clearTimeout(timer); child.show(); child.focus(); resolve(true); delete entry.context; };
      child.on('closed', () => { clearTimeout(timer); this.entries.delete(sender); reject(new Error(this.tr('Окно письма закрыто'))); });
      child.webContents.on('render-process-gone', () => child.destroy());
      child.loadFile(this.page, { hash: 'compose' }).catch(() => child.destroy());
    });
  }
}
module.exports = { ComposeWindows, allowed };

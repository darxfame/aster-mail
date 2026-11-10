const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const tr = require('../src/i18n.js').text;

// Remote traffic stays in Updates. Squirrel receives only the already verified ZIP.
class MacUpdates {
  constructor({ autoUpdater, appPath, restart, staged = () => {}, run = execute, timeout = 180000 }) {
    Object.assign(this, { autoUpdater, appPath, restart, onStaged: staged, run, timeout });
    // Native errors can arrive after cancellation or quitAndInstall returns.
    autoUpdater.on('error', error => { this.error = error; });
    autoUpdater.on('update-downloaded', () => {
      if (!this.awaitingDigest) return;
      this.staged = this.awaitingDigest; this.awaitingDigest = null; this.onStaged();
    });
  }
  async install(handle, asset, signal) {
    signal.throwIfAborted();
    if (this.staged) {
      if (this.staged !== asset.sha256) throw new Error(tr('Перезапустите приложение перед другим обновлением'));
      return this.restart(signal);
    }
    if (this.pending || this.timedOut) throw new Error(tr('Перезапустите приложение перед другим обновлением'));
    // A damaged or ad hoc installed copy must never become an update trust root.
    await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', this.appPath]);
    const { stdout, stderr } = await this.run('/usr/bin/codesign', ['--display', '--requirements', '-', this.appPath]);
    if (!/certificate leaf = H"94449af39dabd49526a09ae19047190ec2d165e8"/.test(`${stdout}\n${stderr}`)) throw new Error(tr('Для обновления нужна установленная версия с постоянной подписью Aster'));
    signal.throwIfAborted();
    const token = crypto.randomBytes(32).toString('hex');
    let base;
    const server = http.createServer((request, response) => {
      if (signal.aborted || request.method !== 'GET' || request.headers.host !== new URL(base).host) { response.writeHead(403).end(); return; }
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === `/${token}/feed`) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ url: `${base}/${token}/update.zip`, name: asset.version }));
      } else if (request.url === `/${token}/update.zip`) {
        response.setHeader('Content-Type', 'application/zip');
        response.setHeader('Content-Length', asset.size);
        const stream = handle.createReadStream({ start: 0, autoClose: false });
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      } else response.writeHead(404).end();
    });
    this.pending = true;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      base = `http://127.0.0.1:${server.address().port}`;
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); this.autoUpdater.removeListener('update-downloaded', downloaded); this.autoUpdater.removeListener('error', failed); this.autoUpdater.removeListener('update-not-available', missing); };
        const downloaded = () => { cleanup(); resolve(); };
        const failed = error => { if (!this.timedOut) this.awaitingDigest = null; cleanup(); reject(error); };
        const missing = () => failed(new Error(tr('Обновление не подготовлено')));
        const timer = setTimeout(() => { this.timedOut = true; failed(new Error(tr('Подготовка обновления не завершена. Перезапустите приложение.'))); }, this.timeout);
        this.autoUpdater.once('update-downloaded', downloaded);
        this.autoUpdater.once('error', failed);
        this.autoUpdater.once('update-not-available', missing);
        try {
          this.awaitingDigest = asset.sha256;
          this.autoUpdater.setFeedURL({ url: `${base}/${token}/feed` });
          this.autoUpdater.checkForUpdates();
        } catch (error) { failed(error); }
      });
    } finally {
      server.closeAllConnections(); server.close(); this.pending = false;
    }
    signal.throwIfAborted();
    return this.restart(signal);
  }
}

function applicationPath(resourcesPath) { return path.dirname(path.dirname(resourcesPath)); }
module.exports = { MacUpdates, applicationPath };

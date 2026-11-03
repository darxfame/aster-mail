const tr = require('../src/i18n.js').text;
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { constants } = require('node:fs');
const repository = 'darxfame/aster-mail';
const apiURL = `https://api.github.com/repos/${repository}/releases/latest`;
const maxSize = 500 * 1024 * 1024;
function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error(tr('Некорректная версия релиза'));
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(tr('Некорректная версия релиза'));
  return parts;
}
function newer(candidate, installed) {
  const a = version(candidate), b = version(installed);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseInfo(release, installed, platform, arch) {
  if (release.draft || release.prerelease) throw new Error(tr('Доступен только стабильный опубликованный релиз'));
  const number = String(release.tag_name || '').replace(/^v/, '');
  if (!newer(number, installed)) return null;
  const target = platform === 'darwin' && arch === 'arm64' ? 'mac-arm64.dmg' : platform === 'win32' && arch === 'x64' ? 'windows-x64.exe' : null;
  if (!target) throw new Error(tr('Для этой платформы пока нет установщика'));
  const name = `Aster-Mail-${number}-${target}`;
  const url = `https://github.com/${repository}/releases/download/v${number}/${name}`;
  const asset = release.assets?.find(asset => asset.name === name && asset.state === 'uploaded');
  if (!asset || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxSize || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error(tr('У релиза нет подходящего установщика с SHA-256'));
  return { version: number, name, url, size: asset.size, sha256: asset.digest.slice(7), notes: String(release.body || '').slice(0, 12000) };
}
function allowedURL(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname);
}
async function request(fetch, url, signal, headers = {}) {
  for (let i = 0; i < 6; i++) {
    if (!allowedURL(url)) throw new Error(tr('Недопустимый адрес загрузки'));
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: url === apiURL ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'Aster-Mail', ...headers } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(tr('Некорректное перенаправление GitHub'));
      url = new URL(location, url).href; continue;
    }
    if (!response.ok && !(response.status === 416 && headers.Range)) {
      await response.body?.cancel();
      throw Object.assign(new Error(`GitHub: HTTP ${response.status}`), { retryable: [408, 429, 500, 502, 503, 504].includes(response.status) });
    }
    return response;
  }
  throw new Error(tr('Слишком много перенаправлений GitHub'));
}
// Race the operation too: an injected or stalled transport need not honour abort.
function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
function retryableNetwork(error) {
  if (error.retryable !== undefined) return error.retryable;
  const code = error.code || error.cause?.code;
  if (code) return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code);
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}
class Updates {
  constructor({ directory, installed, platform = process.platform, arch = process.arch, fetch, changed = () => {}, open, headerTimeout = 60000, idleTimeout = 120000, retryDelays = [1000, 3000] }) {
    Object.assign(this, { directory, installed, platform, arch, fetch, changed, open, headerTimeout, idleTimeout, retryDelays });
    this.state = { installed, status: 'idle', autoCheck: true, lastChecked: null, available: null, progress: 0, received: 0, speed: 0, retryAt: null, error: '' };
    this.busy = false;
  }
  snapshot() { return structuredClone(this.state); }
  publish(values) { Object.assign(this.state, values); this.changed(this.snapshot()); return this.snapshot(); }
  async initialize() {
    try { const saved = JSON.parse(await fs.readFile(path.join(this.directory, 'preferences.json'), 'utf8')); this.state.autoCheck = saved.autoCheck !== false; } catch { /* Default on first launch. */ }
  }
  async preferences(autoCheck) {
    if (typeof autoCheck !== 'boolean') throw new Error(tr('Некорректная настройка обновлений'));
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(path.join(this.directory, 'preferences.json'), JSON.stringify({ autoCheck }), { mode: 0o600 });
    return this.publish({ autoCheck });
  }
  async checkAutomatically(now = Date.now()) {
    if (!this.state.autoCheck || this.busy) return this.snapshot();
    if (this.lastAutomaticAttempt !== undefined && now - this.lastAutomaticAttempt < 60000) return this.snapshot();
    const checked = Date.parse(this.state.lastChecked);
    if (!this.state.error && Number.isFinite(checked) && now - checked < 6 * 60 * 60000) return this.snapshot();
    this.lastAutomaticAttempt = now;
    return this.check();
  }
  async check() {
    if (this.busy) return this.snapshot();
    this.busy = true;
    const previous = this.state.status;
    this.publish({ status: 'checking', error: '' });
    try {
      const response = await request(this.fetch, apiURL, AbortSignal.timeout(30000));
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) throw new Error(tr('Слишком большой ответ GitHub')); chunks.push(Buffer.from(chunk)); }
      const available = releaseInfo(JSON.parse(Buffer.concat(chunks).toString('utf8')), this.installed, this.platform, this.arch);
      const same = this.state.available?.sha256 === available?.sha256 && this.state.available?.name === available?.name && this.state.available?.size === available?.size;
      const ready = previous === 'ready' && same;
      return this.publish({ available, status: ready ? 'ready' : previous === 'paused' && same ? 'paused' : available ? 'available' : 'current', lastChecked: new Date().toISOString(), progress: ready ? 100 : same ? this.state.progress : 0, received: same ? this.state.received : 0, speed: 0, retryAt: null });
    } catch (error) { return this.publish({ status: previous, error: error.message }); }
    finally { this.busy = false; }
  }
  async pauseDownload() {
    if (this.downloadController) {
      this.downloadController.abort(Object.assign(new Error(tr('Загрузка приостановлена')), { paused: true }));
      await this.downloadFinished;
    }
    return this.snapshot();
  }
  async cancelDownload() {
    if (this.downloadController) {
      this.downloadController.abort(Object.assign(new Error(tr('Загрузка отменена')), { cancelled: true }));
      await this.downloadFinished;
      return this.snapshot();
    }
    if (this.busy) return this.snapshot();
    if (this.partialAsset) await fs.rm(path.join(this.directory, `${this.partialAsset.name}.part`), { force: true });
    this.partialAsset = null;
    if (this.state.status === 'paused') this.publish({ status: 'available', progress: 0, received: 0, speed: 0, retryAt: null, error: '' });
    return this.snapshot();
  }
  async download() {
    if (this.busy) return this.snapshot();
    const asset = this.state.available;
    if (!asset) throw new Error(tr('Сначала проверьте обновления'));
    this.busy = true;
    const partial = path.join(this.directory, `${asset.name}.part`), final = path.join(this.directory, asset.name);
    const controller = new AbortController();
    this.downloadController = controller;
    let finished;
    this.downloadFinished = new Promise(resolve => { finished = resolve; });
    let handle, received = 0;
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const same = this.partialAsset?.name === asset.name && this.partialAsset?.sha256 === asset.sha256 && this.partialAsset?.size === asset.size;
      if (same) {
        const stat = await fs.lstat(partial);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > asset.size) throw new Error(tr('Некорректный частичный файл обновления'));
        handle = await fs.open(partial, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
        const opened = await handle.stat();
        if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error(tr('Некорректный частичный файл обновления'));
        received = opened.size;
      } else {
        if (this.partialAsset) await fs.rm(path.join(this.directory, `${this.partialAsset.name}.part`), { force: true });
        await fs.rm(partial, { force: true });
        handle = await fs.open(partial, 'wx+', 0o600);
      }
      this.partialAsset = { ...asset };
      this.publish({ status: 'downloading', received, progress: Math.floor(received * 100 / asset.size), speed: 0, retryAt: null, error: '' });
      for (let attempt = 0; ; attempt++) {
        const connection = new AbortController();
        const signal = AbortSignal.any([controller.signal, connection.signal]);
        let timer, reader;
        const arm = delay => {
          clearTimeout(timer);
          timer = setTimeout(() => connection.abort(Object.assign(new Error(tr('Нет данных от сервера обновлений')), { retryable: true })), delay);
        };
        try {
          arm(this.headerTimeout);
          const response = await abortable(request(this.fetch, asset.url, signal, received ? { Range: `bytes=${received}-` } : {}), signal);
          clearTimeout(timer);
          reader = response.body?.getReader();
          const declared = response.headers.get('content-length');
          if (response.status === 416) {
            if (received !== asset.size || response.headers.get('content-range') !== `bytes */${asset.size}`) throw new Error(tr('Некорректный диапазон установщика'));
            break;
          }
          if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
            if (!range || Number(range[1]) !== received || Number(range[2]) !== asset.size - 1 || Number(range[3]) !== asset.size) throw new Error(tr('Некорректный диапазон установщика'));
          } else if (response.status === 200) {
            received = 0; await handle.truncate(0);
            this.publish({ received: 0, progress: 0 });
          } else throw new Error(tr('Некорректный ответ сервера обновлений'));
          if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== asset.size - received)) throw new Error(tr('Размер установщика не совпадает'));
          if (!reader) throw new Error(tr('Некорректный ответ сервера обновлений'));
          let measured = received, measuredAt = Date.now();
          while (true) {
            arm(this.idleTimeout);
            let item;
            try { item = await abortable(reader.read(), signal); }
            catch (error) { throw Object.assign(error, { retryable: !controller.signal.aborted }); }
            clearTimeout(timer);
            controller.signal.throwIfAborted();
            if (item.done) break;
            if (!item.value.length) continue;
            if (received + item.value.length > asset.size) throw new Error(tr('Размер установщика превышен'));
            // Explicit positions keep resumed writes independent of the handle cursor.
            let written = 0;
            while (written < item.value.length) {
              const result = await handle.write(item.value, written, item.value.length - written, received + written);
              if (!result.bytesWritten) throw new Error(tr('Не удалось записать установщик'));
              written += result.bytesWritten;
            }
            received += written;
            const now = Date.now(), progress = Math.floor(received * 100 / asset.size);
            if (now - measuredAt >= 500 || progress !== this.state.progress) {
              this.publish({ received, progress, speed: Math.round((received - measured) * 1000 / Math.max(1, now - measuredAt)), retryAt: null });
              measured = received; measuredAt = now;
            }
          }
          if (received !== asset.size) throw Object.assign(new Error(tr('Загрузка установщика прервалась')), { retryable: true });
          break;
        } catch (error) {
          const failure = controller.signal.aborted ? controller.signal.reason : connection.signal.aborted ? connection.signal.reason : error;
          if (failure.paused || failure.cancelled || !retryableNetwork(failure) || attempt >= this.retryDelays.length) throw failure;
          const delay = this.retryDelays[attempt];
          this.publish({ retryAt: Date.now() + delay, speed: 0 });
          let retryTimer;
          try { await abortable(new Promise(resolve => { retryTimer = setTimeout(resolve, delay); }), controller.signal); }
          finally { clearTimeout(retryTimer); }
        } finally {
          clearTimeout(timer);
          // Do not wait for a broken transport to acknowledge cancellation.
          if (reader) void reader.cancel().catch(() => {});
          connection.abort();
        }
      }
      controller.signal.throwIfAborted();
      const hash = crypto.createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) { controller.signal.throwIfAborted(); hash.update(chunk); }
      if (hash.digest('hex') !== asset.sha256) throw new Error(tr('Проверка SHA-256 установщика не пройдена'));
      await handle.close(); handle = null;
      controller.signal.throwIfAborted();
      await fs.rename(partial, final);
      this.partialAsset = null;
      // Only old installers in this dedicated cache may be removed.
      for (const name of await fs.readdir(this.directory)) if (name !== asset.name && /^Aster-Mail-\d+\.\d+\.\d+-(mac-arm64\.dmg|windows-x64\.exe)(\.part)?$/.test(name)) await fs.rm(path.join(this.directory, name), { force: true });
      return this.publish({ status: 'ready', progress: 100, received: asset.size, speed: 0, retryAt: null });
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      const preserve = this.partialAsset && (error.paused || retryableNetwork(error)) && !error.cancelled;
      if (!preserve) { await fs.rm(partial, { force: true }).catch(() => {}); this.partialAsset = null; }
      return this.publish({ status: preserve ? 'paused' : 'available', progress: preserve ? Math.floor(received * 100 / asset.size) : 0, received: preserve ? received : 0, speed: 0, retryAt: null, error: error.paused || error.cancelled ? '' : error.message });
    } finally { this.downloadController = null; this.busy = false; finished(); }
  }
  async openInstaller() {
    if (this.busy || this.state.status !== 'ready') throw new Error(tr('Установщик ещё не готов'));
    const asset = this.state.available, file = path.join(this.directory, asset.name);
    this.busy = true;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size) throw new Error(tr('Установщик изменён; скачайте его заново'));
      const handle = await fs.open(file, 'r');
      let digest;
      try { const hash = crypto.createHash('sha256'); for await (const chunk of handle.createReadStream()) hash.update(chunk); digest = hash.digest('hex'); }
      finally { await handle.close(); }
      if (digest !== asset.sha256) throw new Error(tr('Установщик изменён; скачайте его заново'));
      const error = await this.open(file);
      if (error) throw new Error(error);
      return this.snapshot();
    } catch (error) { this.publish({ status: 'available', error: error.message }); throw error; }
    finally { this.busy = false; }
  }
}
module.exports = { Updates, newer, releaseInfo, allowedURL, request, apiURL };

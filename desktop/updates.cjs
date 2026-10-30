const tr = require('../src/i18n.js').text;
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
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
async function request(fetch, url, signal) {
  for (let i = 0; i < 6; i++) {
    if (!allowedURL(url)) throw new Error(tr('Недопустимый адрес загрузки'));
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: url === apiURL ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'Aster-Mail' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(tr('Некорректное перенаправление GitHub'));
      url = new URL(location, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub: HTTP ${response.status}`); }
    return response;
  }
  throw new Error(tr('Слишком много перенаправлений GitHub'));
}
class Updates {
  constructor({ directory, installed, platform = process.platform, arch = process.arch, fetch, changed = () => {}, open }) {
    Object.assign(this, { directory, installed, platform, arch, fetch, changed, open });
    this.state = { installed, status: 'idle', autoCheck: true, lastChecked: null, available: null, progress: 0, error: '' };
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
      const ready = previous === 'ready' && this.state.available?.sha256 === available?.sha256;
      return this.publish({ available, status: ready ? 'ready' : available ? 'available' : 'current', lastChecked: new Date().toISOString(), progress: ready ? 100 : 0 });
    } catch (error) { return this.publish({ status: previous, error: error.message }); }
    finally { this.busy = false; }
  }
  async download() {
    if (this.busy) return this.snapshot();
    const asset = this.state.available;
    if (!asset) throw new Error(tr('Сначала проверьте обновления'));
    this.busy = true;
    const partial = path.join(this.directory, `${asset.name}.part`), final = path.join(this.directory, asset.name);
    this.publish({ status: 'downloading', progress: 0, error: '' });
    let handle;
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.rm(partial, { force: true });
      handle = await fs.open(partial, 'wx', 0o600);
      const response = await request(this.fetch, asset.url, AbortSignal.timeout(15 * 60000));
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) !== asset.size) throw new Error(tr('Размер установщика не совпадает'));
      const hash = crypto.createHash('sha256'); let received = 0, percent = -1;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > asset.size) throw new Error(tr('Размер установщика превышен'));
        hash.update(chunk); await handle.writeFile(chunk);
        const next = Math.floor(received * 100 / asset.size);
        if (next !== percent) { percent = next; this.publish({ progress: next }); }
      }
      if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error(tr('Проверка SHA-256 установщика не пройдена'));
      await handle.close(); handle = null;
      await fs.rename(partial, final);
      // Only old installers in this dedicated cache may be removed.
      for (const name of await fs.readdir(this.directory)) if (name !== asset.name && /^Aster-Mail-\d+\.\d+\.\d+-(mac-arm64\.dmg|windows-x64\.exe)(\.part)?$/.test(name)) await fs.rm(path.join(this.directory, name), { force: true });
      return this.publish({ status: 'ready', progress: 100 });
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(partial, { force: true }).catch(() => {});
      return this.publish({ status: 'available', progress: 0, error: error.message });
    } finally { this.busy = false; }
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

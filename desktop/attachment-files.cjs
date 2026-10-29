const tr = require('../src/i18n.js').text;
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { writeAttachment } = require('./attachment-trust.cjs');

const openExtensions = new Set(['.pdf', '.txt', '.log', '.md', '.json', '.csv', '.rtf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.eml', '.msg', '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.pages', '.numbers', '.key']);
function safeName(value) {
  const name = String(value || '').split(/[\\/]/).at(-1).replace(/[<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/, '').slice(-180);
  if (!name || /^\.+$/.test(name)) throw new Error(tr('Некорректное имя вложения'));
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
class AttachmentFiles {
  constructor(directory, openPath, { now = Date.now, maxFiles = 20, maxBytes = 100 * 1024 * 1024, maxAge = 30 * 60000, write = writeAttachment } = {}) {
    Object.assign(this, { directory, openPath, now, maxFiles, maxBytes, maxAge, write });
    this.generation = 0; this.queue = Promise.resolve();
  }
  run(action) {
    const task = this.queue.then(action); this.queue = task.catch(() => {}); return task;
  }
  async retained() {
    let names;
    try { names = await fs.readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const entries = [];
    for (const name of names) {
      const directory = path.join(this.directory, name), stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !/^file-/.test(name)) throw new Error(tr('Некорректный каталог временных вложений'));
      let size = 0;
      for (const file of await fs.readdir(directory)) {
        const info = await fs.lstat(path.join(directory, file));
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(tr('Некорректная временная копия вложения'));
        size += info.size;
      }
      entries.push({ directory, size, at: stat.mtimeMs });
    }
    return entries;
  }
  cleanupExpired() {
    return this.run(async () => {
      const entries = await this.retained();
      const results = await Promise.allSettled(entries.filter(entry => this.now() - entry.at >= this.maxAge).map(entry => fs.rm(entry.directory, { recursive: true, force: true })));
      if (results.some(result => result.status === 'rejected')) throw new Error(tr('Не удалось удалить временные вложения. Закройте их во внешних приложениях и повторите очистку.'));
    });
  }
  clear() {
    this.generation++;
    return this.run(async () => {
      try { await fs.rm(this.directory, { recursive: true, force: true }); }
      catch { throw new Error(tr('Не удалось удалить временные вложения. Закройте их во внешних приложениях и повторите выход или сброс.')); }
    });
  }
  clearSync() {
    this.generation++;
    fsSync.rmSync(this.directory, { recursive: true, force: true });
  }
  async open({ name, load, assertActive }) {
    name = safeName(name);
    if (!openExtensions.has(path.extname(name).toLowerCase())) throw new Error(tr('Этот тип вложения можно только сохранить через «Сохранить как…».'));
    const generation = this.generation;
    const check = () => { assertActive(); if (generation !== this.generation) throw new Error(tr('Сессия аккаунта завершена')); };
    const bytes = await load(); check();
    if (!Buffer.isBuffer(bytes) || bytes.length > 30 * 1024 * 1024) throw new Error(tr('Некорректное или слишком большое вложение'));
    await this.cleanupExpired(); check();
    return this.run(async () => {
      check();
      const retained = await this.retained(); check();
      if (retained.length >= this.maxFiles || retained.reduce((sum, entry) => sum + entry.size, 0) + bytes.length > this.maxBytes) throw new Error(tr('Лимит временных вложений достигнут. Закройте файлы и выполните выход или сброс локальных данных.'));
      let directory;
      try {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); check();
        directory = await fs.mkdtemp(path.join(this.directory, 'file-')); check();
        const file = path.join(directory, name);
        await this.write(file, bytes, { assertActive: check }); check();
        const error = await this.openPath(file); check();
        if (error) throw new Error(tr('Не удалось открыть вложение. Установите приложение для этого типа файла или используйте «Сохранить как…».'));
        return true;
      } catch (error) {
        if (directory) {
          try { await fs.rm(directory, { recursive: true, force: true }); }
          catch { throw new Error(`${error.message} ${tr("Временная копия не удалена; закройте файл и повторите очистку.")}`); }
        }
        throw error;
      }
    });
  }
}
module.exports = { AttachmentFiles, safeName };

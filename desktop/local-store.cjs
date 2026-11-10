const tr = require('../src/i18n.js').text;
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// All disk mutations share one queue: logout deletion cannot be overtaken by an old save.
class LocalStore {
  constructor(directory, encryption, platform = process.platform) {
    this.directory = directory; this.encryption = encryption; this.platform = platform;
    this.owner = null; this.data = {}; this.queue = Promise.resolve();
  }
  async requireEncryption() {
    if (!await this.encryption.isEncryptionAvailable() || this.platform === 'linux' && this.encryption.getSelectedStorageBackend() === 'basic_text') throw new Error(tr('Защищённое хранилище недоступно. Данные не сохранены.'));
  }
  run(action) {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  async write(name, value, guard) {
    guard(); await this.requireEncryption(); guard();
    const encrypted = await this.encryption.encryptString(JSON.stringify(value)); guard();
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); guard();
    const temporary = path.join(this.directory, `${name}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      guard(); await fs.rename(temporary, path.join(this.directory, name));
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async read(name, guard) {
    const bytes = await fs.readFile(path.join(this.directory, name)); guard();
    await this.requireEncryption(); guard();
    const value = JSON.parse(await this.encryption.decryptString(bytes)); guard();
    // Replace one file atomically only after successful decryption and while its
    // original session is still current. Failure leaves the legacy file intact.
    if (this.encryption.needsMigration?.(bytes)) await this.write(name, value, guard);
    return value;
  }
  migrate(guard = () => {}) {
    return this.run(async () => {
      if (!this.encryption.needsMigration) return;
      guard();
      try { await fs.lstat(path.join(this.directory, 'logout.pending')); return; }
      catch (error) { if (error.code !== 'ENOENT') return; }
      // Migrate healthy legacy files during the first restore, including settings
      // that cannot otherwise be read until Exchange reconnects. A damaged file
      // keeps its original bytes and is reported by its ordinary read operation.
      for (const name of ['account.enc', 'login-hint.enc', 'local-data.enc']) {
        guard();
        try {
          const bytes = await fs.readFile(path.join(this.directory, name)); guard();
          if (this.encryption.needsMigration(bytes)) await this.read(name, guard);
        } catch { guard(); }
      }
    });
  }
  load(owner, guard = () => {}) {
    return this.run(async () => {
      guard(); this.owner = owner; this.data = {};
      try {
        const saved = await this.read('local-data.enc', guard);
        if (saved.owner === owner) this.data = saved.data || {};
        else await fs.rm(path.join(this.directory, 'local-data.enc'), { force: true });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      guard(); return structuredClone(this.data);
    });
  }
  save(patch, guard) {
    return this.run(async () => {
      guard();
      if (!this.owner || !patch || typeof patch !== 'object' || JSON.stringify(patch).length > 256000) throw new Error(tr('Некорректные локальные настройки'));
      if (patch.values !== undefined && (!patch.values || typeof patch.values !== 'object' || Array.isArray(patch.values) || Object.entries(patch.values).some(([key, value]) => !key.startsWith('aster-') || typeof value !== 'string'))) throw new Error(tr('Некорректные локальные настройки'));
      const next = { ...this.data, ...patch };
      await this.write('local-data.enc', { owner: this.owner, data: next }, guard);
      guard(); this.data = next;
    });
  }
  loadCredentials(guard = () => {}) {
    return this.run(async () => {
      guard();
      try { await fs.lstat(path.join(this.directory, 'logout.pending')); return null; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try {
        return await this.read('account.enc', guard);
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    });
  }
  saveCredentials(account, guard) {
    return this.run(async () => {
      await this.write('account.enc', account, guard); guard();
      await fs.rm(path.join(this.directory, 'logout.pending'), { force: true });
    });
  }
  removeCredentials(guard) { return this.run(() => { guard(); return fs.rm(path.join(this.directory, 'account.enc'), { force: true }); }); }
  // The profile is available before authentication, but contains no password.
  saveLoginHint(account, guard) {
    return this.run(async () => {
      await this.write('login-hint.enc', this.loginHint(account), guard);
      guard(); await fs.rm(path.join(this.directory, 'login-hint.json'), { force: true });
    });
  }
  loginHint(value) {
    if (typeof value?.username !== 'string' || !value.username.trim() || value.username.length > 1024) throw new Error(tr('Укажите логин и пароль'));
    return { server: require('../src/server.js').normalize(value.server), username: value.username.trim() };
  }
  loadLoginHint(guard = () => {}) {
    return this.run(async () => {
      guard();
      // Discard the short-lived plaintext format instead of trusting its server address.
      await fs.rm(path.join(this.directory, 'login-hint.json'), { force: true }); guard();
      try {
        try { await fs.lstat(path.join(this.directory, 'logout.pending')); return null; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const value = this.loginHint(await this.read('login-hint.enc', guard));
        guard(); return value;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    });
  }
  clear() {
    return this.run(async () => {
      this.owner = null; this.data = {};
      // Revoke before any enumeration: readdir can fail while writes still work.
      try { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); }
      catch { throw new Error(tr('Не удалось удалить локальные данные и заблокировать автовход. Проверьте права на каталог приложения и повторите сброс перед закрытием Aster.')); }
      let markerError;
      try { await fs.writeFile(path.join(this.directory, 'logout.pending'), 'revoked\n', { mode: 0o600 }); }
      catch (error) { markerError = error; }
      let names;
      try { names = await fs.readdir(this.directory); }
      catch { throw new Error(markerError ? tr('Не удалось удалить локальные данные и заблокировать автовход. Проверьте права на каталог приложения и повторите сброс перед закрытием Aster.') : tr('Автовход заблокирован. Не удалось прочитать каталог приложения; повторите сброс локальных данных.')); }
      const files = names.filter(name => ['local-data.enc', 'account.enc', 'notifications.json', 'login-hint.json', 'login-hint.enc'].includes(name) || /^(?:(?:local-data|account|login-hint)\.enc|login-hint\.json)\.[0-9a-f-]+\.tmp$/.test(name));
      const results = await Promise.allSettled(files.map(name => fs.rm(path.join(this.directory, name), { force: true })));
      if (results.some(result => result.status === 'rejected')) {
        throw new Error(markerError ? tr('Не удалось удалить локальные данные и заблокировать автовход. Проверьте права на каталог приложения и повторите сброс перед закрытием Aster.') : tr('Сессия завершена, автовход заблокирован. Не удалось удалить часть локальных данных; повторите сброс в окне подключения.'));
      }
      await fs.rm(path.join(this.directory, 'logout.pending'), { force: true });
    });
  }
}
module.exports = { LocalStore };

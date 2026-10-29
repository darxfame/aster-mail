const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// All disk mutations share one queue: logout deletion cannot be overtaken by an old save.
class LocalStore {
  constructor(directory, encryption, platform = process.platform) {
    this.directory = directory; this.encryption = encryption; this.platform = platform;
    this.owner = null; this.data = {}; this.queue = Promise.resolve();
  }
  requireEncryption() {
    if (!this.encryption.isEncryptionAvailable() || this.platform === 'linux' && this.encryption.getSelectedStorageBackend() === 'basic_text') throw new Error('Защищённое хранилище недоступно. Данные не сохранены.');
  }
  run(action) {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  async write(name, value, guard) {
    guard(); this.requireEncryption();
    const encrypted = this.encryption.encryptString(JSON.stringify(value));
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); guard();
    const temporary = path.join(this.directory, `${name}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      guard(); await fs.rename(temporary, path.join(this.directory, name));
    } finally { await fs.rm(temporary, { force: true }); }
  }
  load(owner, guard = () => {}) {
    return this.run(async () => {
      guard(); this.owner = owner; this.data = {};
      try {
        const bytes = await fs.readFile(path.join(this.directory, 'local-data.enc')); guard();
        this.requireEncryption();
        const saved = JSON.parse(this.encryption.decryptString(bytes));
        if (saved.owner === owner) this.data = saved.data || {};
        else await fs.rm(path.join(this.directory, 'local-data.enc'), { force: true });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      guard(); return structuredClone(this.data);
    });
  }
  save(patch, guard) {
    return this.run(async () => {
      guard();
      if (!this.owner || !patch || typeof patch !== 'object' || JSON.stringify(patch).length > 256000) throw new Error('Некорректные локальные настройки');
      if (patch.values !== undefined && (!patch.values || typeof patch.values !== 'object' || Array.isArray(patch.values) || Object.entries(patch.values).some(([key, value]) => !key.startsWith('aster-') || typeof value !== 'string'))) throw new Error('Некорректные локальные настройки');
      const next = { ...this.data, ...patch };
      await this.write('local-data.enc', { owner: this.owner, data: next }, guard);
      guard(); this.data = next;
    });
  }
  saveCredentials(account, guard) { return this.run(() => this.write('account.enc', account, guard)); }
  removeCredentials(guard) { return this.run(() => { guard(); return fs.rm(path.join(this.directory, 'account.enc'), { force: true }); }); }
  clear() {
    return this.run(async () => {
      this.owner = null; this.data = {};
      let names;
      try { names = await fs.readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      const files = names.filter(name => ['local-data.enc', 'account.enc', 'notifications.json'].includes(name) || /^(?:local-data|account)\.enc\.[0-9a-f-]+\.tmp$/.test(name));
      await Promise.all(files.map(name => fs.rm(path.join(this.directory, name), { force: true })));
    });
  }
}
module.exports = { LocalStore };

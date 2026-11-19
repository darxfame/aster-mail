const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class ThemeStore {
  constructor(file) {
    this.file = file;
    this.pending = Promise.resolve();
  }

  async read() {
    await this.pending;
    return this.load();
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const id = mode => typeof saved?.[mode] === 'string' && /^[a-z][a-z0-9.-]{2,79}$/.test(saved[mode]) ? saved[mode] : null;
      return { light: id('light'), dark: id('dark') };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      return { light: null, dark: null };
    }
  }

  change(action, value, guard = () => {}) {
    const pending = this.pending.then(async () => {
      if (action === 'clear') return fs.rm(this.file, { force: true });
      const current = await this.load();
      guard();
      const next = action === 'select' ? value : {
        light: current.light === value ? null : current.light,
        dark: current.dark === value ? null : current.dark,
      };
      if (next.light === current.light && next.dark === current.dark) return;
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        guard();
        await fs.rename(temporary, this.file);
      } finally { await fs.rm(temporary, { force: true }); }
    });
    this.pending = pending.catch(() => {});
    return pending;
  }
}

module.exports = { ThemeStore };

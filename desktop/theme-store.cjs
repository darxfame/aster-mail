const fs = require('node:fs/promises');
const { O_RDONLY, O_NONBLOCK } = require('node:fs').constants;
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { maxBytes, normalize } = require('../src/theme-sdk.js');

const empty = () => ({ themes: [], selected: null });

async function readTheme(filePath) {
  const file = await fs.open(filePath, O_RDONLY | O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('format');
    const chunks = [];
    for await (const chunk of file.createReadStream({ end: maxBytes, autoClose: false })) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (bytes.length > maxBytes) throw new Error('format');
    const json = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return normalize(JSON.parse(json));
  } finally { await file.close(); }
}

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
      const themes = saved.themes.map(normalize);
      return { themes, selected: themes.some(theme => theme.id === saved.selected) ? saved.selected : null };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      return empty();
    }
  }

  change(action, value) {
    const pending = this.pending.then(async () => {
      if (action === 'clear') {
        await fs.rm(this.file, { force: true });
        return empty();
      }
      const current = await this.load();
      if (action === 'import') {
        if (current.themes.some(theme => theme.id === value.id)) throw new Error('duplicate');
        if (current.themes.length >= 64) throw new Error('limit');
        current.themes.push(value);
      } else {
        if (value !== null && !current.themes.some(theme => theme.id === value)) throw new Error('format');
        if (action === 'select') current.selected = value;
        else {
          current.themes = current.themes.filter(theme => theme.id !== value);
          if (current.selected === value) current.selected = null;
        }
      }
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(temporary, JSON.stringify(current), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally { await fs.rm(temporary, { force: true }); }
      return current;
    });
    this.pending = pending.catch(() => {});
    return pending;
  }
}

module.exports = { readTheme, ThemeStore };

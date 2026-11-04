const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('./modules.cjs');
const { LocalStore } = require('./local-store.cjs');
const tr = require('../src/i18n.js').text;

// Modules own this encrypted profile independently of Exchange credentials and settings.
class ModuleProfile {
  constructor(directory, packages, encryption, legacyRecords = () => []) {
    this.store = new LocalStore(directory, encryption); this.packages = packages;
    this.loaded = false; this.loading = null; this.legacyRecords = legacyRecords; this.retire();
  }
  retire() { this.controller?.abort(); this.controller = new AbortController(); this.sessionId = crypto.randomUUID(); }
  scope() { return this.loaded ? { sessionId: this.sessionId, signal: this.controller.signal, records: this.store.data.modules || [] } : null; }
  async initialize(guard = () => {}) {
    if (!this.loading) this.loading = this.load().catch(error => { this.loading = null; throw error; });
    await this.loading; guard();
  }
  async load() {
    await this.store.load('aster-modules');
    if (!Object.hasOwn(this.store.data, 'modules')) {
      // Earlier versions stored explicitly installed packages without profile records.
      const records = [], legacy = M.records(this.legacyRecords());
      let folders = [];
      try { folders = await fs.readdir(this.packages, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const folder of folders) {
        if (!folder.isDirectory() || !/^[a-z][a-z0-9.-]{2,79}$/.test(folder.name)) continue;
        let newest;
        for (const version of await fs.readdir(path.join(this.packages, folder.name), { withFileTypes: true })) {
          const match = /^(\d+\.\d+\.\d+)-([a-f0-9]{64})$/.exec(version.name);
          if (!match || !version.isDirectory()) continue;
          const record = { id: folder.name, version: match[1], digest: match[2], enabled: true, data: {} };
          try {
            const bundle = await M.readPackage(M.recordDirectory(this.packages, record));
            if (bundle.digest !== record.digest || bundle.manifest.id !== record.id || bundle.manifest.version !== record.version) continue;
            if (!newest || require('./module-settings.cjs').newer(record.version, newest.version)) newest = { ...record, settingsVersion: bundle.manifest.settingsVersion };
          } catch { /* Invalid legacy copies never become runnable records. */ }
        }
        const previous = legacy.find(record => record.id === folder.name);
        if (previous) {
          try {
            const bundle = await M.readPackage(M.recordDirectory(this.packages, previous));
            if (bundle.digest === previous.digest && bundle.manifest.id === previous.id && bundle.manifest.version === previous.version) newest = { ...previous, settingsVersion: previous.settingsVersion ?? bundle.manifest.settingsVersion };
          } catch { /* Keep only a validated copy; never export an Exchange credential. */ }
        }
        if (newest && records.length < 8) records.push(newest);
      }
      if (records.length) await this.store.save({ modules: records }, () => {});
      else this.store.data.modules = [];
    }
    M.records(this.store.data.modules); this.loaded = true;
  }
  async save(records, sessionId) {
    const guard = () => { if (sessionId !== this.sessionId || this.controller.signal.aborted) throw new Error(tr('Сессия аккаунта завершена')); };
    guard(); await this.store.save({ modules: M.records(records) }, guard); guard();
  }
  async clear() {
    this.retire();
    await this.initialize();
    await this.save([], this.sessionId);
  }
}
module.exports = { ModuleProfile };

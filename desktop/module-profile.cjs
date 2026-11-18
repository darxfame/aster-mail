const crypto = require('node:crypto');
const M = require('./modules.cjs');
const { LocalStore } = require('./local-store.cjs');
const tr = require('../src/i18n.js').text;

// Modules own this encrypted profile independently of Exchange credentials and settings.
class ModuleProfile {
  constructor(directory, packages, encryption, legacyRecords = () => null) {
    this.store = new LocalStore(directory, encryption); this.packages = packages;
    this.loaded = false; this.loading = null; this.legacyRecords = legacyRecords; this.retire();
  }
  retire() { this.controller?.abort(); this.controller = new AbortController(); this.sessionId = crypto.randomUUID(); }
  scope() { return this.loaded ? { sessionId: this.sessionId, signal: this.controller.signal, records: this.store.data.modules || [] } : null; }
  async initialize(guard = () => {}) {
    if (!this.loading) this.loading = this.load().finally(() => { this.loading = null; });
    await this.loading; guard();
  }
  async load() {
    const sessionId = this.sessionId;
    if (!this.loaded) await this.store.load('aster-modules');
    const data = this.store.data;
    const records = Object.hasOwn(data, 'modules') ? M.records(data.modules) : [];
    const excluded = this.legacyExclusions(), legacy = excluded && this.legacyRecords();
    if (legacy?.length) {
      // Only a former profile record can authorize migration. Explicit choices
      // made before Exchange sign-in take precedence over the former profile.
      for (const previous of M.records(legacy)) {
        if (records.length >= 8 || excluded.includes(previous.id) || records.some(record => record.id === previous.id)) continue;
        try {
          const bundle = await M.readPackage(M.recordDirectory(this.packages, previous));
          if (bundle.digest === previous.digest && bundle.manifest.id === previous.id && bundle.manifest.version === previous.version) records.push({ ...previous, settingsVersion: previous.settingsVersion ?? bundle.manifest.settingsVersion });
        } catch { /* An unverified package remains inactive. */ }
      }
      if (records.length) await this.save(records, sessionId, true);
    }
    this.loaded = true;
  }
  legacyExclusions() {
    const data = this.store.data;
    if (Object.hasOwn(data, 'pendingLegacyModuleIds')) return data.pendingLegacyModuleIds;
    return Object.hasOwn(data, 'modules') ? null : [];
  }
  async save(records, sessionId, finishMigration = false) {
    const guard = () => { if (sessionId !== this.sessionId || this.controller.signal.aborted) throw new Error(tr('Сессия аккаунта завершена')); };
    guard();
    const modules = M.records(records), excluded = this.legacyExclusions();
    const pendingLegacyModuleIds = !finishMigration && excluded && this.legacyRecords() === null
      ? [...new Set([...excluded, ...modules.map(record => record.id)])] : null;
    await this.store.save({ modules, pendingLegacyModuleIds }, guard);
    guard();
  }
  async clear() {
    this.retire();
    await this.loading?.catch(() => {});
    await this.initialize();
    await this.save([], this.sessionId, true);
  }
}
module.exports = { ModuleProfile };

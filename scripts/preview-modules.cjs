// Explicit development fixture only: no mailbox transport or keychain is used.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-module-ui-'));
app.setName('Aster Module UI Fixture'); app.setPath('userData', profile);
const M = require('../desktop/modules.cjs');
async function main() {
  const bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  await M.installPackage(path.join(profile, 'modules'), bundle);
  const modules = process.argv.includes('--catalog-fixture') || process.argv.includes('--author-catalog') ? [] : [{ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, enabled: true, data: {} }];
  if (process.argv.includes('--catalog-fixture')) {
    const Github = require('../desktop/module-github.cjs');
    const revision = 'a'.repeat(40), commit = 'b'.repeat(40);
    const catalog = { catalogVersion: 1, modules: [{ manifest: bundle.manifest, description: 'Fictional SDK module for catalog testing only.', commit, directory: 'examples/sandbox-demo', digest: bundle.digest }] };
    Github.getBytes = async (_net, _session, url, limit, signal) => {
      if (signal.aborted) throw new Error('Fixture cancelled');
      let bytes;
      if (url.endsWith('/commits/main')) bytes = Buffer.from(JSON.stringify({ sha: revision }));
      else if (url.endsWith('/catalog.json')) bytes = Buffer.from(JSON.stringify(catalog));
      else if (url.endsWith(`/commits/${commit}`)) bytes = Buffer.from(JSON.stringify({ sha: commit }));
      else bytes = bundle.files.get(url.split('/examples/sandbox-demo/')[1]);
      if (!bytes || bytes.length > limit) throw new Error('Unexpected fixture download');
      return bytes;
    };
  }
  class FixtureStore {
    constructor() { this.data = { modules, values: {} }; }
    requireEncryption() {}
    async load(_owner, guard = () => {}) { guard(); return structuredClone(this.data); }
    async save(patch, guard = () => {}) { guard(); this.data = { ...this.data, ...patch }; }
    async loadCredentials() { return null; }
    async loadLoginHint() { return null; }
    async saveCredentials(_value, guard) { guard(); }
    async saveLoginHint(_value, guard) { guard(); }
    async removeCredentials(guard) { guard(); }
    async clear() { this.data = {}; }
  }
  class FixtureClient {
    constructor(account) { this.account = account; this.photoCache = new Map(); this.mailCache = { generation: 0, clear() { this.generation++; } }; }
    async authenticate() { this.canary = 'fictional'; }
    async folders() { return [{ id: 'inbox', name: 'Fictional inbox', wellKnown: 'inbox', unread: 0, total: 0 }]; }
    async messages() { return { items: [], more: false }; }
    async inboxStatus() { return null; }
    async identity() { return { email: 'fictional@example.test', displayName: 'Fictional account' }; }
    async calendar() { return []; }
    async contacts() { return []; }
    async signature() { return ''; }
    async createEvent() { throw new Error('Fixture: invitations are never sent'); }
    async send() { throw new Error('Fixture: messages are never sent'); }
  }
  function replace(name, value) { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports: value }; }
  replace('../desktop/local-store.cjs', { LocalStore: FixtureStore });
  replace('../desktop/owa.cjs', { OWAClient: FixtureClient });
  console.log('MODULE UI FIXTURE: connect using https://mail.example.test, fictional@example.test and any fictional password. No actual OWA requests or keychain operations.');
  require('../desktop/main.cjs');
}
main().catch(error => { console.error(error); app.exit(1); });

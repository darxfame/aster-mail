const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const tr = require('../src/i18n.js').text;
const magic = Buffer.from('ASTK1');
const maxPlaintext = 1024 * 1024;
const maxFrame = 3 * 1024 * 1024;
const unavailable = () => new Error(tr('Защищённое хранилище недоступно. Данные не сохранены.'));

class KeychainEncryption {
  constructor({ resourcesPath, legacy, manifest = require('./keychain-helper.json'), file, launch = spawn, timeout = 120000 }) {
    Object.assign(this, { legacy, manifest, launch, timeout });
    this.file = file || path.join(resourcesPath, 'keychain', manifest.file);
    this.pending = new Map(); this.sequence = 0; this.buffer = Buffer.alloc(0);
  }
  needsMigration(bytes) { return !bytes.subarray(0, magic.length).equals(magic); }
  async start() {
    if (this.closed) throw unavailable();
    if (!this.starting) this.starting = (async () => {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024 || this.manifest.protocol !== 1) throw unavailable();
      const hash = crypto.createHash('sha256').update(await fs.readFile(this.file)).digest('hex');
      if (hash !== this.manifest.sha256 || this.closed) throw unavailable();
      const child = this.child = this.launch(this.file, [], { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' }, windowsHide: true });
      child.stdout.on('data', chunk => this.receive(chunk));
      child.on('error', () => this.fail()); child.on('exit', () => this.fail());
      child.stdin.on('error', () => this.fail());
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      if (this.closed) throw unavailable();
    })().catch(() => { this.fail(); throw unavailable(); });
    return this.starting;
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      if (newline > maxFrame) { this.fail(); return; }
      let value;
      try { value = JSON.parse(this.buffer.subarray(0, newline).toString('utf8')); } catch { this.fail(); return; }
      this.buffer = this.buffer.subarray(newline + 1);
      const pending = this.pending.get(value.id);
      if (!pending || typeof value.ok !== 'boolean' || value.ok && (typeof value.result !== 'string' || value.result.length > maxFrame)) { this.fail(); return; }
      clearTimeout(pending.timer); this.pending.delete(value.id);
      value.ok ? pending.resolve(value.result) : pending.reject(unavailable());
    }
    if (this.buffer.length > maxFrame) this.fail();
  }
  fail() {
    this.closed = true; this.buffer = Buffer.alloc(0);
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(unavailable()); }
    this.pending.clear(); this.child?.kill();
  }
  close() { this.fail(); }
  async request(operation, data) {
    await this.start();
    if (this.closed || this.pending.size >= 16) throw unavailable();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, operation, ...(data ? { data: data.toString('base64') } : {}) }) + '\n'); }
      catch { this.fail(); }
    });
  }
  async isEncryptionAvailable() {
    try { return await this.request('ping') === '1'; } catch { return false; }
  }
  async encryptString(value) {
    const data = Buffer.from(value, 'utf8');
    if (data.length > maxPlaintext) throw unavailable();
    const result = Buffer.from(await this.request('encrypt', data), 'base64');
    if (this.needsMigration(result) || result.length !== data.length + 33) throw unavailable();
    return result;
  }
  async decryptString(bytes) {
    if (bytes.length > maxPlaintext + 33) throw unavailable();
    if (this.needsMigration(bytes)) {
      if (this.legacyFailed) throw unavailable();
      if (!this.legacy.isEncryptionAvailable()) { this.legacyFailed = true; throw unavailable(); }
      try {
        return this.legacy.decryptString(bytes);
      } catch { throw unavailable(); }
    }
    return Buffer.from(await this.request('decrypt', bytes), 'base64').toString('utf8');
  }
}
module.exports = { KeychainEncryption };

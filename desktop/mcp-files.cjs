const crypto = require('node:crypto');
const limit = 20 * 1024 * 1024;
// Uploads are account-owned, bounded memory only; agents never supply local paths.
class McpFiles {
  constructor() { this.clear(); }
  clear() { this.entries = new Map(); this.bytes = 0; }
  prune() {
    for (const [id, entry] of this.entries) if (entry.until < Date.now()) { this.bytes -= entry.bytes.length; this.entries.delete(id); }
  }
  get(id, owner) {
    this.prune(); const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner) throw new Error('Attachment handle expired or belongs to another account');
    return entry;
  }
  upload(input, owner) {
    this.prune();
    if (input.content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) throw new Error('Invalid base64 attachment chunk');
    const bytes = Buffer.from(input.content, 'base64');
    if (bytes.toString('base64') !== input.content) throw new Error('Invalid base64 attachment chunk');
    let id = input.handle, entry = id ? this.get(id, owner) : null;
    if (!entry) {
      if (this.entries.size >= 100 || !input.name?.trim() || input.offset) throw new Error('Invalid attachment upload');
      id = crypto.randomUUID(); entry = { owner, name: input.name, type: input.type || 'application/octet-stream', bytes: Buffer.alloc(0), complete: false, until: Date.now() + 1800000 };
    }
    if (entry.complete || input.offset !== entry.bytes.length || this.bytes + bytes.length > limit || input.name && input.name !== entry.name || input.type && input.type !== entry.type) throw new Error('Attachment offset, metadata or memory limit mismatch');
    entry.bytes = Buffer.concat([entry.bytes, bytes]); entry.complete = input.final === true;
    this.bytes += bytes.length; this.entries.set(id, entry);
    return { handle: id, name: entry.name, type: entry.type, size: entry.bytes.length, complete: entry.complete };
  }
  remove(id, owner) { const entry = this.get(id, owner); this.bytes -= entry.bytes.length; this.entries.delete(id); return true; }
}
module.exports = { McpFiles, limit };

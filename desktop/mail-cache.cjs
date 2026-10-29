// Account-local memory only. No filesystem, cookies or credentials enter this cache.
class MailCache {
  constructor({ maxBytes = 24 * 1024 * 1024, maxEntries = 150, now = Date.now } = {}) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.now = now;
    this.entries = new Map(); this.pending = new Map(); this.bytes = 0; this.generation = 0;
  }
  clear({ preserveImages = false } = {}) {
    this.generation++; this.pending.clear();
    for (const [key, entry] of this.entries) if (!preserveImages || !key.startsWith('image:')) { this.bytes -= entry.size; this.entries.delete(key); }
  }
  async get(key, load, { ttl = 30000, refresh = false } = {}) {
    if (key.length > 20000) return load();
    const cached = this.entries.get(key);
    if (!refresh && cached && cached.until > this.now()) {
      this.entries.delete(key); this.entries.set(key, cached);
      return structuredClone(cached.value);
    }
    if (this.pending.has(key)) return structuredClone(await this.pending.get(key));
    const generation = this.generation;
    const task = Promise.resolve().then(load);
    this.pending.set(key, task);
    try {
      const value = await task, size = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(key);
      if (generation === this.generation) {
        if (this.entries.has(key)) { this.bytes -= this.entries.get(key).size; this.entries.delete(key); }
        if (size <= this.maxBytes) {
          for (const [id, entry] of this.entries) if (entry.until <= this.now()) { this.bytes -= entry.size; this.entries.delete(id); }
          while (this.entries.size && (this.bytes + size > this.maxBytes || this.entries.size >= this.maxEntries)) {
            const first = this.entries.keys().next().value; this.bytes -= this.entries.get(first).size; this.entries.delete(first);
          }
          this.entries.set(key, { value: structuredClone(value), size, until: this.now() + ttl }); this.bytes += size;
        }
      }
      return structuredClone(value);
    } finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
}
module.exports = { MailCache };

const { execFile } = require('node:child_process');
const path = require('node:path');
// Public desktop APIs do not provide a cross-app capture signal on both targets.
// Hide only while an application explicitly selected by the user is running.
// Process names are inspected in memory only, never logged or persisted.
const catalog = require('../src/privacy-apps.js');
function matchingApplications(output, platform, selected) {
  const processes = output.split(/\r?\n/).map(line => {
    const command = platform === 'win32' ? /^"([^"]+)"/.exec(line)?.[1] : line.trim();
    return command ? path.basename(command).replace(/\.exe$/i, '').toLowerCase() : '';
  });
  return catalog.selected(selected).filter(id => catalog.applications.find(app => app.id === id).processes.some(name => processes.includes(name.toLowerCase())));
}
function sharingAppRunning(output, platform, selected = []) { return matchingApplications(output, platform, selected).length > 0; }
function scan(selected = [], platform = process.platform) {
  return new Promise(resolve => {
    if (!selected.length) return resolve({ active: false, matches: [] });
    if (!['darwin', 'win32'].includes(platform)) return resolve(null);
    const command = platform === 'darwin' ? '/bin/ps' : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
    const args = platform === 'darwin' ? ['-A', '-o', 'comm='] : ['/FO', 'CSV', '/NH'];
    execFile(command, args, { timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, output) => resolve(error || !output.trim() ? null : { active: sharingAppRunning(output, platform, selected), matches: matchingApplications(output, platform, selected) }));
  });
}
class SharingPrivacy {
  constructor({ read = scan, changed = () => {}, selected = [] } = {}) { this.read = read; this.changed = changed; this.selected = catalog.selected(selected); this.active = this.selected.length ? null : false; this.matches = []; this.pending = null; this.generation = 0; }
  configure(selected) {
    const next = catalog.selected(selected);
    if (JSON.stringify(next) === JSON.stringify(this.selected)) return;
    this.selected = next; this.generation++; this.pending = null; this.active = next.length ? null : false; this.matches = []; this.changed();
  }
  async check() {
    if (!this.selected.length) return false;
    if (this.pending) return this.pending;
    const generation = this.generation, selected = [...this.selected];
    const task = this.pending = (async () => {
      let result;
      try { result = await this.read(selected); } catch { result = null; }
      if (generation !== this.generation) return this.active;
      const active = typeof result === 'boolean' || result === null ? result : result.active;
      const matches = result?.matches || [];
      if (active !== this.active || JSON.stringify(matches) !== JSON.stringify(this.matches)) { this.active = active; this.matches = matches; this.changed(); }
      return this.active;
    })();
    try { return await task; } finally { if (this.pending === task) this.pending = null; }
  }
}
module.exports = { sharingAppRunning, scan, SharingPrivacy };

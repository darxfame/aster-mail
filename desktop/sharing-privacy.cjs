const { execFile } = require('node:child_process');
const path = require('node:path');
// Public desktop APIs do not provide a cross-app capture signal on both targets.
// Conservatively hide while a known calling, recording or browser app is running.
// Process names are inspected in memory only, never logged or persisted.
const applications = /^(?:zoom(?:\.us)?|Microsoft Teams|MSTeams|ms-teams|Teams|Webex|Cisco Webex Meetings|Slack|Discord|OBS|obs64|QuickTime Player|Screen Sharing|screencaptureui|Google Chrome|chrome|Microsoft Edge|msedge|firefox|Safari|Brave Browser|brave|Arc|Opera)(?:\.exe)?$/i;
function sharingAppRunning(output, platform) {
  return output.split(/\r?\n/).some(line => {
    const command = platform === 'win32' ? /^"([^"]+)"/.exec(line)?.[1] : line.trim();
    return command && applications.test(path.basename(command));
  });
}
function scan(platform = process.platform) {
  return new Promise(resolve => {
    if (!['darwin', 'win32'].includes(platform)) return resolve(null);
    const command = platform === 'darwin' ? '/bin/ps' : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
    const args = platform === 'darwin' ? ['-A', '-o', 'comm='] : ['/FO', 'CSV', '/NH'];
    execFile(command, args, { timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, output) => resolve(error || !output.trim() ? null : sharingAppRunning(output, platform)));
  });
}
class SharingPrivacy {
  constructor({ read = scan, changed = () => {} } = {}) { this.read = read; this.changed = changed; this.active = null; this.pending = null; }
  async check() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      let active;
      try { active = await this.read(); } catch { active = null; }
      if (active !== this.active) { this.active = active; this.changed(); }
      return this.active;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
}
module.exports = { sharingAppRunning, scan, SharingPrivacy };

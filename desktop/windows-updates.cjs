const { spawn } = require('node:child_process');

// NSIS owns replacement and relaunch. Never use a shell or replay a failed launch.
class WindowsUpdates {
  constructor({ prepare, quit, cancelled, launch = spawn }) { Object.assign(this, { prepare, quit, cancelled, launch }); }
  async install(file, signal) {
    signal.throwIfAborted();
    if (!this.prepare()) return;
    try {
      signal.throwIfAborted();
      const child = this.launch(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('spawn', () => { try { child.unref(); this.quit(); resolve(); } catch (error) { reject(error); } });
      });
    } catch (error) { this.cancelled(); throw error; }
  }
}
module.exports = { WindowsUpdates };

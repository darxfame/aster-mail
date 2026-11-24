// Remove the isolated profile after Electron releases its files.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-electron-test-'));
try {
  const fixture = path.resolve(__dirname, process.argv[2]);
  const result = spawnSync(require('electron'), [fixture, profile], { stdio: 'inherit', timeout: 45000, killSignal: 'SIGKILL' });
  process.exitCode = result.status ?? 1;
  if (result.error) console.error(result.error);
} finally {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

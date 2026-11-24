// Remove the isolated profile after Electron releases its files.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-electron-test-'));
  let timer;
  try {
    const fixture = path.resolve(__dirname, process.argv[2]);
    const child = spawn(require('electron'), [fixture, profile], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    process.exitCode = await new Promise((resolve, reject) => {
      let result, stopped = false;
      timer = setTimeout(() => child.kill('SIGKILL'), 45000);
      child.on('message', code => {
        if (result !== undefined || (code !== 0 && code !== 1)) return;
        result = code;
        clearTimeout(timer);
        // Electron may hang after the assertions, while closing native windows.
        timer = setTimeout(() => { stopped = child.kill('SIGKILL'); }, 1000);
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (result === undefined) reject(new Error(`Electron exited without a fixture result (${signal || code})`));
        else resolve(stopped ? result : result || code || Number(Boolean(signal)));
      });
    });
  } finally {
    clearTimeout(timer);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

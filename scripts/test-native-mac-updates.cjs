// Two disposable signed apps, fictional data only. Never replace the installed Aster.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const fixtureMain = directory => `
const { app, autoUpdater, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { MacUpdates } = require('./desktop/mac-updates.cjs');
const directory = ${JSON.stringify(directory)};
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  if (app.getVersion() === '0.0.2') {
    await fs.writeFile(path.join(directory, 'restarted.json'), JSON.stringify({ version: app.getVersion(), executable: process.execPath }));
    app.quit(); return;
  }
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<p>Fictional update fixture</p>');
  let restarts = 0, allowed = false;
  const controller = new AbortController();
  const updater = new MacUpdates({ autoUpdater, appPath: path.dirname(path.dirname(process.resourcesPath)),
    staged: () => controller.abort(),
    restart: signal => { signal.throwIfAborted(); restarts++; if (allowed) autoUpdater.quitAndInstall(); },
  });
  async function install(name, signal) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    const handle = await fs.open(file, 'r');
    try { await updater.install(handle, { version:'0.0.2', size:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex') }, signal); }
    finally { await handle.close(); }
  }
  await assert.rejects(install('wrong.zip', new AbortController().signal));
  assert.equal(restarts, 0); assert.equal(updater.staged, undefined);
  await assert.rejects(install('update.zip', controller.signal), error => {
    if (!controller.signal.aborted) throw error;
    return true;
  });
  assert.equal(restarts, 0); assert.ok(updater.staged);
  // A cancelled dirty-editor guard must leave every window and the app running.
  await install('update.zip', new AbortController().signal);
  assert.equal(restarts, 1); assert.equal(window.isDestroyed(), false);
  await fs.writeFile(path.join(directory, 'checks.json'), JSON.stringify({ rejectedWrongSignature:true, cancelledRelaunch:true, deniedQuitPreservesWindow:true }));
  allowed = true;
  autoUpdater.once('before-quit-for-update', () => {
    if (!allowed) throw new Error('Quit without approval');
  });
  await install('update.zip', new AbortController().signal);
}).catch(async error => { await fs.writeFile(path.join(directory, 'failure.txt'), error.stack); app.exit(1); });
`;

async function main() {
  if (process.platform !== 'darwin') { console.log('SKIP: signed restart updates require macOS'); return; }
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aster-native-update-')));
  const source = path.join(directory, 'source');
  try {
    await fs.mkdir(path.join(source, 'desktop'), { recursive: true });
    await fs.mkdir(path.join(source, 'src'));
    await fs.copyFile(path.join(root, 'desktop/mac-updates.cjs'), path.join(source, 'desktop/mac-updates.cjs'));
    await fs.copyFile(path.join(root, 'src/i18n.js'), path.join(source, 'src/i18n.js'));
    await fs.writeFile(path.join(source, 'main.cjs'), fixtureMain(directory));
    const id = `app.astermail.update-fixture.${Date.now()}`;
    let installed, update;
    for (const version of ['0.0.1', '0.0.2']) {
      await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'aster-update-fixture', version, main: 'main.cjs', description: 'Fictional update fixture', author: 'Aster Mail', license: 'MIT' }));
      const output = path.join(directory, version);
      await build({ projectDir: source, targets: Platform.MAC.createTarget('dir', process.arch === 'arm64' ? Arch.arm64 : Arch.x64), publish: 'never', config: {
        appId: id, productName: 'Aster Update Fixture', electronVersion: require('electron/package.json').version,
        electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'), npmRebuild: false,
        electronFuses: require('../package.json').build.electronFuses,
        directories: { output }, files: ['main.cjs', 'desktop/**', 'src/**'],
        mac: { identity: 'Aster Mail Local Signing', forceCodeSigning: true, target: 'dir', timestamp: 'none',
          // Data files are sealed by their containing bundle, not executable code.
          signIgnore: ['\\.pak$', '\\.bin$', '\\.dat$', '\\.car$', '\\.metallib$'],
        },
      } });
      const application = path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Aster Update Fixture.app');
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
      if (version === '0.0.1') installed = application; else update = application;
    }
    await execute('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', update, path.join(directory, 'update.zip')]);
    const wrong = path.join(directory, 'wrong/Aster Update Fixture.app');
    await execute('/usr/bin/ditto', [update, wrong]);
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', wrong]);
    await execute('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', wrong, path.join(directory, 'wrong.zip')]);
    const child = spawn(path.join(installed, 'Contents/MacOS/Aster Update Fixture'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const deadline = Date.now() + 120000;
    try {
      while (Date.now() < deadline) {
        const failure = await fs.readFile(path.join(directory, 'failure.txt'), 'utf8').catch(() => '');
        if (failure) throw new Error(failure);
        const restarted = await fs.readFile(path.join(directory, 'restarted.json'), 'utf8').catch(() => '');
        if (restarted) {
          assert.equal(JSON.parse(restarted).version, '0.0.2');
          assert.equal(JSON.parse(restarted).executable, path.join(installed, 'Contents/MacOS/Aster Update Fixture'));
          assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'checks.json'), 'utf8')), { rejectedWrongSignature: true, cancelledRelaunch: true, deniedQuitPreservesWindow: true });
          await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
          console.log('PASS: real Squirrel rejects a different signature, preserves windows on cancellation, replaces the signed fixture and relaunches version 0.0.2');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('Native update timed out: ' + output.slice(-6000));
    } finally { if (child.exitCode === null) child.kill(); }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exit(1); });

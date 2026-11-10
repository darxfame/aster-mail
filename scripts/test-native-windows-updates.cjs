// Installs ONLY two uniquely named fictional fixtures into a temporary directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const fixtureMain = directory => `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {WindowsUpdates}=require('./windows-updates.cjs');
const directory=${JSON.stringify(directory)};
app.setPath('userData',path.join(directory,'profile'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const preference=path.join(directory,'profile','fictional-preference');
  if(app.getVersion()==='0.0.2'){
    assert.equal(fs.readFileSync(preference,'utf8'),'preserve this setting');
    assert.equal(fs.existsSync(path.join(directory,'graceful-quit')),true);
    fs.writeFileSync(path.join(directory,'restarted.json'),JSON.stringify({version:app.getVersion(),executable:process.execPath}));
    app.quit();return;
  }
  fs.mkdirSync(path.dirname(preference),{recursive:true});fs.writeFileSync(preference,'preserve this setting');
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('data:text/html,<p>Fictional update fixture</p>');
  let allowed=false;
  const updater=new WindowsUpdates({prepare:()=>allowed,cancelled:()=>{},quit:()=>{app.quit();}});
  const installer=path.join(directory,'0.0.2','fixture-0.0.2.exe');
  await updater.install(installer,new AbortController().signal);
  assert.equal(window.isDestroyed(),false);
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(updater.install(installer,cancelled.signal));
  assert.equal(window.isDestroyed(),false);
  app.on('before-quit',()=>fs.writeFileSync(path.join(directory,'graceful-quit'),'approved'));
  allowed=true;await updater.install(installer,new AbortController().signal);
}).catch(error=>{fs.writeFileSync(path.join(directory,'failure.txt'),error.stack);app.exit(1);});
`;
async function main() {
  if (process.platform !== 'win32') { console.log('SKIP: native NSIS replacement requires Windows'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-nsis-fixture-'));
  const source = path.join(directory, 'source'), installed = path.join(directory, 'installed');
  const name = `Aster Update Fixture ${crypto.randomUUID()}`;
  let child, launchError;
  try {
    await fs.mkdir(source);
    await fs.copyFile(path.join(root, 'desktop/windows-updates.cjs'), path.join(source, 'windows-updates.cjs'));
    await fs.writeFile(path.join(source, 'main.cjs'), fixtureMain(directory));
    for (const version of ['0.0.1', '0.0.2']) {
      await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'aster-nsis-fixture', version, main: 'main.cjs', description: 'Fictional NSIS update fixture', author: 'Aster Mail', license: 'MIT' }));
      await build({ projectDir: source, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
        appId: `app.astermail.fixture.${path.basename(directory)}`, productName: name,
        electronVersion: require('electron/package.json').version, electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
        npmRebuild: false, directories: { output: path.join(directory, version) }, files: ['main.cjs', 'windows-updates.cjs'],
        electronFuses: require('../package.json').build.electronFuses,
        win: { target: 'nsis', artifactName: 'fixture-${version}.exe', signAndEditExecutable: true },
        nsis: { perMachine: false, allowElevation: false, runAfterFinish: true, include: path.join(root, 'scripts/windows-installer.nsh') },
      } });
    }
    // NSIS consumes /D as the unquoted remainder of its command line.
    await execute(path.join(directory, '0.0.1/fixture-0.0.1.exe'), ['/S', `/D=${installed}`], { windowsVerbatimArguments: true, timeout: 90000 });
    const executable = path.join(installed, `${name}.exe`);
    child = spawn(executable, [], { stdio: 'ignore' });
    child.once('error', error => { launchError = error; });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      const failure = await fs.readFile(path.join(directory, 'failure.txt'), 'utf8').catch(() => '');
      if (failure) throw new Error(failure);
      const restarted = await fs.readFile(path.join(directory, 'restarted.json'), 'utf8').catch(() => '');
      if (restarted) {
        assert.equal(JSON.parse(restarted).version, '0.0.2');
        assert.equal(path.normalize(JSON.parse(restarted).executable).toLowerCase(), path.normalize(executable).toLowerCase());
        console.log('PASS: real NSIS preserves windows on cancellation, waits for graceful exit, replaces the fixture and relaunches 0.0.2 with settings');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('NSIS update did not relaunch the fixture');
  } finally {
    if (child?.exitCode === null) child.kill();
    // The new fixture writes its result just before app.quit; wait for its final
    // renderer processes too before invoking a non-forcing silent uninstaller.
    const exitBy = Date.now() + 10000;
    while (Date.now() < exitBy) {
      const { stdout } = await execute('tasklist.exe', ['/FI', `IMAGENAME eq ${name}.exe`, '/FO', 'CSV', '/NH'], { windowsHide: true });
      if (!stdout.toLowerCase().includes(`${name}.exe`.toLowerCase())) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const uninstaller = (await fs.readdir(installed).catch(() => [])).find(name => /^Uninstall.*\.exe$/.test(name));
    if (uninstaller) await execute(path.join(installed, uninstaller), ['/S', `_?=${installed}`], { windowsVerbatimArguments: true, timeout: 60000 });
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exit(1); });

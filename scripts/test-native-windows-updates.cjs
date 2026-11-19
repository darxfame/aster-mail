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
const fixtureMain = (directory, name) => `
const {app,BrowserWindow,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {WindowsUpdates}=require('./windows-updates.cjs');
const {LocalStore}=require('./desktop/local-store.cjs');
const directory=${JSON.stringify(directory)}, name=${JSON.stringify(name)};
const initial=path.join(directory,'initial-profile.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const profile=app.getPath('userData'), preference=path.join(profile,'fictional-preference');
  assert.equal(path.basename(profile).toLowerCase(), name, 'Electron uses the isolated default profile');
  assert.equal(path.dirname(profile).toLowerCase(), app.getPath('appData').toLowerCase());
  const store=new LocalStore(profile,safeStorage);
  const account={server:'https://mail.example.test',username:'fictional@example.test',password:'fictional-fixture'};
  const guard=()=>{};
  if(!fs.existsSync(preference)){
    assert.equal(app.getVersion(),'0.0.1');
    await store.saveCredentials(account,guard);
    await store.saveLoginHint(account,guard);
    fs.writeFileSync(initial,JSON.stringify({profile,ciphertext:hash(fs.readFileSync(path.join(profile,'account.enc')))}));
    fs.writeFileSync(preference,'preserve this setting');
    app.quit();return;
  }
  const previous=JSON.parse(fs.readFileSync(initial,'utf8'));
  assert.equal(profile,previous.profile,'The app resolves the same profile after the restart or update');
  assert.ok(fs.existsSync(path.join(profile,'account.enc')),'The encrypted credential file still exists');
  assert.equal(hash(fs.readFileSync(path.join(profile,'account.enc'))),previous.ciphertext,'The installer leaves the encrypted file intact');
  assert.ok(!fs.existsSync(path.join(profile,'logout.pending')),'There is no pending logout blocking restore');
  assert.deepEqual(await store.loadCredentials(),account,'DPAPI can decrypt the saved account');
  assert.deepEqual(await store.loadLoginHint(),{server:account.server,username:account.username});
  if(app.getVersion()==='0.0.2'){
    assert.equal(fs.readFileSync(preference,'utf8'),'preserve this setting');
    assert.equal(fs.existsSync(path.join(directory,'graceful-quit')),true);
    fs.writeFileSync(path.join(directory,'restarted.json'),JSON.stringify({version:app.getVersion(),executable:process.execPath}));
    app.quit();return;
  }
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
  const name = `aster-update-fixture-${crypto.randomUUID()}`;
  let child, launchError;
  try {
    await fs.mkdir(source);
    await fs.copyFile(path.join(root, 'desktop/windows-updates.cjs'), path.join(source, 'windows-updates.cjs'));
    await fs.mkdir(path.join(source, 'desktop'));
    await fs.mkdir(path.join(source, 'src'));
    await fs.copyFile(path.join(root, 'desktop/local-store.cjs'), path.join(source, 'desktop/local-store.cjs'));
    for (const file of ['i18n.js', 'server.js']) await fs.copyFile(path.join(root, 'src', file), path.join(source, 'src', file));
    await fs.writeFile(path.join(source, 'main.cjs'), fixtureMain(directory, name));
    for (const version of ['0.0.1', '0.0.2']) {
      await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name, version, main: 'main.cjs', description: 'Fictional NSIS update fixture', author: 'Aster Mail', license: 'MIT' }));
      await build({ projectDir: source, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
        appId: `app.astermail.fixture.${path.basename(directory)}`, productName: name,
        electronVersion: require('electron/package.json').version, electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
        npmRebuild: false, directories: { output: path.join(directory, version) }, files: ['main.cjs', 'windows-updates.cjs', 'desktop/**', 'src/**'],
        electronFuses: require('../package.json').build.electronFuses,
        win: { target: 'nsis', artifactName: 'fixture-${version}.exe', signAndEditExecutable: true },
        nsis: { perMachine: false, allowElevation: false, runAfterFinish: true, include: path.join(root, 'scripts/windows-installer.nsh') },
      } });
    }
    // NSIS consumes /D as the unquoted remainder of its command line.
    await execute(path.join(directory, '0.0.1/fixture-0.0.1.exe'), ['/S', `/D=${installed}`], { windowsVerbatimArguments: true, timeout: 90000 });
    const executable = path.join(installed, `${name}.exe`);
    await execute(executable, [], { timeout: 60000 }).catch(async error => {
      throw new Error(await fs.readFile(path.join(directory, 'failure.txt'), 'utf8').catch(() => error.message));
    });
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
        assert.equal((await fs.realpath(JSON.parse(restarted).executable)).toLowerCase(), (await fs.realpath(executable)).toLowerCase());
        console.log('PASS: native NSIS waits for graceful exit and relaunches 0.0.2. The default profile, encrypted credential bytes and DPAPI decryption survive both an ordinary restart and the update.');
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
    if (process.env.APPDATA) await fs.rm(path.join(process.env.APPDATA, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exit(1); });

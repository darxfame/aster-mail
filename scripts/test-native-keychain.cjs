// Two signed, hardened parents share one immutable TEST helper and a unique TEST Keychain item.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const parentMain = directory => `
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { LocalStore } = require('./desktop/local-store.cjs');
const { KeychainEncryption } = require('./desktop/keychain.cjs');
const directory = ${JSON.stringify(directory)};
app.setPath('userData', path.join(directory, 'profile'));
let encryption;
app.whenReady().then(async () => {
  if (process.env.ASTER_FUSE_PROBE) { app.exit(0); return; }
  let legacyReads = 0;
  const legacy = { isEncryptionAvailable: () => true, decryptString(bytes) { legacyReads++; assert.equal(bytes.subarray(0,4).toString(),'old:'); return bytes.subarray(4).toString(); } };
  encryption = new KeychainEncryption({ resourcesPath:process.resourcesPath, legacy });
  if (process.env.ASTER_DENIED_PROBE) {
    assert.equal(await encryption.isEncryptionAvailable(), false); encryption.close(); app.exit(0); return;
  }
  const data = path.join(directory, 'data'); await fs.mkdir(data, {recursive:true});
  const store = new LocalStore(data, encryption), modules = new LocalStore(path.join(data,'module-profile'), encryption);
  const credentials = {username:'fictional-user',password:'fictional-keychain-test-secret',server:'https://fictional.invalid'};
  if (app.getVersion()==='0.0.1') {
    await fs.writeFile(path.join(data,'account.enc'),Buffer.from('old:'+JSON.stringify(credentials)));
    assert.deepEqual(await store.loadCredentials(),credentials);
    assert.equal(legacyReads,1);
    await store.saveLoginHint(credentials,()=>{});
    await modules.load('aster-modules'); await modules.save({values:{'aster-fixture':'fictional-module-secret'}},()=>{});
  } else {
    assert.deepEqual(await store.loadCredentials(),credentials);
    assert.equal((await store.loadLoginHint()).username,credentials.username);
    assert.equal((await modules.load('aster-modules')).values['aster-fixture'],'fictional-module-secret');
    assert.equal(legacyReads,0);
  }
  const bytes=await fs.readFile(path.join(data,'account.enc'));
  assert.equal(bytes.subarray(0,5).toString(),'ASTK1');
  assert.equal(bytes.includes(Buffer.from(credentials.password)),false);
  const damaged=Buffer.from(bytes); damaged[damaged.length-1]^=1;
  await assert.rejects(encryption.decryptString(damaged));
  assert.deepEqual(await store.loadCredentials(),credentials);
  await assert.rejects(encryption.request('export-key'));
  if (app.getVersion()==='0.0.2') await encryption.request('reset');
  encryption.close();
  await fs.writeFile(path.join(directory,'phase-'+app.getVersion()+'.json'),JSON.stringify({migrated:app.getVersion()==='0.0.1',legacyReads}));
  app.exit(0);
}).catch(async error=>{
  try { await encryption?.request('reset'); } catch {}
  encryption?.close(); console.error(error); app.exit(1);
});
`;

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') { console.log('SKIP: Keychain fixture requires macOS arm64'); return; }
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aster-keychain-native-')));
  try {
    const source = path.join(directory, 'source');
    await fs.mkdir(path.join(source, 'desktop'), { recursive: true }); await fs.mkdir(path.join(source, 'src'));
    for (const name of ['keychain.cjs', 'local-store.cjs']) await fs.copyFile(path.join(root, 'desktop', name), path.join(source, 'desktop', name));
    for (const name of ['i18n.js', 'server.js']) await fs.copyFile(path.join(root, 'src', name), path.join(source, 'src', name));
    await fs.writeFile(path.join(source, 'main.cjs'), parentMain(directory));
    const swift = path.join(directory, 'helper.swift'), binary = path.join(directory, 'aster-keychain-v1');
    await fs.writeFile(swift, (await fs.readFile(path.join(root, 'native/keychain-helper-v1.swift'), 'utf8')).replace('app.astermail.keychain.fixture.v1', `app.astermail.keychain.fixture.${crypto.randomUUID()}`));
    await execute('/usr/bin/xcrun', ['swiftc', '-O', '-D', 'ASTER_KEYCHAIN_FIXTURE', '-module-cache-path', path.join(directory, 'swift-cache'), '-target', 'arm64-apple-macos13.0', swift, '-o', binary]);
    await execute('/usr/bin/codesign', ['--force', '--sign', 'Aster Mail Local Signing', '--identifier', 'app.astermail.keychain-helper.v1', '--options', 'runtime', '--timestamp=none', binary]);
    const digest = hash(await fs.readFile(binary));
    await fs.writeFile(path.join(source, 'desktop/keychain-helper.json'), JSON.stringify({ protocol: 1, file: 'aster-keychain-v1', sha256: digest }));
    // An unsigned Node caller must be refused before any Keychain operation.
    const untrusted = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; untrusted.stdout.on('data', chunk => { output += chunk; });
    untrusted.stdin.on('error', () => {}); untrusted.stdin.end('{"id":1,"operation":"ping"}\n');
    assert.equal(await new Promise(resolve => untrusted.once('exit', resolve)), 77); assert.equal(output, '');
    const parents = [];
    for (const version of ['0.0.1', '0.0.2', '0.0.3']) {
      await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'aster-keychain-fixture', version, main: 'main.cjs', description: 'Fictional Keychain test', author: 'Aster Mail', license: 'MIT' }));
      const out = path.join(directory, version);
      await build({ projectDir: source, targets: Platform.MAC.createTarget('dir', Arch.arm64), publish: 'never', config: {
        appId: 'app.astermail.desktop', productName: 'Aster Keychain Fixture', electronVersion: require('electron/package.json').version,
        electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'), npmRebuild: false,
        directories: { output: out }, files: ['main.cjs', 'desktop/**', 'src/**'],
        electronFuses: version === '0.0.3' ? null : require('../package.json').build.electronFuses,
        afterSign: version === '0.0.3' ? undefined : context => require('./verify-keychain-helper.cjs').stampFramework(path.join(context.appOutDir, 'Aster Keychain Fixture.app')),
        extraResources: [{ from: binary, to: 'keychain/aster-keychain-v1' }],
        mac: { identity: 'Aster Mail Local Signing', forceCodeSigning: true, target: 'dir', timestamp: 'none',
          extendInfo: { AsterKeychainProtocol: 'fixture-1' }, signIgnore: ['aster-keychain-v1$', '\\.pak$', '\\.bin$', '\\.dat$', '\\.car$', '\\.metallib$'] },
      } });
      const app = path.join(out, 'mac-arm64/Aster Keychain Fixture.app');
      assert.equal(hash(await fs.readFile(path.join(app, 'Contents/Resources/keychain/aster-keychain-v1'))), digest);
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      parents.push(app);
      if (version !== '0.0.3') await execute(path.join(app, 'Contents/MacOS/Aster Keychain Fixture'), [], { timeout: 30000 });
    }
    const hashes = [];
    for (const app of parents) {
      const result = await execute('/usr/bin/codesign', ['--display', '--verbose=4', app]);
      hashes.push(/\nCDHash=([^\n]+)/.exec(result.stderr)[1]);
    }
    assert.notEqual(hashes[0], hashes[1]);
    const injected = path.join(directory, 'injected.cjs'), marker = path.join(directory, 'injected.txt');
    await fs.writeFile(injected, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe');`);
    await execute(path.join(parents[1], 'Contents/MacOS/Aster Keychain Fixture'), ['-e', `require(${JSON.stringify(injected)})`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require=${injected}`, ASTER_FUSE_PROBE: '1' }, timeout: 30000 });
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
    const swapped = path.join(directory, 'swapped/Aster Keychain Fixture.app');
    await execute('/usr/bin/ditto', [parents[1], swapped]);
    const frameworkPath = 'Contents/Frameworks/Electron Framework.framework';
    await fs.rm(path.join(swapped, frameworkPath), { recursive: true });
    await execute('/usr/bin/ditto', [path.join(parents[2], frameworkPath), path.join(swapped, frameworkPath)]);
    // Ordinary deep signature validation accepts the old framework's DR; our broker must not.
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', swapped]);
    await execute(path.join(swapped, 'Contents/MacOS/Aster Keychain Fixture'), [], { env: { ...process.env, ASTER_DENIED_PROBE: '1' }, timeout: 30000 });
    // Even the same signing certificate is insufficient without the hardened-protocol marker.
    await execute('/usr/libexec/PlistBuddy', ['-c', 'Delete :AsterKeychainProtocol', path.join(parents[1], 'Contents/Info.plist')]);
    await execute('/usr/bin/codesign', ['--force', '--sign', 'Aster Mail Local Signing', '--options', 'runtime', '--timestamp=none', '--preserve-metadata=entitlements,requirements', parents[1]]);
    await execute(path.join(parents[1], 'Contents/MacOS/Aster Keychain Fixture'), [], { env: { ...process.env, ASTER_DENIED_PROBE: '1' }, timeout: 30000 });
    console.log('PASS: actual Keychain migration, immutable helper across different parent cdhashes, authenticated encryption and denied unsigned/legacy/injected/framework-downgrade callers');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exit(1); });

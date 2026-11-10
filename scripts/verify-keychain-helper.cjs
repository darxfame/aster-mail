const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function stampFramework(application) {
  const framework = path.join(application, 'Contents/Frameworks/Electron Framework.framework');
  const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=4', framework]);
  const digest = /\nCDHash=([a-f0-9]{40})\b/.exec(`${signature.stdout}\n${signature.stderr}`)?.[1];
  if (!digest) throw new Error('Missing Electron Framework cdhash');
  const info = path.join(application, 'Contents/Info.plist');
  await execute('/usr/libexec/PlistBuddy', ['-c', `Add :AsterKeychainFrameworkHash string ${digest}`, info]);
  const args = ['--force', '--sign', 'Aster Mail Local Signing', '--options', 'runtime', '--timestamp=none', '--preserve-metadata=identifier,entitlements,requirements'];
  if (process.env.CSC_KEYCHAIN) args.push('--keychain', process.env.CSC_KEYCHAIN);
  await execute('/usr/bin/codesign', [...args, application]);
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
}
async function verify(file) {
  const manifest = require('../desktop/keychain-helper.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || hash(await fs.readFile(file)) !== manifest.sha256) throw new Error('The frozen Keychain helper was changed or re-signed');
  if (hash(await fs.readFile(path.join(root, 'native/keychain-helper-v1.swift'))) !== manifest.sourceSha256) throw new Error('The frozen Keychain helper source no longer matches its manifest');
  await execute('/usr/bin/codesign', ['--verify', '--strict', file]);
  const { stdout, stderr } = await execute('/usr/bin/codesign', ['--display', '--requirements', '-', file]);
  if (!`${stdout}\n${stderr}`.includes('certificate leaf = H"94449af39dabd49526a09ae19047190ec2d165e8"')) throw new Error('Unexpected Keychain helper signer');
}
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const manifest = require('../desktop/keychain-helper.json');
  await verify(path.join(root, 'assets/keychain-macos', manifest.file));
  const application = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await verify(path.join(application, 'Contents/Resources/keychain', manifest.file));
  const { getCurrentFuseWire, FuseV1Options: O } = require('@electron/fuses');
  const fuses = await getCurrentFuseWire(application);
  for (const key of [O.RunAsNode, O.EnableNodeOptionsEnvironmentVariable, O.EnableNodeCliInspectArguments]) if (fuses[key] !== 48) throw new Error('Unsafe Electron entry point is enabled');
  for (const key of [O.EnableEmbeddedAsarIntegrityValidation, O.OnlyLoadAppFromAsar]) if (fuses[key] !== 49) throw new Error('ASAR integrity is required for Keychain access');
  await stampFramework(application);
  await verify(path.join(application, 'Contents/Resources/keychain', manifest.file));
  await require('./verify-macos-compatibility.cjs').verify(application);
  console.log('Verified frozen Keychain helper and hardened Electron entry points');
};
module.exports.verify = verify;
module.exports.stampFramework = stampFramework;

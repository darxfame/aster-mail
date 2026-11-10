// Explicit, one-time creation. Never called by release builds and never overwrites a frozen broker.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '..');
async function main() {
  if (process.platform !== 'darwin') throw new Error('The Keychain helper is built on macOS only');
  const directory = path.join(root, 'assets/keychain-macos');
  const binary = path.join(directory, 'aster-keychain-v1');
  try { await fs.lstat(binary); throw new Error('Frozen helper already exists. A changed helper requires a new protocol version and an explicit migration.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = path.join(root, 'native/keychain-helper-v1.swift');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-build-keychain-'));
  try {
    const output = path.join(temporary, 'aster-keychain-v1');
    await execute('/usr/bin/xcrun', ['swiftc', '-O', '-module-cache-path', path.join(temporary, 'modules'), '-target', 'arm64-apple-macos13.0', source, '-o', output]);
    await execute('/usr/bin/codesign', ['--force', '--sign', 'Aster Mail Local Signing', '--identifier', 'app.astermail.keychain-helper.v1', '--options', 'runtime', '--timestamp=none', output]);
    await execute('/usr/bin/codesign', ['--verify', '--strict', output]);
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const bytes = await fs.readFile(output);
    const manifest = { protocol: 1, file: 'aster-keychain-v1', sha256: hash(bytes), sourceSha256: hash(await fs.readFile(source)) };
    await fs.writeFile(path.join(root, 'desktop/keychain-helper.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(binary, bytes, { flag: 'wx', mode: 0o755 });
    console.log('Created frozen signed Keychain helper. Commit the binary, source and manifest together.');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

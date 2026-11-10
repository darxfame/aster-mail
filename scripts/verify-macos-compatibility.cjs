const fs = require('node:fs/promises');
const path = require('node:path');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const minimum = '13.0';

function checkDeploymentTargets(commands, file) {
  const targets = commands.split(/Load command \d+/).filter(block => /\bcmd LC_(?:BUILD_VERSION|VERSION_MIN_MACOSX)\b/.test(block));
  if (!targets.length) throw new Error(`Missing macOS deployment target: ${file}`);
  for (const block of targets) {
    const version = /^\s*(?:minos|version) (\d+(?:\.\d+){1,2})\s*$/m.exec(block)?.[1];
    const [major, minor = 0, patch = 0] = (version || '').split('.').map(Number);
    if (!version || major > 13 || major === 13 && (minor > 0 || patch > 0)) throw new Error(`Requires macOS ${version || 'unknown'}, expected ${minimum} or earlier: ${file}`);
  }
}

async function verify(application) {
  const info = path.join(application, 'Contents/Info.plist');
  const { stdout } = await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', info]);
  if (stdout.trim() !== minimum) throw new Error(`LSMinimumSystemVersion must be ${minimum}`);
  let binaries = 0;
  const temporary = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'aster-macos-targets-'));
  try {
    for (const entry of await fs.readdir(application, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name), header = Buffer.alloc(4);
      const handle = await fs.open(file, 'r');
      try { await handle.read(header, 0, 4, 0); } finally { await handle.close(); }
      if (!['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'))) continue;
      // otool interprets a trailing "(Renderer)" as an archive member name.
      const alias = path.join(temporary, `${binaries}.macho`);
      await fs.symlink(path.resolve(file), alias);
      const { stdout: commands } = await execute('/usr/bin/otool', ['-arch', 'arm64', '-l', alias]);
      checkDeploymentTargets(commands, file); binaries++;
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  if (!binaries) throw new Error('No Mach-O binaries found in the macOS application');
  console.log(`Verified macOS ${minimum}+ deployment targets in ${binaries} Mach-O binaries`);
}

module.exports = { verify, checkDeploymentTargets };
if (require.main === module) verify(process.argv[2] || path.resolve(__dirname, '../release/mac-arm64/Aster Mail.app')).catch(error => { console.error(error.message); process.exitCode = 1; });

// Mount a synthetic read-only DMG through real Electron; never launch an installer or change Applications.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const { openInstallerFile } = require('../desktop/updates.cjs');
app.whenReady().then(async () => {
  if (process.platform !== 'darwin') { console.log('SKIP: native DMG mounting is macOS-only'); app.exit(0); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-update-mount-'));
  const source = path.join(directory, 'source'), image = path.join(directory, 'fictional.dmg');
  let volume;
  try {
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'Readme.txt'), 'Fictional installer fixture');
    await execute('/usr/bin/hdiutil', ['create', '-srcfolder', source, '-format', 'UDZO', '-volname', path.basename(directory), image]);
    const calls = [];
    const shell = { openPath() { assert.fail('Do not open DiskImageMounter'); }, async openExternal(url, options) {
      volume = fileURLToPath(url); assert.equal(options.activate, true);
      assert.equal(await fs.readFile(path.join(volume, 'Readme.txt'), 'utf8'), 'Fictional installer fixture'); calls.push(url);
    } };
    for (let i = 0; i < 2; i++) assert.equal(await openInstallerFile(image, shell), '');
    assert.equal(calls[0], calls[1]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(openInstallerFile(image, shell, { signal: controller.signal }));
    assert.equal(calls.length, 2);
    console.log('PASS: real DMG mount and reopen resolve the same volume, request foreground activation, and cancellation suppresses opening');
  } finally {
    if (volume) await execute('/usr/bin/hdiutil', ['detach', volume]);
    await fs.rm(directory, { recursive: true, force: true });
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

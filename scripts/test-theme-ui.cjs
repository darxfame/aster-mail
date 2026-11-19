// Exercise the real module/renderer lifecycle with synthetic data and an offline catalog.
const { app, BrowserWindow, dialog, nativeImage, safeStorage, Tray } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-theme-ui-'));
const directory = process.argv.includes('--northern-tide') ? 'aster-mail-modules/northern-tide' : 'test/fixtures/theme';
const packageBytes = require('node:fs').readFileSync(path.join(root, directory, 'module.json'));
const { manifest, digest } = require('../desktop/modules.cjs').fromFiles(new Map([['module.json', packageBytes]]));
const commit = 'a'.repeat(40), revision = 'b'.repeat(40);
const repository = 'https://github.com/darxfame/aster-mail-modules';
const catalog = { schemaVersion: 1, modules: [{
  id: manifest.id, name: manifest.name, version: manifest.version, sha256: digest,
  source: { repository, commit, directory: 'theme' }, permissions: [], networkOrigins: [], networkHeaders: [],
  host: { apiVersion: 1, features: ['appearance.palette'] },
}] };
require('../desktop/module-github.cjs').getBytes = async (_net, _session, url) => {
  if (url.endsWith('/commits/main')) return Buffer.from(JSON.stringify({ sha: revision }));
  if (url.endsWith(`/commits/${commit}`)) return Buffer.from(JSON.stringify({ sha: commit }));
  if (url.endsWith(`/${revision}/catalog.json`)) return Buffer.from(JSON.stringify(catalog));
  if (url.endsWith(`/${commit}/theme/module.json`)) return packageBytes;
  throw new Error('Unexpected fixture download');
};
Object.assign(safeStorage, {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value),
  decryptString: value => value.toString(),
});
app.setPath('userData', profile);
app.getVersion = () => require('../package.json').version;

let window;
let tray, trayImage, dockImage;
const setTrayImage = Tray.prototype.setImage;
Tray.prototype.setImage = function (image) {
  tray = this;
  trayImage = image;
  return setTrayImage.call(this, image);
};
if (process.platform === 'darwin') {
  const setDockIcon = app.dock.setIcon.bind(app.dock);
  app.dock.setIcon = image => { dockImage = image; setDockIcon(image); };
}
function iconTile(image) {
  const { width, height } = image.getSize();
  const offset = (Math.floor(height * 0.15) * width + Math.floor(width / 2)) * 4;
  return '#' + image.toBitmap().subarray(offset, offset + 3).reverse().toString('hex');
}
async function waitFor(check) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Theme UI timeout');
}

app.on('browser-window-created', (_event, candidate) => {
  if (window) return;
  window = candidate;
  const contents = window.webContents;
  const js = code => contents.executeJavaScript(code);
  const wait = async code => {
    try { await waitFor(async () => !contents.isLoading() && await js(code)); }
    catch (error) { throw new Error(`Theme UI did not reach: ${code}`, { cause: error }); }
  };
  const screenshot = async name => {
    if (!process.argv.includes('--screenshots')) return;
    const output = path.join(root, 'release/theme-ui');
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))');
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, `${name}.png`), (await contents.capturePage()).toPNG());
  };
  contents.once('did-finish-load', () => {
    void (async () => {
      try {
        await wait('updatePromptsReady');
        const fields = 'document.querySelector("#settings-form").elements';
        const themeId = JSON.stringify(manifest.id);
        const custom = 'document.body.classList.contains("custom-theme")';
        const accent = 'getComputedStyle(document.body).getPropertyValue("--accent").trim()';
        const notice = () => js('getComputedStyle(document.querySelector(".mail-alert-heading")).color');
        await js("applyLanguage('ru'); settingsModal()");
        assert.equal(await js('state.account'), null);
        assert.equal(await js(`Boolean(${fields}.darkPalette || ${fields}.lightPalette)`), false);
        assert.equal(await js('Boolean(document.querySelector("[data-action=theme-import]"))'), false);
        await js('moduleAuthorCatalog()');
        const connect = 'document.querySelector("[data-action=module-approved-connect]")';
        await wait(`${connect} && !${connect}.disabled`);
        await js(`${connect}.click(); ${connect}.click()`);
        await wait('themePreferences.themes.length === 1');
        assert.equal(await js(custom), false, 'Installing does not select the palette');
        const invoke = await js(`window.aster.invoke("moduleInvoke", { id: ${themeId}, command: "none" })`);
        assert.equal(invoke.ok, false, 'Palette modules have no runtime entry point');
        assert.equal(BrowserWindow.getAllWindows().some(candidate => candidate.webContents.getURL().includes('aster-module.invalid')), false);

        await js('settingsModal()');
        assert.equal(await js(`${fields}.darkPalette.value`), '');
        assert.equal(await js(`Boolean(${fields}.lightPalette)`), false);
        assert.equal(await js(`${fields}.theme.options.length`), 2);
        const mismatch = await js(`window.aster.invoke("themePreferences", { selected: { light: ${themeId}, dark: null } })`);
        assert.equal(mismatch.ok, false, 'A dark palette cannot be assigned to light mode');
        await js(`${fields}.theme.value = "dark"; ${fields}.darkPalette.value = ${themeId}; document.querySelector("#settings-form").requestSubmit()`);
        await wait(`!document.querySelector("#modal").open && ${custom}`);
        assert.equal(await js(accent), manifest.palette.colors.accent);
        await js('renderMailAlerts([{ id: "fixture", title: "Sample message", body: "Fictional body" }])');
        assert.equal(await notice(), 'rgb(121, 228, 206)');
        await js('renderMailAlerts([])');
        const originalIcon = nativeImage.createFromPath(path.join(root, 'assets/icon.png'));
        const { tintIcon } = require('../desktop/appearance-icon.cjs');
        const trayBitmap = image => image.resize({ width: 18, height: 18 }).toBitmap();
        const expectedTray = trayBitmap(tintIcon(nativeImage, originalIcon, manifest.palette.colors));
        await waitFor(() => trayImage && trayImage.toBitmap().equals(expectedTray));
        if (process.platform === 'darwin') assert.equal(iconTile(dockImage), manifest.palette.colors.accentSurface);
        tray.emit('click');
        let widget;
        await waitFor(() => {
          widget = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().endsWith('/widget.html'));
          return widget && !widget.webContents.isLoading();
        });
        await waitFor(() => widget.webContents.executeJavaScript(`${accent} === ${JSON.stringify(manifest.palette.colors.accent)}`));
        widget.hide();
        await js('document.querySelector("[data-action=theme]").click()');
        await wait(`state.theme === "light" && !${custom}`);
        assert.equal(await js(accent), '#7760d6');
        await js('document.querySelector("[data-action=theme]").click()');
        await wait(`state.theme === "dark" && ${custom}`);

        contents.reload();
        await wait(`typeof updatePromptsReady !== "undefined" && updatePromptsReady && themePreferences.selected.dark === ${themeId}`);
        await js('document.querySelector("[data-action=demo]").click()');
        await wait('state.demo && state.messages.length > 0');
        if (!await js('state.theme === "dark"')) await js('document.querySelector("[data-action=theme]").click()');
        await wait(custom);
        await js('openMessage(state.messages[0].id)');
        await wait('document.querySelector("#reader iframe")?.offsetHeight > 30');
        await screenshot('palette-module-mail');
        await js('settingsModal()');
        assert.equal(await js('getComputedStyle(document.querySelector("#modal"), "::backdrop").backdropFilter.includes("12px")'), true);
        await screenshot('palette-module-settings');
        window.setContentSize(800, 600);
        contents.setZoomFactor(2);
        await wait('innerWidth <= 401');
        assert.equal(await js(`(() => {
          const panel = document.querySelector("#settings-panel-general");
          return panel.clientWidth >= panel.scrollWidth - 1 && document.querySelector(".settings-footer").getBoundingClientRect().bottom <= innerHeight + 1;
        })()`), true);
        contents.setZoomFactor(1);
        await js('document.querySelector("#modal").close(); compose("new")');
        await js('detachCompose("new")');
        const child = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().endsWith('#compose'));
        assert.ok(child, 'Detached editor opened');
        assert.equal(await child.webContents.executeJavaScript(accent), manifest.palette.colors.accent);
        assert.equal((await child.webContents.executeJavaScript('window.aster.invoke("themePreferences", { selected: { light: null, dark: null } })')).ok, false);
        await js('settingsModal().then(() => selectSettingsTab(document.querySelector("#settings-tab-modules")))');
        const configure = 'document.querySelector("#module-list [data-action=module-configure]")';
        await wait(`Boolean(${configure})`);
        await js(`${configure}.click()`);
        await wait(`state.theme === "dark" && !${custom} && !${fields}.darkPalette`);
        assert.equal(await js(accent), '#ab92ee');
        await waitFor(() => widget.webContents.executeJavaScript(`snapshot.theme === "dark" && ${accent} === "#ab92ee"`));
        assert.ok(trayImage.toBitmap().equals(trayBitmap(originalIcon)));
        if (process.platform === 'darwin') assert.equal(iconTile(dockImage), '#29283e');
        await waitFor(() => child.webContents.executeJavaScript(`state.theme === "dark" && ${accent} === "#ab92ee"`));
        child.destroy();

        await wait(`${configure}?.dataset.enabled === "true"`);
        await js(`${configure}.click()`);
        await wait(`Boolean(${fields}.darkPalette)`);
        assert.equal(await js(`${fields}.darkPalette.value`), '', 'Enabling again requires selecting the palette');
        assert.equal(await js(custom), false);
        await js(`selectSettingsTab(document.querySelector("#settings-tab-general")); ${fields}.darkPalette.value = ${themeId}; document.querySelector("#settings-form").requestSubmit()`);
        await wait(`!document.querySelector("#modal").open && ${custom}`);
        dialog.showMessageBox = async () => ({ response: 0 });
        await js(`api("moduleRemove", { id: ${themeId} })`);
        await wait(`state.theme === "dark" && !${custom}`);
        assert.equal(await js(accent), '#ab92ee');
        console.log('PASS: approved palette module, mode-specific selection, restarts, glass and 800×600 at 200%, detached editor, immediate disable and remove fallback.');
      } finally {
        for (const candidate of BrowserWindow.getAllWindows()) candidate.destroy();
        await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      }
    })().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
  });
});

require('../desktop/main.cjs');

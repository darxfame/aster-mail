// Exercise the real main/preload/store and renderer without configuring Exchange.
const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-theme-ui-'));
const example = path.join(root, 'examples/themes/northern-tide.json');
app.setPath('userData', profile);
app.getVersion = () => require('../package.json').version;

let window, choice;
dialog.showOpenDialog = async () => choice;

async function waitFor(check) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Theme UI timeout: ${String(check)}`);
}

app.on('browser-window-created', (_event, candidate) => {
  if (window) return;
  window = candidate;
  const contents = window.webContents;
  const js = code => contents.executeJavaScript(code);
  const wait = code => waitFor(async () => !contents.isLoading() && await js(code));
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
        await js("applyLanguage('ru'); document.querySelector('[data-action=settings]').click()");
        await wait('Boolean(document.querySelector("#settings-form"))');
        assert.equal(await js('state.account'), null);
        const mockFile = path.join(profile, 'invalid.json');
        await fs.writeFile(mockFile, '{"themeVersion":1,"colors":{"background":"url(https://invalid.example)"}}');
        choice = { canceled: false, filePaths: [mockFile] };
        const importClick = 'document.querySelector("[data-action=theme-import]").click()';
        const themeSelect = 'document.querySelector("#settings-form").elements.theme';
        await js(importClick);
        await wait('document.querySelector("[data-theme-status]").textContent.includes("формату")');
        assert.equal(await js(`${themeSelect}.options.length`), 2);
        choice = { canceled: true, filePaths: [] };
        await js(importClick);
        await wait('!document.querySelector("[data-action=theme-import]").disabled');
        assert.equal(await js(`${themeSelect}.options.length`), 2);
        choice = { canceled: false, filePaths: [example] };
        await js(importClick);
        await wait(`${themeSelect}.value === "custom:northern-tide"`);
        assert.equal(await js('document.body.classList.contains("custom-theme")'), false, 'Import is saved only as an available theme');
        await js('document.querySelector("#settings-form").requestSubmit()');
        await wait('!document.querySelector("#modal").open && document.body.classList.contains("custom-theme")');
        assert.equal(await js('getComputedStyle(document.body).getPropertyValue("--accent").trim()'), '#79e4ce');
        assert.equal(await js('document.body.classList.contains("dark")'), true);

        contents.reload();
        await wait('typeof updatePromptsReady !== "undefined" && updatePromptsReady && document.body.classList.contains("custom-theme")');
        assert.equal(await js('state.account'), null);
        await js('document.querySelector("[data-action=demo]").click()');
        await wait('state.demo && state.messages.length > 0');
        await js('openMessage(state.messages[0].id)');
        await wait('document.querySelector("#reader iframe")?.offsetHeight > 30');
        await screenshot('northern-tide-mail');
        await js('settingsModal()');
        assert.equal(await js(`${themeSelect}.value`), 'custom:northern-tide');
        assert.equal(await js('getComputedStyle(document.querySelector("#modal"), "::backdrop").backdropFilter.includes("12px")'), true);
        await screenshot('northern-tide-settings');

        window.setContentSize(800, 600);
        contents.setZoomFactor(2);
        await wait('innerWidth <= 401');
        assert.equal(await js(`(() => {
          const panel = document.querySelector("#settings-panel-general");
          const footer = document.querySelector(".settings-footer");
          return panel.clientWidth >= panel.scrollWidth - 1 && footer.getBoundingClientRect().bottom <= innerHeight + 1;
        })()`), true, 'Theme settings fit at 800×600 / 200%');
        contents.setZoomFactor(1);
        await js('document.querySelector("#modal").close(); compose("new")');
        await js('detachCompose("new")');
        const child = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().endsWith('#compose'));
        assert.ok(child, 'Detached editor opened');
        assert.equal(await child.webContents.executeJavaScript('getComputedStyle(document.body).getPropertyValue("--accent").trim()'), '#79e4ce');
        assert.equal((await child.webContents.executeJavaScript('window.aster.invoke("themePreferences", { action: "select", id: null })')).ok, false);
        child.destroy();

        await js(`settingsModal().then(() => { ${themeSelect}.value = "light"; document.querySelector("#settings-form").requestSubmit(); })`);
        await wait('!document.querySelector("#modal").open && !document.body.classList.contains("custom-theme")');
        assert.equal(await js('getComputedStyle(document.body).getPropertyValue("--accent").trim()'), '#7760d6');
        await js(`settingsModal().then(() => { ${themeSelect}.value = "custom:northern-tide"; ${themeSelect}.dispatchEvent(new Event("change")); document.querySelector("[data-action=theme-remove]").click(); })`);
        await wait(`${themeSelect}.options.length === 2`);
        assert.equal((await js('api("themePreferences")')).themes.length, 0);
        console.log('PASS: theme import and cancellation, invalid file rejection, persistence without Exchange, glass and 800×600 at 200%, detached editor, built-in fallback and removal.');
      } finally {
        for (const candidate of BrowserWindow.getAllWindows()) candidate.destroy();
        await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      }
    })().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
  });
});

require('../desktop/main.cjs');

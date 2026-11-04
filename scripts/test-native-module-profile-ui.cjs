// Full application IPC with an explicit fictional module fixture; no OWA or keychain access.
const electron = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
let running = false;
async function waitFor(check) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Standalone module UI did not become ready');
}
electron.app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => {
    if (running || !window.webContents.getURL().endsWith('/src/index.html')) return;
    running = true;
    void (async () => {
      const wc = window.webContents;
      await waitFor(() => wc.executeJavaScript('updatePromptsReady'));
      assert.equal(await wc.executeJavaScript('state.account'), null);
      await wc.executeJavaScript(`window.fixtureApi=api; api=(operation,data)=>operation==='moduleAuthorCatalog'?Promise.resolve({modules:[]}):fixtureApi(operation,data); void 0`);
      await wc.executeJavaScript('settingsModal().then(()=>selectSettingsTab(document.querySelector("#settings-tab-modules")))');
      await waitFor(() => wc.executeJavaScript('Boolean(document.querySelector("#module-list [data-action=module-panel]"))'));
      assert.equal(await wc.executeJavaScript('document.querySelector("#module-list").textContent.includes("Подключённых модулей пока нет.")'), false);
      await wc.executeJavaScript('document.querySelector("#module-list [data-action=module-panel]").click()');
      let panel;
      await waitFor(() => { panel = electron.webContents.getAllWebContents().find(contents => contents.getURL().includes('/package/panel.html')); return panel && !panel.isLoading(); });
      await panel.executeJavaScript('document.querySelector("#increment").click()');
      await waitFor(() => panel.executeJavaScript('document.querySelector("#result").textContent === "1"'));
      if (process.argv.includes('--screenshots')) {
        const output = path.join(__dirname, '../release/ui-sidebar-catalog'); await fs.mkdir(output, { recursive: true });
        await new Promise(resolve => setTimeout(resolve, 150));
        await fs.writeFile(path.join(output, 'standalone-panel.png'), (await panel.capturePage()).toPNG());
      }
      assert.equal(await wc.executeJavaScript('state.account'), null);
      console.log('PASS: installed module appears and its embedded settings read/write through real main/preload IPC without Exchange');
      electron.app.exit(0);
    })().catch(error => { console.error(error); electron.app.exit(1); });
  });
});
require('./preview-modules.cjs');

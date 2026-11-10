// Actual renderer, isolated profile and fictional update data. No mailbox or installs.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-update-ui-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(root, 'src/index.html'));
    await window.webContents.executeJavaScript(`(async () => {
      window.asterI18n.setLanguage('ru');
      const value = { installed:'0.0.1', status:'available', autoCheck:true, available:{version:'0.0.2', restart:true, notes:'Вымышленное обновление для проверки'}, error:'' };
      window.aster = { invoke: async () => ({ ok:true, value }) };
      receiveUpdate(value); await updatesModal();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await window.webContents.executeJavaScript(`(() => {
      const dialog=document.querySelector('#modal'), button=dialog.querySelector('[data-update="installUpdate"]');
      return dialog.open && Boolean(button) && button.textContent.includes('Обновить и перезапустить') && dialog.scrollWidth<=dialog.clientWidth+1;
    })()`), true);
    await fs.mkdir(path.join(root, 'release'), { recursive: true });
    await fs.writeFile(path.join(root, 'release/update-restart-ui.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: actual restart-update dialog renders the action without horizontal overflow');
  } finally { window.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

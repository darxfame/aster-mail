// Actual renderer, isolated profile and fictional update data. No mailbox or installs.
if (!process.versions.electron) {
  // Chromium holds profile files until the entire Electron process has exited.
  const fs = require('node:fs/promises');
  (async () => {
    const profile = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'aster-update-ui-'));
    try {
      const child = require('node:child_process').spawn(require('electron'), [__filename, profile], { stdio: 'inherit' });
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => resolve(code ?? 1));
      });
    } finally {
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
  return;
}
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = process.argv[2];
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
    assert.equal(await window.webContents.executeJavaScript(`(() => {
      try {
        const initial = structuredClone(updateSnapshot);
        for (const automaticPrompt of [false, true]) {
          if (automaticPrompt) {
            document.querySelector('#modal').close();
            promptedUpdateVersions.clear();
            enableUpdatePrompts();
            if (!document.querySelector('#updates-panel').dataset.installFlow) throw new Error('Automatic update prompt did not open');
          }
          for (const snapshot of [
            { status: 'available' }, { status: 'checking' }, { status: 'downloading' },
            { status: 'paused' }, { status: 'ready' }, { status: 'ready', installing: true },
            { status: 'ready', staged: true }, { status: 'downloading', retryAt: Date.now() + 1000 },
            { status: 'available', error: 'Fictional update failure' },
          ]) {
            const notes = document.querySelector('.update-notes');
            notes.open = true;
            notes.querySelector('summary').focus();
            receiveUpdate({ ...initial, ...snapshot, progress: 35, received: 350 });
            if (!document.querySelector('.update-notes').open) throw new Error('Release notes collapsed during ' + JSON.stringify(snapshot));
            if (document.activeElement !== document.querySelector('.update-notes summary')) throw new Error('Release notes lost keyboard focus');
            document.querySelector('.update-notes').open = false;
            receiveUpdate({ ...initial, ...snapshot, progress: 40, received: 400 });
            if (document.querySelector('.update-notes').open) throw new Error('Manually closed notes reopened');
          }
          document.querySelector('.update-notes').open = true;
          receiveUpdate({ ...initial, available: { ...initial.available, version: '0.0.3' } });
          if (document.querySelector('.update-notes').open) throw new Error('New release inherited old disclosure state');
          receiveUpdate(initial);
        }
        document.querySelector('.update-notes').open = true;
      } catch (error) { return error.message; }
    })()`), undefined);
    assert.equal(await window.webContents.executeJavaScript(`(async () => {
      try {
        const initial = structuredClone(updateSnapshot);
        window.fixtureCheckRequests = 0;
        window.aster.invoke = async operation => {
          if (operation === 'checkUpdates') fixtureCheckRequests++;
          return { ok: true, value: updateSnapshot };
        };
        receiveUpdate({ ...initial, checkRetryAt: Date.now() + 200 });
        const button = document.querySelector('[data-update=checkUpdates]');
        if (!button.disabled) throw new Error('Repeated check is not disabled');
        button.click();
        if (fixtureCheckRequests) throw new Error('Disabled check made a request');
        if (!document.querySelector('#updates-panel').textContent.includes('Повторная проверка доступна после')) throw new Error('Missing retry time');
        await new Promise(resolve => setTimeout(resolve, 350));
        if (document.querySelector('[data-update=checkUpdates]').disabled) throw new Error('Check did not unlock after cooldown');
        if (!document.querySelector('.update-notes').open) throw new Error('Cooldown collapsed release notes');
        document.querySelector('[data-update=checkUpdates]').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (fixtureCheckRequests !== 1) throw new Error('Unlocked check did not make exactly one request');
        receiveUpdate({ ...initial, error: 'GitHub: HTTP 403' });
        const error = document.querySelector('#updates-panel [role=alert]').textContent;
        if (!error.includes('GitHub') || error.includes('администратор')) throw new Error('GitHub refusal was confused with mailbox access');
        receiveUpdate(initial);
      } catch (error) { return error.message; }
    })()`), undefined);
    await fs.mkdir(path.join(root, 'release'), { recursive: true });
    await fs.writeFile(path.join(root, 'release/update-restart-ui.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: restart-update dialog, automatic/manual prompts, release-note disclosure and keyboard focus across checks/downloads/pause/retry/install/error, manual collapse, version changes, cooldown/unlock and GitHub errors');
  } finally { window.destroy(); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

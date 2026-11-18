// Real application launches share a fictional profile, without Exchange credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

if (process.versions.electron) {
  const { app, BrowserWindow, Menu } = require('electron');
  const [phase, profile] = process.argv.slice(2);
  app.setPath('userData', profile);
  require('../desktop/main.cjs');
  app.whenReady().then(async () => {
    let window;
    for (let attempt = 0; attempt < 200; attempt++) {
      window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/src/index.html') && !item.webContents.isLoading());
      if (window) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(window, 'Application window must load');
    const invoke = (operation, data = {}) => window.webContents.executeJavaScript(`window.aster.invoke(${JSON.stringify(operation)},${JSON.stringify(data)})`);
    let result;
    for (let attempt = 0; attempt < 200; attempt++) {
      result = await invoke('mcpState');
      if (!result.value?.changing) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(result.ok, true);
    assert.equal(result.value.changing, false);
    assert.equal(result.value.enabled, phase === 'disable', 'Restore the last explicit MCP choice');
    assert.equal(Menu.getApplicationMenu().getMenuItemById('aster-mcp').checked, result.value.enabled);
    if (phase !== 'off') {
      const enabled = phase === 'enable';
      assert.deepEqual(await invoke('setMcpEnabled', { enabled }), { ok: true, value: enabled });
      assert.equal(Menu.getApplicationMenu().getMenuItemById('aster-mcp').checked, enabled);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile, 'mcp-preferences.json'), 'utf8')), { enabled });
      if (enabled) assert.ok(JSON.parse(await fs.readFile(path.join(profile, 'mcp-connection.json'), 'utf8')).port);
    }
    if (phase !== 'enable') await assert.rejects(fs.readFile(path.join(profile, 'mcp-connection.json')), { code: 'ENOENT' });
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  const { spawn } = require('node:child_process');
  (async () => {
    const profile = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'aster-mcp-restart-'));
    try {
      for (const phase of ['enable', 'disable', 'off']) {
        await new Promise((resolve, reject) => {
          const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
          const child = spawn(require('electron'), [__filename, phase, profile], { env, stdio: 'inherit', timeout: 20000 });
          child.on('error', reject);
          child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`MCP restart ${phase}: ${signal || code}`)));
        });
        assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'mcp-preferences.json'), 'utf8')).enabled, phase === 'enable', 'Normal quit must preserve the saved choice');
      }
      console.log('PASS: MCP defaults off, restores enabled access after native quit/relaunch, and stays disabled after explicit off and relaunch.');
    } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

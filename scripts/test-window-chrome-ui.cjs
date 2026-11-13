// Actual native overlay on Windows; Chromium layout preview on other platforms.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { windowsChrome } = require('../desktop/window-chrome.cjs');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-window-chrome-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let window;
const js = code => window.webContents.executeJavaScript(code);
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await js(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Window chrome not ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    const output = path.join(root, 'release/window-chrome-ui');
    await fs.mkdir(output, { recursive: true });
    window = new BrowserWindow({ width: 1440, height: 940, show: true, ...windowsChrome(),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    await window.loadFile(path.join(root, 'src/index.html'));
    await js("document.body.classList.add('desktop','windows');document.querySelector('[data-action=demo]').click()");
    await waitFor('state.demo && state.messages.length > 1');
    if (process.platform === 'win32') {
      assert.equal(window.isMenuBarVisible(), false, 'The menu consumes no extra row');
      await waitFor('navigator.windowControlsOverlay.visible');
      window.maximize();
      await waitFor('navigator.windowControlsOverlay.getTitlebarAreaRect().width > 0');
      window.unmaximize();
      window.minimize(); window.restore();
      assert.equal(window.isMinimized(), false);
    }
    for (const theme of ['light', 'dark']) {
      if (process.platform === 'win32') window.setTitleBarOverlay(windowsChrome(theme).titleBarOverlay);
      await js(`state.theme=${JSON.stringify(theme)};applyTheme()`);
      for (const [width, zoom] of [[1440,1],[1024,1],[760,1],[1440,2],[1440,0.8]]) {
        window.setSize(width, 940); window.webContents.setZoomFactor(zoom);
        await js(`document.documentElement.style.setProperty('--interface-scale',${JSON.stringify(String(zoom))})`);
        await new Promise(resolve => setTimeout(resolve, 100));
        for (const collapsed of [false, true]) {
          await js(`document.body.classList.toggle('sidebar-collapsed',${collapsed})`);
          await js('renderSidebar()');
          assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).backgroundColor"), 'rgba(0, 0, 0, 0)');
          assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).borderTopColor"), 'rgba(0, 0, 0, 0)');
          const layout = await js(`(()=>{const bar=document.querySelector('.topbar'),r=bar.getBoundingClientRect();return {right:r.right,top:r.top,bottom:r.bottom,height:r.height,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:[...bar.children].every(el=>el.getBoundingClientRect().right<=r.right+1),drag:getComputedStyle(bar).webkitAppRegion,noDrag:getComputedStyle(document.querySelector('#quick-create')).webkitAppRegion};})()`);
          assert.equal(layout.top, 10, 'No separate title row or extra top padding');
          assert.equal(layout.overflow, false, `${theme} ${width}/${zoom} overflow`);
          assert.equal(layout.buttons, true, `${theme} ${width}/${zoom} toolbar`);
          assert.equal(layout.drag, 'drag'); assert.equal(layout.noDrag, 'no-drag');
          if (process.platform === 'win32') {
            const safe = await js('(()=>{const r=navigator.windowControlsOverlay.getTitlebarAreaRect();return {x:r.x,width:r.width}})()');
            assert.ok(layout.right <= safe.x + safe.width + 1, 'No action underneath native controls');
          } else assert.ok(layout.right <= layout.viewport - 138 / zoom, 'Preview reserves the native control area');
        }
        if (width === 1440 && zoom === 1) {
          await js("document.body.classList.remove('sidebar-collapsed');renderSidebar();openMessage(state.messages[0].id)");
          await new Promise(resolve => setTimeout(resolve, 150));
          await fs.writeFile(path.join(output, `windows-${theme}.png`), (await window.webContents.capturePage()).toPNG());
        }
      }
    }
    window.setSize(960, 800); window.webContents.setZoomFactor(1);
    await js("document.documentElement.style.setProperty('--interface-scale','1');compose();document.body.classList.add('compose-window')");
    assert.equal(await js("getComputedStyle(document.querySelector('.modal-header')).webkitAppRegion"), 'drag');
    assert.equal(await js("getComputedStyle(document.querySelector('.modal-header button')).webkitAppRegion"), 'no-drag');
    assert.equal(await js("(()=>{const h=document.querySelector('.modal-header'),r=h.getBoundingClientRect();return [...h.children].every(el=>el.getBoundingClientRect().right<=r.right-parseFloat(getComputedStyle(h).paddingRight)+1);})()"), true, 'Detached composer actions clear the native buttons');
    await fs.writeFile(path.join(output, 'windows-compose.png'), (await window.webContents.capturePage()).toPNG());
    console.log(`PASS: Windows Air light/dark, safe control area, zoom, compact sidebar and detached editor; ${process.platform === 'win32' ? 'native overlay/menu/maximize/minimize verified' : 'native Windows checks require Windows'}.`);
  } finally {
    window?.destroy();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(error => { if (!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code)) throw error; });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

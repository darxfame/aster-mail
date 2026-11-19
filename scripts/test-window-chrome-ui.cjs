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
const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error('Renderer step:', code); throw error; });
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
          const layout = await js(`(() => {
            const bar = document.querySelector('.topbar'), rect = bar.getBoundingClientRect();
            const children = [...bar.children].map(el => el.getBoundingClientRect()).filter(rect => rect.width);
            return { right: rect.right, top: rect.top, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
              actionsRight: Math.max(...children.map(rect => rect.right)),
              drag: getComputedStyle(bar).webkitAppRegion, noDrag: getComputedStyle(document.querySelector('#quick-create')).webkitAppRegion };
          })()`);
          assert.equal(layout.top, 10, 'No separate title row or extra top padding');
          assert.equal(layout.overflow, false, `${theme} ${width}/${zoom} overflow`);
          assert.ok(layout.actionsRight <= layout.right + 1, `${theme} ${width}/${zoom} toolbar`);
          assert.ok(layout.right >= layout.viewport - 11, 'The toolbar surface spans the window');
          assert.equal(layout.drag, 'drag'); assert.equal(layout.noDrag, 'no-drag');
          if (process.platform === 'win32') {
            const safe = await js('(()=>{const r=navigator.windowControlsOverlay.getTitlebarAreaRect();return {x:r.x,width:r.width}})()');
            assert.ok(layout.actionsRight <= safe.x + safe.width + 1, 'No action underneath native controls');
          } else assert.ok(layout.actionsRight <= layout.viewport - 138 / zoom, 'Preview reserves the native control area');
        }
        if (width === 1440 && zoom === 1) {
          await js("document.body.classList.remove('sidebar-collapsed');renderSidebar();openMessage(state.messages[0].id)");
          await waitFor('document.querySelector(".email-frame")?.offsetHeight > 8');
          assert.equal(await js('document.fonts.ready.then(() => [...document.fonts].some(font => font.family === "Inter" && font.status === "loaded"))'), true, 'The shared UI font is loaded');
          const mail = await js(`(() => {
            const recipients = document.querySelector('.mail-recipients');
            const list = recipients.querySelector('.mail-recipient-list');
            const hidden = !list.getClientRects().length;
            recipients.querySelector('summary').click();
            const visible = list.getClientRects().length > 0;
            recipients.querySelector('summary').click();
            const frame = document.querySelector('.email-frame'), inner = frame.contentDocument.documentElement;
            return { hidden, visible, closedAgain: !list.getClientRects().length,
              outerScheme: getComputedStyle(frame).colorScheme, innerScheme: frame.contentWindow.getComputedStyle(inner).colorScheme,
              background: frame.contentWindow.getComputedStyle(inner).backgroundColor };
          })()`);
          assert.deepEqual(mail, { hidden: true, visible: true, closedAgain: true,
            outerScheme: `${theme} only`, innerScheme: `${theme} only`, background: 'rgba(0, 0, 0, 0)' });
          await new Promise(resolve => setTimeout(resolve, 200));
          await fs.writeFile(path.join(output, `windows-${theme}.png`), (await window.webContents.capturePage()).toPNG());
        }
      }
    }
    // A blurred toolbar is a stacking context: its directory popup must remain
    // above the contacts container, including its clickable actions.
    window.setSize(1280, 940); window.webContents.setZoomFactor(1);
    await waitFor('Math.abs(innerWidth - 1280) < 2');
    await js("document.documentElement.style.setProperty('--interface-scale','1');state.view='contacts';state.query='';loadView();document.querySelector('#demo-banner').hidden=true");
    for (const theme of ['light', 'dark']) {
      await js(`state.theme=${JSON.stringify(theme)};applyTheme();(()=>{const input=document.querySelector('#search');input.focus();input.value='example';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor("!document.querySelector('#people-search-suggestions').hidden && Boolean(document.querySelector('[data-person-pin]')) && !document.querySelector('#people-search-suggestions .recipient-note')");
      const point = await js(`(() => {
        const button = [...document.querySelectorAll('[data-person-pin]')].at(-1);
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit?.className, top: hit?.closest('[data-person-pin]') === button };
      })()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(output, `contacts-search-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      assert.equal(point.top, true, `${theme}: directory actions must be above the contacts surface at ${JSON.stringify(point)}`);
      await js("document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await js("document.querySelector('#people-search-suggestions').hidden"), true);
    }
    await js("(()=>{const input=document.querySelector('#search');input.value='Ирина';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await waitFor("Boolean(document.querySelector('[data-person-pin]:not(:disabled)')) && !document.querySelector('#people-search-suggestions').hidden");
    const pin = await js("(()=>{const r=document.querySelector('[data-person-pin]:not(:disabled)').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    window.focus();
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: Math.round(pin.x), y: Math.round(pin.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: Math.round(pin.x), y: Math.round(pin.y), clickCount: 1 });
    await waitFor("Boolean(document.querySelector('[data-person-pin]:disabled'))");
    await js("document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));state.view='mail';state.query='';loadView()");
    window.setSize(960, 800); window.webContents.setZoomFactor(1);
    await js("document.documentElement.style.setProperty('--interface-scale','1');compose();document.body.classList.add('compose-window')");
    assert.equal(await js("getComputedStyle(document.querySelector('.modal-header')).webkitAppRegion"), 'drag');
    assert.equal(await js("getComputedStyle(document.querySelector('.modal-header button')).webkitAppRegion"), 'no-drag');
    assert.equal(await js("(()=>{const h=document.querySelector('.modal-header'),r=h.getBoundingClientRect();return [...h.children].every(el=>el.getBoundingClientRect().right<=r.right-parseFloat(getComputedStyle(h).paddingRight)+1);})()"), true, 'Detached composer actions clear the native buttons');
    await fs.writeFile(path.join(output, 'windows-compose.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(760, 530);
    await waitFor('innerHeight <= 530');
    assert.ok(await js(`(() => {
      const fields = document.querySelector('.compose-fields');
      const spacer = document.createElement('div'); spacer.style.height = '640px'; fields.append(spacer);
      fields.scrollTop = fields.scrollHeight;
      return fields.scrollTop;
    })()`), 'Composer fields have scrolled');
    const close = await js(`(() => {
      const button = document.querySelector('.modal-header [data-action=close]');
      const bounds = button.getBoundingClientRect();
      const x = Math.round(bounds.right - 3), y = Math.round(bounds.top + 4);
      return { x, y, usable: document.elementFromPoint(x, y) === button };
    })()`);
    assert.equal(close.usable, true, 'The perimeter of the close button remains clickable');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: close.x, y: close.y });
    await waitFor('document.querySelector(".modal-header [data-action=close]").matches(":hover")');
    for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, button: 'left', x: close.x, y: close.y, clickCount: 1 });
    await waitFor('!document.querySelector("#modal").open');

    console.log(`PASS: Windows Air light/dark, safe control area, zoom, compact sidebar and detached editor; ${process.platform === 'win32' ? 'native overlay/menu/maximize/minimize verified' : 'native Windows checks require Windows'}.`);
  } finally {
    window?.destroy();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(error => { if (!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code)) throw error; });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

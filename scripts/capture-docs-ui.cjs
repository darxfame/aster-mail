// Capture the actual renderer with fictional demo data; never connect a mailbox.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'docs/screenshots');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-docs-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let main, widget;
app.whenReady().then(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    main = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: true,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 12 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    main.webContents.session.webRequest.onBeforeRequest((request, callback) => callback({ cancel: /^https?:/.test(request.url) }));
    const js = code => main.webContents.executeJavaScript(code);
    const capture = async (window, name) => {
      await new Promise(resolve => setTimeout(resolve, 250));
      await fs.writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
    };
    await main.loadFile(path.join(root, 'src/index.html'));
    if (process.platform === 'darwin') await js("document.body.classList.add('desktop','mac')");
    await js('document.querySelector("[data-action=demo]").click()');
    await js("state.theme='dark';document.body.classList.add('dark');openMessage(state.messages[0].id)");
    await capture(main, 'mail-dark.png');
    await js("applyLanguage('en');state.theme='light';document.body.classList.remove('dark');renderSidebar();renderMail()");
    await capture(main, 'mail-light.png');
    await js("applyLanguage('ru');state.theme='dark';document.body.classList.add('dark');state.view='calendar';calendarPreference='day';loadView()");
    await capture(main, 'calendar-dark.png');
    widget = new BrowserWindow({ width: 380, height: 560, useContentSize: true, show: true, frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await widget.loadFile(path.join(root, 'src/widget.html'));
    await widget.webContents.executeJavaScript(`window.fixedNow=Date.parse('2026-11-12T11:30:00+03:00');Date.now=()=>fixedNow;render({connected:true,theme:'dark',language:'ru',timeZone:'Europe/Moscow',lastPoll:new Date(fixedNow).toISOString(),calendarEvents:[{id:'current',title:'Обсуждение проекта',start:'2026-11-12T11:00:00+03:00',end:'2026-11-12T12:00:00+03:00',response:'Accept',joinUrl:true},{id:'next',title:'Планирование команды',start:'2026-11-12T12:00:00+03:00',end:'2026-11-12T13:00:00+03:00',response:'Accept',joinUrl:true}],events:[]})`);
    await capture(widget, 'widget.png');
    console.log('Captured current mail light/dark, calendar and widget screenshots with fictional data.');
  } finally {
    widget?.destroy(); main?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

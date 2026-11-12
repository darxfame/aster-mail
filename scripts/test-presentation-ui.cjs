// Verify actual Chromium rendering with fictional mail and calendar data only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-presentation-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    for (const action of ['mail-star', 'mail-important']) {
      for (const enabled of [false, true]) {
        await js(`state.messages[0].flagged=${enabled};state.messages[0].importance=${enabled}?'High':'Normal';renderMail()`);
        const info = await js(`(() => {const b=document.querySelector('[data-action=${action}]');return {title:b.title,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed')};})()`);
        assert.equal(info.pressed, String(enabled)); assert.equal(info.title, info.label);
        assert.equal(info.title, action === 'mail-star' ? enabled ? 'Убрать из избранного' : 'В избранное' : enabled ? 'Обычная важность' : 'Пометить важным');
      }
    }
    await js('settingsModal()');
    assert.equal(await js('document.querySelector("[name=notifyPreview]").checked && document.querySelector("[name=mailTextPreview]").checked'), true);
    assert.equal(await js('document.querySelectorAll("[name=privacyApp]").length'), 15);
    assert.equal(await js('document.querySelectorAll("[name=privacyApp]:checked").length'), 0);
    await js(`state.demo=false;state.account={sessionId:'fixture'};window.aster={};window.savedPreferences=null;api=async (operation,data)=>{if(operation==='saveNotifications'){savedPreferences=data;return data;}if(operation==='togglePresentation')return {presentationMode:data.enabled,privacyActive:data.enabled,presentationUntil:Date.now()+data.minutes*60000};return true;};document.querySelector('#presentation-duration').value='15';document.querySelector('[data-action=presentation-mode][data-presentation-toggle]').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await js('document.querySelector("[data-presentation-toggle]").getAttribute("aria-checked")'), 'true');
    await js(`document.querySelector('[name=privacyApp][value=zoom]').checked=true;document.querySelector('#settings-form').requestSubmit()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(await js('savedPreferences.privacyApps'), ['zoom']);
    await window.setSize(380, 560);
    await window.loadFile(path.join(root, 'src/widget.html'));
    await js(`snapshot.calendarEvents[0].preview='Fictional meeting description';expandedAlerts=true;snapshot.mailAlerts=[{id:'mail',subject:'Fictional subject',text:'Fictional mail description'}];render(snapshot)`);
    assert.match(await js('document.querySelector("#meetings").textContent'), /Fictional meeting description/);
    assert.match(await js('document.querySelector("#meetings").textContent'), /Fictional subject/);
    assert.equal(await js('Boolean(document.querySelector("#privacy-toggle, .privacy-controls"))'), false);
    await js('render({...snapshot,presentationMode:true,privacyActive:true,presentationUntil:Date.now()+15*60000})');
    assert.doesNotMatch(await js('document.querySelector("#meetings").textContent'), /Fictional|Командная встреча/);
    assert.equal(await js('Boolean(document.querySelector(".day-grid"))'), true);
    assert.match(await js('document.querySelector(".featured .time").textContent'), /\d\d:\d\d/);
    const output = path.join(root, 'release/presentation-ui'); await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'private.png'), (await window.webContents.capturePage()).toPNG());
    await js('render({...snapshot,presentationMode:false,privacyActive:false,presentationUntil:0})');
    assert.match(await js('document.querySelector("#meetings").textContent'), /Fictional meeting description/);
    await fs.writeFile(path.join(output, 'normal.png'), (await window.webContents.capturePage()).toPNG());
    const scan = await require('../desktop/sharing-privacy.cjs').scan(['zoom']);
    assert.notEqual(scan, null, 'Actual native process enumeration must succeed');
    assert.equal(typeof scan.active, 'boolean');
    console.log('PASS: state-sensitive mail tooltips, default previews, selected applications saved, presentation switch/timer, private timing preserved and content restored, native process enumeration.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

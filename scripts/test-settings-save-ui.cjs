// Exercise the settings form in Electron with fictional data and offline OWA reads.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-settings-save-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Settings did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js('openMessage(state.messages.find(message=>!message.meeting).id)');
    await js(`window.readerBefore=document.querySelector('#reader');window.selectedBefore=state.selected;syncSignature=true;serverSignature=null;state.demo=false;state.account={server:'https://mail.example.test',username:'fictional',sessionId:'fictional'};window.aster={};window.settingsCalls=[];api=async(operation,data)=>{settingsCalls.push(operation);if(operation==='notificationSettings')return {...notificationPreferences};if(operation==='saveNotifications')return data;if(operation==='moduleCatalog')return [];if(['saveLocalData','setInterfaceScale','setLanguage','moduleMounts'].includes(operation))return true;throw Object.assign(new Error('Не удалось подключиться к OWA. Проверьте адрес, VPN и сертификат сервера.'),{connectionError:true});};void 0`);
    await js('settingsModal()');
    assert.equal(await js('settingsCalls.includes("signature")'), false, 'Opening general settings must not read the OWA signature');
    await js(`document.querySelector('#settings-tab-account').click();document.querySelector('#settings-form').elements.debugErrors.checked=true;document.querySelector('#settings-form').requestSubmit()`);
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('notificationPreferences.debugErrors'), true);
    assert.equal(await js('syncSignature'), true);
    assert.equal(await js('document.querySelector("#reader")===readerBefore && state.selected===selectedBefore'), true);
    assert.equal(await js('settingsCalls.some(operation=>["messages","signature","calendar","connect","restore","autoReplies"].includes(operation))'), false);
    // A failed explicitly requested signature read leaves the preference on and does not block another save.
    await js('settingsModal().then(()=>document.querySelector("#settings-tab-signature").click())');
    await waitFor('document.querySelector("#signature-status").textContent.includes("Не удалось получить подпись")');
    assert.equal(await js('document.querySelector("#settings-form").elements.syncSignature.checked'), true);
    assert.equal(await js('document.querySelector("#settings-form").elements.signature.readOnly'), true);
    await js('document.querySelector("#settings-tab-account").click();document.querySelector("#settings-form").elements.debugErrors.checked=false;document.querySelector("#settings-form").requestSubmit()');
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('notificationPreferences.debugErrors'), false);
    assert.equal(await js('settingsCalls.filter(operation=>operation==="signature").length'),1);
    assert.equal(await js('syncSignature'), true);
    console.log('PASS: debug saves offline, no signature/list reload, reader preserved, explicit signature read failure preserves preference and permits saving.');
  } finally { window?.destroy(); await fs.rm(profile,{recursive:true,force:true,maxRetries:3}); }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});

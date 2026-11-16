// Rules UI uses fictional data only; no Exchange writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-rules-ui-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Rules did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.resolve(__dirname, '../src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`openMessage(state.messages.find(message=>!message.meeting).id);window.readerBefore=document.querySelector('#reader');window.selectedBefore=state.selected;state.demo=false;state.account={server:'https://mail.example.test',username:'fictional',sessionId:'fictional'};window.aster={};window.rulesCalls=[];window.failWrite=false;window.confirm=()=>true;window.ruleFixtures=[{id:'rule1',revision:'a'.repeat(64),name:'Invoices <safe>',sender:'anna@example.test',subject:'Invoice',folder:'target',markRead:true,priority:1,enabled:true,editable:true},{id:'complex',revision:'b'.repeat(64),name:'Complex Outlook',sender:'',subject:'',folder:'',markRead:false,priority:2,enabled:true,editable:false}];api=async(operation,data)=>{rulesCalls.push({operation,data});if(operation==='notificationSettings')return {...notificationPreferences};if(operation==='mailRules')return {items:ruleFixtures};if(operation==='folders')return [{id:'target',name:'Invoices'}];if(operation==='changeMailRule' || operation==='createMailRule'){if(failWrite)throw new Error('Lost response');return true;}if(operation==='moduleCatalog')return [];return true;};void 0`);
    await js('settingsModal()');
    assert.equal(await js('rulesCalls.some(c=>c.operation==="mailRules")'), false, 'Rules are read only when requested');
    await js('document.querySelector("#modal").close();asterMcpUI({method:"panel",input:{panel:"rules"},sessionId:"fictional"})');
    await waitFor('document.querySelectorAll("[data-rule-index]").length===2');
    await js('document.querySelector("[data-rule-index=\\"0\\"]").click()');
    assert.equal(await js('document.querySelector("#settings-form").elements.ruleName.value'), 'Invoices <safe>');
    assert.equal(await js('document.querySelector("[data-rules-list] safe")===null'), true);
    await js(`document.querySelector('#settings-form').elements.ruleEnabled.checked=false;document.querySelector('[data-rule-save]').click()`);
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.find(c=>c.operation==="changeMailRule").data.changes.enabled'), false);
    assert.equal(await js('document.querySelector("[data-rules-editor]").disabled'), true);
    await js('document.querySelector("[data-rule-save]").click()');
    assert.equal(await js('rulesCalls.filter(c=>c.operation==="changeMailRule").length'), 1);
    await js('document.querySelector("[data-rules-load]").click()');
    await waitFor('!document.querySelector("[data-rules-load]").disabled');
    await js('document.querySelector("[data-rule-index=\\"1\\"]").click()');
    assert.equal(await js('document.querySelector("[data-rules-editor]").disabled'), true);
    await js('document.querySelector("[data-rule-index=\\"0\\"]").click();document.querySelector("[data-rule-delete]").click()');
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.filter(c=>c.operation==="changeMailRule").at(-1).data.action'), 'delete');
    await js('document.querySelector("[data-rules-load]").click()');
    await waitFor('!document.querySelector("[data-rules-load]").disabled');
    await js('failWrite=true;document.querySelector("[data-rule-index=\\"0\\"]").click();document.querySelector("[data-rule-save]").click()');
    await waitFor('!modalBusy');
    assert.equal(await js('document.querySelector("[data-rules-editor]").disabled'), true);
    assert.equal(await js('document.querySelector("[data-rules-status]").textContent'), 'Перед следующим сохранением загрузите настройки из Exchange заново.');
    assert.equal(await js('document.querySelector("#reader")===readerBefore && state.selected===selectedBefore'), true);
    await js('document.querySelector("[data-rules-load]").click()');
    await waitFor('!document.querySelector("[data-rules-load]").disabled');
    await js(`failWrite=false;document.querySelector('[data-rules-new]').click();document.querySelector('#settings-form').elements.ruleName.value='New rule';document.querySelector('#settings-form').elements.ruleSender.value='anna@example.test';document.querySelector('[data-rule-save]').click()`);
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.filter(c=>c.operation==="createMailRule").length'), 1);
    await js('document.querySelector("[data-rules-load]").click()');
    await waitFor('!document.querySelector("[data-rules-load]").disabled');
    await js('document.querySelector("[data-rule-index=\\"0\\"]").click()');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.mkdir(path.resolve(__dirname, '../release/screenshots'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../release/screenshots/mail-rules.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: explicit rules settings, safe text, edit/toggle/delete, protected rules, uncertain write lock, reader preserved.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

// Actual Electron UI, isolated profile and fictional demo mail only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-waiting-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`UI did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length>0');
    await js('openMessage(state.messages[0].id)');
    assert.equal(await js('Boolean(document.querySelector("[data-action=wait-for-reply]"))'), false);
    await js(`state.folder='sentitems';loadView()`);
    await js(`openMessage('demo-sent-waiting')`);
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js(`(() => {const bar=document.querySelector('.reader-toolbar');const buttons=[...bar.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0);return bar.scrollWidth<=bar.clientWidth && new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top))).size===1 && buttons.every(button=>button.title && button.getAttribute('aria-label'));})()`), true, 'Sent-message actions must fit one row and have hover hints');
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`(() => {const menu=document.querySelector('.reader-more-actions');if(!menu.open)menu.querySelector('summary').click();})()`);
    await js(`document.querySelector('[data-action=wait-for-reply]').click()`);
    assert.equal(await js('Boolean(document.querySelector("#waiting-reply-form"))'), true);
    const output = path.join(root, 'release/waiting-replies-ui'); await fs.mkdir(output, { recursive: true });
    await js(`document.querySelector('#waiting-reply-form').elements.due.value='2000-01-01T10:00';document.querySelector('#waiting-reply-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#waiting-reply-form .form-error").textContent)');
    assert.equal(await js('demoWaitingReplies.length'), 0);
    await js(`document.querySelector('#waiting-reply-form').elements.due.value=T.wall(new Date(Date.now()+86400000),timeZone).slice(0,16);document.querySelector('#waiting-reply-form').requestSubmit()`);
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('demoWaitingReplies.length'), 1);
    assert.equal(await js('JSON.stringify(demoWaitingReplies).includes("Согласование")'), false);
    await js('waitingRepliesModal()'); await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-entry"))');
    assert.match(await js('document.querySelector(".waiting-entry").textContent'), /Ожидается ответ/);
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector("#waiting-list-form").scrollWidth<=document.querySelector("#waiting-list-form").clientWidth+1'), true);
      await fs.writeFile(path.join(output, `waiting-${width}-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`demoWaitingReplies[0].due='2000-01-01T00:00:00Z';document.querySelector('[data-waiting-refresh]').click()`);
    await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-overdue"))');
    await js(`window.asterDemo.messages.push({id:'fictional-reply',folder:'inbox',subject:'Unrelated subject',from:{name:'Anna',email:'anna@example.com'},to:[],cc:[],attachments:[],date:new Date(Date.now()+1000).toISOString(),inReplyTo:'<demo-sent-waiting@example.com>',isFromMe:false,isDraft:false,itemClass:'IPM.Note',read:false,text:'Fictional reply'});document.querySelector('[data-waiting-refresh]').click()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("[data-waiting-open=fictional-reply]"))');
    assert.match(await js('document.querySelector(".waiting-entry").textContent'), /Найден ответ/);
    await js(`document.querySelector('[data-waiting-open=fictional-reply]').click()`);
    await waitFor('!modalBusy && state.selected?.id==="fictional-reply"');
    assert.equal(await js('state.selected.read'), false, 'Opening from waits must not perform a mailbox write');
    await js('waitingRepliesModal()'); await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-entry"))');
    await js(`document.querySelector('[data-waiting-remove]').click()`); await waitFor('!modalBusy && !document.querySelector(".waiting-entry")');
    assert.equal(await js('demoWaitingReplies.length'), 0);
    await js(`document.querySelector('#modal').close();state.selected=structuredClone(window.asterDemo.messages.find(message=>message.id==='demo-sent-waiting'));state.demo=false;state.account={sessionId:'fixture-alice'};window.waitingCalls=[];api=async(operation,data)=>{waitingCalls.push({operation,data});throw Object.assign(new Error('Storage unavailable'),{userFacing:true});};waitForReplyModal();document.querySelector('#waiting-reply-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#waiting-reply-form .form-error").textContent)');
    assert.equal(await js('waitingCalls.length'), 1);
    assert.equal(await js('waitingCalls[0].operation'), 'waitForReply');
    assert.equal(await js('Object.keys(waitingCalls[0].data).sort().join(",")'), 'due,id');
    assert.equal(await js('Boolean(document.querySelector("#waiting-reply-form").elements.due.value)'), true);
    await js(`api=()=>new Promise(resolve=>{window.completeWait=resolve;});document.querySelector('#waiting-reply-form').requestSubmit()`);
    await waitFor('Boolean(window.completeWait)');
    await js(`document.querySelector('#modal').close();state.account={sessionId:'fixture-bob'};modalBusy=false;modal('Other dialog','','<p id="preserved-dialog">Keep me</p>');completeWait(true)`);
    await waitFor('!modalBusy');
    assert.equal(await js('Boolean(document.querySelector("#preserved-dialog")) && document.querySelector("#modal").open'), true);
    await js(`state.account=null;state.demo=true`);
    await js(`document.querySelector('#modal').close();applyLanguage('en');waitingRepliesModal()`);
    await waitFor('!modalBusy'); assert.match(await js('document.querySelector("#modal").textContent'), /Waiting for reply/);
    console.log('PASS: sent-only action, deadlines, metadata-only demo storage, overdue/reply statuses, original/reply navigation, removal, RU/EN and 100%/200%/narrow layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

// Actual UI and delayed injected reads. No real accounts or mailbox writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-search-'));
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
    window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error('Failed renderer step:', code); throw error; });
    await window.loadFile(path.join(root, 'src/index.html'));
    await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length>0');
    assert.notEqual(await js('getComputedStyle(document.querySelector("[data-action=search-filters]")).display'), 'none');
    await js(`window.fixture=structuredClone(state.messages.find(message=>message.hasAttachments&&!message.meeting));window.originalCount=state.messages.length;void 0`);
    await js(`document.querySelector('[data-action=search-filters]').click()`);
    await waitFor('Boolean(document.querySelector("#mail-search-form"))');
    await js(`(() => {const f=document.querySelector('#mail-search-form');f.elements.from.value=fixture.from.email;f.elements.to.value=fixture.to[0].email;f.elements.start.value=fixture.date.slice(0,10);f.elements.end.value=fixture.date.slice(0,10);f.elements.folder.value='inbox';f.elements.attachments.value='yes';})()`);
    const output = path.join(root, 'release/mail-search-ui'); await fs.mkdir(output, { recursive: true });
    for (const scale of [1, 2]) {
      window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js(`(() => {const bar=document.querySelector('.topbar'),right=bar.getBoundingClientRect().right;return [...bar.children].every(element=>element.getBoundingClientRect().right<=right+1);})()`), true);
      assert.equal(await js('document.querySelector("#mail-search-form").scrollWidth<=document.querySelector("#mail-search-form").clientWidth+1'), true);
      await fs.writeFile(path.join(output, `search-filters-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.webContents.setZoomFactor(1);
    await js(`document.querySelector('#mail-search-form').requestSubmit()`);
    await waitFor('!modalBusy && !document.querySelector("#modal").open && Boolean(state.query)');
    assert.equal(await js('state.messages.some(message=>message.id===fixture.id)'), true);
    assert.equal(await js('state.messages.every(message=>window.asterMailSearch.matches(message,state.mailSearch.criteria))'), true);
    assert.equal(await js('state.searchObjects'), null);
    assert.equal(await js('mailSearchScope()'), 'Входящие');
    await js(`document.querySelector('[data-action=search-filters]').click()`);
    assert.equal(await js('document.querySelector("#mail-search-form").elements.from.value'), await js('fixture.from.email'));
    await js(`document.querySelector('#mail-search-form').elements.end.value='2000-01-01';document.querySelector('#mail-search-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#mail-search-form .form-error").textContent)');
    assert.equal(await js('document.querySelector("#modal").open'), true);
    await js(`document.querySelector('[data-action=clear-search-filters]').click()`);
    await waitFor('!document.querySelector("#modal").open && !state.query && state.messages.length===originalCount');
    await js(`document.querySelector('[data-action=search-filters]').click();document.querySelector('#mail-search-form').elements.folder.value='inbox';document.querySelector('#mail-search-form').requestSubmit()`);
    await waitFor('!modalBusy && state.query==="*"');
    assert.equal(await js('state.messages.length'), await js('originalCount'));
    // Ordinary search exits advanced mode and continues to include related sources.
    await js(`document.querySelector('#search').value='Анна';document.querySelector('#search-form').requestSubmit()`);
    await waitFor('state.query==="Анна" && !state.mailLoading');
    assert.equal(await js('state.mailSearch'), null);
    assert.equal(await js('Boolean(state.searchObjects.calendar && state.searchObjects.contacts)'), true);
    await js(`(() => {state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.com',username:'fictional'};state.mailSearch={query:'from:"fictional@example.com"',criteria:{folder:'inbox'}};state.query=state.mailSearch.query;window.searchCalls=[];api=async(operation,data)=>{if(operation!=='search')return {};searchCalls.push(data);return {items:[{...fixture,id:searchCalls.length===1?'first-match':'older-match'}],more:searchCalls.length===1,nextOffset:searchCalls.length===1?120:121}};})()`);
    await js('loadView()');
    assert.equal(await js('state.offset'), 120);
    await js('loadView(true)');
    assert.equal(await js('searchCalls.length'), 2);
    assert.equal(await js('searchCalls[1].offset'), 120);
    assert.equal(await js('searchCalls.every(call=>call.folder==="inbox" && call.kind==="mail")'), true);
    assert.equal(await js('state.messages[1].id'), 'older-match');
    // A superseded scoped search cannot repaint a different folder, even if it completes later.
    await js(`(() => {state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.com',username:'fictional'};state.mailSearch={query:'from:"fictional@example.com"',criteria:{folder:'inbox'}};state.query=state.mailSearch.query;api=async(operation,data)=>operation==='search'?new Promise(resolve=>window.finishSearch=resolve):{items:[],more:false};void loadView();})()`);
    await waitFor('typeof finishSearch==="function"');
    await js(`(() => {state.generation++;state.view='contacts';document.querySelector('#workspace').innerHTML='<p id="new-view">Keep this view</p>';finishSearch({items:[fixture],more:false});})()`);
    await waitFor('Boolean(document.querySelector("#new-view"))');
    assert.equal(await js('document.querySelector("#new-view").textContent'), 'Keep this view');
    console.log('PASS: mail filter UI, UTC date validation, scoped demo, clearing, ordinary multi-source search, stale results and 100%/200% layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

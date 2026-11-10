// Actual contact card and composer, fictional data and an isolated Electron profile.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-contact-history-'));
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
    await window.loadFile(path.join(root, 'src/index.html')); await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()'); await waitFor('state.demo && state.messages.length>0');
    await js(`window.fixtureId=state.messages[0].id;openMessage(fixtureId)`);
    await js(`window.originalReader=document.querySelector('#reader');for(let i=0;i<54;i++)window.asterDemo.messages.push({id:'history-'+i,subject:'History '+i,folder:'inbox',date:new Date(Date.now()-i*60000).toISOString(),from:{name:'Anna',email:'anna@example.com'},to:[],cc:[],read:false,text:'Fictional mail',attachments:[]});window.asterDemo.messages.push({id:'wrong-address',subject:'anna@example.com',folder:'inbox',date:new Date().toISOString(),from:{name:'Anna',email:'anna@example.com.other'},to:[],cc:[],bcc:[{email:'anna@example.com'}],read:false});document.querySelector('[data-action=open-mail-person][data-group=from]').click()`);
    await waitFor('Boolean(document.querySelector(".contact-history-message")) && document.querySelector(".contact-history").getAttribute("aria-busy")!=="true"');
    assert.equal(await js('document.querySelectorAll(".contact-history-message").length'), 50);
    assert.equal(await js('Boolean(document.querySelector("[data-history-id=wrong-address]"))'), false);
    assert.equal(await js('originalReader===document.querySelector("#reader")'), true);
    assert.equal(await js('Boolean(document.querySelector("[data-history-more]").hidden)'), false);
    await js(`document.querySelector('[data-history-more]').click()`); await waitFor('document.querySelectorAll(".contact-history-message").length>50');
    const output = path.join(root, 'release/contact-history-ui'); await fs.mkdir(output, { recursive: true });
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector(".contact-history").scrollWidth<=document.querySelector(".contact-history").clientWidth+1'), true);
      await fs.writeFile(path.join(output, `contact-${width}-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`document.querySelector('[data-history-id=history-0]').click()`); await waitFor('state.selected?.id==="history-0"');
    assert.equal(await js('state.selected.read'), false, 'Opening a related original must not mark read');
    await js(`openContactCard({name:'No SMTP',email:''})`);
    assert.match(await js('document.querySelector(".contact-history [role=alert]").textContent'), /SMTP/);
    await js(`document.querySelector('#modal').close();state.demo=false;state.account={sessionId:'fixture-alice'};window.pendingHistory=[];api=async(operation)=>{if(operation==='contactHistory')return new Promise(resolve=>pendingHistory.push(resolve));return {items:[]};};openContactCard({name:'First',email:'one@example.com'})`);
    await waitFor('pendingHistory.length===1');
    await js(`document.querySelector('#modal').close();openContactCard({name:'Second',email:'two@example.com'});pendingHistory[0]({items:[{id:'late',subject:'Wrong person',date:new Date().toISOString(),from:{name:'Wrong',email:'one@example.com'},role:'from'}],nextOffset:50,more:false,checked:1})`);
    await waitFor('pendingHistory.length===2');
    assert.equal(await js('document.querySelectorAll(".contact-history-message").length'), 0);
    await js(`pendingHistory[1]({items:[{id:'second',subject:'<img src=x onerror=alert(1)>',date:new Date().toISOString(),from:{name:'Second',email:'two@example.com'},role:'to'}],nextOffset:50,more:true,checked:1})`);
    await waitFor('Boolean(document.querySelector("[data-history-id=second]"))');
    assert.equal(await js('Boolean(document.querySelector(".contact-history img"))'), false);
    await js(`api=async()=>{throw Object.assign(new Error('Access denied'),{userFacing:true});};document.querySelector('[data-history-more]').click()`);
    await waitFor('document.querySelector(".contact-history [role=alert]").textContent.includes("Access denied")');
    assert.equal(await js('document.querySelectorAll(".contact-history-message").length'), 1);
    await js(`api=async(operation)=>{if(operation==='message')return new Promise(resolve=>{window.finishOriginal=resolve;});return {items:[]};};document.querySelector('[data-history-id=second]').click()`); await waitFor('Boolean(window.finishOriginal)');
    await js(`document.querySelector('#modal').close();modal('Other','','<p id="keep-dialog">Keep me</p>');finishOriginal({id:'second'})`);
    assert.equal(await js('Boolean(document.querySelector("#keep-dialog")) && document.querySelector("#modal").open'), true);
    await js(`document.querySelector('#modal').close();api=async(operation)=>{if(operation==='contactHistory')throw Object.assign(new Error('History unavailable'),{userFacing:true});return {items:[{email:'two@example.com',name:'Second',company:'Exact company',phone:'123'}]};};openContactCard({name:'Second',email:'two@example.com'},true)`);
    await waitFor('document.querySelector("[data-contact-field=company]").textContent==="Exact company"');
    assert.match(await js('document.querySelector(".contact-history [role=alert]").textContent'), /History unavailable/);
    assert.equal(await js('document.querySelector("[data-action=write-card-contact]").disabled'), false);
    await js(`document.querySelector('#modal').close();state.demo=true;state.account=null;applyLanguage('en');document.body.classList.add('dark');openContactCard({name:'Anna',email:'anna@example.com'})`);
    await waitFor('Boolean(document.querySelector(".contact-history-message"))');
    assert.match(await js('document.querySelector(".contact-history").textContent'), /Correspondence history/);
    console.log('PASS: exact contact history, paging, original/unread preservation, missing SMTP, stale cards, failed pages, safe text, independent directory/history, RU/EN and 100%/200%/narrow layouts.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

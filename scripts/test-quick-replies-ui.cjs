// Real Chromium selection/undo and compose UI; fictional data, no mailbox requests.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-quick-replies-'));
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
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
    const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error('Failed renderer step:', code); throw error; });
    await window.loadFile(path.join(root, 'src/index.html'));
    await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length > 0');
    await js('compose()');
    await js(`document.querySelector('.quick-replies').open=true`);
    await waitFor('!document.querySelector(".quick-replies fieldset").disabled');
    await js(`document.querySelector('[data-quick-title]').value='Получили документы';document.querySelector('[data-quick-body]').value=${JSON.stringify('Спасибо, документы получили.\nОтветим после проверки. <b>Это текст</b>')};document.querySelector('[data-quick-save]').click()`);
    await waitFor('demoQuickReplies.length===1 && !document.querySelector(".quick-replies fieldset").disabled');
    await js(`(() => {
      const editor=document.querySelector('#compose-body');editor.innerHTML='<p>Before AFTER</p><p><b>Signature</b></p>';editor.focus();
      const range=document.createRange();range.setStart(editor.firstChild.firstChild,7);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new MouseEvent('mouseup'));
      document.querySelector('[data-quick-insert]').click();
    })()`);
    const result = await js('composeData.editor.read()');
    assert.match(result.body, /Before Спасибо, документы получили\./); assert.match(result.body, /AFTER/); assert.match(result.bodyHtml, /<b>Signature<\/b>/);
    assert.match(result.body, /<b>Это текст<\/b>/); assert.doesNotMatch(result.bodyHtml, /<b>Это текст<\/b>/);
    assert.equal(await js('modalDirty'), true);
    await js('document.querySelector("#compose-body").focus();document.execCommand("undo")');
    assert.doesNotMatch((await js('composeData.editor.read()')).body, /документы получили/);
    const before = await js('composeData.editor.read().bodyHtml');
    await js(`document.querySelector('[data-quick-search]').value='несуществующий';document.querySelector('[data-quick-search]').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await js('document.querySelector("[data-quick-list]").options.length'), 0);
    assert.equal(await js('composeData.editor.read().bodyHtml'), before);
    await js(`document.querySelector('[data-quick-search]').value='документы';document.querySelector('[data-quick-search]').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await js('document.querySelector("[data-quick-list]").options.length'), 1);
    await js(`document.querySelector('[data-quick-manage]').open=true;document.querySelector('[data-quick-body]').value+=' Дополнение.';document.querySelector('[data-quick-save]').click()`);
    await waitFor('demoQuickReplies[0].body.endsWith("Дополнение.") && !document.querySelector(".quick-replies fieldset").disabled');
    assert.equal(await js('demoQuickReplies.length'), 1);
    assert.equal(await js('composeData.editor.read().bodyHtml'), before);
    const output = path.join(root, 'release/quick-replies-ui'); await fs.mkdir(output, { recursive: true });
    for (const scale of [1, 2]) {
      window.webContents.setZoomFactor(scale); await js(`document.querySelector('.quick-replies').scrollIntoView({block:'start'})`); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
      await fs.writeFile(path.join(output, `quick-replies-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.webContents.setZoomFactor(1);
    await js(`window.confirm=()=>true;document.querySelector('[data-quick-manage]').open=true;document.querySelector('[data-quick-delete]').click()`);
    await waitFor('demoQuickReplies.length===0');
    // Separate editors use the same UI with account-scoped IPC, never broad preference access.
    await js(`setModalDirty(false);document.querySelector('#modal').close();state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.com',username:'fictional'};api=async operation=>operation==='quickReplies'?{replies:[{id:'saved',title:'Saved',body:'Keep me'}],revision:3}:operation==='saveQuickReplies'?Promise.reject(new Error('Fictional save failure')):[];void 0;`);
    await js('compose()');
    await js(`document.querySelector('.quick-replies').open=true`);
    await waitFor('!document.querySelector(".quick-replies fieldset").disabled');
    await js(`document.querySelector('[data-quick-new]').click();document.querySelector('[data-quick-title]').value='Do not lose';document.querySelector('[data-quick-body]').value='Unsaved template';document.querySelector('[data-quick-save]').click()`);
    await waitFor('Boolean(document.querySelector(".quick-reply-error").textContent)');
    assert.equal(await js('document.querySelector("[data-quick-body]").value'), 'Unsaved template');
    assert.equal(await js('document.querySelector(".quick-replies fieldset").disabled'), false);
    await js(`api=operation=>operation==='quickReplies'?new Promise(resolve=>window.finishRead=resolve):Promise.resolve([]);document.querySelector('[data-quick-reload]').click();setModalDirty(false);document.querySelector('#modal').close()`);
    await js('compose()');
    await js(`finishRead({replies:[{id:'late',title:'Late',body:'Must not appear'}],revision:4})`);
    assert.equal(await js('document.querySelector("[data-quick-list]").options.length'), 0);
    assert.equal(await js('document.querySelector(".quick-replies fieldset").disabled'), true);
    console.log('PASS: quick reply CRUD/search, literal text insertion, caret, undo, signature, save failure, stale reads and 100%/200% layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

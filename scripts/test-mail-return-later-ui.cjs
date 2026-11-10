// Exercise the actual reader and unread filter with fictional demo mail only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-return-later-'));
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
    await waitFor('state.demo && state.messages.length > 0');
    await js(`window.fixtureId=state.messages.find(message=>!message.meeting&&!message.isDraft).id`);
    const output = path.join(root, 'release/mail-return-later-ui'); await fs.mkdir(output, { recursive: true });
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale);
      await js('openMessage(fixtureId)');
      await waitFor('Boolean(document.querySelector("[data-action=return-later]"))');
      assert.equal(await js('state.selected.read'), true);
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js(`(() => {const bar=document.querySelector('#reader .reader-toolbar');const buttons=[...bar.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0);return buttons.every(button=>button.title && button.getAttribute('aria-label')) && new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top))).size===1 && bar.scrollWidth<=bar.clientWidth;})()`), true, 'Visible reader actions must fit one row and have tooltips/accessibility labels');
      assert.equal(await js('document.querySelectorAll("#reader [data-action=unread]").length'), 0, 'Do not duplicate the unread/revisit action');
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(output, `reader-${width}-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
      await js(`(() => {const button=document.querySelector('[data-action=return-later]');const menu=button.closest('details');if(!menu.open)menu.querySelector('summary').click();})()`);
      assert.equal(await js(`document.querySelector('[data-action=return-later]').getBoundingClientRect().width>0`), true, 'Revisit action must be reachable through the compact menu');
      await js('document.querySelector("[data-action=return-later]").click()');
      await waitFor('state.selected===null');
      assert.equal(await js('state.messages.find(message=>message.id===fixtureId).read'), false);
      assert.equal(await js('window.asterDemo.messages.find(message=>message.id===fixtureId).read'), false);
      assert.equal(await js('document.body.classList.contains("reader-open")'), false);
      assert.equal(await js('document.activeElement.dataset.id'), await js('fixtureId'));
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`state.filter='unread';renderMail();openMessage(fixtureId)`);
    await waitFor('state.selected?.read===true');
    assert.equal(await js('filteredMessages().some(message=>message.id===fixtureId)'), false);
    await js('document.querySelector("[data-action=return-later]").click()');
    await waitFor('state.selected===null');
    assert.equal(await js('filteredMessages().some(message=>message.id===fixtureId)'), true);
    // Keep a mounted composer when a successful return action finishes behind it.
    await js('openMessage(fixtureId)'); await js('compose()');
    await js(`document.querySelector('#compose-form').elements.subject.value='Keep this draft';void 0`);
    await js(`returnToMessageLater(document.querySelector('[data-action=return-later]'))`);
    assert.equal(await js('document.querySelector("#compose-form").elements.subject.value'), 'Keep this draft');
    assert.equal(await js('state.selected.id'), await js('fixtureId'));
    assert.equal(await js('state.selected.read'), false);
    console.log('PASS: revisit later closes the reader, restores unread/filter state and focus, preserves a composer, and fits 100%/200% and narrow layouts.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

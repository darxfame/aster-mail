// Actual Chromium editing with fictional recipients and intercepted writes only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-compose-recipients-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js('compose()');
    assert.equal(await js('document.querySelectorAll(".compose-participants .meeting-participant-field").length'), 3);
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden && document.querySelector("#recipient-field-bcc").hidden'), true);
    const entry = (name, value) => js(`(()=>{const input=document.querySelector('[data-participant-target=${name}]');input.focus();input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await entry('to', 'first@example.test; second@example.test');
    await js(`document.querySelector('[data-participant-target=to]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), 'first@example.test, second@example.test');
    assert.equal(await js('document.querySelectorAll(".compose-recipient-card").length'), 2);
    assert.equal(await js('modalDirty'), true);
    await js('document.querySelector(".participant-remove").click()');
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), 'second@example.test');
    // Editing a card retains the canonical field used by sends, drafts and transfers.
    await js(`document.querySelector('.participant-card').click();document.querySelector('#compose-form').elements.to.value='edited@example.test';document.querySelector('#compose-form').elements.to.dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await js('document.querySelector(".participant-card").dataset.email'), 'edited@example.test');
    await js(`document.querySelector('[aria-controls=recipient-field-cc]').click();document.querySelector('[aria-controls=recipient-field-bcc]').click()`);
    await entry('cc', 'copy@example.test');
    await entry('bcc', 'blind@example.test');
    await entry('to', 'pending@example.test, анна');
    await js(`(()=>{const input=document.querySelector('[data-participant-target=to]');for(const key of ['ArrowDown','Enter'])input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));})()`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value.includes("anna")'), true, 'Directory selection adds a card');
    assert.equal(await js('document.querySelector("[data-participant-target=to]").value'), 'pending@example.test', 'Directory selection preserves surrounding addresses');
    // Save commits every pending email without requiring blur or +.
    await js('sendCompose(true)');
    assert.equal(await js('document.querySelector("#modal").open'), false);
    assert.equal(await js('window.asterDemo.messages[0].to.some(person=>person.email==="pending@example.test")'), true);
    assert.equal(await js('window.asterDemo.messages[0].cc[0].email'), 'copy@example.test');
    assert.equal(await js('window.asterDemo.messages[0].bcc[0].email'), 'blind@example.test');
    await js('state.selected=window.asterDemo.messages[0];compose("draft")');
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden || document.querySelector("#recipient-field-bcc").hidden'), false);
    await entry('to', 'unresolved name');
    await js('sendCompose(false)');
    assert.equal(await js('document.querySelector("#modal").open'), true, 'Unresolved names block sending');
    await entry('to', 'transfer@example.test');
    await js(`window.aster={};window.originalApi=api;api=async(operation,data)=>{if(operation==='detachCompose'){window.savedSnapshot=data.snapshot;return true;}return [];};detachCompose('draft')`);
    assert.equal(await js('savedSnapshot.fields.to.includes("transfer@example.test")'), true);
    await js('compose("draft",null,savedSnapshot)');
    assert.equal(await js('document.querySelector("#compose-form").elements.bcc.value'), 'blind@example.test');
    assert.equal(await js('Boolean([...document.querySelectorAll(".participant-card")].find(card=>card.dataset.email==="transfer@example.test"))'), true);
    // Failed transfer preserves source and entered recipients.
    await js(`api=async()=>{throw new Error('Fictional handoff failure')};detachCompose('draft')`);
    assert.equal(await js('document.querySelector("#modal").open && !document.querySelector("#compose-form").inert'), true);
    const output = path.join(root, 'release/compose-recipients-ui'); await fs.mkdir(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      for (const width of [1280, 560]) {
        window.setSize(width, 1000);
        await js(`state.theme=${JSON.stringify(theme)};applyTheme();document.activeElement.blur();document.querySelector('#modal').scrollTop=0`);
        assert.equal(await js('document.querySelector("#compose-form").scrollWidth<=document.querySelector("#compose-form").clientWidth+1'), true);
        await fs.writeFile(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    // Reply/forward keep their existing recipient contracts.
    await js(`window.aster=undefined;api=originalApi;setModalDirty(false);document.querySelector('#modal').close();state.selected=window.asterDemo.messages.find(message=>message.folder==='inbox'&&!message.meeting);compose('reply-all')`);
    assert.equal(await js('document.querySelector("#compose-form").elements.bcc.value'), '');
    assert.equal(await js('Boolean(document.querySelector("#compose-form").elements.to.value)'), true);
    await js(`setModalDirty(false);document.querySelector('#modal').close();compose('forward')`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), '');
    console.log('PASS: recipient cards, removal/editing, multi-address paste, directory selection, dirty state, drafts, pending validation, snapshot restore/failure, reply/forward and responsive light/dark layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

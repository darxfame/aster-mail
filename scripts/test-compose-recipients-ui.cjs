// Actual Chromium editing with fictional recipients and intercepted writes only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const javascriptLiteral = require('./javascript-literal.cjs');
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
    const drag = (address, target) => js(`(() => {
      const source = [...document.querySelectorAll('.compose-participants .participant-card')].find(card => card.dataset.email === ${javascriptLiteral(address)});
      const destination = document.querySelector(${javascriptLiteral(target)});
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    })()`);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js('compose()');
    assert.equal(await js('document.querySelectorAll(".compose-participants .meeting-participant-field").length'), 3);
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden && document.querySelector("#recipient-field-bcc").hidden'), true);
    assert.equal(await js('document.querySelector("[data-participant-target=to]").getClientRects().length > 0'), true);
    assert.equal(await js('document.activeElement.dataset.participantTarget'), 'to');
    assert.equal(await js('document.querySelector(".highlight-palette").matches(":popover-open")'), false);
    await js(`(() => {
      const editor = document.querySelector('#compose-body'), range = document.createRange();
      editor.textContent = ''; const bold = document.createElement('b'); bold.textContent = 'alpha beta'; editor.append(bold);
      range.setStart(bold.firstChild, 0); range.setEnd(bold.firstChild, 5);
      editor.focus(); getSelection().removeAllRanges(); getSelection().addRange(range);
      editor.dispatchEvent(new MouseEvent('mouseup'));
      document.querySelector('[popovertarget=compose-body-highlights]').click();
    })()`);
    assert.equal(await js('document.querySelectorAll("#compose-body-highlights:popover-open .highlight-swatches button").length'), 5);
    assert.equal(await js('Boolean(document.querySelector("#compose-body-highlights:popover-open input[type=color]"))'), true);
    await js(`document.querySelector('.highlight-swatches button').click()`);
    assert.match(await js('composeData.editor.read().bodyHtml'), /background-color:/);
    await js(`document.querySelector('[popovertarget=compose-body-highlights]').click();document.querySelector('[data-value=transparent]').click()`);
    assert.equal(await js('document.querySelector("#compose-body-highlights").matches(":popover-open")'), false);
    assert.match(await js('composeData.editor.read().bodyHtml'), /<b>alpha beta<\/b>/);
    assert.doesNotMatch(await js('composeData.editor.read().bodyHtml'), /background-color:/);

    const entry = (name, value) => js(`(()=>{const input=document.querySelector('[data-participant-target=' + ${javascriptLiteral(name)} + ']');input.focus();input.value=${javascriptLiteral(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await entry('to', 'first@example.test; second@example.test');
    await js(`document.querySelector('[data-participant-target=to]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), 'first@example.test, second@example.test');
    assert.equal(await js('document.querySelectorAll(".compose-recipient-card").length'), 2);
    await drag('second@example.test', '.participant-card[data-email="first@example.test"]');
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), 'second@example.test, first@example.test');
    await drag('first@example.test', '.participant-card[data-email="second@example.test"]');
    await js(`document.querySelector('.participant-card').click();
      window.duplicateEdit = document.querySelector('.compose-recipient-editor:not([hidden]) input');
      duplicateEdit.value = 'second@example.test';
      duplicateEdit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);
    assert.equal(await js('duplicateEdit.validity.customError && document.querySelector("#compose-form").elements.to.value === "first@example.test, second@example.test"'), true);
    await js(`duplicateEdit.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`);
    assert.equal(await js('document.querySelector(".compose-recipient-editor:not([hidden])") === null'), true);
    assert.equal(await js('modalDirty'), true);
    await js('document.querySelector(".participant-remove").click()');
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), 'second@example.test');
    // Editing a card retains the canonical field used by sends, drafts and transfers.
    await js(`document.querySelector('.participant-card').click();
      const edit = document.querySelector('.compose-recipient-editor:not([hidden]) input');
      if (edit.value !== 'second@example.test') throw new Error('Editor must contain only the selected address');
      edit.value = 'edited@example.test'; edit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    `);
    assert.equal(await js('document.querySelector(".participant-card").dataset.email'), 'edited@example.test');
    await drag('edited@example.test', '[aria-controls=recipient-field-cc]');
    assert.equal(await js('document.querySelector("#compose-form").elements.cc.value'), 'edited@example.test');
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden'), false);
    await js(`document.querySelector('[aria-controls=recipient-field-bcc]').click()`);
    await entry('cc', 'copy@example.test');
    await entry('bcc', 'blind@example.test');
    await entry('to', 'pending@example.test, анна');
    await js(`(()=>{const input=document.querySelector('[data-participant-target=to]');for(const key of ['ArrowDown','Enter'])input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));})()`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value.includes("anna")'), true, 'Directory selection adds a card');
    assert.equal(await js('document.querySelector("[data-participant-target=to]").value'), 'pending@example.test', 'Directory selection preserves surrounding addresses');
    await js(`document.querySelector('[aria-controls=recipient-field-cc]').click()`);
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden'), true);
    assert.equal(await js('document.querySelector("#compose-form").elements.cc.value'), 'edited@example.test, copy@example.test');
    // Save commits every pending email without requiring blur or +.
    await js('sendCompose(true)');
    assert.equal(await js('document.querySelector("#modal").open'), false);
    assert.equal(await js('window.asterDemo.messages[0].to.some(person=>person.email==="pending@example.test")'), true);
    assert.equal(await js('window.asterDemo.messages[0].cc[1].email'), 'copy@example.test');
    assert.equal(await js('window.asterDemo.messages[0].bcc[0].email'), 'blind@example.test');
    await js('state.selected=window.asterDemo.messages[0];compose("draft")');
    assert.equal(await js('document.querySelector("#recipient-field-cc").hidden && document.querySelector("#recipient-field-bcc").hidden'), true);
    await entry('to', 'алекс');
    await js(`(() => { const input = document.querySelector('[data-participant-target=to]');
      for (const key of ['ArrowDown', 'Enter']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles:true, cancelable:true }));
    })()`);
    await entry('to', 'unresolved name');
    await js('sendCompose(false)');
    assert.equal(await js('document.querySelector("#modal").open'), true, 'Unresolved names block sending');
    await entry('to', 'transfer@example.test');
    await js(`window.aster={};window.originalApi=api;api=async(operation,data)=>{if(operation==='detachCompose'){window.savedSnapshot=data.snapshot;return true;}return [];};detachCompose('draft')`);
    assert.equal(await js('savedSnapshot.fields.to.includes("transfer@example.test")'), true);
    assert.equal(await js('savedSnapshot.recipientPeople.some(person => person.name === "Алексей Морозов" && person.email === "alex@example.com")'), true);
    await js('compose("draft",null,savedSnapshot)');
    assert.equal(await js('document.querySelector("#compose-form").elements.bcc.value'), 'blind@example.test');
    assert.equal(await js('Boolean([...document.querySelectorAll(".participant-card")].find(card=>card.dataset.email==="transfer@example.test"))'), true);
    assert.equal(await js('document.querySelector(\'.participant-card[data-email="alex@example.com"] strong\').textContent'), 'Алексей Морозов');
    // Failed transfer preserves source and entered recipients.
    await js(`api=async()=>{throw new Error('Fictional handoff failure')};detachCompose('draft')`);
    assert.equal(await js('document.querySelector("#modal").open && !document.querySelector("#compose-form").inert'), true);
    const output = path.join(root, 'release/compose-recipients-ui'); await fs.mkdir(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      for (const width of [1280, 560]) {
        window.setSize(width, 1000);
        await js(`state.theme=${javascriptLiteral(theme)};applyTheme();document.activeElement.blur();document.querySelector('#modal').scrollTop=0`);
        assert.equal(await js('document.querySelector("#compose-form").scrollWidth<=document.querySelector("#compose-form").clientWidth+1'), true);
        await fs.writeFile(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    // Reply/forward keep their existing recipient contracts.
    await js(`window.aster=undefined;api=originalApi;setModalDirty(false);document.querySelector('#modal').close();state.selected=window.asterDemo.messages.find(message=>message.folder==='inbox'&&!message.meeting);compose('reply-all')`);
    assert.equal(await js('document.querySelector("#compose-form").elements.bcc.value'), '');
    assert.equal(await js('Boolean(document.querySelector("#compose-form").elements.to.value)'), true);
    window.setSize(560, 640);
    await js(`(() => {
      setModalDirty(false); document.querySelector('#modal').close();
      const people = (prefix, count) => Array.from({ length: count }, (_, i) => ({ name: 'Fictional Name ' + i, email: prefix + i + '@example.test' }));
      state.selected = { ...state.selected, to: people('to', 12), cc: people('cc', 9) };
      return compose('reply-all');
    })()`);
    const header = await js(`(() => {
      document.activeElement.blur();
      const dialog = document.querySelector('#modal'); dialog.scrollTop = 0;
      const recipients = document.querySelector('.compose-participants').getBoundingClientRect();
      const editor = document.querySelector('.compose-editor').getBoundingClientRect();
      const cards = document.querySelector('.compose-participants .participant-cards');
      const names = [...cards.querySelectorAll('strong')];
      return { height: recipients.height, visibleEditor: dialog.getBoundingClientRect().bottom - editor.top, cards: document.querySelectorAll('.compose-recipient-card').length, overflow: cards.scrollHeight > cards.clientHeight, fullNames: names.every(name => name.scrollWidth <= name.clientWidth + 1 && getComputedStyle(name).textOverflow !== 'ellipsis') };
    })()`);
    assert.equal(header.cards, 22);
    assert.ok(header.height <= 150, `Recipient rows take ${header.height}px`);
    assert.ok(header.visibleEditor >= 80, `Only ${header.visibleEditor}px of editor visible without scrolling`);
    assert.equal(header.overflow, true, 'Long recipient lists scroll inside the row');
    assert.equal(header.fullNames, true, 'Recipient names fit without horizontal clipping or ellipses');
    await js(`(() => {
      const original = {...state.selected, from:{name:'Анна Смирнова',email:'anna@example.test'}, to:[{name:'Илья Орлов',email:'ilya@example.test'}], cc:[{name:'Мария Белова',email:'maria@example.test'}]};
      setModalDirty(false); document.querySelector('#modal').close();
      return compose('reply-all', null, null, {message:original});
    })()`);
    await js(`document.activeElement.blur(); document.querySelector('#modal').scrollTop=0`);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output, 'reply-address-lines.png'), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('[aria-controls=recipient-field-cc]').click(); document.activeElement.blur(); document.querySelector('#modal').scrollTop=0`);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output, 'reply-with-copy.png'), (await window.webContents.capturePage()).toPNG());
    console.log(`PASS: 22 recipients occupy ${Math.round(header.height)}px and leave ${Math.round(header.visibleEditor)}px of the editor visible at 560×640.`);
    await js(`setModalDirty(false);document.querySelector('#modal').close();compose('forward')`);
    assert.equal(await js('document.querySelector("#compose-form").elements.to.value'), '');
    await js(`setModalDirty(false);document.querySelector('#modal').close();compose('new')`);
    assert.equal(await js('document.querySelector("[data-participant-target=to]").getClientRects().length > 0'), true);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(output, 'new-address-lines.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: recipient cards, removal/editing, multi-address paste, directory selection, dirty state, drafts, pending validation, snapshot restore/failure, reply/forward and responsive light/dark layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

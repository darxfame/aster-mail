// Exercise the real reader with long fictional mail, never a real mailbox.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-reader-space-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Reader did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`(() => { const mail=structuredClone(state.messages[0]);mail.id='long-reader-fixture';mail.subject='Длинное письмо для проверки прокрутки';mail.meeting=null;mail.html=Array.from({length:1200},(_,i)=>'<p>Строка '+i+' — вымышленный текст письма для проверки чтения.</p>').join('');mail.to=Array.from({length:12},(_,i)=>({name:'Получатель '+i,email:'person'+i+'@example.test'}));mail.cc=[{name:'Копия',email:'copy@example.test'}];mail.attachments=[{id:'text',name:'notes.txt',size:12,type:'text/plain',previewText:'Fictional attachment text'}, {id:'image',name:'image.png',size:100,type:'image/png',previewUrl:'../assets/icon.png'}];state.messages.unshift(mail); })()`);
    await js("openMessage('long-reader-fixture')");
    await waitFor('Boolean(document.querySelector(".email-frame")?.contentDocument?.body?.textContent.includes("Строка 1199"))');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await js('(() => {const f=document.querySelector(".email-frame");return f.clientHeight>=f.contentDocument.body.scrollHeight})()'), true, 'Long mail must not have an inner vertical scrollbar');
    assert.equal(await js('document.querySelectorAll(".recipient-summary-names").length'), 0, 'Collapsed recipients show counts only');
    await js('document.querySelector(".mail-recipients").open=true');
    assert.equal(await js('document.querySelector(".mail-recipients").querySelectorAll(".mail-person").length'), 12);
    await js('document.querySelector(".mail-recipients").open=false;document.querySelector(".reader-scroll").scrollTop=10000');
    assert.equal(await js('document.querySelector("#reader h2").getBoundingClientRect().bottom<document.querySelector(".reader-toolbar").getBoundingClientRect().bottom'), true, 'Mail header must scroll out of view');
    await js(`document.querySelector('[data-mail-find]').click();window.findInput=document.querySelector('.mail-find input');findInput.value='Строка 999';findInput.dispatchEvent(new Event('input',{bubbles:true}))`);
    await waitFor('document.querySelector(".reader-scroll").scrollTop>20000');
    assert.equal(await js('document.querySelector(".email-frame").contentWindow.scrollY'),0);
    await js('document.querySelector(".mail-find button:last-child").click()');
    await js('document.querySelector(".reader-scroll").scrollTop=240;window.readerFrame=document.querySelector(".email-frame")');
    await js('document.querySelector("[data-action=preview-attachment]").click()');
    await waitFor('Boolean(document.querySelector(".reader-attachment-preview pre"))');
    assert.equal(await js('document.querySelector(".reader-scroll").hidden'), true);
    assert.equal(await js('Math.abs(document.querySelector(".reader-attachment-preview").getBoundingClientRect().top-document.querySelector(".reader-toolbar").getBoundingClientRect().bottom)<2'), true);
    assert.equal(await js('document.querySelector(".reader-attachment-preview pre").textContent'), 'Fictional attachment text');
    await js('window.previewPanel=document.querySelector(".reader-attachment-preview");renderMessages()');
    assert.equal(await js('document.querySelector(".reader-attachment-preview")===previewPanel'),true);
    await js('document.querySelector("[data-close-mail-preview]").click()');
    assert.equal(await js('document.querySelector(".reader-scroll").hidden'), false);
    assert.equal(await js('Boolean(document.querySelector(".reader-attachment-preview"))'), false);
    assert.equal(await js('document.querySelector(".reader-scroll").scrollTop'), 240);
    assert.equal(await js('document.querySelector(".email-frame")===readerFrame'), true);
    await js('previewMailAttachment(document.querySelector("[data-action=preview-attachment][data-id=image]"))');
    await waitFor('Boolean(document.querySelector(".reader-attachment-body img")?.naturalWidth)');
    assert.equal(await js('document.querySelector(".reader-scroll").hidden'), true);
    const output=path.join(root,'release/reader-space-ui');await fs.mkdir(output,{recursive:true});
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(output,'attachment.png'),(await window.webContents.capturePage()).toPNG());
    await js('document.querySelector("[data-close-mail-preview]").click()');
    // A delayed native response after close must not replace the current reader.
    await js(`window.originalApi=api;window.aster={};state.demo=false;window.previewCalls=[];api=async(op,data)=>{previewCalls.push(data.action);if(data.action==='preview')return new Promise(resolve=>window.finishPreview=resolve);return true;};window.pendingPreview=previewMailAttachment(document.querySelector('[data-action=preview-attachment]'));void 0`);
    await js('closeMailAttachmentPreview();finishPreview({kind:"text",text:"STALE PREVIEW"});pendingPreview');
    assert.deepEqual(await js('previewCalls'), ['preview', 'close']);
    assert.equal(await js('document.querySelector("#reader").textContent.includes("STALE PREVIEW")'), false);
    await js('api=originalApi;delete window.aster;state.demo=true;document.querySelector(".reader-scroll").scrollTop=0');
    for (const [width, zoom] of [[1280,1],[640,1],[1280,2]]) {
      window.setSize(width,850);window.webContents.setZoomFactor(zoom);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await js('(() => {const f=document.querySelector(".email-frame");return f.clientHeight>=f.contentDocument.body.scrollHeight})()'),true);
    }
    window.setSize(1280,850);window.webContents.setZoomFactor(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(output,'reader.png'),(await window.webContents.capturePage()).toPNG());
    window.setContentSize(800, 600);
    window.webContents.setZoomFactor(2);
    await waitFor('innerWidth === 400 && innerHeight === 300 && document.body.classList.contains("mail-compact")');
    await js("document.body.classList.add('desktop', 'mac'); document.documentElement.style.setProperty('--interface-scale','2'); returnToMailList()");
    for (const [language, theme] of [['en', 'light'], ['ru', 'dark']]) {
      await js(`applyLanguage('${language}'); state.theme='${theme}'; document.body.classList.toggle('dark', state.theme==='dark'); renderSidebar(); renderMail()`);
      await js("document.querySelector('#search').focus()");
      const layout = await js(`(() => {
        const bounds = selector => document.querySelector(selector).getBoundingClientRect();
        const settings = bounds('.dock-settings'), list = bounds('#messages'), first = bounds('.message-row');
        return { search: bounds('#search').width, settings: settings.bottom, first: first.bottom, list: list.bottom };
      })()`);
      assert.ok(layout.search >= 80 && layout.settings <= 300 && layout.first <= layout.list + 1,
        `At 800×600 and 200%, search, settings and one full mail row fit (${language}): ${JSON.stringify(layout)}`);
      const filterState = () => js(`[...document.querySelectorAll('.list-filters button')].map(button => button.getAttribute('aria-pressed'))`);
      assert.deepEqual(await filterState(), ['true', 'false', 'false']);
      await js(`(() => { const filter = document.querySelector('[data-filter="unread"]'); filter.focus(); filter.click(); })()`);
      await waitFor('document.activeElement.dataset.filter === "unread"');
      assert.deepEqual(await filterState(), ['false', 'true', 'false']);
      await js(`document.querySelector('[data-filter="all"]').click()`);
      await waitFor('document.querySelector(\'[data-filter="all"]\').getAttribute("aria-pressed") === "true"');
      await js(`(() => { const opener = document.querySelector('.message-open'); window.fixtureOpenedId = opener.dataset.id; opener.focus(); opener.click(); })()`);
      await waitFor('Boolean(document.querySelector("#reader h2")) && document.activeElement.dataset.action === "back-to-list"');
      await js('renderReader()');
      assert.equal(await js('document.activeElement.dataset.action'), 'back-to-list', 'Reader refresh preserves the back button focus');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await waitFor('document.activeElement.hasAttribute("data-mail-find")');
      await js('document.querySelector(".back-to-list").focus()');
      await js('document.activeElement.click()');
      assert.equal(await js('document.activeElement.dataset.id === fixtureOpenedId'), true, 'Returning to the list restores focus to the opened message');
      await fs.writeFile(path.join(output, `mail-800x600-200-${language}.png`), (await window.webContents.capturePage()).toPNG());
      await js('document.activeElement.click()');
      await waitFor('Boolean(document.querySelector("#reader [data-action=reply]"))');
      await js('document.querySelector("#reader [data-action=reply]").click()');
      await waitFor('document.activeElement.id === "compose-body"');
      assert.equal(await js(`(() => {
        const bounds = selector => document.querySelector(selector).getBoundingClientRect();
        const editor = bounds('#compose-body'), fields = bounds('.compose-fields'), actions = bounds('.compose-footer');
        const send = bounds('#compose-form [type="submit"]');
        return Math.min(editor.bottom, fields.bottom) - Math.max(editor.top, fields.top) >= 64 &&
          send.top >= fields.bottom && send.bottom <= actions.bottom;
      })()`), true, 'Reply text and Send are visible together at 200%');
      assert.equal(await js(`(() => {
        const dialog = document.querySelector('#modal');
        return matchMedia('(prefers-reduced-transparency: no-preference) and (forced-colors: none)').matches
          ? getComputedStyle(dialog, '::backdrop').backdropFilter.includes('12px')
          : !getComputedStyle(dialog, '::backdrop').backdropFilter.includes('12px');
      })()`), true, 'Compose backdrop respects the system transparency preference');
      if (theme === 'dark') {
        const debuggerSession = window.webContents.debugger;
        debuggerSession.attach('1.3');
        try {
          await debuggerSession.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
          assert.equal(await js('getComputedStyle(document.querySelector("#modal"), "::backdrop").backdropFilter'), 'none');
          await debuggerSession.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        } finally { debuggerSession.detach(); }
      }
      await js('document.querySelector("#modal").close(); settingsModal()');
      const settings = await js(`(() => {
        const picker = document.querySelector('.settings-section-picker');
        const select = document.querySelector('#settings-panel-general select[name="language"]').getBoundingClientRect();
        const panel = document.querySelector('.settings-panels').getBoundingClientRect();
        picker.value = 'settings-tab-notifications';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        return { picker: picker.getClientRects().length > 0, firstFieldFits: select.bottom <= panel.bottom + 1,
          notifications: !document.querySelector('#settings-panel-notifications').hidden };
      })()`);
      assert.deepEqual(settings, { picker: true, firstFieldFits: true, notifications: true });
      await js('document.querySelector("#modal").close(); returnToMailList()');
    }
    console.log('PASS: search and settings fit, a complete mail row is visible, filters expose their pressed state and reader focus returns at 800×600/200% in light EN and dark RU.');
    console.log('PASS: long mail, compact recipients, image/text previews, return with preserved scroll/frame, stale preview cancellation and 100%/200%/narrow layouts.');
  } finally { window?.destroy(); await fs.rm(profile,{recursive:true,force:true,maxRetries:3}); }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});

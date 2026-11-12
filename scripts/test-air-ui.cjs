// Real Chromium layout and delayed fictional reads; no account, network or sends.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-air-ui-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let window;
const js = code => window.webContents.executeJavaScript(code);
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await js(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Air UI did not become ready: ${expression}`);
}
const output = path.join(root, 'release/air-ui');
async function screenshot(name) {
  await new Promise(resolve => setTimeout(resolve, 100));
  await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    window = new BrowserWindow({ width: 1920, height: 940, useContentSize: true, show: true,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 34 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length > 1');
    if (process.platform === 'darwin') {
      await js("document.body.classList.add('desktop','mac');document.querySelector('.app-shell').prepend(document.querySelector('.topbar'))");
      assert.deepEqual(window.getWindowButtonPosition(), { x: 22, y: 34 });
      assert.equal(window.getBounds().height, window.getContentBounds().height, 'No separate native title bar consumes content height');
      for (const zoom of [0.8, 1, 2]) {
        window.webContents.setZoomFactor(zoom);
        window.setWindowButtonPosition({ x: Math.round(22 * zoom), y: Math.round(41 * zoom - 7) });
        for (const collapsed of [false, true]) {
          await js(`document.body.classList.toggle('sidebar-collapsed',${collapsed})`);
          const controlsBottom = (window.getWindowButtonPosition().y + 14) / zoom;
          assert.equal(await js(`document.querySelector('.wordmark').getBoundingClientRect().top>${controlsBottom}`), true, 'Brand stays below native controls at every scale');
          assert.equal(await js(`document.querySelector('#quick-create').getBoundingClientRect().left>${(window.getWindowButtonPosition().x + 70) / zoom}`), true, 'Toolbar stays clear of native controls with either sidebar width');
          assert.equal(await js("getComputedStyle(document.querySelector('.topbar')).webkitAppRegion"), 'drag');
          assert.equal(await js("document.querySelector('.sidebar').getBoundingClientRect().top>=document.querySelector('.topbar').getBoundingClientRect().bottom"), true, 'Sidebar starts below the shared toolbar');
          assert.equal(await js("document.querySelector('.topbar').getBoundingClientRect().left<12"), true, 'Toolbar spans both sidebar and workspace');
          assert.equal(await js("getComputedStyle(document.querySelector('#quick-create')).webkitAppRegion"), 'no-drag');
        }
      }
      window.webContents.setZoomFactor(1);
      window.setWindowButtonPosition({ x: 22, y: 34 });
      await js('renderSidebar()');
    }
    await js(`window.fixtureMessages=structuredClone(state.messages).map(m=>({...m,read:true})); window.fixtureApi=api;void 0;`);
    await js('openMessage(state.messages[0].id)');
    assert.equal(await js(`Math.abs(document.querySelector('.reader-content').getBoundingClientRect().width-document.querySelector('.reader-scroll').clientWidth)<1`), true, 'Mail content must use the full reader width on a wide window');
    await screenshot('mail-light');
    // Preserve every existing action and the original semantic palette.
    assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"), '#7760d6');
    for (const selector of ['[data-mail-find]', '[data-mail-move]', '[data-action=archive]', '[data-action=delete]', '[data-action=reply]', '[data-action=reply-all]', '[data-action=forward]', '.mail-select', '.message-quick-actions', '.privacy-note', '.sender-detail']) assert.equal(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), true, selector);
    assert.notEqual(await js("getComputedStyle(document.querySelector('.topbar')).backdropFilter"), 'none');
    assert.equal(await js('Boolean(document.querySelector(".reader-toolbar .privacy-note[title]")) && !document.querySelector(".reader-content .privacy-note")'), true, 'Image policy belongs in a compact labelled toolbar indicator');
    // All reads below use manually released promises, with no artificial UI delay.
    await js(`state.demo=false;state.account={server:'https://mail.example.test',username:'fictional@example.test',sessionId:'air-fixture'};window.fixtureReads=[];
      api=async(operation,data={})=>{
        if(['messages','message','calendar','contacts','eventDetails'].includes(operation))return new Promise((resolve,reject)=>fixtureReads.push({operation,data,resolve,reject}));
        if(operation==='contentImages')return {images:{},errors:{}};
        if(operation==='personPhoto')return null;
        if(operation==='change')return {changeKey:'fictional-key'};
        return [];
      };state.mailViewKey=null;state.selected=null;window.fixtureLoad=loadView();void 0;`);
    assert.equal(await js('Boolean(document.querySelector(".loading-mail[aria-busy=true]"))'), true);
    assert.equal(await js('document.querySelectorAll(".loading-placeholder button,.loading-placeholder input").length'), 0);
    await screenshot('mail-skeleton');
    await js(`fixtureReads.shift().resolve({items:structuredClone(fixtureMessages),more:false});fixtureLoad`);
    assert.equal(await js('Boolean(document.querySelector(".loading-placeholder"))'), false);
    await js('window.fixtureRead=openMessage(state.messages[0].id);void 0');
    assert.equal(await js('Boolean(document.querySelector("#reader .loading-reader"))'), true);
    assert.equal(await js(`Math.abs(document.querySelector('#reader .skeleton-reader').getBoundingClientRect().width-document.querySelector('#reader .skeleton-layout').clientWidth)<1`), true, 'Reader skeleton must use the same full width');
    await screenshot('reader-skeleton');
    await js('fixtureReads.shift().resolve({...fixtureMessages[0],meeting:null});fixtureRead');
    assert.equal(await js('Boolean(document.querySelector("#reader .sender-detail"))'), true);
    // Overlapping message reads must not let the first response replace the second.
    await js('window.fixtureOld=openMessage(state.messages[0].id);window.fixtureNew=openMessage(state.messages[1].id);void 0');
    await js('fixtureReads[1].resolve({...fixtureMessages[1],meeting:null});fixtureNew');
    await js('fixtureReads[0].resolve({...fixtureMessages[0],meeting:null});fixtureOld;fixtureReads=[];');
    assert.equal(await js('state.selected.id===fixtureMessages[1].id && !document.querySelector(".loading-placeholder")'), true);
    // Network recovery remains the existing compact waiting state, with no timer.
    await js('window.fixtureRead=openMessage(state.messages[0].id);void 0');
    await js('fixtureReads.shift().reject(Object.assign(new Error("Fictional offline"),{connectionError:true}));fixtureRead');
    assert.equal(await js('Boolean(state.recoverMessage) && !document.querySelector("#reader .loading-placeholder")'), true);
    await js('window.fixtureRead=openMessage(state.messages[0].id);void 0');
    await js('fixtureReads.shift().resolve({...fixtureMessages[0],meeting:null});fixtureRead');
    // Do not mount a skeleton over existing mail during a same-folder refresh.
    await js('window.fixtureReader=document.querySelector("#reader");window.fixtureLoad=loadView();void 0');
    assert.equal(await js('document.querySelector("#reader")===fixtureReader && !document.querySelector(".loading-placeholder")'), true);
    await js('fixtureReads.shift().resolve({items:structuredClone(fixtureMessages),more:false});fixtureLoad');
    // An obsolete folder read cannot replace the calendar or its loading state.
    await js('state.mailViewKey=null;window.fixtureOld=loadView();state.view="calendar";window.fixtureCalendar=loadView();void 0');
    await js('fixtureReads[0].resolve({items:structuredClone(fixtureMessages),more:false});fixtureOld');
    assert.equal(await js('Boolean(document.querySelector(".loading-calendar"))'), true);
    await js('fixtureReads[1].resolve(structuredClone(window.asterDemo.events));fixtureCalendar;fixtureReads=[];');
    assert.equal(await js('Boolean(document.querySelector(".calendar-legend")) && !document.querySelector(".loading-placeholder")'), true);
    // A failed read replaces the skeleton with the existing actionable error.
    await js('state.view="contacts";window.fixtureLoad=loadView();void 0');
    assert.equal(await js('Boolean(document.querySelector(".loading-contacts"))'), true);
    await js('fixtureReads.shift().reject(new Error("Fictional contact failure"));fixtureLoad');
    assert.equal(await js('!document.querySelector(".loading-placeholder") && Boolean(document.querySelector("#workspace [data-action=refresh]"))'), true);
    // Return to demo for editable drafts, screenshots and all responsive layouts.
    await js('api=fixtureApi;state.account=null;state.demo=true;state.view="mail";state.mailViewKey=null;loadView()');
    await js('openMessage(state.messages[0].id)');
    await js(`compose()`);
    await js(`window.fixtureForm=document.querySelector('#compose-form');fixtureForm.elements.subject.value='Fictional draft';window.fixtureEditor=fixtureForm.querySelector('[contenteditable]');fixtureEditor.textContent='Keep this draft';window.fixtureReader=document.querySelector('#reader');renderMessages();`);
    assert.equal(await js('document.querySelector("#reader")===fixtureReader && document.querySelector("#compose-form")===fixtureForm && fixtureEditor.textContent==="Keep this draft"'), true);
    await js(`(async()=>{state.demo=false;state.account={sessionId:'air-inbox',server:'https://mail.example.test',username:'fictional@example.test'};try{await receiveInbox({sessionId:'air-inbox',page:{items:[{...fixtureMessages[1],id:'fictional-new'},...fixtureMessages],more:false}});}finally{state.account=null;state.demo=true;}})()`);
    assert.equal(await js('state.messages[0].id==="fictional-new" && document.querySelector("#reader")===fixtureReader && document.querySelector("#compose-form")===fixtureForm && fixtureEditor.textContent==="Keep this draft" && !document.querySelector(".loading-placeholder")'), true);
    await screenshot('compose-light');
    await js('setModalDirty(false);document.querySelector("#modal").close()');
    // Respect reduced motion in the actual Chromium runtime.
    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await js(`(()=>{const holder=document.createElement('div');holder.innerHTML=window.asterLoading.markup('reader','Loading');document.body.append(holder);const animation=getComputedStyle(holder.querySelector('.skeleton-bar'),'::after').animationName;holder.remove();return animation})()`), 'none');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await js('getComputedStyle(document.querySelector(".topbar")).backdropFilter'), 'none');
    await window.webContents.debugger.detach();
    for (const theme of ['light', 'dark']) {
      await js(`state.theme=${JSON.stringify(theme)};document.body.classList.toggle('dark',state.theme==='dark');`);
      const colors = await js(`(()=>{const node=document.createElement('div');document.body.append(node);const result={};for(const kind of ['pending','accepted','organized','declined']){node.className='event-card event-'+kind;const s=getComputedStyle(node);result[kind]=[s.backgroundColor,s.borderLeftColor,s.color];}node.remove();return result;})()`);
      const originalColors = await js(`(()=>{const sheet=document.querySelector('link[href="air.css"]').sheet;sheet.disabled=true;try{const node=document.createElement('div');document.body.append(node);const result={};for(const kind of ['pending','accepted','organized','declined']){node.className='event-card event-'+kind;const s=getComputedStyle(node);result[kind]=[s.backgroundColor,s.borderLeftColor,s.color];}node.remove();return result;}finally{sheet.disabled=false;}})()`);
      assert.deepEqual(colors, originalColors, `${theme} event fills, rails and text must match the original styles`);
      for (const [width, zoom] of [[1440,1],[1024,1],[760,1],[1440,2]]) {
        window.setContentSize(width, 940); window.webContents.setZoomFactor(zoom);
        await waitFor(`Math.abs(innerWidth-${width/zoom})<2`);
        for (const view of ['mail','calendar','contacts']) {
          await js(`state.view=${JSON.stringify(view)};loadView()`);
          if (view === 'mail') await js('openMessage(state.messages[0].id)');
          await new Promise(resolve => setTimeout(resolve, 120));
          assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, `${view} ${theme} ${width}/${zoom} horizontal overflow`);
          if (view === 'mail') assert.equal(await js(`(()=>{const frame=document.querySelector('.email-frame');return !frame || frame.contentWindow.getComputedStyle(frame.contentDocument.body).backgroundColor==='rgb(255, 255, 255)';})()`), true, 'HTML messages keep a white surface independently of chrome theme');
          assert.equal(await js(`(()=>{const bar=document.querySelector('.topbar'),right=bar.getBoundingClientRect().right;return [...bar.children].every(el=>el.getBoundingClientRect().right<=right+1);})()`), true, `toolbar ${theme} ${width}/${zoom}`);
          if (width === 1440 && zoom === 1) await screenshot(`${view}-${theme}`);
        }
      }
    }
    console.log('PASS: real delayed reads, skeleton success/error/recovery, stale navigation, retained reader/draft, semantic colors, reduced motion/transparency and responsive light/dark screens.');
  } finally {
    window?.destroy();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

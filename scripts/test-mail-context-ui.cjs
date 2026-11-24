// Context-menu writes use fictional in-memory accounts and an injected backend only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-mail-context-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 800, show: true,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 12 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    async function waitFor(expression) {
      for (let i = 0; i < 150; i++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 20)); }
      throw new Error(`Context UI did not become ready: ${expression}`);
    }
    await window.loadFile(path.join(root,'src/index.html'));
    await js("applyLanguage('ru')");
    if (process.platform === 'darwin') await js("document.body.classList.add('desktop','mac')");
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`window.selectionButtons = () => [...document.querySelectorAll('#messages .message-open')];
      window.selectedPositions = () => selectionButtons().map((button, position) => mailSelection.has(button.dataset.id) ? position : -1).filter(position => position !== -1);
      window.shiftClick = position => selectionButtons()[position].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
      window.toggleClick = (position, platform) => {
        const desktopApi = window.aster;
        window.aster = { platform };
        try {
          selectionButtons()[position].dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, metaKey: platform === 'darwin', ctrlKey: platform === 'win32'
          }));
        } finally {
          window.aster = desktopApi;
        }
      };
      window.selectionKey = (key, shiftKey = true) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); void 0;`);
    assert.equal(await js('document.querySelectorAll(".mail-select:not([hidden]), .mail-selection-bar").length'), 0);
    await js('selectionButtons()[0].parentElement.classList.add("selected"); selectionButtons()[0].focus()');
    function tab(modifiers = []) {
      for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: 'Tab', modifiers });
    }
    tab();
    await waitFor('document.activeElement.matches(".message-quick-actions button:focus-visible")');
    assert.equal(await js('getComputedStyle(selectionButtons()[0].parentElement).outlineStyle'), 'none');
    assert.equal(await js('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
    tab(['shift']);
    await waitFor('document.activeElement === selectionButtons()[0] && document.activeElement.matches(":focus-visible")');
    assert.deepEqual(await js(`(() => {
      const button = selectionButtons()[0], row = getComputedStyle(button.parentElement);
      return [getComputedStyle(button).outlineStyle, row.outlineStyle, row.outlineOffset, parseFloat(row.borderRadius) > 0];
    })()`), ['none', 'solid', '-2px', true], 'Keyboard focus follows the rounded row, including its quick actions');
    await js('selectionButtons()[0].parentElement.classList.remove("selected")');
    await js(`selectionButtons()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, clientX:400, clientY:300 }))`);
    assert.equal(await js('document.querySelectorAll(".mail-select:not([hidden])").length'), 0, 'Opening the menu alone leaves checkboxes hidden');
    await js('document.querySelector("[data-mail-context=select]").click()');
    assert.deepEqual(await js('selectedPositions()'), [1]);
    assert.equal(await js('document.querySelectorAll(".mail-select:not([hidden])").length === selectionButtons().length'), true);
    await js('shiftClick(4)');
    assert.deepEqual(await js('selectedPositions()'), [1, 2, 3, 4]);
    await js('selectionKey("ArrowUp")');
    assert.deepEqual(await js('selectedPositions()'), [1, 2, 3]);
    await js('shiftClick(0)');
    assert.deepEqual(await js('selectedPositions()'), [0, 1]);
    await js('selectionKey("Escape", false); selectionButtons()[2].focus(); selectionKey("ArrowUp")');
    assert.deepEqual(await js('selectedPositions()'), [1, 2], 'Shift navigation starts from the focused mail even outside selection mode');
    await js('selectionKey("Escape", false); selectionButtons()[0].focus(); shiftClick(3)');
    assert.deepEqual(await js('selectedPositions()'), [0, 1, 2, 3]);
    assert.equal(await js('state.selected === null'), true, 'Selecting a range does not open a message');
    await js('selectionKey("Escape", false)');
    assert.equal(await js('mailSelection.size === 0 && document.querySelectorAll(".mail-select:not([hidden]), .mail-selection-bar").length === 0'), true);
    async function clickWithNativeModifier(position, modifier, expected) {
      const point = await js(`(() => {
        const rect = selectionButtons()[${position}].getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`);
      for (const type of ['mouseDown', 'mouseUp']) {
        window.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1, modifiers: [modifier] });
      }
      await waitFor(`JSON.stringify(selectedPositions()) === '${JSON.stringify(expected)}'`);
    }
    for (const platform of ['darwin', 'win32']) {
      const toggle = platform === process.platform
        ? (position, expected) => clickWithNativeModifier(position, platform === 'darwin' ? 'meta' : 'control', expected)
        : position => js(`toggleClick(${position}, ${JSON.stringify(platform)})`);
      await toggle(0, [0]);
      await toggle(3, [0, 3]);
      assert.deepEqual(await js('selectedPositions()'), [0, 3], platform);
      assert.equal(await js('document.activeElement === selectionButtons()[3]'), true, platform);
      await toggle(0, [3]);
      assert.deepEqual(await js('selectedPositions()'), [3], platform);
      await toggle(3, []);
      assert.deepEqual(await js('selectedPositions()'), [], platform);
      assert.equal(await js('document.querySelectorAll(".mail-select:not([hidden]), .mail-selection-bar").length'), 0, platform);
      assert.equal(await js('state.selected'), null, platform);
    }
    await js('openMessage(state.messages[0].id)');
    await js(`window.readerBefore=document.querySelector('#reader');window.selectedBefore=state.selected.id;window.targetId=state.messages[1].id;window.otherId=state.messages[2].id;state.messages[1].read=true;state.demo=false;state.account={sessionId:'context-fixture',server:'https://mail.example.test',username:'fictional@example.test'};window.calls=[];api=async(operation,data)=>{if(operation==='personPhoto')return null;calls.push({operation,data});if(operation!=='mailBatch')throw new Error('Unexpected operation');return {results:data.refs.map(ref=>({id:ref.id,status:'done',changeKey:'updated-key'}))}};renderMessages();mailSelection.add(otherId);renderMailBatchToolbar();void 0;`);
    const open = async () => js(`document.querySelector('[data-id="'+targetId+'"] .message-open').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}))`);
    await open();
    assert.equal(await js('state.selected.id===selectedBefore && calls.length===0'),true,`Right click neither opens nor marks a message read: ${JSON.stringify(await js('({selected:state.selected?.id,before:selectedBefore,calls})'))}`);
    assert.equal(await js('document.querySelector(".mail-context-menu").getBoundingClientRect().right<=innerWidth && document.querySelector(".mail-context-menu").getBoundingClientRect().bottom<=innerHeight'),true);
    assert.equal(await js('document.querySelector("[data-mail-context=unread]").textContent'),'Пометить непрочитанным');
    await js(`window.finishRead=null;readingMessages.set(targetId,new Promise(resolve=>{finishRead=()=>{state.messages[1].changeKey='fresh-before-context';readingMessages.delete(targetId);resolve()}}));document.querySelector('[data-mail-context=unread]').click()`);
    assert.equal(await js('calls.length'),0,'Context action waits for an outstanding read to get a fresh ChangeKey');
    await js('finishRead()');
    await waitFor('!mailBatchBusy && calls.length===1');
    assert.equal(await js('calls[0].data.refs[0].changeKey'),'fresh-before-context');
    assert.equal(await js('calls[0].data.action'),'unread');
    assert.equal(await js('calls[0].data.refs.length'),1);
    assert.equal(await js('state.messages.find(m=>m.id===targetId).read'),false);
    assert.equal(await js('mailSelection.has(otherId)'),true,'Other checked messages are not affected');
    assert.equal(await js('document.querySelector("#reader")===readerBefore && state.selected.id===selectedBefore'),true,'The other open message remains mounted');
    await js("applyLanguage('en')"); await open();
    assert.equal(await js('document.querySelector("[data-mail-context=read]").textContent'),'Mark as read','Menu follows English UI independently of the OS language');
    await js("closeMailContextMenu();applyLanguage('ru')"); await open();
    assert.equal(await js('document.querySelector("[data-mail-context=read]").textContent'),'Пометить прочитанным');
    await js('document.querySelector("[data-mail-context=read]").click()'); await waitFor('!mailBatchBusy && calls.length===2');
    assert.equal(await js('state.messages.find(m=>m.id===targetId).read'),true);
    await open(); await js('state.generation++;document.querySelector("[data-mail-context=trash]").click()');
    assert.equal(await js('calls.length'),2,'A menu overtaken by navigation cannot mutate another view');
    await js(`document.querySelector('[data-id="'+targetId+'"] .message-open').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}))`);
    assert.equal(await js('Boolean(document.querySelector(".mail-context-menu"))'),true,'Keyboard opens the same menu');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    assert.equal(await js('Boolean(document.querySelector(".mail-context-menu"))'),false);
    await new Promise(resolve=>setTimeout(resolve,80));
    await open();
    await new Promise(resolve=>setTimeout(resolve,80));
    const output=path.join(root,'release/mail-context-ui');await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'menu.png'),(await window.webContents.capturePage()).toPNG());
    await js(`window.loadBefore=loadView;loadView=async()=>{};api=async(operation,data)=>{calls.push({operation,data});return {results:[{id:targetId,status:'uncertain',error:'Fictional uncertain write'}]}};document.querySelector('[data-mail-context=trash]').click()`);
    await waitFor('!mailBatchBusy && calls.length===3');
    assert.equal(await js('calls[2].data.action'),'trash');
    assert.equal(await js('mailSelection.has(otherId)'),true);
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await js('calls.length'),3,'Uncertain mutations are never retried');
    await js(`state.selected.importance='Normal';state.messages.find(m=>m.id===selectedBefore).importance='Normal';
      window.importanceWrites=[];
      api=async(operation,data)=>{
        if(operation==='personPhoto') return null;
        if(operation!=='change') throw new Error('Unexpected operation');
        importanceWrites.push(data);return {changeKey:'importance-key'};
      };renderMessages();renderReader();
      document.querySelector('[data-action=mail-important][data-id="'+selectedBefore+'"]').click();void 0;`);
    await waitFor("state.selected.importance==='High'");
    assert.equal(await js("state.messages.find(m=>m.id===selectedBefore).importance"),'High');
    assert.deepEqual(await js('importanceWrites.map(write=>[write.field,write.value])'),[['Importance','High']]);
    await js("document.querySelector('[data-action=important]').click()");
    await waitFor("state.selected.importance==='Normal'");
    assert.deepEqual(await js('importanceWrites.map(write=>[write.field,write.value])'),[['Importance','High'],['Importance','Normal']]);
    console.log('PASS: modifier-click and Shift selection, right-click/keyboard menus, fresh read/unread keys, preserved reader, viewport placement, stale navigation and no uncertain-write retry.');
  } finally {
    window?.destroy();
    await fs.rm(profile,{recursive:true,force:true,maxRetries:3}).catch(error=>{
      if(process.platform!=='win32'||!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code))throw error;
    });
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});

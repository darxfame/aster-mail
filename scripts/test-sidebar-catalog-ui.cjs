// Actual Chromium layout checks with fictional catalog data and no mailbox access.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-sidebar-ui-')));
app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const wc = window.webContents;
  await window.loadFile(path.join(__dirname, '../src/index.html'));
  await wc.executeJavaScript('applyLanguage("ru"); document.querySelector("[data-action=demo]").click()');
  for (let i = 0; i < 100 && !await wc.executeJavaScript('state.demo && state.messages.length > 0'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  for (const scale of [1, 1.5, 2]) {
    wc.setZoomFactor(scale);
    for (const width of [180, 210, 300]) {
      const report = await wc.executeJavaScript(`(() => {
        sidebarCollapsed=false; renderSidebar(); document.querySelector('.sidebar').style.width='${width}px'; document.querySelector('.sidebar').style.minWidth='${width}px';
        return [...document.querySelectorAll('.folder-row')].map(row => { const button=row.querySelector('.folder'), rect=button.getBoundingClientRect(), parent=row.getBoundingClientRect(); return { width:rect.width, right:rect.right, edge:Math.min(parent.right, document.querySelector(".sidebar-scroll").getBoundingClientRect().right) }; });
      })()`);
      assert.ok(report.length > 5);
      assert.ok(report.every(row => row.right <= row.edge + 1), `Folder overflow at ${width}px/${scale}: ${JSON.stringify(report)}`);
    }
    await wc.executeJavaScript('sidebarCollapsed=true; renderSidebar()');
    assert.equal(await wc.executeJavaScript('[...document.querySelectorAll(".folder-row>.folder")].filter(el=>el.getClientRects().length).every(el=>Math.abs(el.getBoundingClientRect().width-44)<1)'), true);
  }
  wc.setZoomFactor(1);
  await wc.executeJavaScript(`(async () => {
    eventModal(new Date()); const form=document.querySelector('#event-form');
    const event=window.asterDemo.events.find(event=>event.id==='demo-event-3');
    form.elements.start.value=localDate(event.start); form.elements.end.value=localDate(event.end); form.elements.attendees.value='';
    await runPlanner(form.querySelector('[data-action=planner-check]'));
  })()`);
  assert.equal(await wc.executeJavaScript('Boolean(document.querySelector(".planner-verdict.busy"))'), true);
  assert.equal(await wc.executeJavaScript('document.querySelector(".planner-people").textContent.includes("Вы")'), true);
  await wc.executeJavaScript('setModalDirty(false); document.querySelector("#modal").close()');
  await wc.executeJavaScript(`(async () => {
    sidebarCollapsed=false; renderSidebar(); window.aster={}; state.account=null; state.demo=true;
    window.catalogCalls=[]; api=async (operation) => { catalogCalls.push(operation); if(operation==='moduleCatalog') return []; return { revision:'a'.repeat(40), modules:[{ manifest:{id:'fictional.module',name:'Fictional meetings',version:'1.0.0',permissions:['ui','network'],networkOrigins:['https://service.example.test']},description:'Create a meeting link',digest:'b'.repeat(64),commit:'c'.repeat(40),directory:'example'}] }; };
    await moduleAuthorCatalog();
  })()`);
  assert.equal(await wc.executeJavaScript('document.querySelector("[data-action=module-approved-connect]").disabled'), false);
  assert.equal(await wc.executeJavaScript('document.querySelector(".module-catalog-row details").open'), false);
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-author-catalog").textContent.includes("service.example.test")'), false);
  assert.equal(await wc.executeJavaScript('document.querySelector(".module-catalog-row").scrollWidth <= document.querySelector(".module-catalog-row").clientWidth'), true);
  const output = path.join(__dirname, '../release/ui-sidebar-catalog');
  const capture = async name => { if (process.argv.includes('--screenshots')) { await fs.mkdir(output, { recursive: true }); await new Promise(resolve => setTimeout(resolve, 150)); await fs.writeFile(path.join(output, name), (await wc.capturePage()).toPNG()); } };
  await capture('catalog.png');
  await wc.executeJavaScript(`handleModuleAction(document.querySelector('[data-action="module-approved-connect"]'))`);
  assert.equal(await wc.executeJavaScript(`document.querySelector('[data-action="module-approved-connect"]').textContent`), 'Подтвердить подключение');
  assert.equal(await wc.executeJavaScript(`catalogCalls.includes('moduleInstallApproved')`), false);
  assert.equal(await wc.executeJavaScript(`document.querySelector('.module-catalog-row details').open`), false);
  await new Promise(resolve => setTimeout(resolve, 150));
  await capture('confirm.png');
  await wc.executeJavaScript(`handleModuleAction(document.querySelector('[data-action="module-approved-cancel"]'))`);
  assert.equal(await wc.executeJavaScript(`document.querySelector('[data-action="module-approved-connect"]').textContent`), 'Подключить');
  assert.equal(await wc.executeJavaScript(`catalogCalls.includes('moduleInstallApproved')`), false);
  await wc.executeJavaScript(`(async () => { const button=document.querySelector('[data-action="module-approved-connect"]'); await handleModuleAction(button); await handleModuleAction(button); })()`);
  assert.equal(await wc.executeJavaScript(`catalogCalls.filter(call=>call==='moduleInstallApproved').length`), 1);

  await wc.executeJavaScript(`(async () => {
    modal('Модули', '', '<div id="module-list"></div>');
    loadModuleContributions=async () => { connectedModules=[{id:'fictional.module',name:'Fictional meetings',version:'1.0.0',enabled:true,permissions:['ui','network'],networkOrigins:['https://service.example.test'],views:[{id:'settings',title:'Настроить',slot:'panel'}]}]; };
    await refreshModuleList();
  })()`);
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-list details").open'), false);
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-list").textContent.includes("service.example.test")'), false);
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-list .module-catalog-row").scrollWidth <= document.querySelector("#module-list .module-catalog-row").clientWidth'), true);
  await new Promise(resolve => setTimeout(resolve, 150));
  await capture('connected.png');
  await wc.executeJavaScript(`(async () => {
    window.fixtureInstalledVersion='1.0.0'; window.fixtureUpdateWrites=0;
    loadModuleContributions=async () => { connectedModules=[{id:'fictional.module',name:'Fictional meetings',version:fixtureInstalledVersion,enabled:true,permissions:['ui'],views:[{id:'settings',title:'Настроить',slot:'panel'}]}]; };
    api=async (operation) => {
      if(operation==='moduleInstallApproved') { fixtureUpdateWrites++; fixtureInstalledVersion='1.1.0'; return true; }
      return {revision:'a'.repeat(40),modules:[{manifest:{id:'fictional.module',version:'1.1.0'},digest:'b'.repeat(64)}]};
    };
    await refreshModuleList();
  })()`);
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-list .module-update").textContent.includes("1.1.0")'), true);
  assert.equal(await wc.executeJavaScript('fixtureUpdateWrites'), 0);
  await capture('module-update.png');
  await wc.executeJavaScript('handleModuleAction(document.querySelector("#module-list [data-action=module-approved-connect]"))');
  assert.equal(await wc.executeJavaScript('fixtureUpdateWrites'), 0);
  await wc.executeJavaScript('handleModuleAction(document.querySelector("#module-list [data-action=module-approved-connect]"))');
  assert.equal(await wc.executeJavaScript('fixtureUpdateWrites'), 1);
  assert.equal(await wc.executeJavaScript('document.querySelectorAll("#module-list .module-update").length'), 0);
  await wc.executeJavaScript('api=async()=>{throw new Error("Fictional offline catalog")}; refreshModuleList()');
  assert.equal(await wc.executeJavaScript('Boolean(document.querySelector("#module-list [data-action=module-panel]"))'), true);
  assert.equal(await wc.executeJavaScript('Boolean(document.querySelector("#module-list [data-action=module-check-updates]"))'), true);
  await wc.executeJavaScript(`(() => {
    connectedModules=[{id:'fictional.module',sessionId:'fictional-module-session',enabled:true,commands:[{id:'create-room',title:'Создать комнату',slot:'meeting.create'}],views:[{id:'settings',title:'Настроить',slot:'panel',height:500}]}];
    eventModal(); const form=document.querySelector('#event-form'); form.elements.title.value='Встреча команды'; form.elements.body.value='Повестка встречи';
    window.fixtureInvokeCount=0;
    api=async (operation, data) => {
      if(operation!=='moduleInvoke') return [];
      fixtureInvokeCount++;
      receiveModuleAction({id:data.id,sessionId:'fictional-module-session',method:'meeting.patchDraft',editorId:data.editorId,input:{location:'https://service.example.test/room',body:data.draft.body+'\\n\\nСсылка: https://service.example.test/room'}});
      return {message:'Ссылка на комнату добавлена в новую встречу.'};
    };
    window.fixtureConfirm=window.confirm; window.confirm=()=>{throw new Error('Unexpected confirmation');};
  })()`);
  assert.equal(await wc.executeJavaScript('document.querySelectorAll("#meeting-module-contributions button").length'), 1);
  assert.equal(await wc.executeJavaScript('document.querySelectorAll("#event-form .module-view-slot").length'), 0);
  await wc.executeJavaScript('handleModuleAction(document.querySelector("#meeting-module-contributions button"))');
  assert.equal(await wc.executeJavaScript('fixtureInvokeCount'), 1);
  assert.equal(await wc.executeJavaScript('document.querySelector("#event-form").elements.location.value'), 'https://service.example.test/room');
  assert.equal(await wc.executeJavaScript('document.querySelector("#event-form").elements.body.value'), 'Повестка встречи\n\nСсылка: https://service.example.test/room');
  assert.equal(await wc.executeJavaScript('document.querySelector("#meeting-module-status").textContent'), 'Ссылка на комнату добавлена в новую встречу.');
  await capture('meeting-room.png');
  await wc.executeJavaScript(`api=async()=>({error:true,message:'Сначала настройте вход в сервис в разделе «Модули».'}); handleModuleAction(document.querySelector('#meeting-module-contributions button'))`);
  assert.equal(await wc.executeJavaScript('document.querySelector("#meeting-module-status").getAttribute("role")'), 'alert');
  assert.equal(await wc.executeJavaScript('document.querySelector("#meeting-module-status").textContent'), 'Сначала настройте вход в сервис в разделе «Модули».');
  await capture('meeting-module-error.png');
  await wc.executeJavaScript(`api=async()=>{throw new Error('Ошибка выполнения модуля')}; handleModuleAction(document.querySelector('#meeting-module-contributions button'))`);
  assert.equal(await wc.executeJavaScript('document.querySelector("#meeting-module-status").textContent.includes("Проверьте настройки модуля")'), true);
  assert.equal(await wc.executeJavaScript('document.querySelector("#event-form").inert'), false);
  await wc.executeJavaScript('document.querySelector("#event-form").dataset.editing="true"; renderModuleContributions(); window.confirm=fixtureConfirm; setModalDirty(false)');
  assert.equal(await wc.executeJavaScript('document.querySelector("#meeting-module-contributions").childElementCount'), 0);
  await wc.executeJavaScript('document.querySelector("#modal").close(); window.aster=null; renderSidebar()');
  await new Promise(resolve => setTimeout(resolve, 250));
  await capture('sidebar.png');
  console.log('PASS: sidebar layout; public catalog; demo availability; installed updates with explicit confirmation and offline recovery; single room button; success and failures stay inside meeting; saved meetings have no creation controls');
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); window?.destroy(); app.exit(1); });

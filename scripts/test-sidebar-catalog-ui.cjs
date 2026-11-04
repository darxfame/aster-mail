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
  await wc.executeJavaScript('document.querySelector("[data-action=demo]").click()');
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
  assert.equal(await wc.executeJavaScript('document.querySelector(".module-catalog-row").scrollWidth <= document.querySelector(".module-catalog-row").clientWidth'), true);
  const output = path.join(__dirname, '../release/ui-sidebar-catalog'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'catalog.png'), (await wc.capturePage()).toPNG());
  await wc.executeJavaScript(`handleModuleAction(document.querySelector('[data-action="module-approved-connect"]'))`);
  assert.equal(await wc.executeJavaScript(`document.querySelector('[data-action="module-approved-connect"]').textContent`), 'Подтвердить подключение');
  assert.equal(await wc.executeJavaScript(`catalogCalls.includes('moduleInstallApproved')`), false);
  assert.equal(await wc.executeJavaScript(`document.querySelector('.module-catalog-row details').open`), false);
  await new Promise(resolve => setTimeout(resolve, 150));
  await fs.writeFile(path.join(output, 'confirm.png'), (await wc.capturePage()).toPNG());
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
  assert.equal(await wc.executeJavaScript('document.querySelector("#module-list .module-catalog-row").scrollWidth <= document.querySelector("#module-list .module-catalog-row").clientWidth'), true);
  await new Promise(resolve => setTimeout(resolve, 150));
  await fs.writeFile(path.join(output, 'connected.png'), (await wc.capturePage()).toPNG());
  await wc.executeJavaScript('document.querySelector("#modal").close(); window.aster=null; renderSidebar()');
  await new Promise(resolve => setTimeout(resolve, 250));
  await fs.writeFile(path.join(output, 'sidebar.png'), (await wc.capturePage()).toPNG());
  console.log('PASS: folder rows fit at 180/210/300px and 100/150/200% zoom; collapsed icons fit; catalog connects before login; catalog and installed details start collapsed; demo planner detects own meetings');
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); window?.destroy(); app.exit(1); });

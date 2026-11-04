// Compare the actual demo renderer with the previous release. No account or writes.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), baseline = process.env.ASTER_UI_BASELINE;
const candidate = process.env.ASTER_UI_CANDIDATE || root;
if (!baseline) throw new Error('Set ASTER_UI_BASELINE to the previous release checkout');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-ui-release-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
const windows = new Set();
async function waitFor(window, expression) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await window.webContents.executeJavaScript(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`UI did not become ready: ${expression}`);
}
const geometry = `(() => {
  const selectors = ['.sidebar','.topbar','#workspace','.mail-list','#reader','#quick-create','.calendar-heading','.calendar-toolbar','#event-form [name=title]','#event-form [name=location]','#event-form [name=attendees]','#event-form [name=body]','#compose-form [name=subject]'];
  return Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector); if (!element) return [selector,null];
    const rect = element.getBoundingClientRect();
    return [selector, ['x','y','width','height'].map(key => Math.round(rect[key]*10)/10)];
  }));
})()`;
async function run(directory, scale, theme, screenshots) {
  const isolated = session.fromPartition(`aster-ui-${crypto.randomUUID()}`, { cache: false });
  const window = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  windows.add(window); const contents = window.webContents, reports = {};
  await window.loadFile(path.join(directory, 'src/index.html'));
  await waitFor(window, 'Boolean(document.querySelector("[data-action=demo]"))');
  await contents.executeJavaScript('document.querySelector("[data-action=demo]").click()');
  await waitFor(window, 'state.demo && state.messages.length > 0');
  await contents.executeJavaScript(`applyInterfaceScale(1, false); state.theme=${JSON.stringify(theme)}; document.body.classList.toggle('dark',state.theme==='dark');`);
  contents.setZoomFactor(scale);
  await new Promise(resolve => setTimeout(resolve, 150));
  await contents.executeJavaScript('openMessage(state.messages[0].id)');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  reports.mail = await contents.executeJavaScript(geometry);
  if (screenshots) await fs.writeFile(path.join(screenshots, `mail-${theme}-${scale * 100}.png`), (await contents.capturePage()).toPNG());
  const form = await contents.executeJavaScript(`(async () => {
    await compose(); const form=document.querySelector('#compose-form'); window.fixtureForm=form;
    form.elements.subject.value='Fictional draft must survive';
    const editor=form.querySelector('[contenteditable]'); editor.textContent='Fictional draft body';
    renderMessages();
    return { same: document.querySelector('#compose-form')===window.fixtureForm, subject:form.elements.subject.value, body:editor.textContent };
  })()`);
  assert.deepEqual(form, { same: true, subject: 'Fictional draft must survive', body: 'Fictional draft body' });
  reports.compose = await contents.executeJavaScript(geometry);
  await contents.executeJavaScript("setModalDirty(false); document.querySelector('#modal').close(); state.view='calendar'; loadView()");
  await waitFor(window, 'Boolean(document.querySelector(".calendar-view"))');
  reports.calendar = await contents.executeJavaScript(geometry);
  if (screenshots) await fs.writeFile(path.join(screenshots, `calendar-${theme}-${scale * 100}.png`), (await contents.capturePage()).toPNG());
  await contents.executeJavaScript('eventModal(new Date())');
  assert.equal(await contents.executeJavaScript('Boolean(document.querySelector("#event-form [name=attendees]"))'), true);
  reports.newMeeting = await contents.executeJavaScript(geometry);
  await contents.executeJavaScript("setModalDirty(false); document.querySelector('#modal').close(); window.fixtureResponse=window.asterDemo.events[0].response; openMeeting(window.asterDemo.events[0])");
  await waitFor(window, 'Boolean(activeMeeting)');
  assert.equal(await contents.executeJavaScript('window.asterDemo.events[0].response === window.fixtureResponse'), true);
  await contents.executeJavaScript("setModalDirty(false); document.querySelector('#modal').close(); state.view='contacts'; loadView()");
  await waitFor(window, 'state.contacts.length > 0');
  reports.contacts = await contents.executeJavaScript(geometry);
  await contents.executeJavaScript('settingsModal()');
  await waitFor(window, 'Boolean(document.querySelector("#settings-form"))');
  const tabs = await contents.executeJavaScript('[...document.querySelectorAll("[role=tab]")].map(tab=>tab.id)');
  assert.ok(tabs.includes('settings-tab-general')); assert.ok(tabs.includes('settings-tab-notifications'));
  if (directory === candidate) assert.ok(tabs.includes('settings-tab-modules'));
  if (directory === candidate) {
    const fixture = JSON.parse(await fs.readFile(path.join(root, 'examples/modules/sandbox-demo/module.json')));
    await contents.executeJavaScript(`(async () => {
      setModalDirty(false); document.querySelector('#modal').close(); state.view='mail'; await loadView();
      connectedModules=[{...${JSON.stringify(fixture)}, enabled:true, error:false}]; renderModuleContributions();
    })()`);
    const topbarFits = await contents.executeJavaScript(`(() => {
      const bar=document.querySelector('.topbar'), right=bar.getBoundingClientRect().right;
      return [...bar.children].every(element=>element.getBoundingClientRect().right<=right+1);
    })()`);
    assert.equal(topbarFits, true, 'Module menu must fit alongside existing toolbar controls');
    await contents.executeJavaScript('eventModal(new Date())');
    assert.equal(await contents.executeJavaScript('Boolean(document.querySelector(".module-view-slot")) && document.documentElement.scrollWidth<=innerWidth'), true);
    if (screenshots) await fs.writeFile(path.join(screenshots, `module-meeting-${theme}-${scale * 100}.png`), (await contents.capturePage()).toPNG());
  }
  window.destroy(); windows.delete(window); await isolated.clearStorageData();
  return reports;
}
app.whenReady().then(async () => {
  const screenshots = path.join(root, 'release/ui-regression'); await fs.mkdir(screenshots, { recursive: true });
  const results = [];
  for (const scale of [1, 1.5, 2]) for (const theme of ['light', 'dark']) {
    const before = await run(path.resolve(baseline), scale, theme);
    const after = await run(candidate, scale, theme, screenshots);
    assert.deepEqual(after, before, `Existing layout changed at ${scale * 100}% ${theme}`);
    results.push({ scale, theme, matching: true });
    console.log(`PASS: ${scale * 100}% ${theme}, unchanged mail/calendar/contacts/composer/meeting layout and preserved draft`);
  }
  await fs.writeFile(path.join(screenshots, 'report.json'), JSON.stringify(results, null, 2));
  app.exit(0);
}).catch(error => { console.error(error); for (const window of windows) if (!window.isDestroyed()) window.destroy(); app.exit(1); });

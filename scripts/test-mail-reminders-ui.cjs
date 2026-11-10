// Actual Electron UI and Notification API, fictional data, isolated profile.
const { app, BrowserWindow, Notification } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { MailReminders } = require('../desktop/mail-reminders.cjs');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-mail-reminders-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
const notifications = new Set();
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
    await waitFor('state.demo && state.messages.length>0');
    await js(`window.fixtureId=state.messages.find(message=>!message.meeting).id;openMessage(fixtureId)`);
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1], [960, 1], [1100, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js(`(() => {const bar=document.querySelector('.reader-toolbar');const buttons=[...bar.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0);return bar.scrollWidth<=bar.clientWidth && new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top))).size===1 && buttons.every(button=>button.title && button.getAttribute('aria-label'));})()`), true, `Reader actions fit one row with hover hints (${width}, ${scale}): ${await js("JSON.stringify({width:document.querySelector('.reader-toolbar').clientWidth,scroll:document.querySelector('.reader-toolbar').scrollWidth,compact:document.querySelector('.reader-toolbar').className,buttons:[...document.querySelectorAll('.reader-toolbar button')].filter(button=>button.getBoundingClientRect().width>0).map(button=>({action:button.dataset.action,title:button.title,label:button.getAttribute('aria-label'),top:button.getBoundingClientRect().top}))})")}`);
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`(() => {const menu=document.querySelector('.reader-more-actions');if(!menu.open)menu.querySelector('summary').click();document.querySelector('[data-action=mail-reminder]').click();})()`);
    assert.equal(await js('Boolean(document.querySelector("#mail-reminder-form"))'), true);
    await js(`document.querySelector('#mail-reminder-form').elements.due.value='2000-01-01T10:00';document.querySelector('#mail-reminder-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#mail-reminder-form .form-error").textContent)');
    assert.equal(await js('demoMailReminders.length'), 0);
    const output = path.join(root, 'release/mail-reminders-ui'); await fs.mkdir(output, { recursive: true });
    await js(`document.querySelector('#mail-reminder-form').elements.due.value=T.wall(new Date(Date.now()+3600000),timeZone).slice(0,16);document.querySelector('#mail-reminder-form').elements.unread.checked=true;document.querySelector('#mail-reminder-form').requestSubmit()`);
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('demoMailReminders.length'), 1); assert.equal(await js('state.selected'), null);
    assert.equal(await js('window.asterDemo.messages.find(message=>message.id===fixtureId).read'), false);
    assert.equal(await js('window.asterDemo.messages.find(message=>message.id===fixtureId).folder'), 'inbox');
    assert.equal(await js('Object.keys(demoMailReminders[0]).sort().join(",")'), 'due,id,notifiedAt,token');
    await js(`document.querySelector('[data-action=mail-reminders]').click()`);
    await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-entry"))');
    for (const [width, scale] of [[1280, 1], [1280, 2], [640, 1]]) {
      window.setSize(width, 850); window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector("#mail-reminders-form").scrollWidth<=document.querySelector("#mail-reminders-form").clientWidth+1'), true);
      await fs.writeFile(path.join(output, `reminders-${width}-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.setSize(1280, 850); window.webContents.setZoomFactor(1);
    await js(`demoMailReminders[0].due='2000-01-01T00:00:00Z';document.querySelector('[data-reminders-refresh]').click()`);
    await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-overdue"))');
    await js(`document.querySelector('[data-reminder-open]').click()`);
    await waitFor('!modalBusy && state.selected?.id===fixtureId');
    assert.equal(await js('state.selected.read'), false, 'Opening from reminders does not mark read');
    await js('mailRemindersModal()'); await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-entry"))');
    await js(`document.querySelector('[data-reminder-remove]').click()`); await waitFor('!modalBusy && !document.querySelector(".waiting-entry")');
    assert.equal(await js('demoMailReminders.length'), 0);
    await js(`document.querySelector('#modal').close();compose()`);
    await waitFor('Boolean(document.querySelector("#compose-form"))');
    await js(`document.querySelector('#compose-form').elements.subject.value='Keep this draft';state.demo=false;state.account={sessionId:'fixture-alice'};receiveMailReminderNavigation({mailReminders:true,sessionId:'fixture-alice'})`);
    assert.equal(await js('document.querySelector("#compose-form").elements.subject.value'), 'Keep this draft');
    assert.equal(await js(`receiveMailReminderNavigation({mailReminders:true,sessionId:'fixture-bob'})`), true);
    assert.equal(await js('document.querySelector("#compose-form").elements.subject.value'), 'Keep this draft');
    await js(`setModalDirty(false);document.querySelector('#modal').close();window.reminderCalls=[];api=async(operation,data)=>{reminderCalls.push({operation,data});throw Object.assign(new Error('Storage unavailable'),{userFacing:true});};mailReminderModal();document.querySelector('#mail-reminder-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#mail-reminder-form .form-error").textContent)');
    assert.equal(await js('reminderCalls.length'), 1); assert.equal(await js('reminderCalls[0].operation'), 'setMailReminder');
    assert.equal(await js('document.querySelector("#mail-reminder-form button[type=submit]").disabled'), false);
    await js(`reminderCalls=[];api=async(operation,data)=>{reminderCalls.push({operation,data});if(operation==='setMailReminder')return {id:fixtureId,token:'new-token',due:data.due,notifiedAt:null};if(operation==='message')return {...state.selected,changeKey:'fresh-key'};throw Object.assign(new Error('Outcome unknown'),{userFacing:true});};document.querySelector('#mail-reminder-form').elements.unread.checked=true;document.querySelector('#mail-reminder-form').requestSubmit()`);
    await waitFor('!modalBusy && document.querySelector("#mail-reminder-form button[type=submit]").disabled');
    assert.equal(await js('reminderCalls.map(call=>call.operation).join(",")'), 'setMailReminder,message,change');
    assert.equal(await js('reminderCalls[2].data.ref.changeKey'), 'fresh-key');
    assert.match(await js('document.querySelector("#mail-reminder-form .form-error").textContent'), /Напоминание сохранено/);
    await js(`document.querySelector('#mail-reminder-form').requestSubmit()`);
    assert.equal(await js('reminderCalls.length'), 3, 'Uncertain unread writes must not replay');
    await js(`document.querySelector('#modal').close();api=()=>new Promise(resolve=>{window.finishReminder=resolve;});mailReminderModal();document.querySelector('#mail-reminder-form').requestSubmit()`);
    await waitFor('Boolean(window.finishReminder)');
    await js(`document.querySelector('#modal').close();state.account={sessionId:'fixture-bob'};modalBusy=false;modal('Other','','<p id="preserved-dialog">Keep me</p>');finishReminder(true)`);
    await waitFor('!modalBusy'); assert.equal(await js('Boolean(document.querySelector("#preserved-dialog")) && document.querySelector("#modal").open'), true);
    await js(`document.querySelector('#modal').close();state.demo=true;state.account=null;applyLanguage('en');document.body.classList.add('dark');mailRemindersModal()`); await waitFor('!modalBusy');
    assert.match(await js('document.querySelector("#modal").textContent'), /Mail reminders/);
    await js(`document.querySelector('#modal').close();state.demo=false;state.account={sessionId:'fixture-offline'};window.offlineEntries=[{id:fixtureId,token:'offline-token',due:'2099-01-01T00:00:00Z',notifiedAt:null}];api=async(operation)=>{if(operation==='mailReminders')return {entries:offlineEntries,supported:true};if(operation==='mailReminderSubjects')return offlineEntries.length?new Promise(resolve=>{window.finishTitles=resolve;}):{titles:[]};if(operation==='removeMailReminder'){offlineEntries=[];return true;}throw new Error('Offline');};mailRemindersModal()`);
    await waitFor('!modalBusy && Boolean(document.querySelector(".waiting-entry")) && Boolean(window.finishTitles)');
    await js(`document.querySelector('[data-reminder-remove]').click()`); await waitFor('!modalBusy && !document.querySelector(".waiting-entry")');
    await js(`finishTitles({titles:[{id:fixtureId,subject:'Late subject'}]})`);
    assert.equal(await js('Boolean(document.querySelector(".waiting-entry"))'), false, 'Pending Exchange titles must not block cancellation or restore removed reminders');

    // Use the real Electron notification API once. OS display permissions remain
    // independent of successfully submitting a notification to Electron.
    const source = await fs.readFile(path.join(root, 'desktop/main.cjs'), 'utf8');
    const context = vm.createContext({ Notification, activeNotifications: notifications, tr: value => value, privacyHidden: () => false,
      notificationSettings: { sounds: false }, client: { syncId: 'fixture-session' }, lastPollError: '', path, __dirname: path.join(root, 'desktop'), reveal() {}, process, app });
    vm.runInContext(source.slice(source.indexOf('function notify('), source.indexOf('function closeMailReminderAlerts(')), context);
    const store = { data: {}, async save(patch, guard) { guard(); this.data = { ...this.data, ...patch }; } };
    let dispatches = 0;
    const options = { guard() {}, available: () => Notification.isSupported(), deliver: () => { dispatches++; return context.notify('mail-reminder', 'Aster Mail · проверка напоминания', 'Вымышленные данные. Откройте список напоминаний в Aster.', { mailReminders: true, sessionId: 'fixture-session' }); } };
    const scheduler = new MailReminders(store, options); await scheduler.set({ id: 'fictional-message', due: '2099-01-01T00:00:00Z' });
    await scheduler.tick(Date.parse('2099-01-02T00:00:00Z')); await new MailReminders(store, options).tick(Date.parse('2099-01-03T00:00:00Z'));
    assert.equal(dispatches, Notification.isSupported() ? 1 : 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    console.log(`Native notification handoff: ${dispatches ? 'submitted to Electron; OS delivery depends on system permissions' : 'unsupported; reminders remain in the list'}.`);
    console.log('PASS: reminder dates, optional unread, no moves, list/navigation/delete, one-row toolbar, RU/EN, 100%/200%/narrow layout, preserved composer, failed local save, fresh ChangeKey, no retry after uncertain write, and stale-account guards.');
  } finally { for (const notification of notifications) notification.close(); window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

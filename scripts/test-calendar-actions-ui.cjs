// Calendar actions use fictional demo events and injected IPC only; never real invitations.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const javascriptLiteral = require('./javascript-literal.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-calendar-actions-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Calendar did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = async code => {
      const body = code.includes(';') ? `${code};return {value:undefined};` : `return {value:await (${code})};`;
      const result = await window.webContents.executeJavaScript(`(async()=>{try{${body}}catch(error){return {error:error.stack}}})()`);
      if (result.error) throw new Error(result.error);
      return result.value;
    };
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`window.fixtureEvent={...structuredClone(window.asterDemo.events[0]),id:'fixture-occurrence',title:'Вымышленная встреча',isOrganizer:true,isMeeting:true,canDelete:true,recurring:true,calendarType:'Occurrence',seriesId:'fixture-series',attachments:[],attendees:[{email:'fictional@example.test',name:'Участник',role:'required'}]};window.asterDemo.events.push(fixtureEvent,{...structuredClone(fixtureEvent),id:'fixture-other'});state.week=new Date(fixtureEvent.start);state.view='calendar';calendarPreference='week';loadView()`);
    const source = await fs.readFile(path.join(root, 'src/app.js'), 'utf8');
    const navigation = source.slice(source.indexOf('    window.aster.onNavigate(async data => {'), source.indexOf("    try { loginHint = await api('loginHint'); }"));
    await js(`window.navigationTest={onNavigate:callback=>window.navigateFromWidget=callback};${navigation.replace('window.aster.onNavigate', 'window.navigationTest.onNavigate')};void 0`);
    await js(`window.navigationEvent={...structuredClone(fixtureEvent),id:'fixture-navigation',isOrganizer:false,response:'Unknown',recurring:false,seriesId:undefined};window.asterDemo.events.push(navigationEvent)`);
    for (const preference of ['week', 'quarter', 'day', 'auto']) {
      await js(`calendarPreference=${javascriptLiteral(preference)};localPreferences.setItem('aster-calendar-view',calendarPreference);state.view='mail';state.week=new Date('2020-01-01');navigateFromWidget({view:'calendar',date:navigationEvent.start,eventId:navigationEvent.id})`);
      assert.equal(await js('calendarPreference'), preference, 'Opening a meeting preserves the current calendar view');
      assert.equal(await js('document.querySelector("#calendar-mode").value'), preference);
      assert.equal(await js("localPreferences.getItem('aster-calendar-view')"), preference);
      assert.equal(await js('state.week.toISOString()'), await js('new Date(navigationEvent.start).toISOString()'));
      assert.equal(await js('activeMeeting.id'), 'fixture-navigation');
      if (preference === 'week') {
        await js(`document.querySelector('[data-action=rsvp][data-response=AcceptItem]').click()`);
        await waitFor(`!document.querySelector('#modal').open && state.events.some(event=>event.id==='fixture-navigation' && event.response==='Accept')`);
        assert.equal(await js('document.querySelector("#calendar-mode").value'), preference, 'Accepting the meeting preserves the calendar view');
      } else await js(`document.querySelector('#modal').close()`);
    }
    await js(`window.asterDemo.events=window.asterDemo.events.filter(event=>event.id!=='fixture-navigation');calendarPreference='week';await loadView()`);
    const menu = () => js(`document.querySelector('[data-action=event][data-id=fixture-occurrence]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:900,clientY:400}))`);
    await menu();
    assert.equal(await js('document.querySelectorAll(".calendar-context-menu [role=menuitem]").length>=6'), true);
    assert.equal(await js('document.querySelector(".calendar-context-menu").contains(document.activeElement)'), true);
    await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
    assert.equal(await js('Boolean(document.querySelector(".calendar-context-menu"))'), false);
    assert.equal(await js('document.activeElement.dataset.id'), 'fixture-occurrence');
    await menu();
    const output=path.join(root,'release/calendar-actions-ui');await fs.mkdir(output,{recursive:true});
    await new Promise(resolve=>setTimeout(resolve,100));
    await fs.writeFile(path.join(output,'context-menu.png'),(await window.webContents.capturePage()).toPNG());
    await js('document.querySelector("[data-calendar-action=meeting-delete]").click()');
    await waitFor('Boolean(document.querySelector("#meeting-removal-form"))');
    assert.equal(await js('document.querySelector("#modal").textContent.includes("только выбранный повтор")'),true);
    assert.equal(await js('document.querySelector("#modal").textContent.includes("Exchange отправит отмену всем участникам")'),true);
    assert.equal(await js('window.asterDemo.events.some(event=>event.id==="fixture-occurrence")'),true,'Opening confirmation must not remove anything');
    await js('document.querySelector("#meeting-removal-form").requestSubmit()');
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('window.asterDemo.events.some(event=>event.id==="fixture-occurrence")'),false);
    assert.equal(await js('window.asterDemo.events.some(event=>event.id==="fixture-other")'),true);
    await js('openMeeting(state.events.find(event=>event.id==="fixture-other"))');
    assert.equal(await js('Boolean(document.querySelector("[data-action=meeting-delete]"))'),true);
    await js('document.querySelector("#meeting-scope").value="series";document.querySelector("[data-action=meeting-delete]").click()');
    await waitFor('Boolean(document.querySelector("#meeting-removal-form"))');
    assert.equal(await js('document.querySelector("#modal").textContent.includes("весь ряд")'),true);
    await js('document.querySelector("#meeting-removal-form").requestSubmit()');
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.equal(await js('window.asterDemo.events.some(event=>event.seriesId==="fixture-series")'),false);
    await js(`window.invited={...structuredClone(fixtureEvent),id:'fixture-invited',isOrganizer:false,recurring:false,seriesId:undefined};window.asterDemo.events.push(invited);openMeeting(invited)`);
    await js('document.querySelector("[data-action=meeting-delete]").click()');
    await waitFor('Boolean(document.querySelector("#meeting-removal-form"))');
    assert.equal(await js('document.querySelector("#modal").textContent.includes("Ответ организатору не отправляется")'),true);
    await js('document.querySelector("[data-action=meeting-return]").click()');
    await waitFor('document.querySelector("#modal").dataset.meetingCard==="true"');
    await js('activeMeeting.canDelete=false;renderMeetingCard()');
    assert.equal(await js('document.querySelector("[data-action=meeting-delete]").disabled'),true);
    // A lost response leaves the confirmation disabled; another submit cannot repeat the write.
    await js(`document.querySelector('#modal').close();state.demo=false;state.account={server:'https://mail.example.test',username:'fictional',sessionId:'fictional'};window.removeCalls=0;api=async operation=>{if(operation==='eventDetails')return {...invited,changeKey:'fresh'};if(operation==='removeEvent'){removeCalls++;throw new Error('Fictional lost removal response');}return [];};openMeeting(invited)`);
    await js('document.querySelector("[data-action=meeting-delete]").click()');
    await waitFor('Boolean(document.querySelector("#meeting-removal-form"))');
    await js('document.querySelector("#meeting-removal-form").requestSubmit()');
    await waitFor('!modalBusy && Boolean(document.querySelector("#meeting-removal-form .form-error").textContent)');
    assert.equal(await js('document.querySelector("#meeting-removal-form [type=submit]").disabled'),true);
    await js('document.querySelector("#meeting-removal-form").requestSubmit()');
    assert.equal(await js('removeCalls'),1);
    console.log('PASS: meeting navigation preserves week/quarter/day/auto and accepting preserves week; calendar context menu, Escape/focus, card removal, occurrence/series distinction, organizer/invitee messaging, denied rights and no replay after a lost response.');
  } finally { window?.destroy(); await fs.rm(profile,{recursive:true,force:true,maxRetries:3}); }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});

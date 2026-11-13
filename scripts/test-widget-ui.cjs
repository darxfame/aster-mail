// Exercise the widget and local working-hour settings in actual Chromium with fictional data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-widget-ui-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(code) {
  for (let i=0;i<150;i++) { if (await window.webContents.executeJavaScript(code)) return; await new Promise(resolve=>setTimeout(resolve,30)); }
  throw new Error('UI did not become ready: '+code+' '+await window.webContents.executeJavaScript('window.lastTestError || document.querySelector(".settings-footer .form-error")?.textContent')); 
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width:1280,height:850,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
    const js = async code => {
      const body = code.includes(';') ? code+';return {value:undefined};' : 'return {value:await ('+code+')};';
      const result = await window.webContents.executeJavaScript('(async()=>{try{'+body+'}catch(error){return {error:error.stack}}})()');
      if(result.error)throw new Error(result.error);return result.value;
    };
    await window.loadFile(path.join(root,'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    const iconOutput = path.join(root,'release/widget-ui'); await fs.mkdir(iconOutput,{recursive:true});
    for (const scale of [1, 2]) {
      window.webContents.setZoomFactor(scale);
      await js('[...document.querySelectorAll(".dock-settings")].find(button=>button.getBoundingClientRect().width).focus()');
      await new Promise(resolve=>setTimeout(resolve,100));
      await fs.writeFile(path.join(iconOutput,`settings-icon-${scale}.png`),(await window.webContents.capturePage()).toPNG());
    }
    window.webContents.setZoomFactor(1);
    await js('settingsModal()');
    assert.equal(await js('document.querySelectorAll("[name=workDay]:checked").length'),5);
    assert.equal(await js('document.querySelector("[name=workStart]").value'),'09:00');
    await js(`window.originalErrorText=errorText;errorText=error=>{window.lastTestError=error.stack;return originalErrorText(error)};window.savedWork=null;window.saveCount=0;state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.test',username:'fictional'};window.aster={};api=async(operation,data)=>{if(operation==='saveNotifications'){saveCount++;savedWork=data;return data;}if(operation==='notificationSettings')return savedWork;if(operation==='moduleCatalog')return [];return true;};document.querySelectorAll('[name=workDay]').forEach(input=>input.checked=['2','4'].includes(input.value));document.querySelector('[name=workStart]').value='10:00';document.querySelector('[name=workEnd]').value='17:30';document.querySelector('#settings-form').requestSubmit()`);
    await waitFor('!modalBusy && !document.querySelector("#modal").open');
    assert.deepEqual(await js('savedWork.workSchedule'),{days:[2,4],start:'10:00',end:'17:30'});
    await js('settingsModal()');
    assert.equal(await js('document.querySelector("[name=workEnd]").value'),'17:30');
    assert.equal(await js('document.querySelectorAll("[name=workDay]:checked").length'),2);
    await js('document.querySelector("[name=workEnd]").value="09:00";document.querySelector("#settings-form").requestSubmit()');
    await waitFor('!modalBusy');
    assert.match(await js('document.querySelector(".settings-footer .form-error").textContent'),/позже начала/);
    assert.equal(await js('saveCount'),1);
    await js(`setModalDirty(false);document.querySelector('#modal').close();window.aster=null;state.demo=true;state.account=null;timeZone='Europe/Moscow';calendarPreference='day';state.view='calendar';state.week=new Date('2026-11-12T12:00:00+03:00');state.events=[{id:'early',title:'Early',start:'2026-11-12T08:00:00+03:00',end:'2026-11-12T08:30:00+03:00'},{id:'late',title:'Late',start:'2026-11-12T19:00:00+03:00',end:'2026-11-12T20:00:00+03:00'}];renderCalendar()`);
    assert.equal(await js(`T.wall(document.querySelector('.timeline-track').dataset.start,timeZone).slice(11,16)`),'08:00');
    assert.equal(await js(`T.wall(document.querySelector('.timeline-track').dataset.end,timeZone).slice(11,16)`),'20:00');
    await window.loadFile(path.join(root,'src/widget.html'));
    await js(`window.fixedNow=Date.parse('2026-11-12T11:30:00+03:00');Date.now=()=>fixedNow;window.fixtureEvents=[{id:'old',title:'Old meeting',start:'2026-11-12T07:00:00+03:00',end:'2026-11-12T08:00:00+03:00'},{id:'past',title:'Recent meeting',start:'2026-11-12T10:00:00+03:00',end:'2026-11-12T10:30:00+03:00'},{id:'current',title:'Обсуждение проекта',preview:'Fictional meeting description must stay in the full details',start:'2026-11-12T11:00:00+03:00',end:'2026-11-12T12:00:00+03:00',response:'Accept',joinUrl:true},{id:'next',title:'Груминг',start:'2026-11-12T12:00:00+03:00',end:'2026-11-12T13:00:00+03:00',response:'Accept',joinUrl:true},{id:'late',title:'Вечерний обзор',start:'2026-11-12T19:00:00+03:00',end:'2026-11-12T20:00:00+03:00',response:'Accept'}];selectedDay=null;gridKey=null;render({connected:true,timeZone:'Europe/Moscow',theme:'dark',language:'ru',calendarEvents:fixtureEvents,events:fixtureEvents,lastPoll:new Date(fixedNow).toISOString()})`);
    assert.equal(await js('Boolean(document.querySelector("#privacy-toggle,.privacy-controls,header small"))'),false);
    assert.deepEqual(await js('[...document.querySelectorAll(".featured .featured-title")].map(el=>el.textContent)'),['Обсуждение проекта', 'Груминг']);
    assert.equal(await js('document.querySelectorAll(".featured [data-action=open]").length'),2);
    assert.equal(await js('document.querySelectorAll(".featured [data-action=join]").length'),2);
    assert.doesNotMatch(await js('document.querySelector(".featured-meetings").textContent'),/Fictional meeting description/);
    assert.equal(await js('document.querySelector(".featured [data-action=open]").textContent'), '');
    assert.equal(await js('document.querySelector(".featured [data-action=join]").textContent'), '');
    assert.equal(await js('document.querySelector(".featured [data-action=open]").getAttribute("aria-label").includes("Обсуждение проекта")'),true);
    assert.match(await js('document.querySelector(".featured.is-upcoming").textContent'),/Через 30 мин.*Груминг/);
    assert.equal(await js('document.querySelector(".grid-join svg").getBoundingClientRect().width'),14);
    assert.equal(await js('document.querySelector(".grid-join").getBoundingClientRect().width'),22);
    assert.match(await js('document.querySelector(".grid-join").title'),/Войти в звонок/);
    assert.equal(await js('Boolean(document.querySelector(".day-grid [data-action=open][data-id=next]"))'),true,'Future meetings remain in the schedule');
    assert.doesNotMatch(await js('document.querySelector(".day-grid").textContent'),/Old meeting/);
    assert.match(await js('document.querySelector(".day-grid").textContent'),/Recent meeting/);
    assert.match(await js('document.querySelector(".day-toolbar").textContent'),/09:30–20:00/);
    await js(`window.actions=[];window.asterWidget={action:async(...args)=>{actions.push(args);return {ok:true}}};document.querySelector('.grid-join[data-id=next]').click()`);
    await waitFor('actions.length===1'); assert.deepEqual(await js('actions[0]'),['join','next']);
    const output=path.join(root,'release/widget-ui');await fs.mkdir(output,{recursive:true});
    for(const theme of ['light','dark']) for(const scale of [1,2]) {
      window.setContentSize(380*scale,560*scale);window.webContents.setZoomFactor(scale);
      await new Promise(resolve=>setTimeout(resolve,200));
      await js(`render({...snapshot,theme:${JSON.stringify(theme)}})`);
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(await js('Math.abs(innerWidth-380)<=1'),true,'Widget must retain its CSS width at each zoom factor');
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await js('document.querySelector("header").getBoundingClientRect().height<=44'),true);
      assert.equal(await js('getComputedStyle(document.querySelector("header")).backgroundImage'), 'none', 'Air header must not restore the old purple gradient');
      assert.notEqual(await js('getComputedStyle(document.querySelector("header")).backdropFilter'), 'none');
      assert.equal(await js(`getComputedStyle(document.body).getPropertyValue('--bg').trim()`), theme === 'light' ? '#f5f6f8' : '#202124');
      const eventFill = await js(`getComputedStyle(document.querySelector('.grid-event.accepted')).backgroundColor`);
      assert.equal(eventFill, theme === 'light' ? 'rgb(228, 242, 234)' : 'rgb(41, 69, 55)', 'Calendar status colors must retain their original meaning');
      assert.equal(await js('document.querySelector(".day-grid").getBoundingClientRect().height>=(innerHeight<=440?130:150)'),true);
      assert.equal(await js(`document.querySelector('.featured [data-action=join][data-id=current]').getBoundingClientRect().bottom<=document.querySelector('.featured-meetings').getBoundingClientRect().bottom+1`),true,'Current meeting call button must be visible');
      await fs.writeFile(path.join(output,`${theme}-${scale}.png`),(await window.webContents.capturePage()).toPNG());
    }
    await js('render({...snapshot,calendarEvents:fixtureEvents.filter(event=>event.id!=="current"),events:[]})');
    assert.equal(await js('document.querySelectorAll(".featured.is-upcoming").length'),1,'Nearest future meeting remains visible before it starts');
    assert.equal(await js('Boolean(document.querySelector(".free-state"))'),false);
    await js('render({...snapshot,calendarEvents:[...snapshot.calendarEvents,{...fixtureEvents.find(event=>event.id==="next"),id:"next-two",title:"Вторая ближайшая"}]})');
    assert.equal(await js('document.querySelectorAll(".featured.is-upcoming").length'),2,'All simultaneous nearest meetings are visible');
    assert.equal(await js('document.querySelectorAll(".featured.is-upcoming [data-action=join]").length'),2);
    await js('render({...snapshot,dismissedMeetings:[`next:${fixtureEvents.find(event=>event.id==="next").start}`]})');
    assert.equal(await js('Boolean(document.querySelector(".featured [data-id=next-two]"))'),true,'Dismissing one simultaneous meeting preserves the other');
    await js('render({...snapshot,dismissedMeetings:[]})');
    await js('render({...snapshot,calendarEvents:[]})');
    assert.match(await js('document.querySelector(".free-state").textContent'),/Сейчас встреч нет/);
    await js('render({...snapshot,mailAlerts:[{id:"fictional-mail",subject:"Fictional mail alert"}]})');
    assert.equal(await js('document.querySelectorAll(".featured").length'),0,'Mail alerts never appear in the calendar widget');
    assert.doesNotMatch(await js('document.querySelector("#meetings").textContent'),/Fictional mail alert/);
    await js('render({...snapshot,mailAlerts:[],calendarEvents:fixtureEvents.map(event=>event.id==="next"?{...event,start:new Date(fixedNow).toISOString()}:event)})');
    assert.equal(await js('document.querySelectorAll(".featured.is-current").length'),2,'A meeting becomes a current card exactly when it starts');
    await js('render({...snapshot,calendarEvents:fixtureEvents,events:fixtureEvents,privacyActive:true,presentationMode:true})');
    assert.equal(await js('document.querySelectorAll(".featured [data-action=join]").length'),0);
    assert.doesNotMatch(await js('document.querySelector("#meetings").textContent'),/Груминг|Обсуждение проекта/);
    await js('render({...snapshot,privacyActive:false,presentationMode:false})');
    assert.match(await js('document.querySelector("#meetings").textContent'),/Груминг/);
    // Run the production resize function against an actual Electron window.
    window.webContents.setZoomFactor(1);
    const source = await fs.readFile(path.join(root,'desktop/main.cjs'),'utf8');
    const nativeNow = Date.now();
    const nativeEvents = Array.from({length:4},(_,index)=>({id:`parallel-${index}`,title:`Parallel meeting ${index+1}`,start:new Date(nativeNow-60000).toISOString(),end:new Date(nativeNow+1800000).toISOString(),response:'Accept',joinUrl:true}));
    const anchor = { x: 500, y: 0, width: 24, height: 24 };
    const area = require('electron').screen.getPrimaryDisplay().workArea;
    const context = { widgetWindow:window, widgetState:()=>({calendarEvents:nativeEvents}), tray:{getBounds:()=>anchor}, screen:{getDisplayNearestPoint:()=>({workArea:area})}, notificationSettings:{interfaceScale:1},require:()=>require('../desktop/meetings.cjs') };
    require('node:vm').runInNewContext(source.slice(source.indexOf('function resizeWidget('),source.indexOf('function toggleWidget(')),context);
    for (const count of [1,2,3,4,1]) {
      const state = {calendarEvents:nativeEvents.slice(0,count)};
      context.resizeWidget(state);
      assert.equal(window.getBounds().height,Math.min(560+(count-1)*150,area.height-16));
      await js(`Date.now=()=>${nativeNow};selectedDay=null;render({...snapshot,privacyActive:false,calendarEvents:${JSON.stringify(state.calendarEvents)},dismissedMeetings:[],mailAlerts:[]})`);
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await js('document.querySelector(".day-grid").getBoundingClientRect().height>=150'),true);
      await fs.writeFile(path.join(output,`parallel-${count}.png`),(await window.webContents.capturePage()).toPNG());
    }
    console.log('PASS: proportional native window sizing and screen limits; current and upcoming cards with countdown, future meetings and early join in the grid, idle state, working hours, two-hour history, late meetings, privacy, light/dark at 100% and 200%.');
  } finally {window?.destroy();await fs.rm(profile,{recursive:true,force:true,maxRetries:3});}
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});

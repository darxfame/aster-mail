// Exercise the day overview in real Chromium with fictional mailbox data only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-day-summary-'));
const baseline = process.argv.includes('--baseline');
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    const output = path.join(root, 'release/day-summary-ui'); await fs.mkdir(output, { recursive: true });
    if (baseline) {
      assert.equal(await js('document.querySelector("#reader").textContent.includes("Место для ваших мыслей")'), true);
      await fs.writeFile(path.join(output, 'before.png'), (await window.webContents.capturePage()).toPNG());
      console.log('PASS: baseline reader is the empty screen.');
      return;
    }
    async function waitFor(expression) {
      for (let i = 0; i < 150; i++) {
        if (await js(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Overview did not become ready: ${expression}`);
    }
    await waitFor('Boolean(daySummary?.updated)');
    assert.equal(await js('document.querySelector(".day-summary h2").textContent'), 'Ваш день');
    assert.equal(await js('document.querySelectorAll(".day-mail").length'), 2);
    assert.equal(await js('window.asterDemo.messages.filter(message=>!message.read&&message.folder==="inbox").length'), 2, 'Previewing mail must not mark it read');
    await js(`(() => {
      const start = window.asterCalendar.range(new Date(),'day',timeZone).start;
      const at = (hours,minutes=0) => {const date=civil(start);date.setUTCHours(hours,minutes,0,0);return T.fromWall(date.toISOString().slice(0,19),timeZone,false).toISOString();};
      notificationPreferences.workSchedule={days:[0,1,2,3,4,5,6],start:'09:00',end:'17:00'};
      window.asterDemo.events=[{id:'overview-1',title:'Планирование команды',start:at(9,30),end:at(10,30),showAs:'Busy',location:'Переговорная 3'},{id:'overview-2',title:'Обсуждение макетов',start:at(10),end:at(11),showAs:'Busy'},{id:'overview-3',title:'Итоги недели',start:at(13),end:at(13,30),showAs:'Tentative'},{id:'overview-next',title:'Следующая встреча',start:addDays(at(11),1).toISOString(),end:addDays(at(11,45),1).toISOString(),showAs:'Busy'}];
      resetDaySummary();return refreshDaySummary(true);
    })()`);
    assert.equal(await js('document.querySelectorAll(".day-stats strong")[1].textContent'), '3');
    assert.equal(await js('document.querySelectorAll(".day-stats strong")[2].textContent'), '2 ч');
    assert.equal(await js('document.querySelectorAll(".day-track .day-block").length'), 2, 'Overlapping events share a single busy interval');
    assert.equal(await js('document.querySelector(".day-rhythm").textContent.includes("25%")'), true);
    await js(`(() => {
      const at = minute => window.asterWorkSchedule.at(new Date(), minute, timeZone);
      window.originalSummaryDay = window.asterDaySummary.day;
      window.asterDaySummary.day = (events, now, zone, work) => originalSummaryDay(events, +at(540), zone, work);
      daySummary.calendar.events.push({id:'unknown', start:at(660).toISOString(), end:at(720).toISOString(), showAs:'Free', showAsKnown:false});
      renderDaySummary();
    })()`);
    assert.equal(await js('document.querySelector(".day-block.unknown")!==null'), true);
    assert.equal(await js('document.querySelectorAll(".day-stats strong")[2].textContent'), '3 ч');
    assert.equal(await js('document.querySelector(".day-stats").textContent.includes("Время встреч")'), true);
    assert.equal(await js('document.querySelector(".day-window").textContent.includes("13:30–17:00")'), true);
    assert.equal(await js('document.querySelector(".day-rhythm").textContent.includes("Их время исключено из свободных окон")'), true);
    await js('daySummary.calendar.events.pop();window.asterDaySummary.day=originalSummaryDay;renderDaySummary();void 0');
    await js('window.expectedOverviewEvent=document.querySelector(".day-meeting").dataset.id;document.querySelector(".day-meeting").click()');
    await waitFor('Boolean(document.querySelector("#modal").open && activeMeeting)');
    assert.equal(await js('activeMeeting.id===expectedOverviewEvent'), true);
    await js('document.querySelector("#modal").close();void 0');
    for (const theme of ['light', 'dark']) {
      await js(`state.theme=${JSON.stringify(theme)};applyTheme();renderDaySummary();void 0`);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.querySelector(".day-summary").scrollWidth<=document.querySelector(".day-summary").clientWidth'), true);
      await fs.writeFile(path.join(output, `${theme}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await js('document.querySelector(".day-mail").click()');
    await waitFor('Boolean(state.selected && document.querySelector("#message-body"))');
    assert.equal(await js('window.asterDemo.messages.find(message=>message.id===state.selected.id).read'), true);
    await js('window.originalBody=document.querySelector("#message-body");renderDaySummary();void 0');
    assert.equal(await js('document.querySelector("#message-body")===originalBody'), true, 'Background summary rendering must preserve the reader');
    await js('compose();void 0');
    await waitFor('Boolean(document.querySelector("#compose-form"))');
    await js('window.originalComposer=document.querySelector("#compose-form");renderDaySummary();void 0');
    assert.equal(await js('document.querySelector("#compose-form")===originalComposer'), true);
    await js('document.querySelector("#modal").close();returnToMailList();void 0');
    await waitFor('Boolean(daySummary?.updated)');
    assert.equal(await js('document.querySelectorAll(".day-mail").length'), 1);
    for (const [width, zoom] of [[1440, 1], [1000, 1], [640, 1], [1280, 2]]) {
      window.setSize(width, 900); window.webContents.setZoomFactor(zoom);
      await new Promise(resolve => setTimeout(resolve, 100));
      await js('document.querySelector("[data-action=day-overview]").click()');
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector(".day-summary").getBoundingClientRect().width>0'), true, 'Overview is reachable in narrow windows');
      assert.equal(await js('document.querySelector(".day-summary").scrollWidth<=document.querySelector(".day-summary").clientWidth'), true);
      await fs.writeFile(path.join(output, `${width}-${zoom}.png`), (await window.webContents.capturePage()).toPNG());
      await js('returnToMailList();void 0');
    }
    window.setSize(1440, 900); window.webContents.setZoomFactor(1);
    await js('applyLanguage("en");renderDaySummary();void 0');
    assert.equal(await js('document.querySelector(".day-summary h2").textContent'), 'Your day');
    await js('applyLanguage("ru");state.demo=false;state.account={sessionId:"fictional-session"};window.savedApi=api;window.readResolvers=[];api=(op)=>new Promise(resolve=>readResolvers.push({op,resolve}));resetDaySummary();window.pendingOverview=refreshDaySummary(true);void 0');
    await js('state.generation++;readResolvers.forEach(({op,resolve})=>resolve(op==="calendar"?[]:{items:[{id:"stale"}],more:false}));pendingOverview');
    assert.equal(await js('daySummary.mail===undefined'), true, 'Navigation discards delayed reads');
    await js('resetDaySummary();api=savedApi;state.account=null;state.demo=true;void 0');
    assert.equal(await js('daySummary===null'), true);
    console.log('PASS: overview counts, overlap scale, read-only previews, message opening, reader/composer preservation, light/dark, narrow/200%, translations and stale-read rejection.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

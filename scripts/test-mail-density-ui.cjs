// Measure useful list space in actual Chromium using long fictional summaries.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'release/mail-density-ui');
const baseline = process.argv.includes('--capture-baseline');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-density-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    window = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`state.messages=Array.from({length:40},(_,i)=>({...structuredClone(window.asterDemo.messages[0]),id:'density-'+i,from:{name:'Вымышленный отправитель с длинным именем '+i,email:'person'+i+'@example.test'},subject:'Вымышленное обсуждение проекта и планирование следующего спринта '+i,preview:i%4?'Длинный текст превью для проверки плотности и переноса строк в узкой колонке входящих.':'',date:new Date().toISOString(),read:i%2===0,flagged:i%3===0,hasAttachments:i%4===0,meeting:i%5===0?{id:'fictional',start:new Date().toISOString()}:null}));state.more=true;preferredMailListWidth=260;renderMail();void 0;`);
    const reports = [];
    for (const width of [260, 340]) for (const theme of ['light', 'dark']) {
      await js(`preferredMailListWidth=${width};state.theme=${JSON.stringify(theme)};document.body.classList.toggle('dark',state.theme==='dark');renderMail();void 0`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const report = await js(`(()=>{const list=document.querySelector('#messages'),bounds=list.getBoundingClientRect(),rows=[...list.querySelectorAll('.message-row')];return {listHeight:bounds.height,headerHeight:bounds.top-document.querySelector('.mail-list').getBoundingClientRect().top,visible:rows.filter(row=>row.getBoundingClientRect().bottom<=bounds.bottom).length,rowHeight:Math.max(...rows.map(row=>row.getBoundingClientRect().height)),filterHeight:document.querySelector('.list-filters').getBoundingClientRect().height,seventhOverflow:rows[6].getBoundingClientRect().bottom-bounds.bottom,dayLabelHeight:list.querySelector(".day-label").getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      reports.push({ width, theme, ...report });
      await fs.writeFile(path.join(output, `${baseline ? 'before' : 'after'}-${width}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      if (!baseline) {
        assert.ok(report.visible >= 7, `At least 7 complete messages at ${width}px: ${JSON.stringify(report)}`);
        assert.ok(report.rowHeight <= 84, `Summary row must stay compact at ${width}px`);
        assert.ok(report.headerHeight <= 125, 'List heading, filters and selection must not consume the viewport');
        assert.ok(report.filterHeight <= 40, 'Filters must stay on one line');
        assert.equal(report.overflow, false);
        assert.equal(await js('document.querySelectorAll(".message-quick-actions button").length===80 && document.querySelectorAll(".mail-select").length===40'), true);
        await js('document.querySelector(".mail-select").click()');
        assert.equal(await js('mailSelection.has("density-0") && Boolean(document.querySelector("[data-mail-batch=move]"))'), true);
        await js('mailSelection.clear();renderMessages();void 0');
      }
    }
    await fs.writeFile(path.join(output, `${baseline ? 'before' : 'after'}.json`), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports));
    if (!baseline) console.log('PASS: readable compact rows, seven or more complete summaries, one-line filters and preserved selection/actions.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

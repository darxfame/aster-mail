// Exercise the actual meeting form with fictional mail and injected API calls only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-mail-meeting-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
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
    window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error('Failed renderer step:', code); throw error; });
    await window.loadFile(path.join(root, 'src/index.html'));
    await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length>0');
    await js('openMessage(state.messages.find(message=>!message.meeting&&!message.isDraft).id)');
    await js(`(() => {state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.com',username:'DOMAIN\\fictional'};state.selected.subject='Обсуждение проекта';state.selected.from={name:'Анна',email:'anna@example.com'};state.selected.to=[{email:'own@example.com'},{email:'team@example.com'}];state.selected.cc=[{email:'TEAM@example.com'},{email:'alias@example.com'}];state.selected.bcc=[{email:'secret@example.com'}];state.selected.text='';state.selected.html='<p>Обсудим <b>проект</b>.</p><script>window.mailInjection=1</script><img src="https://invalid.example.test/tracker.png">';window.originalSource=state.selected.html;window.meetingCalls=[];api=async(operation,data)=>{meetingCalls.push({operation,data});if(operation==='identity')return {emails:['own@example.com','alias@example.com']};if(operation==='createEvent')throw new Error('Fictional uncertain write result');return []};})()`);
    await js(`document.querySelector('[data-action=mail-to-meeting]').click()`);
    await waitFor('Boolean(document.querySelector("#event-form"))');
    assert.equal(await js('document.querySelector("#event-form").elements.title.value'), 'Обсуждение проекта');
    assert.equal(await js('document.querySelector("#event-form").elements.attendees.value'), 'anna@example.com, team@example.com');
    const body = await js('document.querySelector("#event-form").elements.body.value');
    assert.match(body, /Обсудим проект/); assert.match(body, /https:\/\/mail.example.com\/owa\/\?ItemID=/);
    assert.doesNotMatch(body, /secret@example.com|mailInjection|<script|<img|tracker.png/);
    assert.equal(await js('typeof window.mailInjection'), 'undefined'); assert.equal(await js('state.selected.html'), await js('originalSource'));
    assert.equal(await js('meetingCalls.filter(call=>call.operation==="createEvent").length'), 0);
    assert.equal(await js('modalDirty'), true);
    assert.equal(await js(`(() => {const f=document.querySelector('#event-form');return +T.fromWall(f.elements.end.value,timeZone)-T.fromWall(f.elements.start.value,timeZone);})()`), 1800000);
    const output = path.join(root, 'release/mail-to-meeting-ui'); await fs.mkdir(output, { recursive: true });
    for (const scale of [1, 2]) {
      window.webContents.setZoomFactor(scale); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      assert.equal(await js('document.querySelector("#event-form").scrollWidth<=document.querySelector("#event-form").clientWidth+1'), true);
      await fs.writeFile(path.join(output, `meeting-from-mail-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.webContents.setZoomFactor(1);
    await js(`document.querySelector('#event-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector("#event-form .form-error").textContent)');
    assert.equal(await js('meetingCalls.filter(call=>call.operation==="createEvent").length'), 1);
    assert.equal(await js('document.querySelector("#event-form").elements.title.value'), 'Обсуждение проекта');
    assert.equal(await js('document.querySelector("#modal").open'), true);
    assert.equal(await js('document.querySelector("#event-form").elements.body.value'), body);
    await js(`setModalDirty(false);document.querySelector('#modal').close();eventModal()`);
    for (const name of ['title', 'attendees', 'body']) assert.equal(await js(`document.querySelector('#event-form').elements[${JSON.stringify(name)}].value`), '');
    console.log('PASS: mail-to-meeting form, visible recipients only, sanitized text, OWA link, default duration, no implicit send, failed-send preservation, ordinary creation and 100%/200% layout.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

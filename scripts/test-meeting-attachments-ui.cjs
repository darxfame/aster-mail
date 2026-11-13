// Fictional meeting attachments in actual Chromium; never contact a mailbox.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-meeting-attachments-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: true, width: 1100, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(code.slice(0, 200) + ': ' + error.message); } };
    await window.loadFile(path.join(root, 'src/index.html'));
    await js(`document.querySelector('[data-action=demo]').click()`);
    await js(`openMeeting({...window.asterDemo.events[0],attachments:[{id:'agenda',name:'agenda.txt',type:'text/plain',size:40,previewText:'<script>fictional plain text</script>'},{id:'office',name:'agenda.docx',size:40},{id:'picture',name:'picture.png',type:'image/png',size:40,previewUrl:'../assets/icon.png'}]})`);
    assert.equal(await js(`document.querySelectorAll('[data-action=meeting-preview-attachment]').length`), 3);
    assert.equal(await js(`document.querySelectorAll('.meeting-attachments [data-action=attachment]').length`), 3, 'Save remains available');
    const preview = id => js(`handleMeetingAction(document.querySelector('[data-action=meeting-preview-attachment][data-id=${id}]'))`);
    await preview('agenda');
    assert.equal(await js(`document.querySelector('#attachment-preview pre').textContent`), '<script>fictional plain text</script>');
    assert.equal(await js(`document.querySelectorAll('#attachment-preview script').length`), 0);
    const output = path.join(root, 'release/meeting-attachments-ui'); await fs.mkdir(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await js(`document.body.classList.toggle('dark', ${theme === 'dark'})`);
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(output, `${theme}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await js('closeAttachmentPreview()');
    await js(`document.querySelector('.meeting-attachments').scrollIntoView({block:'center'})`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(output, 'meeting-card.png'), (await window.webContents.capturePage()).toPNG());
    assert.equal(await js(`document.querySelector('#modal').open`), true, 'Meeting stays mounted after preview closes');
    await preview('picture');
    assert.equal(await js(`document.querySelector('#attachment-preview img').alt`), 'picture.png');
    await js('closeAttachmentPreview()');
    await preview('office');
    assert.match(await js(`document.querySelector('.attachment-preview-body').textContent`), /системном приложении/);
    await js(`closeAttachmentPreview();window.fixtureMeeting=activeMeeting;state.demo=false;state.account={sessionId:'fictional'};window.aster={};window.requests=[];window.originalApi=api;api=async(operation,data)=>{requests.push({operation,data});if(data.action==='preview')return new Promise(resolve=>window.finishPreview=resolve);return true};void 0`);
    await js(`window.pendingPreview=handleMeetingAction(document.querySelector('[data-action=meeting-preview-attachment][data-id=agenda]'));void 0`);
    assert.equal(await js(`requests[0].data.source.kind`), 'event');
    assert.equal(await js(`requests[0].data.source.id===activeMeeting.id`), true);
    await js(`closeAttachmentPreview();finishPreview({kind:'text',text:'late'});pendingPreview`);
    assert.equal(await js(`Boolean(document.querySelector('#attachment-preview'))`), false, 'Late response cannot restore a closed preview');
    await js(`window.pendingPreview=handleMeetingAction(document.querySelector('[data-action=meeting-preview-attachment][data-id=agenda]'));void 0`);
    await js(`modal('Other view','','');finishPreview({kind:'text',text:'late navigation'});pendingPreview`);
    assert.equal(await js(`Boolean(document.querySelector('#attachment-preview'))`), false);
    // Existing composer preview remains available.
    await js(`window.aster=null;state.demo=true;state.account=null;api=originalApi;compose('new')`);
    await js(`previewComposeAttachment(new File(['composer text'],'draft.txt',{type:'text/plain'}),null)`);
    assert.equal(await js(`document.querySelector('#attachment-preview pre').textContent`), 'composer text');
    console.log('PASS: meeting text/image/Office preview, save, safe text, close/navigation races, and existing composer preview.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

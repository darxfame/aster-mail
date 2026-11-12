// Folder permissions and menus in actual Chromium with fictional mailbox data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-folder-ui-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`state.demo=false;state.account={sessionId:'fictional',server:'https://mail.example.test',username:'fictional@example.test'};state.folders=[
      {id:'sync',wellKnown:'syncissues',name:'Ошибки синхронизации',systemIdentityKnown:true},
      {id:'conflicts',parentId:'sync',wellKnown:'conflicts',name:'Конфликты',systemIdentityKnown:true},
      {id:'local',parentId:'sync',wellKnown:'localfailures',name:'Локальные ошибки',systemIdentityKnown:true},
      {id:'server',parentId:'sync',wellKnown:'serverfailures',name:'Ошибки сервера',systemIdentityKnown:true},
      {id:'custom',name:'Ошибки синхронизации',systemIdentityKnown:true},
      {id:'unresolved',name:'Unknown identity',systemIdentityKnown:false}
    ];window.fixtureCalls=[];api=async(...args)=>{fixtureCalls.push(args);throw new Error('Unexpected native write');};renderSidebar();void 0;`);
    for (const id of ['sync', 'conflicts', 'local', 'server', 'custom', 'unresolved']) {
      await js(`showFolderMenu(document.querySelector('[data-folder="${id}"]'),500,240)`);
      const protectedFolder = id !== 'custom';
      assert.equal(await js('document.querySelector("[data-folder-operation=trash]").disabled'), protectedFolder, id);
      assert.equal(await js('document.querySelector("[data-folder-operation=rename]").disabled'), protectedFolder, id);
      assert.equal(await js('document.querySelector("[data-folder-operation=refresh]").disabled'), false);
      if (protectedFolder) {
        await js('document.querySelector("[data-folder-operation=trash]").click()');
        assert.equal(await js('document.querySelector("#modal").open'), false, 'A protected folder must never open a removal confirmation');
        const message = await js(`(async()=>{const folder=state.folders.find(f=>f.id==='${id}');try{await performFolderAction({folder:{...folder,key:folder.id},action:'trash',account:state.account,demo:false});return '';}catch(error){return error.message;}})()`);
        assert.match(message, id === 'unresolved' ? /определить системные папки/ : /Системную папку/);
      }
      await js('closeFolderMenu()');
    }
    assert.equal(await js('fixtureCalls.length'), 0, 'No denied action can reach IPC');
    const output = path.join(root, 'release/folder-ui'); await fs.mkdir(output, { recursive: true });
    await js('showFolderMenu(document.querySelector("[data-folder=sync]"),500,240)');
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(output, 'protected-sync-folder.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: synchronization tree, disabled rename/trash, direct-call protection, unresolved identity and same-named custom folders; zero writes.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

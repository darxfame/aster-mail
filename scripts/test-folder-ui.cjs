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
    assert.equal(await js('Boolean($("[data-folder-operation=empty]"))'), false);
    await js(`closeFolderMenu();state.demo=true;state.account=null;state.view='mail';state.folder='deleteditems';
      const message=window.asterDemo.messages[0];
      window.asterDemo.messages.push({...message,id:'trashed',folder:'deleteditems'},{...message,id:'trashed-child',folder:'trash-child'});
      window.asterDemo.folders.push({id:'trash-child',parentId:'folder-deleteditems',name:'Child'},{id:'trash-grandchild',parentId:'trash-child',name:'Grandchild'});
      loadView()`);
    assert.equal(await js('state.messages.length'), 1);
    await js('showFolderMenu($("[data-folder=deleteditems]"),500,240);$("[data-folder-operation=empty]").click()');
    assert.equal(await js('$("#modal").open && document.activeElement.dataset.action === "close"'), true);
    await js('$("#folder-operation-form [data-action=close]").click()');
    assert.equal(await js('state.messages.length'), 1, 'Cancel leaves Trash intact');
    await js('$("[data-action=empty-trash]").click()');
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(output, 'empty-trash-confirmation.png'), (await window.webContents.capturePage()).toPNG());
    await js('$("#folder-operation-form button[type=submit]").click()');
    assert.deepEqual(await js('[state.messages.length, window.asterDemo.messages.some(m=>m.id==="trashed-child"), window.asterDemo.folders.some(f=>f.id.startsWith("trash-")), window.asterDemo.messages.some(m=>m.folder==="inbox"), $("#modal").open]'), [0, false, false, true, false]);
    const failure = await js(`(async () => {
      state.demo=false;state.account={sessionId:'fictional'};
      api=async (...args)=>{fixtureCalls.push(args);throw Object.assign(new Error('Lost response'), {userFacing:true});};
      $("[data-action=empty-trash]").click();
      $("#folder-operation-form").requestSubmit();$("#folder-operation-form").requestSubmit();
      await new Promise(resolve=>setTimeout(resolve, 30));
      return {calls:fixtureCalls, open:$("#modal").open, error:$("#folder-operation-form .form-error").textContent};
    })()`);
    assert.deepEqual(failure, { calls: [['folderOperation', { action: 'empty', folder: 'deleteditems' }]], open: true, error: 'Lost response' });
    console.log('PASS: folder protection and empty-trash controls, cancel, recursive demo cleanup and preserved Inbox.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

// Real Electron host and independent Node stdio harness; fictional UI data only.
const { app, BrowserWindow, Menu, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-mcp-native-'));
app.setPath('userData', profile);
require('../desktop/main.cjs');
let child, clipboardBackup;
async function finish(code, error) {
  if (error) console.error(error);
  try {
    child?.kill();
    if (clipboardBackup !== undefined) await clipboard.writeText(clipboardBackup);
    // The fixture owns every window; do not invoke production quit/dirty guards.
    app.removeAllListeners('window-all-closed');
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => {
      // Chromium can retain Windows profile handles until process exit.
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      console.warn(`Temporary fictional profile remains locked until exit: ${error.code}`);
    });
  } catch (failure) { console.error(failure); code = 1; }
  finally { app.exit(code); }
}
async function waitFor(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('MCP native fixture timed out');
}
app.whenReady().then(async () => {
  clipboardBackup = await clipboard.readText();
  await waitFor(() => Menu.getApplicationMenu()?.getMenuItemById('aster-mcp') && BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/src/index.html') && !window.webContents.isLoading()));
  const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/src/index.html'));
  const js = async code => {
    const result = await window.webContents.executeJavaScript(`try { ${code} } catch (error) { ({ fixtureError: error.stack }); }`);
    if (result?.fixtureError) throw new Error(result.fixtureError);
    return result;
  };
  const item = Menu.getApplicationMenu().getMenuItemById('aster-mcp');
  assert.equal(item.checked, false);
  await assert.rejects(fs.readFile(path.join(profile, 'mcp-connection.json')), { code: 'ENOENT' });
  item.click();
  await waitFor(async () => { try { return Boolean(JSON.parse(await fs.readFile(path.join(profile, 'mcp-connection.json'), 'utf8')).port); } catch { return false; } });
  const menu = Menu.getApplicationMenu().items.find(item => item.label === 'MCP');
  menu.submenu.items[1].click();
  const config = JSON.parse(await clipboard.readText()).mcpServers['aster-mail'];
  assert.equal(config.command, 'node'); assert.deepEqual(config.args, [path.join(profile, 'mcp-stdio.cjs')]);
  child = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; const replies = new Map(); let id = 0;
  child.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); replies.get(value.id)?.(value); replies.delete(value.id); } });
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => reject(new Error('Independent harness timeout')), 5000);
    replies.set(requestId, value => { clearTimeout(timer); resolve(value); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'independent-node-fixture', version: '1' } });
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const exposed = (await request('tools/list')).result.tools;
  assert.equal(exposed.length, 14);
  for (const name of ['list_meetings', 'search_meetings', 'read_meeting', 'get_availability', 'find_meeting_slots', 'create_meeting', 'update_meeting']) assert.ok(exposed.some(tool => tool.name === name));
  assert.deepEqual(JSON.parse((await request('tools/call', { name: 'get_account', arguments: {} })).result.content[0].text), { connected: false, sessionId: null });
  assert.equal((await request('tools/call', { name: 'read_meeting', arguments: { sessionId: 'retired', id: 'fictional' } })).result.isError, true);
  await js('document.querySelector("[data-action=demo]").click()');
  await waitFor(() => js('Boolean(document.querySelector(".message-open"))'));
  await js('document.querySelector(".message-open").click()');
  await waitFor(() => js('Boolean(state.selected)'));
  await js(`(() => {
    window.mcpFixtureMessage=JSON.parse(JSON.stringify(state.selected));
    window.mcpReader=document.querySelector('#reader');
    document.querySelector('[data-action=compose]').click();
    window.mcpEditor=document.querySelector('[contenteditable=true]');
    window.mcpDialog=document.querySelector('#modal');
    mcpEditor.textContent='Unsaved fictional draft';
    state.demo=false;state.account={sessionId:'fictional-mcp'};
    api=async operation=>operation==='folders'?[{id:'inbox',name:'Входящие',wellKnown:'inbox'}]:{items:[{...mcpFixtureMessage,id:'after-move'}],more:false};
    return receiveMailboxChange({sessionId:'fictional-mcp',busy:true});
  })()`);
  await js('receiveMailboxChange({sessionId:"fictional-mcp",busy:false})');
  assert.equal(await js('document.querySelector("#reader")===mcpReader'), true);
  assert.equal(await js('document.querySelector("[contenteditable=true]")===mcpEditor && mcpEditor.textContent==="Unsaved fictional draft" && mcpDialog.open'), true);
  assert.equal(await js('state.messages[0].id'), 'after-move');
  const output = path.join(__dirname, '../release/mcp-ui'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'preserved-compose.png'), (await window.webContents.capturePage()).toPNG());
  await js(`(() => {
    mcpDialog.close();state.demo=true;state.account=null;state.view='calendar';state.selected=null;state.query='';
    return loadView();
  })()`);
  await js(`(() => {
    document.querySelector('[data-action=new-event]').click();
    document.querySelector('#event-form').elements.title.value='Unsaved fictional meeting';
    window.mcpMeetingForm=document.querySelector('#event-form');
    state.demo=false;state.account={sessionId:'fictional-mcp'};
    api=async operation=>operation==='calendar'?[{id:'mcp-event',title:'Updated through MCP',start:new Date().toISOString(),end:new Date(Date.now()+3600000).toISOString(),showAs:'Busy'}]:{};
    return receiveCalendarChange({sessionId:'fictional-mcp',busy:true});
  })()`);
  await js('receiveCalendarChange({sessionId:"fictional-mcp",busy:false})');
  assert.equal(await js('document.querySelector("#event-form")===mcpMeetingForm && mcpMeetingForm.elements.title.value==="Unsaved fictional meeting" && mcpDialog.open'), true);
  assert.equal(await js('state.events[0].id'), 'mcp-event');
  await fs.writeFile(path.join(output, 'preserved-meeting.png'), (await window.webContents.capturePage()).toPNG());
  await js('mcpDialog.close();state.account=null;state.demo=true;window.aster.setUnsavedChanges(false);void 0');
  item.click();
  await waitFor(async () => { try { await fs.stat(path.join(profile, 'mcp-connection.json')); return false; } catch { return true; } });
  assert.equal((await request('tools/call', { name: 'get_account', arguments: {} })).result.isError, true);
  console.log('PASS: native MCP menu, independent stdio harness, mail/calendar tools, disabled access, preserved reader and unsaved mail/meeting drafts.');
}).then(() => finish(0), error => finish(1, error));

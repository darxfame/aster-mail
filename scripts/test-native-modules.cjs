const electron = require('electron');
const { app, BrowserWindow } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const M = require('../desktop/modules.cjs');
const G = require('../desktop/module-github.cjs');
const { ModuleHost } = require('../desktop/module-host.cjs');
let host, owner, server, udp;
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'aster-native-modules-profile-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-native-modules-'));
  await fs.writeFile(path.join(directory, 'fictional-secret.txt'), 'fictional account data');
  let hits = 0, udpHits = 0, records = [], sessionId = 'fictional-session';
  const controller = new AbortController();
  udp = require('node:dgram').createSocket('udp4'); udp.on('message', () => { udpHits++; });
  await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
  await electron.session.defaultSession.cookies.set({ url: 'https://aster-module.invalid', name: 'account-test', value: 'fictional-cookie' });
  server = http.createServer((_request, response) => { hits++; response.end('must not be reached'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  host = new ModuleHost({ electron, directory: path.join(directory, 'modules'),
    scope: () => ({ sessionId, signal: controller.signal, records }),
    save: async value => { records = value; }, sdk: async () => { throw new Error('No external host actions in this fixture'); } });
  let bundle = await M.readPackage(path.join(__dirname, '../examples/modules/sandbox-demo'));
  const githubIndex = process.argv.indexOf('--github');
  if (githubIndex !== -1) {
    const ref = process.argv[githubIndex + 1];
    assert.match(ref || '', /^[a-f0-9]{40}$/);
    const downloadSession = electron.session.fromPartition(`github-module-test-${Date.now()}`, { cache: false });
    const remote = await G.load({ url: 'https://github.com/darxfame/aster-mail', ref, directory: 'examples/modules/sandbox-demo' },
      (url, limit, signal) => G.getBytes(electron.net, downloadSession, url, limit, signal), controller.signal);
    assert.equal(remote.digest, bundle.digest);
    assert.equal(remote.source.commit, ref);
    bundle = remote;
    await downloadSession.closeAllConnections();
    console.log('PASS: real GitHub commit-pinned download matches the local package fingerprint');
  }
  await host.install(bundle); await host.configure(bundle.manifest.id, true);
  const report = await host.invoke(bundle.manifest.id, 'inspect', { url: `http://127.0.0.1:${server.address().port}/blocked`, iceServer: `stun:127.0.0.1:${udp.address().port}`, file: `file://${path.join(directory, 'fictional-secret.txt')}` });
  assert.deepEqual(report, { cookie: '', coreBridge: false, node: false, directNetworkBlocked: true, fileBlocked: true, calendarBlocked: true });
  assert.equal(hits, 0); assert.equal(udpHits, 0);
  assert.deepEqual(await host.invoke(bundle.manifest.id, 'increment'), { count: 1 });
  assert.equal(records[0].data.count, 1);
  const runtime = host.entries.get(bundle.manifest.id);
  const preferences = runtime.window.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true);
  assert.equal(runtime.window.webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp');
  owner = new BrowserWindow({ width: 800, height: 500, show: process.argv.includes('--keep-open'), title: 'Aster Module Sandbox Test', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  await owner.loadURL('data:text/html,<title>Aster Module Sandbox Test</title><h2>Embedded sandbox module</h2><p>Fictional test data only.</p>');
  await host.mounts(owner, [{ id: bundle.manifest.id, view: 'panel', bounds: { x: 30, y: 110, width: 720, height: 280 } }]);
  assert.equal(host.views.size, 1);
  const embedded = [...host.views.values()][0];
  assert.equal(embedded.view.webContents.getLastWebPreferences().sandbox, true);
  assert.notEqual(owner.webContents.getOSProcessId(), embedded.view.webContents.getOSProcessId());
  await assert.rejects(host.invoke(bundle.manifest.id, 'undeclared'), /операции/);
  sessionId = 'another-session';
  assert.throws(() => host.current(runtime), /Сессия/);
  sessionId = 'fictional-session';
  console.log('PASS: actual Chromium sandbox, no Node/file/direct network, denied calendar permission, scoped storage, embedded WebContentsView and account retirement');
  if (process.argv.includes('--keep-open')) { console.log('Visual fixture remains open. Ctrl+C to close.'); return; }
  host.closeAll(); assert.equal(host.entries.size, 0); assert.equal(host.views.size, 0); owner.destroy();
  await new Promise(resolve => server.close(resolve)); udp.close(); app.exit(0);
}).catch(error => { console.error(error); host?.closeAll(); if (owner && !owner.isDestroyed()) owner.destroy(); server?.closeAllConnections(); server?.close(); try { udp?.close(); } catch {} app.exit(1); });

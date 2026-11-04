// Fictional providers only. No Exchange, real credentials or external applications.
const electron = require('electron');
const { app } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const hostRoot = process.env.ASTER_PACKAGED_APP || path.join(__dirname, '..');
const M = require(path.join(hostRoot, 'desktop/modules.cjs'));
const { ModuleHost } = require(path.join(hostRoot, 'desktop/module-host.cjs'));
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'aster-sdk-native-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let host;
app.whenReady().then(async () => {
  const origin = 'https://login.example.test', startOrigin = 'https://start.example.test', expiry = new Date(Date.now() + 3600000).toISOString();
  let records = [], currentSession = 'fictional', authSession, authWindow, captures = 0;
  const controller = new AbortController();
  const adaptedElectron = { ...electron, session: { fromPartition(partition, options) {
    const session = electron.session.fromPartition(partition, options);
    if (partition.startsWith('aster-module-auth-')) {
      authSession = session;
      session.protocol.handle('https', request => {
        captures++;
        const body = new URL(request.url).origin === startOrigin
          ? `<button id="sso">Workspace SSO</button><script>localStorage.setItem('fictional-login',JSON.stringify({credential:{access:'must-not-capture-from-start',until:'${expiry}'}}));document.querySelector('button').onclick=()=>location.href='${origin}/';</script>`
          : `<iframe src="https://analytics.example.test/frame"></iframe><script>localStorage.setItem('fictional-login', JSON.stringify({credential:{access:'fictional-secret',until:'${expiry}'}}));</script>Fictional provider`;
        return new Response(body, { headers: { 'Content-Type': 'text/html' } });
      });
    }
    return session;
  } }, BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, show: false }); if (options.title?.includes(origin)) authWindow = this; }
  } };
  host = new ModuleHost({ electron: adaptedElectron, directory: path.join(profile, 'modules'), scope: () => ({ sessionId: currentSession, signal: controller.signal, records }), save: async value => { records = value; }, sdk: async () => { throw new Error('No host data in fixture'); } });
  const manifest = { apiVersion: 1, id: 'example.auth-fixture', name: 'Fictional login fixture', version: '1.0.0', type: 'integration', main: 'main.js', files: ['main.js'], permissions: ['auth.session', 'network'], networkOrigins: [origin], authentication: { type: 'browser-token', origins: [origin], identityOrigins: [], capture: { storage: 'localStorage', key: 'fictional-login', tokenPath: ['credential', 'access'], expiresAtPath: ['credential', 'until'] }, authorization: { scheme: 'Bearer' } }, commands: [{ id: 'login', title: 'Fictional login', slot: 'internal' }, { id: 'status', title: 'Status', slot: 'internal' }, { id: 'logout', title: 'Logout', slot: 'internal' }, { id: 'http-status', title: 'HTTP status', slot: 'internal' }] };
  const source = `export async function activate(api) { return { commands: { login: () => api.call('auth.signIn',{origin:${JSON.stringify(origin)}}), status: () => api.call('auth.status'), logout: () => api.call('auth.signOut'), 'http-status': async () => { try { await api.call('network.request',{url:${JSON.stringify(origin)}+'/room'}); } catch (error) { return {code:error.code,status:error.status}; } } } }; }`;
  const bundle = M.fromFiles(new Map([['module.json', Buffer.from(JSON.stringify(manifest))], ['main.js', Buffer.from(source)]]));
  await host.install(bundle, true);
  await host.invoke(manifest.id, 'login');
  const deadline = Date.now() + 10000;
  while (!records[0].auth && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(records[0].auth?.token, 'fictional-secret'); assert.ok(captures > 0); assert.ok(authWindow.isDestroyed()); assert.equal(host.entries.get(manifest.id).authBlockedOrigin, null);
  const status = await host.invoke(manifest.id, 'status'); assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('fictional-secret'), false);
  assert.equal(JSON.stringify(await host.catalog()).includes('fictional-secret'), false);
  assert.notEqual(authSession, electron.session.defaultSession);
  const originalRequest = M.requestJSON;
  try {
    M.requestJSON = async () => { throw Object.assign(new Error('Fictional missing room'), { code: 'http-error', status: 404 }); };
    assert.deepEqual(await host.invoke(manifest.id, 'http-status'), { code: 'http-error', status: 404 });
  } finally { M.requestJSON = originalRequest; }
  await host.invoke(manifest.id, 'logout'); assert.equal(records[0].auth, undefined);
  const nextFiles = new Map(bundle.files), nextManifest = structuredClone(manifest);
  nextManifest.version = '1.0.1'; nextManifest.authentication.startOrigin = startOrigin; nextManifest.authentication.identityOrigins = [startOrigin];
  nextFiles.set('module.json', Buffer.from(JSON.stringify(nextManifest))); await host.install(M.fromFiles(nextFiles), true);
  await host.invoke(manifest.id, 'login');
  assert.equal(new URL(authWindow.webContents.getURL()).origin, startOrigin);
  await new Promise(resolve => setTimeout(resolve, 900)); assert.equal(records[0].auth, undefined);
  await authWindow.webContents.executeJavaScript('document.querySelector("#sso").click()');
  const separateDeadline = Date.now() + 5000;
  while (!records[0].auth && Date.now() < separateDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(records[0].auth?.token, 'fictional-secret'); assert.equal(records[0].auth?.origin, origin);
  await host.invoke(manifest.id, 'logout');
  await host.invoke(manifest.id, 'login');
  const preferences = authWindow.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true);
  const entry = host.entries.get(manifest.id); assert.ok(entry.authFlow);
  currentSession = 'retired'; host.closeAll(); assert.ok(authWindow.isDestroyed()); assert.equal(host.entries.size, 0);
  assert.equal(typeof app.getApplicationNameForProtocol('aster-fictional-unregistered://rooms.example.test/room'), 'string');
  console.log('PASS: real isolated browser sign-in, declarative token capture, hidden credentials, logout, account retirement and OS protocol lookup');
  app.exit(0);
}).catch(error => { console.error(error); host?.closeAll(); app.exit(1); });

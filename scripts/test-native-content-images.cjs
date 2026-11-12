// Real Electron fetches against fictional loopback responses; no production TLS changes.
const { app, session, net, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, fetchContentImage, fetchImageResponse } = require('../desktop/content-images.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-content-images-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');
app.whenReady().then(async () => {
  let server, imageWindow;
  const isolated = session.fromPartition('fictional-images', { cache: false });
  try {
    const requests = []; let slowStarted;
    const slowReady = new Promise(resolve => { slowStarted = resolve; });
    server = http.createServer((request, response) => {
      requests.push(request.headers);
      assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.referer, undefined);
      if (request.url === '/redirect') { response.writeHead(302, { location: 'https://it/picture.png', 'set-cookie': 'tracking=fixture' }); response.end(); }
      else if (request.url === '/unsafe') { response.writeHead(302, { location: 'https://127.0.0.1/private' }); response.end(); }
      else if (request.url === '/large') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(Buffer.alloc(5 * 1024 * 1024 + 1)); }
      else if (request.url === '/slow') { response.writeHead(200, { 'content-type': 'image/png' }); response.write(image.subarray(0,8)); slowStarted(); }
      else if (request.url === '/auth') { response.writeHead(401, { 'www-authenticate': 'Basic realm="fictional"' }); response.end(); }
      else { response.writeHead(200, { 'content-type': 'image/png' }); response.end(image); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    await isolated.cookies.set({ url: local, name: 'fictional', value: 'must-not-leave' });
    const account = session.fromPartition('fictional-account', { cache: false });
    await account.cookies.set({ url: local, name: 'account', value: 'must-not-leave' });
    const fixture = { fetch(url, options) {
      assert.ok(['it', 'cdn.example.test'].includes(new URL(url).hostname));
      // Only this fixture maps synthetic HTTPS names onto its local HTTP server.
      return fetchImageResponse(local + new URL(url).pathname, options, isolated, net);
    } };
    const lifetime = new AbortController();
    for (const url of ['https://it/picture.png', 'https://cdn.example.test/redirect', 'http://it/picture.png']) {
      const loaded = await fetchContentImage(url, 'https://mail.example.test', fixture, lifetime.signal);
      assert.equal(loaded.Content, image.toString('base64'));
    }
    await assert.rejects(fetchContentImage('https://it/auth', 'https://mail.example.test', fixture, lifetime.signal), /401/);
    assert.equal(requests.length, 5);
    assert.equal((await isolated.cookies.get({ url: local })).some(cookie => cookie.name === 'tracking'), false);
    const html = '<div style="background-color:white"><img src="http://it/picture.png" alt="Fictional HTTP image"></div>';
    const loaded = await load({ html, attachments: [] }, () => assert.fail('Not an attachment'), url => fetchContentImage(url, 'https://mail.example.test', fixture, lifetime.signal), 'https://mail.example.test');
    imageWindow = new BrowserWindow({ width: 1000, height: 700, show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 12 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await imageWindow.loadFile(path.join(__dirname, '../src/index.html'));
    await imageWindow.webContents.executeJavaScript(`document.querySelector('[data-action=demo]').click();window.imageFixture=document.createElement('div');imageFixture.style.width='320px';document.querySelector('#workspace').replaceChildren(imageFixture);window.asterRichContent.render(imageFixture,${JSON.stringify(html)},{dark:true,title:'Fictional HTTP image',loadImages:async()=>(${JSON.stringify(loaded)}),openLink(){}})`);
    let decoded = false;
    for (let i = 0; i < 100; i++) {
      decoded = await imageWindow.webContents.executeJavaScript(`(()=>{const img=imageFixture.querySelector('iframe')?.contentDocument?.querySelector('img');return Boolean(img && !img.hidden && img.naturalWidth===1);})()`);
      if (decoded) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(decoded, true, 'HTTP bytes pass backend validation and decode inside the sandboxed reader');
    imageWindow.destroy(); imageWindow = null;
    await assert.rejects(fetchContentImage('https://it/unsafe', 'https://mail.example.test', fixture, lifetime.signal), /Неподдерживаемый адрес/);
    assert.equal(requests.length, 7);
    await assert.rejects(fetchContentImage('https://it/large', 'https://mail.example.test', fixture, lifetime.signal), /5 МБ/);
    const pending = fetchContentImage('https://it/slow', 'https://mail.example.test', fixture, lifetime.signal);
    const cancelled = assert.rejects(pending); await slowReady;
    lifetime.abort();
    await cancelled;
    await assert.rejects(fetchContentImage('https://it/picture.png', 'https://mail.example.test', fixture, lifetime.signal));
    assert.equal(requests.length, 9);
    console.log('PASS: HTTP/HTTPS images decode in the sandboxed reader, redirects, omitted cookies/auth/referrer, size limits, 401 and logout.');
  } finally {
    imageWindow?.destroy();
    await isolated.closeAllConnections();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

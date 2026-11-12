// Real Electron fetches against fictional loopback responses; no production TLS changes.
const { app, session, net } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fetchContentImage, fetchImageResponse } = require('../desktop/content-images.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-content-images-'));
app.setPath('userData', profile);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');
app.whenReady().then(async () => {
  let server;
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
    for (const url of ['https://it/picture.png', 'https://cdn.example.test/redirect']) {
      const loaded = await fetchContentImage(url, 'https://mail.example.test', fixture, lifetime.signal);
      assert.equal(loaded.Content, image.toString('base64'));
    }
    await assert.rejects(fetchContentImage('https://it/auth', 'https://mail.example.test', fixture, lifetime.signal), /401/);
    assert.equal(requests.length, 4);
    assert.equal((await isolated.cookies.get({ url: local })).some(cookie => cookie.name === 'tracking'), false);
    await assert.rejects(fetchContentImage('https://it/unsafe', 'https://mail.example.test', fixture, lifetime.signal), /Неподдерживаемый адрес/);
    assert.equal(requests.length, 5);
    await assert.rejects(fetchContentImage('https://it/large', 'https://mail.example.test', fixture, lifetime.signal), /5 МБ/);
    const pending = fetchContentImage('https://it/slow', 'https://mail.example.test', fixture, lifetime.signal);
    const cancelled = assert.rejects(pending); await slowReady;
    lifetime.abort();
    await cancelled;
    await assert.rejects(fetchContentImage('https://it/picture.png', 'https://mail.example.test', fixture, lifetime.signal));
    assert.equal(requests.length, 7);
    console.log('PASS: native image fetch, external/short HTTPS hostnames, redirects, omitted cookies/auth/referrer, 401 and logout.');
  } finally {
    await isolated.closeAllConnections();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

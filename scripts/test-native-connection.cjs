const { app, net, session } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTransport } = require('../desktop/transport.cjs');
const { OWAClient } = require('../desktop/owa.cjs');

// No real account, network destination or system certificate changes.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-connection-test-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  let server;
  try {
    let posts = 0;
    server = http.createServer((request, response) => {
      let text;
      if (request.url === '/owa/auth.owa') {
        posts++;
        assert.equal(request.method, 'POST');
        text = '"canary":"fictional-token"';
      } else if (request.url === '/owa/') text = '<form action="/owa/auth.owa"></form>';
      else text = JSON.stringify({ Body: { ResponseCode: 'NoError' } });
      const body = zlib.gzipSync(text);
      response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length });
      response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `https://127.0.0.1:${server.address().port}`;
    const accountSession = session.fromPartition('connection-test', { cache: false });
    const order = [];
    // Only this test maps the synthetic HTTPS origin to its loopback HTTP fixture.
    // Requests still use the actual Electron ClientRequest/IncomingMessage lifecycle.
    const transport = createTransport({ request(options) {
      assert.equal(new URL(options.url).origin, origin);
      const request = net.request({ ...options, url: options.url.replace(/^https:/, 'http:') });
      const setHeader = request.setHeader.bind(request);
      request.setHeader = (name, value) => setHeader(name, /^(?:origin|referer)$/i.test(name) ? value.replace(/^https:/, 'http:') : value);
      for (const name of ['close', 'response']) request.on(name, () => order.push(name));
      return request;
    } }, { server: origin, username: 'fictional', password: 'fictional' }, accountSession, new AbortController().signal);
    const client = new OWAClient({ server: origin, username: 'fictional', password: 'fictional' }, transport, async () => null);
    await client.authenticate();
    assert.equal(client.canary, 'fictional-token');
    assert.equal(posts, 1);
    await client.call('GetFolder', { Body: {} });
    assert.equal(posts, 1);
    assert.equal(order.filter(event => event === 'response').length, 3);
    console.log('PASS: native Electron form login, gzip response and first authenticated read');
    console.log(`Request lifecycle: ${order.join(' → ')}`);
    await accountSession.closeAllConnections();
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

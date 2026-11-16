// Private loopback bridge for the stdio process, not a public HTTP MCP endpoint.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { tools, createTools } = require('./mcp-tools.cjs');
async function start({ directory, version, ...options }) {
  const token = crypto.randomBytes(32).toString('hex');
  const call = createTools(options);
  let pending = 0, closed = false;
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (closed || req.method !== 'POST' || req.url !== '/bridge' || req.headers.origin || req.headers.host !== `127.0.0.1:${server.address()?.port}` || req.headers.authorization !== `Bearer ${token}`) { reply(403, { error: 'Access denied' }); return; }
    if (pending >= 8) { reply(429, { error: 'MCP bridge busy' }); return; }
    pending++;
    try {
      req.setEncoding('utf8');
      let body = '', size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 2 * 1024 * 1024) { reply(413, { error: 'Request too large' }); return; }
        body += chunk.toString('utf8');
      }
      const request = JSON.parse(body);
      if (request.method === 'tools/list') reply(200, { result: { tools } });
      else if (request.method === 'tools/call') {
        try {
          const value = await call(request.params?.name, request.params?.arguments);
          const text = JSON.stringify(value);
          if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('Result too large; narrow the search');
          reply(200, { result: { content: [{ type: 'text', text }], isError: false } });
        } catch (error) { reply(200, { result: { content: [{ type: 'text', text: error.message }], isError: true } }); }
      } else reply(400, { error: 'Unknown bridge operation' });
    } catch { if (!res.headersSent) reply(400, { error: 'Invalid bridge request' }); }
    finally { pending--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const descriptor = path.join(directory, 'mcp-connection.json');
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // The standalone script also works outside app.asar with the user's Node.js.
    await fs.copyFile(path.join(__dirname, 'mcp-stdio.cjs'), path.join(directory, 'mcp-stdio.cjs'));
    await fs.writeFile(descriptor, JSON.stringify({ port: server.address().port, token, version }), { mode: 0o600 });
    await fs.chmod(descriptor, 0o600);
  } catch (error) { server.close(); server.closeAllConnections(); throw error; }
  return { async close() {
    closed = true; server.close(); server.closeAllConnections();
    await fs.rm(descriptor, { force: true });
  } };
}
module.exports = { start };

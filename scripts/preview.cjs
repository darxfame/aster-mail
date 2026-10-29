const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set(['src/i18n.js', 'src/index.html', 'src/app.js', 'src/mail-ui.js', 'src/mail-find.js', 'src/mail-batch.js', 'src/people-ui.js', 'src/events.js', 'src/folders.js', 'src/sidebar-ui.js', 'src/rich-content.js', 'src/mail-editor.js', 'src/recipients.js', 'src/meeting-ui.js', 'src/meeting.css', 'assets/icon.png', 'src/updates-ui.js', 'src/server.js', 'src/time.js', 'src/calendar-layout.js', 'src/calendar-ui.js', 'src/calendar.js', 'src/availability.js', 'src/demo.js', 'src/styles.css', 'src/widget.html', 'src/widget.css', 'src/widget.js', 'node_modules/dompurify/dist/purify.min.js', 'assets/sounds/aster-mail.wav', 'assets/sounds/aster-meeting.wav']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wav': 'audio/wav', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.writeHead(302, { Location: '/src/index.html' }); return res.end(); }
  const file = url.pathname.replace(/^\//, '');
  if (!files.has(file)) { res.writeHead(404); return res.end('Not found'); }
  try { const data = await fs.readFile(path.join(root, file)); res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(500); res.end('Run npm install first'); }
});
const port = Number(process.env.ASTER_PREVIEW_PORT) || 4173;
server.listen(port, '127.0.0.1', () => console.log(`Aster UI preview: http://127.0.0.1:${port}/src/index.html (demo only; OWA requires Electron)`));

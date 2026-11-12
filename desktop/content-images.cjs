const tr = require('../src/i18n.js').text;
const { inspect, maxDecodedBytes } = require('./raster-images.cjs');
const { BlockList, isIP } = require('node:net');
const { isTrackingImage } = require('../src/rich-content.js');
const localAddresses = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) localAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]]) localAddresses.addSubnet(address, prefix, 'ipv6');
function sourceURL(value, origin) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !origin || url.username || url.password || value.length > 16000) throw new Error(tr('Неподдерживаемый адрес изображения'));
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, ''), family = isIP(host);
  // HTTP/HTTPS images use an anonymous session, including corporate short names.
  // Preserve OWA access while rejecting unrelated literal local endpoints.
  if (url.origin !== new URL(origin).origin && (host === 'localhost' || host.endsWith('.localhost') || family && localAddresses.check(host, family === 4 ? 'ipv4' : 'ipv6'))) throw new Error(tr('Неподдерживаемый адрес изображения'));
  return url.href;
}
function sources(html) {
  return [...new Set([...String(html || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m => (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")))].filter(src => !isTrackingImage(src)).slice(0, 12);
}
function cid(value) {
  let result = String(value || '').replace(/^cid:/i, '');
  try { result = decodeURIComponent(result); } catch { /* Keep malformed identifiers unmatched. */ }
  return result.replace(/^<|>$/g, '').toLowerCase();
}
async function load(current, fetchAttachment, fetchRemote, origin) {
  const images = {}, errors = {}; let total = 0, decoded = 0;
  const queue = sources(current.html);
  async function worker() {
    while (queue.length) {
      const src = queue.shift();
      try {
        const attachment = current.attachments.find(a => cid(a.contentId) === cid(src) && /^cid:/i.test(src));
        let image;
        if (attachment) {
          if (attachment.size > 5 * 1024 * 1024) throw new Error(tr('Изображение превышает 5 МБ'));
          image = await fetchAttachment(attachment.id);
        } else if (/^cid:/i.test(src)) {
          throw new Error(tr('Встроенное изображение не найдено во вложениях'));
        } else if (/^data:/i.test(src)) {
          const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src);
          if (!match) throw new Error(tr('Неподдерживаемый формат изображения'));
          image = { ContentType: match[1], Content: match[2] };
        } else {
          if (!fetchRemote) throw new Error(tr('Загрузка внешних изображений недоступна'));
          image = await fetchRemote(sourceURL(new URL(src, `${origin}/owa/`).href, origin));
        }
        const result = inspect(image);
        total += result.compressedBytes; decoded += result.decodedBytes;
        if (decoded > maxDecodedBytes) throw new Error(tr('Превышен лимит распакованных изображений письма'));
        if (total > 12 * 1024 * 1024) throw new Error(tr('Лимит изображений письма — 12 МБ'));
        images[src] = result.dataURL;
      } catch (error) { errors[src] = error.message; }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  return { images, errors };
}
async function fetchContentImage(url, origin, imageSession, lifetime) {
  url = sourceURL(new URL(url, `${origin}/owa/`).href, origin);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  const signal = AbortSignal.any([controller.signal, lifetime]);
  try {
    signal.throwIfAborted();
    let response;
    for (let redirect = 0; redirect <= 4; redirect++) {
      response = await imageSession.fetch(url, { credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = sourceURL(new URL(response.headers.get('location'), url).href, origin);

      await response.body?.cancel(); url = next;
    }
    if (!response.ok || response.status >= 300) throw new Error(`${tr("Изображение: HTTP")} ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) { controller.abort(); throw new Error(tr('Неподдерживаемый формат изображения')); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { controller.abort(); throw new Error(tr('Изображение превышает 5 МБ')); }
      chunks.push(Buffer.from(chunk));
    }
    return { ContentType: type, Content: Buffer.concat(chunks).toString('base64') };
  } finally { clearTimeout(timer); controller.abort(); }
}
function fetchImageResponse(url, options, imageSession, net) {
  // Electron Session.fetch rejects manual redirects instead of returning their
  // Location. ClientRequest exposes them without following or authenticating.
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal.aborted) { reject(signal.reason); return; }
    const request = net.request({ url, session: imageSession, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(response);
    };
    const abort = () => { finish(signal.reason || new Error('Aborted')); request.abort(); };
    signal.addEventListener('abort', abort, { once: true });
    request.on('login', (_info, callback) => callback());
    request.on('redirect', (status, _method, location) => {
      finish(null, new Response(null, { status, headers: { location } })); request.abort();
    });
    request.on('error', error => finish(error));
    request.on('response', response => {
      const chunks = []; let size = 0;
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error(tr('Не удалось загрузить изображение'))));
      response.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > 5 * 1024 * 1024) { finish(new Error(tr('Изображение превышает 5 МБ'))); request.abort(); }
        else chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (settled) return;
        const type = response.headers['content-type'];
        const body = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
        try { finish(null, new Response(body, { status: response.statusCode, headers: type ? { 'content-type': Array.isArray(type) ? type[0] : type } : {} })); }
        catch (error) { finish(error); }
      });
    });
    request.end();
  });
}
module.exports = { sourceURL, sources, load, fetchContentImage, fetchImageResponse };

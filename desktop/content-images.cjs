const { inspect, maxDecodedBytes } = require('./raster-images.cjs');
function sourceURL(value, origin) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !origin || url.origin !== new URL(origin).origin || url.username || url.password || value.length > 16000) throw new Error('Неподдерживаемый адрес изображения');
  return url.href;
}
function sources(html) {
  return [...new Set([...String(html || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m => (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")))].slice(0, 12);
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
          if (attachment.size > 5 * 1024 * 1024) throw new Error('Изображение превышает 5 МБ');
          image = await fetchAttachment(attachment.id);
        } else if (/^cid:/i.test(src)) {
          throw new Error('Встроенное изображение не найдено во вложениях');
        } else if (/^data:/i.test(src)) {
          const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src);
          if (!match) throw new Error('Неподдерживаемый формат изображения');
          image = { ContentType: match[1], Content: match[2] };
        } else {
          if (!fetchRemote) throw new Error('Загрузка внешних изображений недоступна');
          image = await fetchRemote(sourceURL(new URL(src, `${origin}/owa/`).href, origin));
        }
        const result = inspect(image);
        total += result.compressedBytes; decoded += result.decodedBytes;
        if (decoded > maxDecodedBytes) throw new Error('Превышен лимит распакованных изображений письма');
        if (total > 12 * 1024 * 1024) throw new Error('Лимит изображений письма — 12 МБ');
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
    if (!response.ok || response.status >= 300) throw new Error(`Изображение: HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) { controller.abort(); throw new Error('Неподдерживаемый формат изображения'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { controller.abort(); throw new Error('Изображение превышает 5 МБ'); }
      chunks.push(Buffer.from(chunk));
    }
    return { ContentType: type, Content: Buffer.concat(chunks).toString('base64') };
  } finally { clearTimeout(timer); controller.abort(); }
}
module.exports = { sourceURL, sources, load, fetchContentImage };

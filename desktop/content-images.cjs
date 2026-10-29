const C = require('./calendar-events.cjs');
const P = require('./protocol.cjs');
function sourceURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 16000) throw new Error('Неподдерживаемый адрес изображения');
  return url.href;
}
function sources(html) {
  return [...new Set([...String(html || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m => (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")))].slice(0, 12);
}
function cid(value) { return String(value || '').replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase(); }
async function load(current, fetchAttachment, fetchRemote) {
  const images = {}, errors = {}; let total = 0;
  for (const src of sources(current.html)) {
    try {
      const attachment = current.attachments.find(a => cid(a.contentId) === cid(src) && /^cid:/i.test(src));
      let image;
      if (attachment) {
        if (attachment.size > 5 * 1024 * 1024) throw new Error('Изображение превышает 5 МБ');
        image = await fetchAttachment(attachment.id);
      } else if (/^data:/i.test(src)) {
        const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src);
        if (!match) throw new Error('Неподдерживаемый формат изображения');
        image = { ContentType: match[1], Content: match[2] };
      } else {
        if (!fetchRemote) throw new Error('Загрузка внешних изображений недоступна');
        image = await fetchRemote(sourceURL(src));
      }
      const result = C.imageData(image);
      total += Buffer.byteLength(image.Content, 'base64');
      if (total > 12 * 1024 * 1024) throw new Error('Лимит изображений письма — 12 МБ');
      images[src] = result;
    } catch (error) { errors[src] = error.message; }
  }
  return { images, errors };
}
module.exports = { sourceURL, sources, load };

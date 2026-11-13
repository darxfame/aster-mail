const tr = require('../src/i18n.js').text;
const { inspect } = require('./raster-images.cjs');
const maxBytes = 20 * 1024 * 1024;
function localFile(file) {
  if (!file || typeof file.name !== 'string' || file.name.length > 255 || typeof file.content !== 'string' || file.content.length > Math.ceil(maxBytes / 3) * 4 || (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))) throw new Error(tr('Некорректное или слишком большое вложение'));
  const bytes = Buffer.from(file.content, 'base64');
  if (bytes.length > maxBytes) throw new Error(tr('Некорректное или слишком большое вложение'));
  return { name: file.name, type: file.type || '', bytes };
}
function preview({ name, type, bytes }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) throw new Error(tr('Некорректное или слишком большое вложение'));
  let raster;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) raster = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216) raster = 'image/jpeg';
  else if (/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) raster = 'image/gif';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') raster = 'image/webp';
  if (raster) {
    if (type && type !== 'application/octet-stream' && type !== raster) throw new Error(tr('Тип изображения не совпадает с содержимым'));
    return { kind: 'image', ...inspect({ ContentType: raster, Content: bytes.toString('base64') }) };
  }
  if (/^image\//.test(type)) throw new Error(tr('Этот формат изображения не поддерживается'));
  if (/\.pdf$/i.test(name) || type === 'application/pdf') return { kind: 'pdf' };
  if (/\.(txt|log|md|csv|json)$/i.test(name)) {
    const sample = bytes.subarray(0, 100000);
    if (sample.includes(0)) return { kind: 'external' };
    return { kind: 'text', text: sample.toString('utf8'), truncated: bytes.length > sample.length };
  }
  return { kind: 'external' };
}
async function resolve(data, { client, sources, assertActive, allowEvents = false }) {
  assertActive();
  if (data.file && !data.source) return localFile(data.file);
  if (!data.source || data.file || !client || typeof data.source.id !== 'string' || typeof data.id !== 'string' || data.id.length > 16000 || !sources.has(data.source.id)) throw new Error(tr('Вложение не принадлежит этому письму'));
  if (data.source.kind !== undefined && data.source.kind !== 'event' || data.source.kind === 'event' && !allowEvents) throw new Error(tr('Некорректный тип содержимого'));
  const message = data.source.kind === 'event' ? await client.eventDetails({ id: data.source.id, changeKey: data.source.changeKey }) : await client.message({ id: data.source.id, refresh: true }); assertActive();
  const attachment = message.attachments.find(file => file.id === data.id);
  if (!attachment) throw new Error(tr(data.source.kind === 'event' ? 'Вложение не найдено во встрече. Откройте карточку заново.' : 'Вложение не найдено в письме. Обновите письмо.'));
  if (attachment.size > maxBytes) throw new Error(tr('Некорректное или слишком большое вложение'));
  const bytes = await client.attachment(attachment.id); assertActive();
  return { name: attachment.name, type: attachment.type, bytes };
}
module.exports = { localFile, preview, resolve };

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { inspect, metadata } = require('../desktop/raster-images.cjs');
const { load } = require('../desktop/content-images.cjs');
const tinyPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
function chunk(kind, data) {
  const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(kind, 4);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(kind), data])) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, data, checksum]);
}
function png(width, height, { encodedWidth = width, encodedHeight = height, extra = [] } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...extra, chunk('IDAT', zlib.deflateSync(Buffer.alloc((encodedWidth * 4 + 1) * encodedHeight))), chunk('IEND', Buffer.alloc(0))]);
}
const raster = (bytes, type = 'image/png') => ({ ContentType: type, Content: bytes.toString('base64') });

test('real static PNG/GIF and WebP/JPEG header variants have bounded dimensions without decoding', () => {
  assert.equal(inspect({ ContentType: 'image/png', Content: tinyPNG }).decodedBytes, 4);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  assert.equal(inspect(raster(gif, 'image/gif')).decodedBytes, 4);
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  assert.equal(inspect(raster(webp, 'image/webp')).decodedBytes, 4);
  for (const marker of [0xc0, 0xc2]) {
    const jpeg = Buffer.from([255,216,255,marker,0,11,8,0,3,0,2,1,1,0x11,0]);
    assert.equal(inspect(raster(jpeg, 'image/jpeg')).decodedBytes, 24);
    jpeg.writeUInt16BE(8192, 7); jpeg.writeUInt16BE(8192, 9);
    assert.throws(() => inspect(raster(jpeg, 'image/jpeg')), /пикселей/);
  }
});

test('oversized dimensions, animation and truncated containers fail before decoder use', () => {
  assert.throws(() => inspect(raster(png(8192, 8192, { encodedWidth: 1, encodedHeight: 1 }))), /пикселей/);
  const apng = Buffer.alloc(8); apng.writeUInt32BE(1000);
  assert.throws(() => inspect(raster(png(1, 1, { extra: [chunk('acTL', apng)] }))), /Анимированные/);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const frame = gif.subarray(19, gif.length - 1);
  assert.throws(() => inspect(raster(Buffer.concat([gif.subarray(0, gif.length - 1), frame, Buffer.from([0x3b])]), 'image/gif')), /Анимированные/);
  for (const bytes of [Buffer.from([137,80,78,71,13,10,26,10]), png(1, 1).subarray(0, 36)]) assert.throws(() => inspect(raster(bytes)));
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8); webp.writeUInt32LE(10, 16); webp[20] = 2;
  assert.throws(() => metadata(webp, 'image/webp'), /Анимированные/);
  assert.throws(() => inspect(raster(png(257, 256)), 256 * 256), /пикселей/);
});

test('inline data, CID and remote image paths share the decoded message budget', async () => {
  const image = raster(png(2000, 2000));
  assert.ok(Buffer.from(image.Content, 'base64').length < 100000);
  const current = { html: Array.from({ length: 10 }, (_value, index) => `<img src="cid:image-${index}">`).join(''), attachments: Array.from({ length: 10 }, (_value, index) => ({ id: `${index}`, contentId: `image-${index}`, size: 20000 })) };
  const result = await load(current, async () => image, null, 'https://mail.example.com');
  assert.equal(Object.keys(result.images).length, 8); assert.equal(Object.keys(result.errors).length, 2);
  assert.match(Object.values(result.errors)[0], /распакованных/);
  const huge = raster(png(8192, 8192, { encodedWidth: 1, encodedHeight: 1 }));
  const rejected = await load({ html: `<img src="data:image/png;base64,${huge.Content}"><img src="https://mail.example.com/huge">`, attachments: [] }, null, async () => huge, 'https://mail.example.com');
  assert.equal(Object.keys(rejected.images).length, 0); assert.equal(Object.keys(rejected.errors).length, 2);
});

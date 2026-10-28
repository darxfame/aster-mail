// Dependency-free rendering of the geometric SVG app mark.
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const n = 1024, pixels = Buffer.alloc((n * 4 + 1) * n);
function distance(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const offset = y * (n * 4 + 1) + 1 + x * 4;
  const alpha = Math.max(0, Math.min(1, 219 - Math.hypot(Math.max(Math.abs(x - 512) - 262, 0), Math.max(Math.abs(y - 512) - 262, 0))));
  const stroke = Math.max(0, Math.min(1, 22 - Math.min(distance(x, y, 512, 242, 512, 782), distance(x, y, 242, 512, 782, 512), distance(x, y, 321, 321, 703, 703), distance(x, y, 321, 703, 703, 321))));
  const center = Math.max(0, Math.min(1, 63 - Math.hypot(x - 512, y - 512)));
  const color = [41, 40, 62].map((c, i) => Math.round((c * (1 - stroke) + [200, 180, 255][i] * stroke) * (1 - center) + [238, 232, 255][i] * center));
  pixels.set([...color, Math.round(alpha * 255)], offset);
}
function crc(data) { let c = 0xffffffff; for (const byte of data) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, checksum]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(__dirname, '../assets/icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));

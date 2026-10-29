// Inspect bounded raster headers before any decoder can allocate pixel buffers.
const maxPixels = 16_000_000, maxDecodedBytes = 128 * 1024 * 1024;
function dimensions(width, height, pixelLimit = maxPixels) {
  if (!width || !height || width > 8192 || height > 8192 || width * height > pixelLimit) throw new Error('Изображение превышает лимит размеров или пикселей');
  return { width, height, decodedBytes: width * height * 4 };
}
function metadata(bytes, type) {
  const invalid = () => { throw new Error('Повреждённый или неподдерживаемый файл изображения'); };
  const staticOnly = () => { throw new Error('Анимированные изображения недоступны для безопасного предпросмотра'); };
  if (type === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return invalid();
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    let offset = 8, data = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8), end = offset + 12 + length;
      if (end > bytes.length || offset !== 8 && kind === 'IHDR') return invalid();
      if (kind === 'acTL') return staticOnly();
      if (kind === 'IDAT') data = true;
      if (kind === 'IEND') return length === 0 && data && end === bytes.length ? size : invalid();
      offset = end;
    }
    return invalid();
  }
  if (type === 'image/gif') {
    if (bytes.length < 14 || !/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return invalid();
    const size = dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0;
    const skipBlocks = () => {
      while (offset < bytes.length) { const length = bytes[offset++]; if (!length) return; offset += length; }
      invalid();
    };
    while (offset < bytes.length) {
      const kind = bytes[offset++];
      if (kind === 0x3b) return frames === 1 && offset === bytes.length ? size : invalid();
      if (kind === 0x21) { if (offset >= bytes.length) return invalid(); offset++; skipBlocks(); continue; }
      if (kind !== 0x2c || offset + 9 > bytes.length) return invalid();
      if (++frames > 1) return staticOnly();
      const left = bytes.readUInt16LE(offset), top = bytes.readUInt16LE(offset + 2), width = bytes.readUInt16LE(offset + 4), height = bytes.readUInt16LE(offset + 6), flags = bytes[offset + 8];
      dimensions(width, height);
      if (left + width > size.width || top + height > size.height) return invalid();
      offset += 9 + (flags & 128 ? 3 * 2 ** ((flags & 7) + 1) : 0);
      if (offset >= bytes.length) return invalid();
      offset++; skipBlocks();
    }
    return invalid();
  }
  if (type === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return invalid();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) return invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || !marker) return invalid();
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) return invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return invalid();
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) return invalid();
        return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length;
    }
    return invalid();
  }
  if (type === 'image/webp') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return invalid();
    let offset = 12, canvas, image;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
      if (end > bytes.length) return invalid();
      if (kind === 'ANIM' || kind === 'ANMF') return staticOnly();
      if (kind === 'VP8X') {
        if (canvas || length !== 10) return invalid();
        if (bytes[start] & 2) return staticOnly();
        canvas = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
      }
      if (kind === 'VP8 ' || kind === 'VP8L') {
        if (image) return invalid();
        if (kind === 'VP8 ') {
          if (length < 10 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d,0x01,0x2a]))) return invalid();
          image = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
        } else {
          if (length < 5 || bytes[start] !== 0x2f) return invalid();
          const bits = bytes.readUInt32LE(start + 1);
          image = dimensions((bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1);
        }
      }
      offset = end + (length & 1);
    }
    if (!image || offset !== bytes.length || canvas && (canvas.width !== image.width || canvas.height !== image.height)) return invalid();
    return image;
  }
  return invalid();
}
function inspect(attachment, pixelLimit = maxPixels) {
  const type = attachment.ContentType, content = attachment.Content;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type) || typeof content !== 'string' || content.length > 7_200_000 || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(content)) throw new Error('Этот формат изображения не поддерживается');
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Изображение превышает 5 МБ');
  const info = metadata(bytes, type);
  dimensions(info.width, info.height, pixelLimit);
  return { ...info, dataURL: `data:${type};base64,${bytes.toString('base64')}`, compressedBytes: bytes.length };
}
module.exports = { inspect, metadata, maxDecodedBytes };

// The bundled raster uses green levels 40, 180 and 232 for the tile, rays and center.
function tintIcon(nativeImage, source, { accentSurface, accent, text }) {
  const image = source.resize({ width: 256 });
  const size = image.getSize(), pixels = image.toBitmap();
  const [tile, rays, center] = [accentSurface, accent, text].map(hex => Buffer.from(hex.slice(1), 'hex').reverse());
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255;
    if (!alpha) continue;
    const green = pixels[offset + 1] / alpha;
    const [from, to, mix] = green <= 180
      ? [tile, rays, Math.max(0, (green - 40) / 140)]
      : [rays, center, Math.min(1, (green - 180) / 52)];
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round((from[channel] + (to[channel] - from[channel]) * mix) * alpha);
    }
  }
  return nativeImage.createFromBitmap(pixels, size);
}

module.exports = { tintIcon };

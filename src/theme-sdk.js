(() => {
  const maxBytes = 8192;
  const tokens = Object.freeze({
    background: '--bg', surface: '--surface', surfaceAlt: '--surface2', text: '--text',
    mutedText: '--muted', border: '--line', accent: '--accent', accentSurface: '--accent-bg',
    onAccent: '--primary-ink', sidebar: '--sidebar',
  });

  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(pair => {
      const value = parseInt(pair, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function normalize(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 5 ||
        input.themeVersion !== 1 || typeof input.id !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(input.id) || input.id.trim() !== input.id ||
        typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 ||
        /[\p{Cc}\p{Cf}]/u.test(input.name) || !['light', 'dark'].includes(input.base) ||
        !input.colors || typeof input.colors !== 'object' || Object.keys(input.colors).length !== Object.keys(tokens).length) {
      throw new Error('format');
    }
    const colors = Object.fromEntries(Object.keys(tokens).map(role => {
      const color = input.colors[role];
      if (typeof color !== 'string' || color.length !== 7 || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('format');
      return [role, color.toLowerCase()];
    }));
    const levels = Object.fromEntries(Object.entries(colors).map(([role, color]) => [role, luminance(color)]));
    const contrast = (a, b) => (Math.max(levels[a], levels[b]) + 0.05) / (Math.min(levels[a], levels[b]) + 0.05);
    const surfaces = ['background', 'surface', 'surfaceAlt', 'sidebar', 'accentSurface'];
    if (surfaces.some(surface => (levels.text > levels[surface]) !== (input.base === 'dark') ||
        ['text', 'mutedText', 'accent'].some(role => contrast(role, surface) < 4.5)) ||
        contrast('onAccent', 'accent') < 4.5) throw new Error('contrast');
    return { themeVersion: 1, id: input.id, name: input.name.trim(), base: input.base, colors };
  }

  const sdk = Object.freeze({ maxBytes, tokens, normalize });
  if (typeof module === 'object') module.exports = sdk;
  else window.asterThemeSdk = sdk;
})();

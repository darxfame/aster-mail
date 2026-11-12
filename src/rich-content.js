/* No scripts, forms or navigation from email HTML. Only the parent handles link clicks. */
(function (root) {
  const styles = {
    color: /^(#[a-f0-9]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,% /+-]+\))$/i,
    'background-color': /^(#[a-f0-9]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,% /+-]+\))$/i,
    'font-family': /^[a-z0-9 ,"'.-]{1,150}$/i,
    'font-size': /^(?:[6-9]|[1-6][0-9]|7[0-2])(?:px|pt)$|^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i,
    'font-weight': /^(?:normal|bold|bolder|[1-9]00)$/,
    'font-style': /^(?:normal|italic|oblique)$/,
    'text-decoration': /^(?:none|underline|line-through|overline)(?: (?:underline|line-through|overline))*$/,
    'text-align': /^(?:left|right|center|justify|start|end)$/,
    'vertical-align': /^(?:baseline|sub|super|top|middle|bottom)$/,
    'white-space': /^(?:normal|pre-wrap|pre-line)$/,
    'margin-left': /^(?:0|[1-9]\d?(?:px|pt))$/,
  };
  const styleAllowed = (name, value) => !!styles[name]?.test(value.trim());
  function isTrackingImage(value) {
    if (!/^(?:https?:)?\/\//i.test(String(value || ''))) return false;
    try {
      const url = new URL(value, 'https://image.invalid');
      return ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'google-analytics.com' || url.hostname.endsWith('.google-analytics.com')) && /^\/(?:[gj]\/)?collect\/?$/.test(url.pathname);
    } catch { return false; }
  }
  if (typeof module !== 'undefined') { module.exports = { styleAllowed, isTrackingImage }; return; }
  const darkSurface = [41, 42, 46];
  const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  function sanitize(html, { dark = false, images = false, preserveBackgrounds = false } = {}) {
    const safe = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['div','p','br','span','b','strong','i','em','u','s','strike','sub','sup','font','a','blockquote','pre','code','ul','ol','li','h1','h2','h3','h4','hr','table','thead','tbody','tfoot','tr','td','th', ...(images ? ['img'] : [])],
      ALLOWED_ATTR: ['style','href','title','alt','src','width','height','colspan','rowspan','color','bgcolor','face','size','align'],
      ADD_DATA_URI_TAGS: ['img'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    let originalColor = '';
    if (preserveBackgrounds) {
      const original = new DOMParser().parseFromString(html, 'text/html');
      originalColor = original.body.style.color || original.body.getAttribute('color') || '';
      const background = original.body.style.backgroundColor || original.body.getAttribute('bgcolor') || original.documentElement.style.backgroundColor || original.documentElement.getAttribute('bgcolor') || '';
      if (styleAllowed('background-color', background)) doc.body.style.backgroundColor = background;
    }
    const canvas = dark || preserveBackgrounds ? document.createElement('canvas') : null;
    if (canvas) canvas.width = canvas.height = 1;
    const colors = canvas?.getContext('2d', { willReadFrequently: true });
    const rgba = value => {
      colors.clearRect(0, 0, 1, 1); colors.fillStyle = '#000'; colors.fillStyle = value; colors.fillRect(0, 0, 1, 1);
      return colors.getImageData(0, 0, 1, 1).data;
    };
    const surfaceFor = node => {
      let surface = dark ? darkSurface : [255, 255, 255];
      const parents = []; for (let parent = node; parent; parent = parent.parentElement) parents.unshift(parent);
      for (const parent of parents) if (styleAllowed('background-color', parent.style.backgroundColor)) {
        const color = rgba(parent.style.backgroundColor), alpha = color[3] / 255;
        surface = surface.map((channel, i) => color[i] * alpha + channel * (1 - alpha));
      }
      return surface;
    };
    const foreground = surface => luminance(surface) > .25 ? '#4d5063' : '#eceef2';
    if (preserveBackgrounds) doc.body.style.color = foreground(surfaceFor(doc.body));
    const readableColor = (value, background = darkSurface) => {
      if (!colors) return false;
      const color = rgba(value), alpha = color[3] / 255;
      if (!alpha) return true; // Preserve deliberately transparent text.
      const text = luminance(background.map((channel, i) => color[i] * alpha + channel * (1 - alpha))), surface = luminance(background);
      return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05) >= 4.5;
    };
    if (preserveBackgrounds && styleAllowed('color', originalColor) && (!dark || readableColor(originalColor, surfaceFor(doc.body)))) doc.body.style.color = originalColor;
    doc.body.querySelectorAll('*').forEach(node => {
      if (node.tagName === 'IMG' && isTrackingImage(node.getAttribute('src'))) { node.remove(); return; }
      if (node.hasAttribute('color')) node.style.color = node.getAttribute('color');
      if (node.hasAttribute('bgcolor')) node.style.backgroundColor = node.getAttribute('bgcolor');
      if (node.hasAttribute('face')) node.style.fontFamily = node.getAttribute('face');
      if (node.hasAttribute('size')) node.style.fontSize = ({ 1:'10px', 2:'13px', 3:'16px', 4:'18px', 5:'24px', 6:'32px', 7:'48px' })[node.getAttribute('size')] || '';
      if (node.hasAttribute('align')) node.style.textAlign = node.getAttribute('align');
      const allowed = Object.keys(styles).map(name => [name, node.style.getPropertyValue(name).trim()]).filter(([name, value]) => styleAllowed(name, value));
      if (preserveBackgrounds) for (const name of ['width', 'max-width']) {
        const value = node.style.getPropertyValue(name).trim();
        if (/^(?:auto|[1-9]\d{0,3}(?:px|pt)|(?:100|[1-9]\d?)(?:\.\d+)?%)$/.test(value)) allowed.push([name, value]);
      }
      const surface = preserveBackgrounds ? surfaceFor(node) : darkSurface;
      if (node.tagName === 'IMG') {
        const width = node.getAttribute('width') || node.style.width.replace(/px$/, '');
        if (/^[1-9]\d{0,3}$/.test(width) && Number(width) <= 1200) node.setAttribute('width', width);
        else node.removeAttribute('width');
      }
      node.removeAttribute('style');
      for (const name of ['color','bgcolor','face','size','align','height']) node.removeAttribute(name);
      for (const [name, value] of allowed) {
        // Inherit readable text when an original color has too little contrast.
        if (dark && (name === 'background-color' && !preserveBackgrounds || name === 'color' && !readableColor(value, surface))) continue;
        node.style.setProperty(name, value);
      }
      if (preserveBackgrounds && node.style.backgroundColor && !node.style.color) node.style.color = foreground(surface);
      if (node.tagName === 'A') {
        try { const url = new URL(node.getAttribute('href')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) node.removeAttribute('href'); }
        catch { node.removeAttribute('href'); }
        node.setAttribute('rel', 'noreferrer noopener');
      }
    });
    return doc;
  }
  function render(target, html, { dark, adaptToTheme = false, title, loadImages, openLink }) {
    const doc = sanitize(html, { dark, images: true, preserveBackgrounds: !adaptToTheme });
    if (!doc.body.textContent.trim() && !doc.querySelector('img,hr')) { target.replaceChildren(); return; }
    doc.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      img.removeAttribute('src'); img.dataset.imageSource = src; img.hidden = true;
      img.alt ||= tr('Изображение'); img.title = tr('Загрузка изображения…');
    });
    const imagesTask = doc.querySelector('img') ? Promise.resolve().then(loadImages) : Promise.resolve({ images: {}, errors: {} });
    imagesTask.catch(() => {}); // The frame's load listener reports the error.
    const frame = document.createElement('iframe'); frame.className = 'email-frame'; frame.title = title;
    // Scripts remain forbidden by both sandbox and CSP; same-origin lets the parent attach listeners.
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.height = '1px'; frame.style.minHeight = '0'; frame.style.background = 'transparent';
    frame.addEventListener('load', async () => {
      const body = frame.contentDocument?.body; if (!body) return;
      const resize = () => { if (frame.isConnected && frame.getClientRects().length) frame.style.height = `${Math.max(1, Math.ceil(body.getBoundingClientRect().height) + 8)}px`; };
      const observer = new ResizeObserver(() => { if (frame.isConnected) resize(); else observer.disconnect(); });
      observer.observe(body);
      const unavailable = (img, reason) => {
        reason = errorText(reason, 'contentImages');
        const placeholder = frame.contentDocument.createElement('span');
        placeholder.className = 'aster-image-unavailable';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', tr('Изображение недоступно'));
        placeholder.textContent = tr('Изображение недоступно');
        // The placeholder may be inside a light authored box in a dark reader.
        // Inherit that box's readable colors instead of the iframe root colors.
        placeholder.style.setProperty('color', 'inherit', 'important');
        placeholder.style.setProperty('background', 'transparent', 'important');
        const source = img.dataset.imageSource || '';
        const address = /^data:/i.test(source) ? `${source.slice(0, source.indexOf(',') + 1)}…` : source.slice(0, 2000);
        placeholder.title = `${String(reason || tr('Не удалось загрузить изображение')).slice(0, 500)}\n${tr('Адрес изображения:')} ${address}`;
        img.replaceWith(placeholder); resize();
      };
      body.addEventListener('click', event => {
        const link = event.target.closest('a[href]'); if (!link) return;
        event.preventDefault(); event.stopPropagation(); openLink(link.getAttribute('href'));
      });
      body.addEventListener('submit', event => event.preventDefault());
      resize();
      try {
        const result = await imagesTask;
        if (!frame.isConnected) return;
        body.querySelectorAll('img').forEach(img => {
          const src = img.dataset.imageSource;
          if (result.images[src]) {
            img.addEventListener('error', () => unavailable(img, tr('Файл изображения не удалось отобразить')), { once: true });
            img.addEventListener('load', () => { img.hidden = false; resize(); }, { once: true });
            img.src = result.images[src]; img.title = img.alt;
          } else unavailable(img, result.errors[src]);
        });
        resize();
      } catch (error) { if (frame.isConnected) body.querySelectorAll('img').forEach(img => unavailable(img, error.message)); }
    });
    const background = adaptToTheme ? dark ? `rgb(${darkSurface.join(',')})` : '#ffffff' : doc.body.style.backgroundColor || 'transparent';
    const text = doc.body.style.color || (dark ? '#eceef2' : '#4d5063'), line = dark ? '#49494d' : '#e4e4eb';
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${dark ? 'dark' : 'light'}}html{background:transparent}body{background:${background};color:${text};margin:0}body{display:flow-root;font:13px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}body *{box-sizing:border-box;max-width:100%}a[href]{color:inherit!important;text-decoration:underline;cursor:pointer}img{max-width:100%;height:auto;object-fit:contain}.aster-image-unavailable{display:inline-block!important;font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif!important;letter-spacing:normal!important;word-spacing:normal!important;white-space:normal!important;color:${text}!important;background:${background}!important;padding:4px 8px!important;border:1px solid ${line}!important;border-radius:4px;max-width:100%}table{border-collapse:collapse}body>table{margin-left:auto;margin-right:auto}td,th{padding:5px;border-color:${line}!important}p{margin:0 0 16px}pre{white-space:pre-wrap}blockquote{border-left:2px solid ${line};padding-left:14px}ul,ol{padding-left:24px}</style></head><body>${doc.body.innerHTML}</body></html>`;
    target.replaceChildren(frame);
  }
  root.asterRichContent = { render, sanitize };
})(typeof window !== 'undefined' ? window : globalThis);

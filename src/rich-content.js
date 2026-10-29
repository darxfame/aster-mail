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
  if (typeof module !== 'undefined') { module.exports = { styleAllowed }; return; }
  function sanitize(html, { dark = false, images = false } = {}) {
    const safe = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['div','p','br','span','b','strong','i','em','u','s','strike','sub','sup','font','a','blockquote','pre','code','ul','ol','li','h1','h2','h3','h4','hr','table','thead','tbody','tfoot','tr','td','th', ...(images ? ['img'] : [])],
      ALLOWED_ATTR: ['style','href','title','alt','src','width','height','colspan','rowspan','color','bgcolor','face','size','align'],
      ADD_DATA_URI_TAGS: ['img'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    doc.body.querySelectorAll('*').forEach(node => {
      if (node.hasAttribute('color')) node.style.color = node.getAttribute('color');
      if (node.hasAttribute('bgcolor')) node.style.backgroundColor = node.getAttribute('bgcolor');
      if (node.hasAttribute('face')) node.style.fontFamily = node.getAttribute('face');
      if (node.hasAttribute('size')) node.style.fontSize = ({ 1:'10px', 2:'13px', 3:'16px', 4:'18px', 5:'24px', 6:'32px', 7:'48px' })[node.getAttribute('size')] || '';
      if (node.hasAttribute('align')) node.style.textAlign = node.getAttribute('align');
      const allowed = Object.keys(styles).map(name => [name, node.style.getPropertyValue(name).trim()]).filter(([name, value]) => styleAllowed(name, value));
      if (node.tagName === 'IMG') {
        const width = node.getAttribute('width') || node.style.width.replace(/px$/, '');
        if (/^[1-9]\d{0,3}$/.test(width) && Number(width) <= 1200) node.setAttribute('width', width);
        else node.removeAttribute('width');
      }
      node.removeAttribute('style');
      for (const name of ['color','bgcolor','face','size','align','height']) node.removeAttribute(name);
      for (const [name, value] of allowed) {
        // Remove unreadable document defaults in dark mode while retaining emphasis colors.
        if (dark && (name === 'background-color' || name === 'color' && /^(?:black|white|#000(?:000)?|#fff(?:fff)?|rgb\((?:0, 0, 0|255, 255, 255)\))$/i.test(value))) continue;
        node.style.setProperty(name, value);
      }
      if (node.tagName === 'A') {
        try { const url = new URL(node.getAttribute('href')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) node.removeAttribute('href'); }
        catch { node.removeAttribute('href'); }
        node.setAttribute('rel', 'noreferrer noopener');
      }
    });
    return doc;
  }
  function render(target, html, { dark, title, loadImages, openLink }) {
    const doc = sanitize(html, { dark, images: true });
    doc.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      img.removeAttribute('src'); img.dataset.imageSource = src;
      img.alt ||= 'Изображение'; img.title = 'Загрузка изображения…';
    });
    const imagesTask = doc.querySelector('img') ? Promise.resolve().then(loadImages) : Promise.resolve({ images: {}, errors: {} });
    imagesTask.catch(() => {}); // The frame's load listener reports the error.
    const frame = document.createElement('iframe'); frame.className = 'email-frame'; frame.title = title;
    // Scripts remain forbidden by both sandbox and CSP; same-origin lets the parent attach listeners.
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.height = '340px';
    frame.addEventListener('load', async () => {
      const body = frame.contentDocument?.body; if (!body) return;
      const resize = () => { if (frame.isConnected) frame.style.height = `${Math.max(160, Math.min(20000, body.scrollHeight + 16))}px`; };
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
          if (result.images[src]) { img.src = result.images[src]; img.title = img.alt; img.addEventListener('load', resize); }
          else { img.title = result.errors[src] || 'Изображение недоступно'; img.alt = `${img.alt}: ${img.title}`; }
        });
        resize();
      } catch (error) { body.querySelectorAll('img').forEach(img => { img.alt = `Изображение недоступно: ${error.message}`; }); resize(); }
    });
    const background = dark ? '#262733' : '#ffffff', text = dark ? '#e1dfee' : '#4d5063', line = dark ? '#49495b' : '#e4e4eb';
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${dark ? 'dark' : 'light'}}html,body{background:${background};color:${text};margin:0}body{font:13px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}body *{box-sizing:border-box;max-width:100%}a[href]{color:${dark ? '#c3a5ff' : '#7750bd'}!important;text-decoration:underline;cursor:pointer}img{max-width:100%;height:auto;object-fit:contain}table{border-collapse:collapse;width:auto!important}td,th{padding:5px;border-color:${line}!important}p{margin:0 0 16px}pre{white-space:pre-wrap}blockquote{border-left:2px solid ${line};padding-left:14px}ul,ol{padding-left:24px}</style></head><body>${doc.body.innerHTML}</body></html>`;
    target.replaceChildren(frame);
  }
  root.asterRichContent = { render, sanitize };
})(typeof window !== 'undefined' ? window : globalThis);

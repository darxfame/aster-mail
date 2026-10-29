/* No scripts, forms or navigation from email HTML. Only the parent handles link clicks. */
(function (root) {
  function render(target, html, { dark, title, loadImages, openLink }) {
    const safe = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'script', 'svg', 'math', 'audio', 'video', 'object', 'embed', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'background', 'srcset', 'action', 'target', 'ping', 'download'],
      ADD_DATA_URI_TAGS: ['img'],
    });
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    // DOMPurify normally drops cid:. Keep only the original img source as inert data.
    const original = new DOMParser().parseFromString(html, 'text/html');
    const originalImages = [...original.querySelectorAll('img')];
    doc.querySelectorAll('img').forEach((img, i) => {
      const src = originalImages[i]?.getAttribute('src') || '';
      img.removeAttribute('src'); img.dataset.imageSource = src;
      img.alt ||= 'Изображение'; img.title = 'Загрузка изображения…';
    });
    doc.querySelectorAll('a').forEach(link => {
      try { const url = new URL(link.getAttribute('href')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) link.removeAttribute('href'); }
      catch { link.removeAttribute('href'); }
      link.setAttribute('rel', 'noreferrer noopener');
    });
    doc.querySelectorAll('[bgcolor],[color]').forEach(node => { if (dark) { node.removeAttribute('bgcolor'); node.removeAttribute('color'); } });
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
        const result = await loadImages();
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
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${dark ? 'dark' : 'light'}}html,body{background:${background};color:${text};margin:0}body{font:13px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}body *{${dark ? `background-color:transparent!important;color:${text}!important;` : ''}box-sizing:border-box;max-width:100%}a[href]{color:${dark ? '#c3a5ff' : '#7750bd'}!important;text-decoration:underline;cursor:pointer}img{max-width:100%;height:auto;object-fit:contain}table{border-collapse:collapse;width:auto!important}td,th{padding:5px;border-color:${line}!important}p{margin:0 0 16px}pre{white-space:pre-wrap}blockquote{border-left:2px solid ${line};padding-left:14px}ul,ol{padding-left:24px}</style></head><body>${doc.body.innerHTML}</body></html>`;
    target.replaceChildren(frame);
  }
  root.asterRichContent = { render };
})(window);

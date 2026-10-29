(function (root) {
  function rangesIn(body, query, limit = 1000) {
    if (!query) return { ranges: [], truncated: false };
    const doc = body.ownerDocument, nodes = [];
    const walker = doc.createTreeWalker(body, 5);
    let node, text = '', previousBlock;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) { if (node.tagName === 'BR') text += '\n'; continue; }
      if (node.parentElement.closest('script,style,[hidden]')) continue;
      const block = node.parentElement.closest('p,div,li,td,th,pre,blockquote,h1,h2,h3,h4') || body;
      if (previousBlock && previousBlock !== block) text += '\n';
      previousBlock = block;
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
    }
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const ranges = [];
    let match, cursor = 0;
    while ((match = pattern.exec(text))) {
      if (ranges.length === limit) return { ranges, truncated: true };
      while (cursor < nodes.length && nodes[cursor].end <= match.index) cursor++;
      const first = nodes[cursor];
      let last = cursor;
      while (last < nodes.length && nodes[last].end < match.index + match[0].length) last++;
      if (!first || !nodes[last]) continue;
      const range = doc.createRange();
      range.setStart(first.node, match.index - first.start);
      range.setEnd(nodes[last].node, match.index + match[0].length - nodes[last].start);
      ranges.push(range);
    }
    return { ranges, truncated: false };
  }
  if (typeof module !== 'undefined') { module.exports = { rangesIn }; return; }

  let mounted, saved = { key: '', query: '', opened: false, index: 0 };
  function mount(reader, key) {
    mounted?.dispose();
    if (saved.key !== key) saved = { key, query: '', opened: false, index: 0 };
    const button = reader.querySelector('[data-mail-find]');
    const frame = reader.querySelector('.email-frame');
    const panel = document.createElement('div');
    panel.className = 'mail-find'; panel.hidden = !saved.opened;
    panel.setAttribute('role', 'search'); panel.setAttribute('aria-label', 'Поиск в тексте письма');
    panel.innerHTML = '<input type="search" maxlength="256" aria-label="Найти в тексте письма" placeholder="Найти в письме"><span role="status" aria-live="polite"></span><button type="button" class="icon-button" aria-label="Предыдущее совпадение" title="Предыдущее · Shift+Enter">↑</button><button type="button" class="icon-button" aria-label="Следующее совпадение" title="Следующее · Enter">↓</button><button type="button" class="icon-button" aria-label="Закрыть поиск" title="Закрыть · Escape">×</button>';
    reader.querySelector('.reader-toolbar').after(panel);
    const input = panel.querySelector('input'), status = panel.querySelector('[role="status"]');
    const [previous, next, close] = panel.querySelectorAll('button');
    input.value = saved.query;
    let ranges = [], highlightedDoc, truncated = false, disposed = false;
    const clear = () => {
      highlightedDoc?.defaultView?.CSS?.highlights?.delete('aster-mail-matches');
      highlightedDoc?.defaultView?.CSS?.highlights?.delete('aster-mail-current');
    };
    function paint(scroll = false) {
      clear();
      status.textContent = saved.query ? ranges.length ? `${saved.index + 1} из ${ranges.length}${truncated ? '+' : ''}` : 'Не найдено' : 'Введите текст';
      previous.disabled = next.disabled = !ranges.length;
      if (!saved.opened || !ranges.length) return;
      const view = highlightedDoc.defaultView;
      if (!view?.CSS?.highlights || !view.Highlight) return;
      view.CSS.highlights.set('aster-mail-matches', new view.Highlight(...ranges));
      view.CSS.highlights.set('aster-mail-current', new view.Highlight(ranges[saved.index]));
      if (scroll) {
        const range = ranges[saved.index];
        range.startContainer.parentElement.scrollIntoView({ block: 'center' });
        // A tall mail frame is capped; scroll its viewport to the actual match too.
        if (frame) view.scrollBy(0, range.getBoundingClientRect().top - frame.clientHeight / 2);
      }
    }
    function search(scroll = false) {
      if (disposed || !reader.isConnected) return;
      clear();
      const body = frame ? frame.contentDocument?.body : reader.querySelector('#message-body');
      highlightedDoc = body?.ownerDocument;
      ({ ranges, truncated } = body ? rangesIn(body, saved.query) : { ranges: [], truncated: false });
      saved.index = Math.min(saved.index, Math.max(0, ranges.length - 1));
      paint(scroll);
    }
    function open() {
      saved.opened = true; panel.hidden = false;
      search(); input.focus(); input.select();
    }
    function hide() {
      saved.opened = false; panel.hidden = true; clear(); button.focus();
    }
    function step(delta) {
      if (!ranges.length) return;
      saved.index = (saved.index + delta + ranges.length) % ranges.length; paint(true);
    }
    function keydown(event) {
      if (document.querySelector('dialog[open]') || !reader.isConnected) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); open(); }
      else if (saved.opened && (event.key === 'F3' || modifier && event.key.toLowerCase() === 'g')) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
      else if (saved.opened && event.key === 'Escape') { event.preventDefault(); hide(); }
    }
    input.addEventListener('input', () => { saved.query = input.value; saved.index = 0; search(true); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); } });
    previous.onclick = () => step(-1); next.onclick = () => step(1); close.onclick = hide; button.onclick = open;
    const frameLoaded = () => {
      if (disposed || !reader.isConnected) return;
      frame.contentDocument?.addEventListener('keydown', keydown);
      const style = frame.contentDocument.createElement('style');
      style.textContent = '::highlight(aster-mail-matches){background:#ffe38a;color:#252033}::highlight(aster-mail-current){background:#e78216;color:#17121c}';
      frame.contentDocument.head.append(style); search();
    };
    document.addEventListener('keydown', keydown);
    if (frame) frame.addEventListener('load', frameLoaded);
    search();
    mounted = { dispose() {
      disposed = true; clear(); document.removeEventListener('keydown', keydown);
      frame?.removeEventListener('load', frameLoaded);
      frame?.contentDocument?.removeEventListener('keydown', keydown);
    } };
  }
  root.asterMailFind = { mount, reset() {
    mounted?.dispose(); mounted = null;
    saved = { key: '', query: '', opened: false, index: 0 };
  } };
})(typeof window === 'undefined' ? {} : window);

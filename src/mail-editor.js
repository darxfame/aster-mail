/* Native rich-text editing; pasted markup passes through the mail formatting allowlist. */
(function (root) {
  function mount(target, text = '', { id = 'compose-body', label = tr('Сообщение'), html, preserveCidImages = false } = {}) {
    const actions = [['bold',tr('Жирный'),'B'],['italic',tr('Курсив'),'I'],['underline',tr('Подчёркнутый'),'U'],['strikeThrough',tr('Зачёркнутый'),'S'],['insertUnorderedList',tr('Маркированный список'),'• ≡'],['insertOrderedList',tr('Нумерованный список'),'1. ≡'],['justifyLeft',tr('По левому краю'),'≡ ←'],['justifyCenter',tr('По центру'),'≡'],['justifyRight',tr('По правому краю'),'→ ≡'],['outdent',tr('Уменьшить отступ'),'←'],['indent',tr('Увеличить отступ'),'→'],['unlink',tr('Удалить ссылку'),'⌫ ↗'],['removeFormat',tr('Убрать форматирование'),'Tx']];
    target.innerHTML = `<span class="editor-label" id="${id}-label">${label}</span><div class="mail-editor"><div class="format-toolbar" role="toolbar" aria-label="${tr("Форматирование письма")}"><select aria-label="${tr("Шрифт")}" data-command="fontName"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Courier New</option></select><select aria-label="${tr("Размер шрифта")}" data-command="fontSize"><option value="2">13</option><option value="3" selected>16</option><option value="4">18</option><option value="5">24</option><option value="6">32</option></select>${actions.map(([command,label,caption]) => `<button type="button" data-command="${command}" title="${label}" aria-label="${label}">${caption}</button>`).join('')}<label title="${tr("Цвет текста")}">A<input type="color" aria-label="${tr("Цвет текста")}" data-command="foreColor" value="#7750bd"></label><label title="${tr("Цвет выделения")}">▰<input type="color" aria-label="${tr("Цвет выделения")}" data-command="hiliteColor" value="#fff0a6"></label><button type="button" data-link-toggle aria-label="${tr("Добавить ссылку")}" title="${tr("Добавить ссылку")}">${tr("↗ Ссылка")}</button><button type="button" data-expand aria-pressed="false">${tr("Развернуть редактор")}</button></div><div class="editor-link" hidden><input type="url" aria-label="${tr("Адрес ссылки")}" placeholder="https://example.com"><button type="button" class="secondary" data-link-apply>${tr("Вставить ссылку")}</button><span class="form-error" role="status"></span></div><div id="${id}" class="compose-editor" role="textbox" aria-labelledby="${id}-label" aria-multiline="true" contenteditable="true" spellcheck="true"></div></div>`;
    const editor = target.querySelector('.compose-editor'), toolbar = target.querySelector('.format-toolbar'), linkForm = target.querySelector('.editor-link');
    function clean(value) {
      const doc = root.asterRichContent.sanitize(value, { images: preserveCidImages });
      for (const image of doc.querySelectorAll('img')) {
        if (!/^cid:[a-z0-9@._+%=-]{1,500}$/i.test(image.getAttribute('src') || '')) image.remove();
      }
      return doc.body.innerHTML;
    }
    if (html !== undefined) editor.innerHTML = clean(html);
    else editor.textContent = text;
    // HTML source indentation must collapse as it does in the script-free reader.
    const whiteSpace = html !== undefined ? 'normal' : 'pre-wrap';
    editor.style.whiteSpace = whiteSpace;
    editor.classList.toggle('html-mail-editor', html !== undefined);
    let range = null;
    function remember() {
      const selection = window.getSelection();
      if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) range = selection.getRangeAt(0).cloneRange();
    }
    function restore() {
      editor.focus();
      if (range && editor.contains(range.commonAncestorContainer)) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    }
    function command(name, value = null) {
      restore(); document.execCommand(name, false, value); remember(); updateButtons();
    }
    function updateButtons() {
      for (const button of toolbar.querySelectorAll('button[data-command]')) {
        if (['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight'].includes(button.dataset.command)) button.setAttribute('aria-pressed', String(document.queryCommandState(button.dataset.command)));
      }
    }
    for (const event of ['keyup','mouseup','input','blur']) editor.addEventListener(event, () => { remember(); updateButtons(); });
    toolbar.addEventListener('pointerdown', event => { remember(); if (event.target.closest('button')) event.preventDefault(); });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-expand')) {
        const expanded = target.classList.toggle('editor-expanded');
        button.setAttribute('aria-pressed', String(expanded));
        button.textContent = expanded ? tr('Свернуть редактор') : tr('Развернуть редактор');
        return;
      }
      if (button.hasAttribute('data-link-toggle')) { linkForm.hidden = !linkForm.hidden; if (!linkForm.hidden) linkForm.querySelector('input').focus(); return; }
      command(button.dataset.command);
    });
    toolbar.addEventListener('change', event => { if (event.target.dataset.command) command(event.target.dataset.command, event.target.value); });
    linkForm.querySelector('button').addEventListener('click', () => {
      const input = linkForm.querySelector('input');
      try {
        const url = new URL(input.value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        restore();
        if (window.getSelection().isCollapsed) { const a = document.createElement('a'); a.href = url.href; a.textContent = url.href; command('insertHTML', a.outerHTML); }
        else command('createLink', url.href);
        linkForm.hidden = true; input.value = ''; linkForm.querySelector('.form-error').textContent = '';
      } catch { linkForm.querySelector('.form-error').textContent = tr('Укажите HTTP(S) ссылку без логина и пароля.'); }
    });
    linkForm.querySelector('input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); linkForm.querySelector('button').click(); } });
    editor.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
    editor.addEventListener('paste', event => {
      event.preventDefault(); remember();
      const html = event.clipboardData.getData('text/html');
      if (html) command('insertHTML', root.asterRichContent.sanitize(html).body.innerHTML);
      else { const div = document.createElement('div'); div.textContent = event.clipboardData.getData('text/plain'); command('insertHTML', div.innerHTML.replace(/\r\n?|\n/g, '<br>')); }
    });
    editor.addEventListener('drop', event => event.preventDefault());
    return { read() { return { body: editor.innerText, bodyHtml: `<div style="white-space: ${whiteSpace}">${clean(editor.innerHTML)}</div>` }; } };
  }
  root.asterMailEditor = { mount };
})(window);

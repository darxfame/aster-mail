/* Native rich-text editing; pasted markup passes through the mail formatting allowlist. */
(function (root) {
  // Chromium applies foreground colors through native editing, including its undo stack.
  // A distinct alpha value carries the default color through selection and continued typing.
  const defaultColorMarker = 'rgba(13, 37, 91, 0.137)';
  const defaultColorSelector = `[style*="color: ${defaultColorMarker}"]`;
  const highlights = [['#fff0a6', 'Жёлтый'], ['#c6efce', 'Зелёный'], ['#cce5ff', 'Голубой'], ['#ffd6e5', 'Розовый'], ['#ffdcba', 'Оранжевый']];
  const textColors = [['#000000', 'Чёрный'], ['#bf242b', 'Красный'], ['#17653c', 'Зелёный'], ['#174ea6', 'Синий'], ['#7138a9', 'Фиолетовый']];

  function colorPalette(id, command, caption, title, presets, reset, resetLabel, customLabel) {
    const name = tr(title), custom = tr(customLabel);
    const swatches = presets.map(([value, label]) => `<button type="button" class="highlight-swatch" data-command="${command}" data-value="${value}" title="${tr(label)}" aria-label="${tr(label)}"><span style="background-color:${value}"></span></button>`).join('');
    return `<button type="button" popovertarget="${id}" title="${name}" aria-label="${name}">${caption} ▾</button><div class="highlight-palette" id="${id}" popover role="group" aria-label="${name}"><div class="highlight-swatches">${swatches}</div><button type="button" data-command="${command}" data-value="${reset}">∅ ${tr(resetLabel)}</button><label class="highlight-custom">${custom}<input type="color" aria-label="${custom}" data-command="${command}" value="${presets[0][0]}"></label></div>`;
  }

  function mount(target, text = '', { id = 'compose-body', label = tr('Сообщение'), html, preserveCidImages = false } = {}) {
    const actions = [['bold',tr('Жирный'),'B'],['italic',tr('Курсив'),'I'],['underline',tr('Подчёркнутый'),'U'],['strikeThrough',tr('Зачёркнутый'),'S'],['insertUnorderedList',tr('Маркированный список'),'• ≡'],['insertOrderedList',tr('Нумерованный список'),'1. ≡'],['justifyLeft',tr('По левому краю'),'≡ ←'],['justifyCenter',tr('По центру'),'≡'],['justifyRight',tr('По правому краю'),'→ ≡'],['outdent',tr('Уменьшить отступ'),'←'],['indent',tr('Увеличить отступ'),'→'],['unlink',tr('Удалить ссылку'),'⌫ ↗'],['removeFormat',tr('Убрать форматирование'),'Tx']];
    const actionButton = ([command, label, caption]) => `<button type="button" data-command="${command}" title="${label}" aria-label="${label}">${caption}</button>`;
    target.innerHTML = `<span class="editor-label" id="${id}-label">${label}</span><div class="mail-editor"><div class="format-toolbar" role="toolbar" aria-label="${tr("Форматирование письма")}">${actions.slice(0, 3).map(actionButton).join('')}${colorPalette(`${id}-text-colors`, 'foreColor', 'A', 'Цвет текста', textColors, 'default', 'Цвет текста по умолчанию', 'Свой цвет текста')}${colorPalette(`${id}-highlights`, 'hiliteColor', '▰', 'Цвет выделения', highlights, 'transparent', 'Убрать выделение цветом', 'Свой цвет выделения')}${colorPalette(`${id}-background-colors`, 'bodyBackground', '▧', 'Цвет фона письма', [['#ffffff', 'Белый'], ...highlights], '', 'Без фона', 'Свой цвет фона письма')}<details class="format-more"><summary aria-label="${tr("Форматирование письма")}">${tr("Ещё")}</summary><div class="format-more-tools"><select aria-label="${tr("Шрифт")}" data-command="fontName"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Courier New</option></select><select aria-label="${tr("Размер шрифта")}" data-command="fontSize"><option value="2">13</option><option value="3" selected>16</option><option value="4">18</option><option value="5">24</option><option value="6">32</option></select>${actions.slice(3).map(actionButton).join('')}<button type="button" data-link-toggle aria-label="${tr("Добавить ссылку")}" title="${tr("Добавить ссылку")}">${tr("↗ Ссылка")}</button><button type="button" data-expand aria-pressed="false">${tr("Развернуть редактор")}</button></div></details></div><div class="editor-link" hidden><input type="url" aria-label="${tr("Адрес ссылки")}" placeholder="https://example.com"><button type="button" class="secondary" data-link-apply>${tr("Вставить ссылку")}</button><span class="form-error" role="status"></span></div><div id="${id}" class="compose-editor" role="textbox" aria-labelledby="${id}-label" aria-multiline="true" contenteditable="true" spellcheck="true"></div></div>`;
    const editor = target.querySelector('.compose-editor'), toolbar = target.querySelector('.format-toolbar'), linkForm = target.querySelector('.editor-link');
    let background = '', bodyForeground = '';
    function setBackground(color) {
      editor.style.backgroundColor = color;
      background = editor.style.backgroundColor;
      const channels = getComputedStyle(editor).backgroundColor.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
      const linear = channels.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      const dark = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.179;
      bodyForeground = background ? dark ? '#ffffff' : '#000000' : '';
      editor.style.color = bodyForeground;
      if (bodyForeground) editor.style.setProperty('--compose-default-color', bodyForeground);
      else editor.style.removeProperty('--compose-default-color');
    }
    function clean(value, opening = false) {
      const doc = root.asterRichContent.sanitize(value, { images: preserveCidImages, preserveBodyBackground: opening });
      for (const image of doc.querySelectorAll('img')) {
        if (!/^cid:[a-z0-9@._+%=-]{1,500}$/i.test(image.getAttribute('src') || '')) image.remove();
      }
      if (opening) {
        // The single outer block emitted by read() carries the letter background.
        const wrapper = doc.body.firstElementChild;
        if (doc.body.style.backgroundColor) setBackground(doc.body.style.backgroundColor);
        else if (wrapper?.tagName === 'DIV' && doc.body.childElementCount === 1 &&
          doc.body.textContent.trim() === wrapper.textContent.trim() && wrapper.style.backgroundColor) {
          setBackground(wrapper.style.backgroundColor);
          wrapper.style.removeProperty('background-color');
          if (wrapper.style.color === editor.style.color) wrapper.style.removeProperty('color');
          if (!wrapper.style.length) {
            const contents = doc.createRange();
            contents.selectNodeContents(wrapper);
            wrapper.replaceWith(contents.extractContents());
          }
        }
      } else if (editor.querySelector(defaultColorSelector)) {
        for (const node of doc.body.querySelectorAll(defaultColorSelector)) {
          if (node.style.color !== defaultColorMarker) continue;
          let ancestor = node.parentElement;
          while (ancestor && !ancestor.style.color) ancestor = ancestor.parentElement;
          node.style.color = ancestor ? bodyForeground || 'CanvasText' : '';
          if (!node.style.length) node.removeAttribute('style');
        }
      }
      return doc.body.innerHTML;
    }
    if (html !== undefined) editor.innerHTML = clean(html, true);
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
      restore();
      if (name === 'bodyBackground') {
        setBackground(value);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (name === 'foreColor' && value === 'default') {
        const usesCSS = document.queryCommandState('styleWithCSS');
        document.execCommand('styleWithCSS', false, true);
        try { document.execCommand(name, false, defaultColorMarker); }
        finally { document.execCommand('styleWithCSS', false, usesCSS); }
      } else document.execCommand(name, false, value);
      remember(); updateButtons();
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
      if (!button.dataset.command) return;
      button.closest('.highlight-palette')?.hidePopover();
      command(button.dataset.command, button.dataset.value);
    });
    toolbar.addEventListener('change', event => {
      if (!event.target.dataset.command) return;
      event.target.closest('.highlight-palette')?.hidePopover();
      command(event.target.dataset.command, event.target.value);
    });
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
    return {
      insertText(value) {
        if (!range) { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }
        const div = document.createElement('div'); div.textContent = value;
        command('insertHTML', div.innerHTML.replace(/\r\n?|\n/g, '<br>'));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      },
      read(appendHtml = '') {
        const content = `<div style="white-space: ${whiteSpace}">${clean(editor.innerHTML)}</div>${appendHtml}`;
        const bodyHtml = background ? `<div style="background-color: ${background}; color: ${bodyForeground}">${content}</div>` : content;
        return { body: editor.innerText, bodyHtml };
      },
    };
  }
  root.asterMailEditor = { mount };
})(window);

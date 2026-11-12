let demoAutoReplies = { state: 'Disabled', audience: 'None', allowExternal: 'All', start: null, end: null, internal: '', external: '', revision: 'demo' };
function autoRepliesMarkup() {
  return `<h3 class="settings-section-title">${tr('Автоответы об отсутствии')}</h3>
    <p class="form-note">${tr('Автоответы отправляет Exchange, даже когда Aster закрыт. Они сохраняются отдельно от остальных настроек.')}</p>
    <button type="button" class="secondary" id="auto-replies-load">${tr('Загрузить из Exchange')}</button>
    <p id="auto-replies-status" class="form-note" role="status"></p>
    <fieldset id="auto-replies-fields" disabled>
    <label class="field"><span>${tr('Режим автоответов')}</span><select name="oofState"><option value="Disabled">${tr('Выключены')}</option><option value="Enabled">${tr('Включены постоянно')}</option><option value="Scheduled">${tr('В указанный период')}</option></select></label>
    <div class="form-row" id="auto-replies-period">${field('oofStart', tr('Начало'), '', 'datetime-local')}${field('oofEnd', tr('Окончание'), '', 'datetime-local')}</div>
    <p class="form-note">${tr('Для отправки по расписанию выберите «В указанный период».')}</p>
    <p class="form-note">${tr('Часовой пояс:')} ${esc(T.zone(timeZone))}</p>
    ${textField('oofInternal', tr('Ответ сотрудникам организации'))}
    <label class="field"><span>${tr('Ответы внешним отправителям')}</span><select name="oofAudience"><option value="None">${tr('Не отправлять')}</option><option value="Known">${tr('Только моим контактам')}</option><option value="All">${tr('Всем внешним отправителям')}</option></select></label>
    ${textField('oofExternal', tr('Ответ внешним отправителям'))}
    <p class="form-note">${tr('Неизменённое форматирование OWA сохраняется. Изменённый текст отправляется без оформления.')}</p>
    </fieldset><p id="auto-replies-error" class="form-error" role="alert"></p>`;
}
function autoReplyText(value) {
  const compact = text => text.replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const container = document.createElement('div');
  container.innerHTML = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p','div','span','br','b','strong','i','em','u','s','pre','blockquote','ul','ol','li','table','thead','tbody','tr','td','th','h1','h2','h3','h4','h5','h6'],
    ALLOWED_ATTR: ['class', 'style'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  if (!container.children.length) return compact(container.textContent);
  let preserveSpacing = false;
  for (const node of [...container.querySelectorAll('*')]) {
    const whiteSpace = node.style.whiteSpace;
    const compactParagraph = node.tagName === 'P' && (node.classList.contains('MsoNormal') || parseFloat(node.style.marginTop) === 0 && parseFloat(node.style.marginBottom) === 0);
    node.removeAttribute('class'); node.removeAttribute('style');
    let element = node;
    if (compactParagraph) {
      element = document.createElement('div'); element.append(...node.childNodes); node.replaceWith(element);
      if (!element.textContent.trim() && !element.querySelector('br')) element.append(document.createElement('br'));
    }
    if (['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(whiteSpace)) {
      element.style.whiteSpace = whiteSpace; element.dataset.oofSpace = 'true'; preserveSpacing = true;
    }
    if (element.tagName === 'PRE') preserveSpacing = true;
  }
  const walker = document.createTreeWalker(container, 4);
  let textNode;
  while ((textNode = walker.nextNode())) if (!textNode.parentElement.closest('pre,[data-oof-space]')) textNode.data = textNode.data.replace(/\u00a0/g, ' ');
  // Use Chromium's rendered text rules for block boundaries and HTML whitespace.
  // Only inert markup and explicitly restored whitespace styles are mounted.
  container.style.cssText = 'position:fixed;left:-100000px;top:0;width:100000px;opacity:0;pointer-events:none;white-space:normal';
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  try {
    const text = container.innerText.replace(/\r\n?/g, '\n');
    return preserveSpacing ? text : compact(text);
  }
  finally { container.remove(); }
}
function setupAutoReplies(panel) {
  const form = panel.closest('form'), account = state.account, demo = state.demo, zone = timeZone;
  const fields = panel.querySelector('fieldset'), status = panel.querySelector('[role="status"]'), errorBox = panel.querySelector('[role="alert"]');
  const reload = panel.querySelector('#auto-replies-load'), save = form.querySelector('#auto-replies-save');
  let snapshot, initialInternal, initialExternal, sequence = 0;
  const current = () => panel.isConnected && state.account === account && state.demo === demo;
  const update = () => {
    const scheduled = form.elements.oofState.value === 'Scheduled';
    for (const name of ['oofStart', 'oofEnd']) { form.elements[name].disabled = !scheduled; form.elements[name].required = scheduled; }
    form.elements.oofExternal.disabled = form.elements.oofAudience.value === 'None';
  };
  panel.addEventListener('input', () => { panel.dataset.dirty = 'true'; setModalDirty(true); });
  panel.addEventListener('change', update);
  reload.addEventListener('click', async () => {
    if (!current() || modalBusy || panel.dataset.dirty === 'true' && !confirm(tr('Загрузить автоответы заново и отменить несохранённые изменения?'))) return;
    const request = ++sequence;
    reload.disabled = true; fields.disabled = true; save.disabled = true; errorBox.textContent = ''; status.textContent = tr('Загружаем автоответы…');
    try {
      const value = demo ? { ...demoAutoReplies } : await api('autoReplies');
      if (!current() || request !== sequence) return;
      snapshot = value;
      initialInternal = autoReplyText(value.internal); initialExternal = autoReplyText(value.external);
      form.elements.oofState.value = value.state; form.elements.oofAudience.value = value.audience;
      form.elements.oofInternal.value = initialInternal; form.elements.oofExternal.value = initialExternal;
      for (const [key, name] of [['start', 'oofStart'], ['end', 'oofEnd']]) form.elements[name].value = value[key] ? T.wall(value[key], zone).slice(0, 16) : '';
      form.elements.oofInternal.maxLength = 32000; form.elements.oofExternal.maxLength = 32000;
      for (const option of form.elements.oofAudience.options) option.disabled = ['None', 'Known', 'All'].indexOf(option.value) > ['None', 'Known', 'All'].indexOf(value.allowExternal);
      fields.disabled = false; save.disabled = false; panel.dataset.dirty = 'false'; setModalDirty(false); update();
      status.textContent = demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Текущие настройки загружены из Exchange.');
    } catch (error) { if (current()) { status.textContent = ''; errorBox.textContent = errorText(error); } }
    finally { if (current() && request === sequence) reload.disabled = false; }
  });
  save.addEventListener('click', () => {
    if (!current() || !snapshot || fields.disabled || modalBusy) return;
    void submitForm(form, async () => {
      errorBox.textContent = '';
      const input = { revision: snapshot.revision, state: form.elements.oofState.value, audience: form.elements.oofAudience.value };
      if (input.state === 'Scheduled') {
        for (const [key, name] of [['start', 'oofStart'], ['end', 'oofEnd']]) {
          const value = form.elements[name].value;
          input[key] = snapshot[key] && value === T.wall(snapshot[key], zone).slice(0, 16) ? snapshot[key] : T.fromWall(value, zone).toISOString();
        }
        if (input.end <= input.start) throw new Error(tr('Укажите корректный период автоответов.'));
      }
      for (const [key, name, initial] of [['internal', 'oofInternal', initialInternal], ['external', 'oofExternal', initialExternal]]) if (form.elements[name].value !== initial) input[key] = form.elements[name].value;
      // A lost write response must never turn into another write on a second click.
      fields.disabled = true; save.disabled = true;
      try {
        if (demo) {
          demoAutoReplies = { ...snapshot, ...input };
          for (const key of ['internal', 'external']) if (Object.hasOwn(input, key)) demoAutoReplies[key] = esc(input[key]).replace(/\n/g, '<br>');
        } else await api('saveAutoReplies', input);
        if (!current()) return;
        panel.dataset.dirty = 'false'; setModalDirty(false);
        status.textContent = demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Автоответы сохранены в Exchange.');
      } catch (error) {
        if (current()) { status.textContent = tr('Перед следующим сохранением загрузите настройки из Exchange заново.'); errorBox.textContent = errorText(error); }
      }
    });
  });
  if (!account && !demo) { reload.disabled = true; status.textContent = tr('Сначала подключите аккаунт OWA'); }
}

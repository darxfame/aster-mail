let demoQuickReplies = [];
function mountQuickReplies(form, draft) {
  const panel = document.createElement('details'); panel.className = 'quick-replies';
  panel.innerHTML = `<summary>${tr('Быстрые ответы')}</summary><p class="form-note">${tr('Личные шаблоны этого аккаунта. Вставляется только текст; письмо не отправляется.')}</p>
    <button type="button" class="secondary" data-quick-reload>${tr('Обновить список шаблонов')}</button>
    <fieldset disabled><label class="field"><span>${tr('Найти быстрый ответ')}</span><input type="search" data-quick-search></label>
    <label class="field"><span>${tr('Сохранённые ответы')}</span><select size="4" data-quick-list></select></label>
    <div class="quick-reply-actions"><button type="button" class="secondary" data-quick-insert>${tr('Вставить в письмо')}</button><button type="button" class="secondary" data-quick-new>${tr('Новый шаблон')}</button></div>
    <details data-quick-manage><summary>${tr('Редактор шаблона')}</summary>
    <label class="field"><span>${tr('Название шаблона')}</span><input type="text" maxlength="100" data-quick-title></label>
    <label class="field"><span>${tr('Текст шаблона')}</span><textarea maxlength="8000" data-quick-body></textarea></label>
    <div class="quick-reply-actions"><button type="button" class="secondary" data-quick-save>${tr('Сохранить шаблон')}</button><button type="button" class="secondary danger" data-quick-delete>${tr('Удалить шаблон')}</button></div></details></fieldset>
    <p class="form-note" role="status"></p><p class="quick-reply-error" role="alert"></p>`;
  form.querySelector('.compose-message-area').before(panel);
  const fields = panel.querySelector('fieldset'), list = panel.querySelector('[data-quick-list]'), search = panel.querySelector('[data-quick-search]');
  const title = panel.querySelector('[data-quick-title]'), body = panel.querySelector('[data-quick-body]');
  const status = panel.querySelector('[role="status"]'), errorBox = panel.querySelector('[role="alert"]');
  const account = state.account, demo = state.demo;
  const current = () => form.isConnected && composeData === draft && state.account === account && state.demo === demo;
  let replies, revision = 0, selected = '', edited = false, loading = false, saving = false;
  const saved = () => replies?.find(reply => reply.id === selected);
  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = replies.filter(reply => `${reply.title}\n${reply.body}`.toLocaleLowerCase().includes(query));
    list.replaceChildren(...matches.map(reply => { const option = document.createElement('option'); option.value = reply.id; option.textContent = reply.title; return option; }));
    list.value = selected;
    panel.querySelector('[data-quick-insert]').disabled = !saved();
    panel.querySelector('[data-quick-delete]').disabled = !saved();
    status.textContent = matches.length ? '' : replies.length ? tr('Ничего не найдено.') : tr('Сохранённых ответов пока нет. Создайте первый шаблон ниже.');
  }
  function select(id) {
    selected = id; edited = false;
    title.value = saved()?.title || ''; body.value = saved()?.body || ''; renderList();
  }
  async function load() {
    if (!current() || loading || saving || modalBusy || edited && !confirm(tr('Отменить несохранённые изменения шаблона?'))) return;
    loading = true; fields.disabled = true;
    status.textContent = tr('Загружаем быстрые ответы…'); errorBox.textContent = '';
    try {
      const value = demo ? { replies: demoQuickReplies, revision: 0 } : await api('quickReplies');
      if (!current()) return;
      replies = window.asterQuickReplies.normalize(value.replies); revision = value.revision; fields.disabled = false; select(''); panel.querySelector('[data-quick-manage]').open = replies.length === 0;
    } catch (error) { if (current()) { status.textContent = ''; errorBox.textContent = errorText(error); } }
    finally { loading = false; }
  }
  panel.addEventListener('toggle', () => { if (panel.open && !replies) void load(); });
  panel.querySelector('[data-quick-reload]').addEventListener('click', () => { void load(); });
  search.addEventListener('input', renderList);
  for (const input of [title, body]) input.addEventListener('input', () => { edited = true; });
  list.addEventListener('change', () => {
    if (edited && !confirm(tr('Отменить несохранённые изменения шаблона?'))) { list.value = selected; return; }
    select(list.value);
  });
  panel.querySelector('[data-quick-new]').addEventListener('click', () => {
    if (edited && !confirm(tr('Отменить несохранённые изменения шаблона?'))) return;
    select(''); panel.querySelector('[data-quick-manage]').open = true; title.focus();
  });
  panel.querySelector('[data-quick-insert]').addEventListener('click', () => {
    if (!current() || modalBusy || !saved()) return;
    draft.editor.insertText(saved().body); setModalDirty(true);
  });
  async function persist(remove) {
    if (!current() || modalBusy || fields.disabled) return;
    errorBox.textContent = '';
    try {
      const id = selected || crypto.randomUUID();
      const next = window.asterQuickReplies.normalize(remove ? replies.filter(reply => reply.id !== selected) : [...replies.filter(reply => reply.id !== id), { id, title: title.value, body: body.value }]);
      fields.disabled = true; saving = true;
      if (demo) demoQuickReplies = next;
      else { const result = await api('saveQuickReplies', { replies: next, revision }); revision = result.revision; }
      if (!current()) return;
      replies = next; select(remove ? '' : id); panel.querySelector('[data-quick-manage]').open = replies.length === 0; status.textContent = demo ? tr('Демо: шаблон изменён только в памяти.') : tr('Шаблоны сохранены в защищённом хранилище аккаунта.');
    } catch (error) { if (current()) errorBox.textContent = errorText(error); }
    finally { saving = false; if (current()) fields.disabled = false; }
  }
  panel.querySelector('[data-quick-save]').addEventListener('click', () => { void persist(false); });
  panel.querySelector('[data-quick-delete]').addEventListener('click', () => {
    if (saved() && confirm(tr('Удалить этот шаблон быстрого ответа?'))) void persist(true);
  });
}

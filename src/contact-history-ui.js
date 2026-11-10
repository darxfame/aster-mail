function contactHistoryBody() {
  return `<section class="contact-history" aria-label="${tr('История переписки')}"><h3>${tr('История переписки')}</h3><p class="form-note">${tr('Письма этого ящика с точным email контакта в отправителе, «Кому» или «Копии». Скрытая копия и другие адреса контакта не учитываются. Просмотр ограничен 200 результатами серверного поиска; полнота зависит от индекса.')}</p><div class="contact-history-items"></div><p class="form-note" role="status"></p><p class="form-error" role="alert"></p><div class="contact-history-actions"><button type="button" class="secondary" data-history-refresh>${tr('Обновить переписку')}</button><button type="button" class="secondary" data-history-more hidden>${tr('Загрузить ещё')}</button></div></section>`;
}
function mountContactHistory(context) {
  const section = document.querySelector('#modal .contact-history');
  if (!section) return;
  const list = section.querySelector('.contact-history-items'), status = section.querySelector('[role="status"]'), error = section.querySelector('[role="alert"]');
  const refresh = section.querySelector('[data-history-refresh]'), more = section.querySelector('[data-history-more]');
  let email;
  try { email = window.asterContactHistory.email(context.person.email); }
  catch (failure) { error.textContent = errorText(failure); refresh.disabled = true; return; }
  const demo = state.demo;
  const current = () => section.isConnected && currentContactCard() === context && state.demo === demo;
  let items = [], offset = 0, hasMore = false, sequence = 0, opening = 0, loading = false;
  function render() {
    list.innerHTML = items.map(item => `<button type="button" class="contact-history-message" data-history-id="${esc(item.id)}"><strong>${esc(item.subject || tr('(Без темы)'))}</strong><span>${{ from: tr('От контакта'), to: tr('В поле «Кому»'), cc: tr('В копии') }[item.role]} · ${Number.isFinite(Date.parse(item.date)) ? esc(dateFormat(item.date, { dateStyle: 'medium', timeStyle: 'short' })) : tr('Дата недоступна')}</span><small>${esc(item.from.name || item.from.email)}</small></button>`).join('');
    more.hidden = !hasMore;
  }
  async function load(append = false) {
    if (!current() || loading) return;
    const request = ++sequence; opening++; loading = true; refresh.disabled = true; more.disabled = true; section.setAttribute('aria-busy', 'true'); error.textContent = '';
    status.textContent = tr('Ищем переписку…');
    try {
      let page;
      const requestedOffset = append ? offset : 0;
      if (demo) {
        const all = window.asterDemo.messages.map(message => window.asterContactHistory.summary(message, email)).filter(Boolean).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        page = { items: all.slice(requestedOffset, Math.min(200, requestedOffset + 50)), nextOffset: Math.min(200, requestedOffset + 50), more: all.length > requestedOffset + 50 && requestedOffset + 50 < 200, limited: all.length > 200 && requestedOffset + 50 >= 200, checked: Math.min(50, Math.max(0, all.length - requestedOffset)) };
      } else page = await api('contactHistory', { email, offset: requestedOffset });
      if (!current() || request !== sequence) return;
      if (!append) items = [];
      for (const item of page.items) if (!items.some(value => value.id === item.id)) items.push(item);
      offset = page.nextOffset; hasMore = page.more; render();
      status.textContent = items.length ? `${tr('Показано писем:')} ${items.length}. ${page.limited ? tr('Достигнут лимит просмотра. Уточните запрос в общем поиске писем.') : ''}` : tr('Совпадений в просмотренных результатах не найдено.');
    } catch (failure) { if (current() && request === sequence) { error.textContent = errorText(failure); status.textContent = items.length ? `${tr('Показано писем:')} ${items.length}` : ''; } }
    finally { loading = false; if (current() && request === sequence) { refresh.disabled = false; more.disabled = false; section.removeAttribute('aria-busy'); } }
  }
  refresh.addEventListener('click', () => { void load(); });
  more.addEventListener('click', () => { void load(true); });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-history-id]'); if (!button || !current() || modalBusy) return;
    const request = ++opening; button.disabled = true; error.textContent = '';
    void (async () => {
      try {
        const id = button.dataset.historyId;
        const original = demo ? structuredClone(window.asterDemo.messages.find(message => message.id === id)) : await api('message', { id });
        if (!current() || request !== opening) return;
        if (!original || original.id !== id) throw new Error(tr('Письмо не найдено'));
        const account = state.account, generation = state.generation, modalVersion = modalSequence, messageVersion = messageOpenSequence;
        $('#modal').close(); state.view = 'mail'; state.query = ''; state.filter = 'all'; $('#search').value = '';
        state.folder = original.folder || original.parentId || 'inbox'; await loadView();
        if (account !== state.account || demo !== state.demo || generation + 1 !== state.generation || modalVersion !== modalSequence || messageVersion !== messageOpenSequence || $('#modal').open || !$('#reader')) return;
        if (!state.messages.some(message => message.id === id)) state.messages.push(original);
        await openMessage(id, state.generation, { markRead: false });
      } catch (failure) { if (current() && request === opening) error.textContent = errorText(failure); }
      finally { if (button.isConnected) button.disabled = false; }
    })();
  });
  void load();
}

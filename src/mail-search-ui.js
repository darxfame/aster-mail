function activeMailSearch() {
  return state.mailSearch?.query === state.query ? state.mailSearch.criteria : { text: state.query, folder: state.folder };
}
function applyMailSearch(criteria, mode = 'text') {
  criteria = window.asterMailSearch.normalize(criteria);
  const query = window.asterMailSearch.query(criteria);
  state.mailSearch = { criteria, query, mode }; state.query = query;
  $('#search').value = criteria[mode];
}
function renderMailSearchControls() {
  const controls = $('#mail-search-controls');
  controls.hidden = state.view !== 'mail' || !ready();
  if (controls.hidden) return;
  const focused = controls.contains(document.activeElement) ? document.activeElement.id : '';
  const value = activeMailSearch(), choices = [];
  const visit = (nodes, prefix = '') => {
    for (const node of nodes) {
      const label = prefix ? `${prefix} / ${node.name}` : node.name;
      choices.push(`<option value="${esc(node.key)}">${esc(label)}</option>`); visit(node.children, label);
    }
  };
  visit(window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders));
  controls.innerHTML = `<label>${tr('Где искать')} <select id="mail-search-scope"><option value="">${tr('Весь почтовый ящик')}</option>${choices.join('')}</select></label><label>${tr('Искать по')} <select id="mail-search-mode"><option value="text">${tr('Текст письма')}</option><option value="from">${tr('От кого')}</option></select></label><div id="mail-search-chips"></div>${state.query ? `<button type="button" class="secondary" data-action="clear-search-filters">${tr('Сбросить поиск')}</button>` : ''}`;
  $('#mail-search-scope').value = value.folder || '';
  $('#mail-search-mode').value = state.mailSearch?.query === state.query ? state.mailSearch.mode || 'text' : 'text';
  const labels = { from: tr('От кого'), to: tr('Кому'), start: tr('Получено с'), end: tr('Получено по · включительно'), attachments: tr('Вложения') };
  $('#mail-search-chips').innerHTML = Object.entries(labels).filter(([key]) => value[key] && value[key] !== 'any').map(([key, label]) => `<button type="button" class="secondary" data-remove-search="${key}" aria-label="${esc(`${tr('Удалить условие')}: ${label}`)}">${esc(label)}: ${esc(key === 'attachments' ? value[key] === 'yes' ? tr('Только с вложениями') : tr('Без вложений') : value[key])} ×</button>`).join('');
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
document.addEventListener('change', event => {
  if (event.target.id === 'mail-search-scope') {
    try { const mode = $('#mail-search-mode').value; applyMailSearch({ ...activeMailSearch(), [mode]: $('#search').value.trim(), folder: event.target.value }, mode); void loadView(); }
    catch (error) { showError(error); }
  }
  if (event.target.id === 'mail-search-mode') {
    const mode = event.target.value, previous = state.mailSearch?.mode || 'text', criteria = { ...activeMailSearch() };
    const text = $('#search').value.trim();
    criteria[mode] = criteria[mode] || text;
    if (mode !== previous && criteria[previous] === text) criteria[previous] = '';
    try { applyMailSearch(criteria, mode); void loadView(); $('#search').focus(); }
    catch (error) { showError(error); }
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-search]'); if (!button) return;
  const criteria = { ...activeMailSearch(), [button.dataset.removeSearch]: button.dataset.removeSearch === 'attachments' ? 'any' : '' };
  applyMailSearch(criteria, state.mailSearch?.mode || 'text'); void loadView(); $('#search').focus();
});
function mailSearchScope() {
  const folder = activeMailSearch().folder;
  if (!folder) return tr('Весь почтовый ящик');
  return systemFolders.find(value => value[0] === folder)?.[1] || (state.demo ? window.asterDemo.folders : state.folders).find(value => value.id === folder)?.name || tr('Выбранная папка');
}
function mailSearchFilters() {
  if (!ready() || modalBusy) return;
  const active = activeMailSearch();
  const value = window.asterMailSearch.normalize(active), choices = [];
  const visit = (nodes, prefix = '') => {
    for (const node of nodes) {
      const label = prefix ? `${prefix} / ${node.name}` : node.name;
      choices.push(`<option value="${esc(node.key)}" ${value.folder === node.key ? 'selected' : ''}>${esc(label)}</option>`); visit(node.children, label);
    }
  };
  visit(window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders));
  modal(tr('Поиск писем'), tr('Условия применяются на сервере ко всем письмам, включая ещё не загруженные.'), `<form id="mail-search-form">
    ${field('text', tr('Слова или поисковый запрос'), value.text)}
    <div class="form-row">${field('from', tr('От кого · имя или email'), value.from)}${field('to', tr('Кому · имя или email'), value.to)}</div>
    <div class="form-row">${field('start', tr('Получено с'), value.start, 'date')}${field('end', tr('Получено по · включительно'), value.end, 'date')}</div>
    <p class="form-note">${tr('Даты получения указаны в UTC. В демо текст ищется как обычная фраза.')}</p>
    <label class="field"><span>${tr('Где искать')}</span><select name="folder"><option value="">${tr('Весь почтовый ящик')}</option>${choices.join('')}</select></label>
    <p class="form-note">${tr('При выборе папки поиск выполняется только в ней, без подпапок.')}</p>
    <label class="field"><span>${tr('Вложения')}</span><select name="attachments">${[['any', tr('Любые письма')], ['yes', tr('Только с вложениями')], ['no', tr('Без вложений')]].map(([id, label]) => `<option value="${id}" ${id === value.attachments ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    ${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="clear-search-filters">${tr('Сбросить поиск')}</button><button type="submit" class="primary">${tr('Найти письма')}</button></div></form>`);
  $('#mail-search-form [name="text"]').focus();
}

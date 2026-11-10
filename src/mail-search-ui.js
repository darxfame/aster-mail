function mailSearchScope() {
  const folder = state.mailSearch?.query === state.query ? state.mailSearch.criteria.folder : '';
  if (!folder) return tr('Весь почтовый ящик');
  return systemFolders.find(value => value[0] === folder)?.[1] || (state.demo ? window.asterDemo.folders : state.folders).find(value => value.id === folder)?.name || tr('Выбранная папка');
}
function mailSearchFilters() {
  if (!ready() || modalBusy) return;
  const active = state.mailSearch?.query === state.query ? state.mailSearch.criteria : { text: state.query };
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

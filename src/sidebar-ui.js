let miniMonthCursor, miniMonthAnchor;
const collapsedFolderBranches = new Set();
function renderFolderTree(demoUnread) {
  const roots = window.asterFolders.tree(state.demo ? window.asterDemo.folders : state.folders, systemFolders);
  const render = (nodes, depth = 0) => nodes.map(node => {
    const open = !collapsedFolderBranches.has(node.key);
    const unread = node.key === 'inbox' && state.demo ? demoUnread : node.unread;
    return `<div class="folder-branch" style="--folder-depth:${Math.min(depth, 8)}"><div class="folder-row">${node.children.length ? `<button class="folder-disclosure" data-action="folder-branch" data-id="${esc(node.key)}" aria-label="${open ? 'Свернуть' : 'Развернуть'} подпапки: ${esc(node.name)}" aria-expanded="${open}">${icon('chevron')}</button>` : '<span class="folder-disclosure-placeholder"></span>'}<button class="folder ${state.view === 'mail' && state.folder === node.key ? 'active' : ''}" data-action="folder" data-folder="${esc(node.key)}" title="${esc(node.name)}" aria-label="${esc(node.name)}">${icon(node.symbol)}<span class="folder-label">${esc(node.name)}</span>${unread ? `<span class="count">${unread}</span>` : ''}</button></div>${node.children.length && open ? `<div class="folder-children">${render(node.children, depth + 1)}</div>` : ''}</div>`;
  }).join('');
  return render(roots);
}
function miniMonthHTML() {
  const anchor = dayKey(state.week);
  if (!miniMonthCursor || miniMonthAnchor !== anchor) { miniMonthCursor = new Date(state.week.getFullYear(), state.week.getMonth(), 1); miniMonthAnchor = anchor; }
  const month = miniMonthCursor, first = new Date(month); first.setDate(1 - (first.getDay() + 6) % 7);
  const selected = window.asterCalendar.range(state.week, calendarMode()), mode = calendarMode();
  return `<div class="mini-calendar-collapsed"><button class="folder" data-action="mini-expand" aria-label="Открыть календарик месяца" title="Открыть календарик месяца">${icon('calendar')}</button></div><section class="mini-calendar" aria-label="Календарик месяца"><header><button class="mini-month-arrow" data-action="mini-prev" aria-label="Предыдущий месяц">${icon('chevron')}</button><strong>${esc(dateFormat(month, { month: 'long', year: 'numeric' }))}</strong><button class="mini-month-arrow" data-action="mini-next" aria-label="Следующий месяц">${icon('chevron')}</button></header><div class="mini-month-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<span class="mini-weekday">${day}</span>`).join('')}${Array.from({ length: 42 }, (_, i) => {
    const day = new Date(first); day.setDate(day.getDate() + i);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return `<button data-action="mini-day" data-date="${date}" class="${day.getMonth() !== month.getMonth() ? 'outside-month' : ''} ${mode === 'week' && day >= selected.start && day < selected.end ? 'selected-week' : ''} ${dayKey(day) === anchor ? 'selected-day' : ''} ${dayKey(day) === dayKey(new Date()) ? 'mini-today' : ''}" aria-label="${esc(dateFormat(day, { day: 'numeric', month: 'long', year: 'numeric' }))}" aria-pressed="${dayKey(day) === anchor}">${day.getDate()}</button>`;
  }).join('')}</div><button class="mini-today-button" data-action="today" aria-label="Вернуться к сегодняшней дате">Сегодня</button><div class="mini-calendar-source"><span></span>Мой календарь Exchange</div></section>`;
}
async function handleSidebarAction(button) {
  const { action } = button.dataset;
  if (action === 'folder-branch') { const key = button.dataset.id; if (collapsedFolderBranches.has(key)) collapsedFolderBranches.delete(key); else collapsedFolderBranches.add(key); return renderSidebar(); }
  if (action === 'mini-expand') { sidebarCollapsed = false; localStorage.setItem('aster-sidebar-collapsed', 'false'); return renderSidebar(); }
  if (action === 'mini-prev' || action === 'mini-next') { miniMonthCursor.setMonth(miniMonthCursor.getMonth() + (action === 'mini-next' ? 1 : -1), 1); return renderSidebar(); }
  if (action === 'mini-day') { state.week = new Date(`${button.dataset.date}T00:00:00`); return loadView(); }
}

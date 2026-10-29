const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const format = (value, options) => window.asterTime.format(value, options, snapshot?.timeZone || 'system');
const clock = value => format(value, { hour: '2-digit', minute: '2-digit' });
let snapshot;
function render(state) {
  snapshot = state;
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.querySelector('#connection').textContent = window.asterWidget ? state.connected ? 'Exchange · HTTPS' : 'Нет подключения' : 'Деморежим · вымышленные встречи';
  document.querySelector('#updated').textContent = state.lastPoll ? `Обновлено ${clock(state.lastPoll)} · ${window.asterTime.zone(state.timeZone)}` : '';
  const error = document.querySelector('#error'); error.hidden = !state.error; error.textContent = state.error || '';
  const events = state.events.filter(e => new Date(e.end) > Date.now());
  if (!state.connected || !events.length) {
    document.querySelector('#meetings').innerHTML = `<div class="empty"><strong>${state.connected ? state.lastPoll ? 'Время для себя' : 'Обновляем календарь' : 'Ваш календарь — рядом'}</strong>${state.connected ? state.lastPoll ? 'Ближайших встреч нет.' : 'Загружаем ближайшие встречи из Exchange.' : 'Подключите корпоративный Exchange в Aster Mail.'}<button class="open" data-action="app">Открыть Aster Mail ↗</button></div>`; return;
  }
  const first = events[0], active = new Date(first.start) <= Date.now();
  const minutes = Math.max(1, Math.ceil((new Date(active ? first.end : first.start) - Date.now()) / 60000));
  const label = minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  document.querySelector('#meetings').innerHTML = `<div class="eyebrow">${active ? 'Встреча идёт' : 'Следующая встреча'}</div><div class="countdown ${active ? 'live' : ''}">${label}</div><div class="countdown-note">${active ? 'до окончания' : 'до начала'}</div><section class="featured"><h1>${escape(first.title)}</h1><div class="time">${format(first.start, { weekday: 'short', day: 'numeric', month: 'short' })} · ${clock(first.start)}–${clock(first.end)}</div>${first.location ? `<div class="location">${escape(first.location)}</div>` : ''}<div class="actions"><button class="join" data-action="join" data-id="${escape(first.id)}" ${first.joinUrl ? '' : 'disabled'}>Войти в созвон ↗</button><button class="open" data-action="open" data-id="${escape(first.id)}">Карточка встречи</button></div>${first.joinUrl ? '' : '<p class="link-note">В описании встречи не найдена ссылка на созвон.</p>'}</section>${events.length > 1 ? `<div class="next-heading">Далее</div>${events.slice(1, 4).map(event => `<button class="next" data-action="open" data-id="${escape(event.id)}"><time>${clock(event.start)}<br>${format(event.start, { day: 'numeric', month: 'short' })}</time><strong>${escape(event.title)}</strong></button>`).join('')}` : ''}`;
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled) return;
  if (!window.asterWidget) { const error = document.querySelector('#error'); error.hidden = false; error.textContent = 'Деморежим. Переходы доступны в настольном приложении.'; return; }
  button.disabled = true;
  try {
    const result = await window.asterWidget.action(button.dataset.action, button.dataset.id);
    if (!result.ok) throw new Error(result.error);
  } catch (error) { const box = document.querySelector('#error'); box.textContent = error.message; box.hidden = false; }
  finally { button.disabled = false; }
});
if (window.asterWidget) {
  window.asterWidget.onUpdate(render);
  window.asterWidget.state().then(result => { if (result.ok) render(result.value); else throw new Error(result.error); }).catch(error => { const box = document.querySelector('#error'); box.textContent = error.message; box.hidden = false; });
} else {
  const next = new Date(Date.now() + 12 * 60000), end = new Date(next.getTime() + 45 * 60000);
  render({ connected: true, lastPoll: new Date().toISOString(), events: [{ id: 'demo-widget', title: 'Обсуждение проекта', start: next.toISOString(), end: end.toISOString(), location: 'Microsoft Teams', joinUrl: 'https://teams.microsoft.com/' }, ...window.asterDemo.events.filter(e => new Date(e.start) > end)] });
}
setInterval(() => { if (snapshot) render(snapshot); }, 15000);

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const T = window.asterTime, E = window.asterEvents;
const format = (value, options) => T.format(value, options, snapshot?.timeZone || 'system');
const clock = value => format(value, { hour: '2-digit', minute: '2-digit' });
const scale = 1;
let snapshot, selectedDay, lastZone, gridKey;
function dayStart(day) { return T.fromWall(`${day}T00:00`, snapshot.timeZone, false); }
function adjacentDay(direction) { return T.wall(T.add(dayStart(selectedDay), { days: direction }, snapshot.timeZone), snapshot.timeZone).slice(0, 10); }
function inRange(day) {
  const start = dayStart(day);
  return !snapshot.range || (+start >= Date.parse(snapshot.range.start) && +start < Date.parse(snapshot.range.end));
}
function render(state) {
  const previousScroll = document.querySelector('.day-scroll')?.scrollTop;
  snapshot = state;
  window.asterI18n.setLanguage(state.language || window.asterI18n.language);
  const now = Date.now(), zone = T.zone(state.timeZone), today = T.wall(now, zone).slice(0, 10);
  if (!selectedDay || lastZone !== zone || !inRange(selectedDay)) selectedDay = today;
  lastZone = zone;
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.querySelector('#connection').textContent = window.asterWidget ? state.connected ? `Exchange · ${state.secure === false ? 'HTTP' : 'HTTPS'}` : tr('Нет подключения') : tr('Демо · вымышленные встречи');
  document.querySelector('#updated').textContent = state.lastPoll ? `${clock(state.lastPoll)} · ${zone}` : zone;
  const error = document.querySelector('#error'); error.hidden = !state.error; error.textContent = state.error || '';
  if (!state.connected) {
    document.querySelector('#meetings').innerHTML = tr('<div class="empty"><strong>Ваш календарь — рядом</strong>Подключите корпоративный Exchange в Aster Mail.<button class="open" data-action="app">Открыть Aster Mail ↗</button></div>'); return;
  }
  const all = (state.calendarEvents || state.events).filter(e => !e.cancelled);
  const nearest = E.nearestMeetings(all, now);
  const start = dayStart(selectedDay), layout = window.asterCalendarLayout.layout(all, start, zone);
  const allDay = all.filter(e => e.allDay && Date.parse(e.start) < +layout.end && Date.parse(e.end) > +start);
  const dayTitle = `${selectedDay === today ? tr('Сегодня, ') : ''}${format(start, { day: 'numeric', month: 'long' })}`;
  document.querySelector('#meetings').innerHTML = `${nearest.length ? `<div class="featured-meetings ${nearest.length > 1 ? `multiple ${nearest.length >= 4 ? 'many' : ''}` : ''}" aria-label="${tr('Ближайшие встречи')}">${nearest.length > 1 ? `<div class="meeting-count">${tr('Встречи')} · ${nearest.length}</div>` : ''}${nearest.map(first => { const status = E.countdown(first, now); return `<section class="featured"><div class="status-line"><span class="eyebrow">${status.active ? tr('Встреча идёт') : tr('Следующая встреча')}</span><strong class="countdown ${status.active ? 'live' : ''}">${escape(status.label)}</strong></div><button class="featured-title" title="${escape(first.title)}" data-action="open" data-id="${escape(first.id)}">${escape(first.title)}</button><div class="time">${format(first.start, { day: 'numeric', month: 'short' })} · ${clock(first.start)}–${clock(first.end)}</div><div class="actions"><button class="join" data-action="join" data-id="${escape(first.id)}" aria-label="${tr('Войти в созвон:')} ${escape(first.title)}" ${first.joinUrl ? '' : 'disabled'}>${nearest.length > 1 ? '↗' : tr("Войти в созвон ↗")}</button><button class="open" data-action="open" data-id="${escape(first.id)}">${tr("Карточка встречи")}</button></div></section>`; }).join('')}</div>` : `<div class="free-state">${state.lastPoll ? tr('Ближайших встреч нет') : tr('Загружаем календарь…')}</div>`}<section class="day-grid"><div class="day-toolbar"><strong>${escape(dayTitle)}</strong><div><button data-action="day-prev" aria-label="${tr("Предыдущий день")}" ${inRange(adjacentDay(-1)) ? '' : 'disabled'}>‹</button><button data-action="today" title="${tr("Сегодня")}" aria-label="${tr("Сегодня")}">●</button><button data-action="day-next" aria-label="${tr("Следующий день")}" ${inRange(adjacentDay(1)) ? '' : 'disabled'}>›</button></div></div>${allDay.length ? `<div class="all-day">${allDay.map(e => `<button data-action="open" data-id="${escape(e.id)}">${tr("Весь день ·")} ${escape(e.title)}</button>`).join('')}</div>` : ''}<div class="day-scroll"><div class="day-track" style="height:${layout.dayMinutes * scale}px">${Array.from({ length: Math.ceil(layout.dayMinutes / 60) }, (_, hour) => `<div class="hour" style="top:${hour * 60 * scale}px"><time>${clock(new Date(+start + hour * 3600000))}</time></div>`).join('')}${layout.entries.map(({ event: e, top, height, left, width }) => {
    const active = Date.parse(e.start) <= now && Date.parse(e.end) > now;
    return `<article class="grid-event ${E.kind(e)} ${active ? 'is-live' : ''} ${Date.parse(e.end) <= now ? 'is-past' : ''}" style="top:${top * scale}px;height:${Math.max(20, height * scale)}px;left:calc(45px + (100% - 49px)*${left});width:calc((100% - 49px)*${width} - 3px)"><button class="grid-event-main" data-action="open" data-id="${escape(e.id)}" aria-label="${tr("Открыть встречу:")} ${escape(e.title)}" title="${escape(`${e.title} · ${clock(e.start)}–${clock(e.end)}${e.organizer?.name ? ` · ${e.organizer.name}` : ''}`)}"><strong>${escape(e.title)}</strong><small>${clock(e.start)}–${clock(e.end)}${e.organizer?.name ? ` · ${escape(e.organizer.name)}` : ''}</small></button>${e.joinUrl && E.kind(e) !== 'declined' && Date.parse(e.end) > now ? `<button class="grid-join" data-action="join" data-id="${escape(e.id)}" title="${tr("Войти в созвон")}" aria-label="${tr("Войти в созвон:")} ${escape(e.title)}">↗</button>` : ''}</article>`;
  }).join('')}${selectedDay === today ? `<div class="now-line" style="top:${(now - start) / 60000 * scale}px" aria-label="${tr("Текущее время")}"><span>${clock(now)}</span></div>` : ''}${!layout.entries.length && !allDay.length ? tr('<div class="no-events">В этот день встреч нет</div>') : ''}</div></div></section>`;
  const scroll = document.querySelector('.day-scroll'), key = `${selectedDay}|${zone}`;
  const focus = selectedDay === today ? (now - start) / 60000 : layout.entries[0]?.top ?? 9 * 60;
  scroll.scrollTop = key === gridKey && previousScroll !== undefined ? previousScroll : Math.max(0, focus - 30) * scale;
  gridKey = key;
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (['day-prev', 'day-next', 'today'].includes(action)) {
    selectedDay = action === 'today' ? T.wall(Date.now(), snapshot.timeZone).slice(0, 10) : adjacentDay(action === 'day-next' ? 1 : -1);
    if (action === 'today') gridKey = null;
    render(snapshot); return;
  }
  if (!window.asterWidget) { const error = document.querySelector('#error'); error.hidden = false; error.textContent = tr('Деморежим. Переходы доступны в настольном приложении.'); return; }
  button.disabled = true;
  try {
    const result = await window.asterWidget.action(action, button.dataset.id);
    if (!result.ok) throw Object.assign(new Error(result.error), { userFacing: result.userFacing === true });
  } catch (error) { const box = document.querySelector('#error'); box.textContent = window.asterErrors.message(error, { debug: snapshot?.debugErrors === true }); box.hidden = false; }
  finally { button.disabled = false; }
});
if (window.asterWidget) {
  window.asterWidget.onUpdate(render);
  window.asterWidget.state().then(result => { if (result.ok) render(result.value); else throw Object.assign(new Error(result.error), { userFacing: result.userFacing === true }); }).catch(error => { const box = document.querySelector('#error'); box.textContent = window.asterErrors.message(error, { debug: snapshot?.debugErrors === true }); box.hidden = false; });
} else {
  const now = Date.now(), at = minutes => new Date(now + minutes * 60000).toISOString();
  const events = [
    { id: 'demo-live', title: tr('Командная встреча'), start: at(-22), end: at(8), response: 'Accept', organizer: { name: tr('Анна Смирнова') }, joinUrl: 'https://calls.example.com/team' },
    { id: 'demo-overlap', title: tr('Обсуждение макетов'), start: at(-10), end: at(35), response: 'Organizer', isOrganizer: true, joinUrl: 'https://calls.example.com/design' },
    { id: 'demo-sync', title: tr('Обсуждение проекта'), start: at(-8), end: at(22), response: 'Accept', joinUrl: 'https://calls.example.com/sync' },
    { id: 'demo-review', title: tr('Обзор дизайна'), start: at(-5), end: at(40), response: 'Tentative', joinUrl: 'https://calls.example.com/review' },
    { id: 'demo-week', title: tr('Итоги недели'), start: at(-2), end: at(25), response: 'Accept', joinUrl: 'https://calls.example.com/week' },
    { id: 'demo-next', title: tr('Планирование проекта'), start: at(98), end: at(128), response: 'Accept', organizer: { name: tr('Михаил Волков') }, joinUrl: 'https://calls.example.com/project' },
    { id: 'demo-past', title: tr('Утренняя синхронизация'), start: at(-120), end: at(-90), response: 'Accept' },
    ...window.asterDemo.events.filter(e => Date.parse(e.start) >= +window.asterCalendar.range(new Date(now), 'day').end),
  ];
  render({ connected: true, timeZone: 'system', theme: 'light', lastPoll: at(0), events, calendarEvents: events });
}
setInterval(() => { if (snapshot) render(snapshot); }, 15000);

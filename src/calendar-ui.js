let calendarScrollKey, currentSystemZone;
function timelineMarkup(start, mode, events) {
  const days = Array.from({ length: mode === 'day' ? 1 : 7 }, (_, i) => addDays(start, i));
  const layouts = days.map(day => window.asterCalendarLayout.layout(events, day, timeZone));
  const height = Math.max(...layouts.map(day => day.dayMinutes));
  const button = (e, style = '') => `<button class="event-card event-${window.asterEvents.kind(e, state.account?.username || '')}" data-action="event" data-id="${esc(e.id)}" ${style ? `style="${style}"` : ''} title="${esc(`${e.title} · ${e.allDay ? 'Весь день' : `${time(e.start)}–${time(e.end)}`}`)}"><time>${e.allDay ? 'Весь день' : `${esc(time(e.start))}–${esc(time(e.end))}`}</time><strong>${esc(e.title)}</strong>${e.location ? `<small>${esc(e.location)}</small>` : ''}</button>`;
  return `<div class="calendar-timeline ${mode === 'day' ? 'timeline-single' : ''}" style="--days:${days.length}"><div class="timeline-headers">${days.map(day => `<div class="timeline-heading ${dayKey(day) === dayKey(new Date()) ? 'today' : ''}"><span>${esc(dateFormat(day, { weekday: mode === 'day' ? 'long' : 'short' }))}</span><strong>${civil(day).getUTCDate()}</strong></div>`).join('')}</div><div class="timeline-all-day">${days.map(day => `<div>${calendarEvents(events, day).filter(e => e.allDay).map(e => button(e)).join('')}</div>`).join('')}</div><div class="timeline-scroll"><div class="timeline-tracks" style="height:${height}px">${layouts.map(({ entries, dayMinutes, start, end }) => `<div class="timeline-track" data-start="${start.toISOString()}" data-end="${end.toISOString()}">${Array.from({ length: Math.ceil(dayMinutes / 60) }, (_, hour) => `<div class="timeline-hour" style="top:${hour * 60}px"><span>${esc(time(new Date(+start + hour * 3600000)))}</span></div>`).join('')}${entries.map(({ event, top, height, left, width, columns }) => button(event, `--event-top:${top}px;--event-height:${Math.max(16, height)}px;--event-left:${left};--event-width:${width};--event-columns:${columns}`)).join('')}<div class="timeline-now" hidden aria-label="Текущее время"><span></span></div></div>`).join('')}</div></div></div>`;
}
function updateCurrentTime() {
  const resolved = T.zone(timeZone);
  if (timeZone === 'system' && currentSystemZone && resolved !== currentSystemZone && ready()) {
    currentSystemZone = resolved; miniMonthCursor = null; void loadView(); return;
  }
  currentSystemZone = resolved;
  const now = Date.now();
  document.querySelectorAll('.timeline-track').forEach(track => {
    const line = track.querySelector('.timeline-now'), start = Date.parse(track.dataset.start), end = Date.parse(track.dataset.end);
    line.hidden = now < start || now >= end;
    if (!line.hidden) { line.style.top = `${(now - start) / 60000}px`; line.querySelector('span').textContent = time(new Date(now)); }
  });
}
function restoreCalendarScroll(start, mode, previousScroll) {
  const scroll = document.querySelector('.timeline-scroll'); if (!scroll) { calendarScrollKey = null; return; }
  const key = `${start.toISOString()}|${mode}|${timeZone}`;
  const today = [...document.querySelectorAll('.timeline-track')].find(track => Date.now() >= Date.parse(track.dataset.start) && Date.now() < Date.parse(track.dataset.end));
  scroll.scrollTop = calendarScrollKey === key && previousScroll !== undefined ? previousScroll : today ? Math.max(0, (Date.now() - Date.parse(today.dataset.start)) / 60000 - 90) : 8 * 60;
  calendarScrollKey = key; updateCurrentTime();
}
setInterval(updateCurrentTime, 15000);

// Pointer capture works in both the native webview and the browser preview.
function calendarSlot(track, clientY) {
  const bounds = track.getBoundingClientRect();
  return window.asterCalendarLayout.slot(track.dataset.start, track.dataset.end, clientY - bounds.top, bounds.height);
}
document.addEventListener('dblclick', event => {
  const track = event.target.closest('.timeline-track');
  if (!track || event.target.closest('.event-card') || $('#modal').open) return;
  event.preventDefault(); eventModal(calendarSlot(track, event.clientY));
});
let calendarDrag = null, calendarDrop = null, suppressCalendarClick = false;
document.addEventListener('click', event => {
  if (!suppressCalendarClick) return;
  suppressCalendarClick = false; event.preventDefault(); event.stopImmediatePropagation();
}, true);
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || $('#modal').open) return;
  const button = event.target.closest('.timeline-track .event-card');
  if (!button) return;
  const item = state.events.find(item => item.id === button.dataset.id);
  if (!item || item.cancelled || item.allDay || !window.asterEvents.organizer(item, state.account?.username || '')) return;
  const track = button.closest('.timeline-track');
  const at = calendarSlot(track, event.clientY);
  calendarDrag = { button, item: { ...item }, id: event.pointerId, x: event.clientX, y: event.clientY, offset: +at - Date.parse(item.start), generation: state.generation };
  button.setPointerCapture(event.pointerId);
});
function clearCalendarDrag() {
  if (calendarDrag?.button.hasPointerCapture(calendarDrag.id)) calendarDrag.button.releasePointerCapture(calendarDrag.id);
  calendarDrag?.marker?.remove(); calendarDrag?.button.classList.remove('calendar-dragging'); calendarDrag = null;
}
document.addEventListener('pointermove', event => {
  const drag = calendarDrag; if (!drag || event.pointerId !== drag.id) return;
  if (!drag.marker && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
  if (!drag.marker) { drag.marker = document.createElement('div'); drag.marker.className = 'calendar-drop-marker'; drag.marker.setAttribute('role', 'status'); drag.button.classList.add('calendar-dragging'); }
  event.preventDefault();
  const track = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline-track');
  drag.target = null; drag.marker.hidden = !track;
  if (!track) return;
  const scroll = track.closest('.timeline-scroll'), bounds = scroll.getBoundingClientRect();
  if (event.clientY < bounds.top + 35) scroll.scrollTop -= 20;
  else if (event.clientY > bounds.bottom - 35) scroll.scrollTop += 20;
  const raw = new Date(+calendarSlot(track, event.clientY) - drag.offset);
  const start = new Date(Math.max(Date.parse(track.dataset.start), Math.min(Date.parse(track.dataset.end) - 15 * 60000, +raw)));
  drag.target = window.asterCalendarLayout.moved(drag.item, start);
  track.append(drag.marker); drag.marker.hidden = false;
  drag.marker.style.top = `${(+start - Date.parse(track.dataset.start)) / 60000}px`;
  drag.marker.style.height = `${Math.max(25, (Date.parse(drag.target.end) - start) / 60000)}px`;
  drag.marker.textContent = `${time(start)}–${time(drag.target.end)} · ${drag.item.title}`;
});
document.addEventListener('pointercancel', clearCalendarDrag);
document.addEventListener('pointerup', event => {
  const drag = calendarDrag; if (!drag || event.pointerId !== drag.id) return;
  const moved = Boolean(drag.marker); clearCalendarDrag();
  if (!moved) return;
  suppressCalendarClick = true; setTimeout(() => { suppressCalendarClick = false; }, 0);
  if (!drag.target || drag.generation !== state.generation || drag.target.start === drag.item.start) return;
  void prepareCalendarDrop(drag.item, drag.target).catch(showError);
});
async function prepareCalendarDrop(origin, target) {
  const generation = state.generation;
  const detail = state.demo ? demoMeeting(origin) : await api('eventDetails', ref(origin));
  if (generation !== state.generation || state.view !== 'calendar' || $('#modal').open) return;
  if (!window.asterEvents.organizer(detail, state.account?.username || '') || detail.canModify === false || detail.cancelled) throw new Error('Переносить можно только свои доступные для изменения встречи');
  calendarDrop = { origin, target, detail, generation };
  modal('Перенести встречу', origin.title, `<form id="calendar-move-form"><p>${esc(dateFormat(target.start, { weekday: 'long', day: 'numeric', month: 'long' }))} · <strong>${esc(time(target.start))}–${esc(time(target.end))}</strong></p>${detail.recurring ? '<label class="field"><span>Применить перенос к</span><select name="scope"><option value="single">Только этому повтору</option><option value="series">Всему ряду</option></select></label>' : ''}<p class="form-note">Длительность сохранится. Участники получат обновление времени.</p>${formError()}<div class="modal-footer"><button class="secondary" type="button" data-action="close">Отмена</button><button class="primary" type="submit">Перенести встречу</button></div></form>`);
}
document.addEventListener('submit', event => {
  const form = event.target; if (form.id !== 'calendar-move-form') return;
  event.preventDefault();
  const move = calendarDrop;
  void submitForm(form, async data => {
    if (!move || move.generation !== state.generation) throw new Error('Календарь изменился. Повторите перенос.');
    const scope = data.scope === 'series' ? 'series' : 'single';
    const detail = scope === 'series' ? state.demo ? demoMeeting(move.origin, scope) : await api('eventDetails', { ...ref(move.origin), scope }) : move.detail;
    const delta = Date.parse(move.target.start) - Date.parse(move.origin.start);
    const changes = window.asterCalendarLayout.moved(detail, new Date(Date.parse(detail.start) + delta));
    await saveMeetingChanges({ origin: move.origin, detail, scope }, changes);
    calendarDrop = null;
  });
});

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

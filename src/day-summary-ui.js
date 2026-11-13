// Mail/calendar summaries remain in account-local renderer memory only.
let daySummary = null, daySummaryRequest = 0;
function resetDaySummary() { daySummary = null; daySummaryRequest++; }
function invalidateDaySummary() { if (daySummary) { daySummary.updated = 0; daySummary.pending = null; } daySummaryRequest++; }
function daySummaryScope() { return state.demo ? 'demo' : state.account; }
function receiveDayInbox(snapshot) {
  if (daySummary?.scope === daySummaryScope() && snapshot.page && Number.isInteger(snapshot.inbox?.unread)) {
    const items = snapshot.page.items.filter(message => !message.read);
    if (items.length >= Math.min(5, snapshot.inbox.unread)) daySummary.mail = { items, total: snapshot.inbox.unread, more: snapshot.page.more };
    else invalidateDaySummary();
  }
  renderDaySummary();
  void refreshDaySummary();
}
function daySummaryDuration(minutes) {
  const value = Math.round(minutes);
  return value >= 60 ? `${Math.floor(value / 60)} ${tr('ч')}${value % 60 ? ` ${value % 60} ${tr('мин')}` : ''}` : `${value} ${tr('мин')}`;
}
function renderDaySummary() {
  if (state.view !== 'mail' || state.selected || !$('#reader')) return;
  const current = daySummary?.scope === daySummaryScope() ? daySummary : null;
  const calendar = current?.calendar;
  const day = calendar ? window.asterDaySummary.day(calendar.events, Date.now(), timeZone, notificationPreferences.workSchedule) : null;
  const mail = current?.mail;
  const loading = tr('Загрузка…'), unavailable = tr('Нет данных');
  const mailStatus = mail ? mail.total ?? `${mail.items.length}${mail.more ? '+' : ''}` : current?.mailError ? '—' : '…';
  const calendarStatus = day ? day.today.length : current?.calendarError ? '—' : '…';
  const busyStatus = day ? day.working ? daySummaryDuration(day.scheduledMinutes) : '—' : current?.calendarError ? '—' : '…';
  const occupancyLabel = day?.unknown.length ? tr('Время встреч') : tr('Занято встречами');
  const rhythmLabel = day?.unknown.length ? tr('По времени встреч') : tr('Занято');
  const stale = current?.mailError || current?.calendarError;
  const count = window.asterEvents.countdown(day?.upcoming[0]);
  const preview = mail?.items.slice(0, 5).map(message => `<button type="button" class="day-mail" data-action="day-message" data-id="${esc(message.id)}"><span class="day-mail-meta"><span>${esc(message.from?.name || message.from?.email || tr('Неизвестный отправитель'))}</span><time>${esc(dateFormat(message.date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</time></span><strong>${esc(message.subject || tr('(Без темы)'))}</strong><span class="day-preview">${esc((message.preview || message.text || '').slice(0, 300))}</span></button>`).join('');
  const upcoming = day?.upcoming.slice(0, 3).map((event, index) => `<button type="button" class="day-meeting ${index === 0 ? 'day-meeting-next' : ''}" data-action="day-event" data-id="${esc(event.id)}">${index === 0 ? `<span class="day-badge">${esc(count.label)}</span>` : ''}<time>${dayKey(event.start) !== dayKey(new Date()) ? `${esc(dateFormat(event.start, { day: 'numeric', month: 'short' }))} · ` : ''}${esc(time(event.start))}–${esc(time(event.end))}</time><strong>${esc(event.title)}</strong><span class="day-preview">${esc(event.location || tr('Место не указано'))}</span></button>`).join('');
  const blocks = day && [...day.busy.map(block => ({ ...block, kind: 'busy' })), ...day.unknown.map(block => ({ ...block, kind: 'unknown' }))];
  const rhythm = day ? day.working ? `<div class="day-section-heading"><h3>${tr('Ритм дня')}</h3><span>${rhythmLabel} ${day.percent}% · ${esc(time(day.workStart))}–${esc(time(day.workEnd))}</span></div><div class="day-track" role="img" aria-label="${esc(`${occupancyLabel}: ${daySummaryDuration(day.scheduledMinutes)}. ${day.unknown.length ? tr('Статус части встреч не указан. Их время исключено из свободных окон.') : ''}`)}">${blocks.map(block => `<span class="day-block ${block.kind}" style="left:${100 * (block.start - day.workStart) / (day.workEnd - day.workStart)}%;width:${100 * (block.end - block.start) / (day.workEnd - day.workStart)}%"></span>`).join('')}</div><div class="day-ticks">${Array.from({ length: 5 }, (_, i) => `<span>${esc(time(day.workStart + (day.workEnd - day.workStart) * i / 4))}</span>`).join('')}</div><p class="day-window">${day.longest ? `${tr('Окно без встреч:')} <strong>${esc(time(day.longest.start))}–${esc(time(day.longest.end))}</strong> · ${daySummaryDuration((day.longest.end - day.longest.start) / 60000)}` : Date.now() >= day.workEnd ? tr('Рабочий день завершён') : tr('До конца рабочего дня нет свободных окон.')}</p>${day.unknown.length ? `<p class="day-note">${tr('Статус части встреч не указан. Их время исключено из свободных окон.')}</p>` : ''}` : `<h3>${tr('Ритм дня')}</h3><p class="day-note">${tr('Нерабочий день')}</p>` : `<h3>${tr('Ритм дня')}</h3><p class="day-note">${current?.calendarError ? unavailable : tr('Загружаем календарь…')}</p>`;
  const markup = `<section class="day-summary" aria-label="${tr('Ваш день')}"><header class="day-header"><div><p class="day-date">${esc(dateFormat(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }))}</p><h2>${tr('Ваш день')}</h2><p class="day-subtitle">${tr('Почта и встречи — одним взглядом')}</p></div><button type="button" class="icon-button back-to-list" data-action="back-to-list" aria-label="${tr('К письмам')}" title="${tr('К письмам')}">${icon('reply')}</button></header><div class="day-stats"><div><strong>${esc(mailStatus)}</strong><span>${tr('Новых писем')}<small>${tr('Непрочитанные во входящих')}</small></span></div><div><strong>${calendarStatus}</strong><span>${tr('Встреч сегодня')}<small>${tr('Без отменённых и отклонённых')}</small></span></div><div><strong>${esc(busyStatus)}</strong><span>${occupancyLabel}<small>${tr('В рабочие часы')}</small></span></div></div><div class="day-columns"><section><div class="day-section-heading"><h3>${icon('mail')}${tr('В новых письмах')}</h3><button type="button" class="day-link" data-action="day-inbox">${tr('Все')} ${icon('chevron')}</button></div>${preview || `<p class="day-note">${mail ? tr('Новых писем нет') : current?.mailError ? unavailable : loading}</p>`}</section><section><div class="day-section-heading"><h3>${icon('calendar')}${tr('Далее по плану')}</h3><button type="button" class="day-link" data-action="day-calendar" aria-label="${tr('Открыть календарь')}" title="${tr('Открыть календарь')}">${icon('chevron')}</button></div>${upcoming || `<p class="day-note">${day ? tr('Нет ближайших встреч на 7 дней') : current?.calendarError ? unavailable : tr('Загружаем календарь…')}</p>`}</section></div><section class="day-rhythm">${rhythm}</section><footer class="day-footer"><span>${esc(T.zone(timeZone))} · ${tr('По загруженному календарю')}</span><span>${stale ? tr('Часть данных не обновлена. Повторим при восстановлении связи.') : current?.updated ? `${tr('Обновлено')} ${esc(time(current.updated))}` : tr('Обновление…')}</span></footer></section>`;
  // Background updates may replace the summary, never a mounted message or composer.
  const reader = $('#reader'), scroll = reader.querySelector('.day-summary')?.scrollTop || 0;
  const focused = reader.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
  reader.innerHTML = markup;
  reader.querySelector('.day-summary').scrollTop = scroll;
  if (focused) [...reader.querySelectorAll('button')].find(button => Object.entries(focused).every(([key, value]) => button.dataset[key] === value))?.focus({ preventScroll: true });
}
async function refreshDaySummary(force = false) {
  if (!ready() || state.view !== 'mail' || state.selected || !$('#reader')) return;
  const scope = daySummaryScope(), generation = state.generation, epoch = mailWriteEpoch;
  const key = JSON.stringify([dayKey(new Date()), T.zone(timeZone)]);
  if (daySummary?.scope !== scope) resetDaySummary();
  if (!force && daySummary?.day === key && daySummary.epoch === epoch && (daySummary.pending === generation || Date.now() - daySummary.updated < 60000)) return;
  const request = ++daySummaryRequest;
  daySummary = { ...daySummary, scope, day: key, pending: generation };
  const range = window.asterCalendar.range(new Date(), 'day', timeZone);
  const end = T.add(range.start, { days: 7 }, timeZone);
  const results = await Promise.allSettled([
    state.demo ? Promise.resolve({ items: structuredClone(window.asterDemo.messages.filter(message => message.folder === 'inbox' && !message.read)), more: false }) : api('messages', { folder: 'inbox', filter: 'unread', offset: 0, refresh: true }),
    state.demo ? Promise.resolve(structuredClone(window.asterDemo.events).filter(event => Date.parse(event.start) < +end && Date.parse(event.end) > +range.start)) : api('calendar', { start: range.start.toISOString(), end: end.toISOString() }),
  ]);
  if (request !== daySummaryRequest || scope !== daySummaryScope() || generation !== state.generation || epoch !== mailWriteEpoch || mailWrites) { if (request === daySummaryRequest && daySummary) daySummary.pending = null; return; }
  const [mail, calendar] = results;
  if (daySummary.day !== key) return;
  daySummary.pending = null; daySummary.epoch = epoch;
  daySummary.mailError = mail.status === 'rejected'; daySummary.calendarError = calendar.status === 'rejected';
  if (mail.status === 'fulfilled') daySummary.mail = mail.value;
  if (calendar.status === 'fulfilled') daySummary.calendar = { events: calendar.value };
  // Failed reads retry through the existing inbox poll, never a separate connection loop.
  daySummary.updated = mail.status === 'fulfilled' && calendar.status === 'fulfilled' ? Date.now() : 0;
  renderDaySummary();
}
async function openDayMessage(id) {
  if ($('#modal').open) return;
  const message = daySummary?.mail?.items.find(item => item.id === id);
  if (!message) return;
  state.view = 'mail'; state.folder = 'inbox'; state.filter = 'all'; state.query = ''; $('#search').value = '';
  const pending = loadView(), generation = state.generation;
  await pending;
  if (generation !== state.generation || state.view !== 'mail' || $('#modal').open || !$('#reader')) return;
  if (!state.messages.some(item => item.id === id)) state.messages.push(message);
  return openMessage(id);
}

/* Meeting views share the existing dialog, forms, planner and isolated content policy. */
let activeMeeting = null, meetingEdit = null, meetingRequest = 0;
const responseName = value => ({ Accept: 'Принято', Accepted: 'Принято', Tentative: 'Под вопросом', TentativelyAccepted: 'Под вопросом', Decline: 'Отклонено', Declined: 'Отклонено', Organizer: 'Организатор' }[value] || 'Нет ответа');
const meetingScope = () => $('#meeting-scope')?.value || 'single';
function demoMeeting(summary, scope = 'single') {
  const source = scope === 'series' && summary.seriesId ? window.asterDemo.events.filter(e => e.seriesId === summary.seriesId).sort((a, b) => a.start.localeCompare(b.start))[0] : summary;
  return structuredClone({ ...source, body: source.body || source.preview || '', attendees: source.attendees || [], attachments: source.attachments || [], ref: ref(source), changeKey: source.changeKey || 'demo-version', reminder: source.reminder ?? 15, reminderSet: source.reminderSet !== false, showAs: source.showAs || 'Busy', sensitivity: source.sensitivity || 'Normal', canModify: true });
}
async function openMeeting(summary) {
  modal('Встреча', 'Загружаем сведения из календаря…', '<div class="meeting-loading">Загрузка карточки…</div>');
  const request = ++meetingRequest;
  const dialog = $('#modal'); dialog.classList.add('meeting-dialog'); dialog.dataset.meetingCard = 'true'; dialog.dataset.eventId = summary.id;
  activeMeeting = null;
  try {
    const detail = state.demo ? demoMeeting(summary) : await api('eventDetails', ref(summary));
    if (request !== meetingRequest || !dialog.open || dialog.dataset.eventId !== summary.id || dialog.dataset.meetingCard !== 'true') return;
    activeMeeting = { ...summary, ...detail, origin: summary, images: {} };
    const cached = state.events.find(e => e.id === summary.id); if (cached) Object.assign(cached, { response: detail.response, isOrganizer: detail.isOrganizer, cancelled: detail.cancelled, recurring: detail.recurring });
    if (state.view === 'calendar') renderCalendar();
    renderMeetingCard();
    let total = 0;
    let decoded = 0;
    for (const attachment of activeMeeting.attachments.filter(a => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.type)).slice(0, 6)) {
      if (attachment.size > 5 * 1024 * 1024 || total + attachment.size > 12 * 1024 * 1024) continue;
      total += attachment.size;
      try {
        const preview = state.demo ? { dataURL: attachment.previewUrl, decodedBytes: 0 } : await api('eventImage', { ref: ref(detail), id: attachment.id });
        decoded += preview.decodedBytes;
        if (decoded > 128 * 1024 * 1024) throw new Error('Превышен лимит распакованных изображений встречи');
        const src = preview.dataURL;
        if (request !== meetingRequest || !dialog.open || dialog.dataset.meetingCard !== 'true') return;
        activeMeeting.images[attachment.id] = src;
        const img = [...document.querySelectorAll('.meeting-image img')].find(img => img.dataset.id === attachment.id);
        if (img) { img.src = src; img.hidden = false; img.closest('.meeting-image').querySelector('.image-status').hidden = true; }
        renderMeetingBody(activeMeeting);
      } catch (error) {
        if (request !== meetingRequest || !dialog.open || dialog.dataset.meetingCard !== 'true') return;
        const note = [...document.querySelectorAll('.meeting-image')].find(node => node.dataset.id === attachment.id)?.querySelector('.image-status');
        if (note) note.textContent = `Предпросмотр недоступен: ${error.message}`;
      }
    }
  } catch (error) {
    if (request === meetingRequest && dialog.open && dialog.dataset.meetingCard === 'true') $('#modal-content').innerHTML = `<div class="modal-header"><h2>Не удалось открыть встречу</h2><button class="icon-button" data-action="close" aria-label="Закрыть">${icon('close')}</button></div><div class="modal-body"><p class="form-error">${esc(error.message)}</p><button class="secondary" data-action="meeting-return">Повторить загрузку</button></div>`;
    if (request === meetingRequest) activeMeeting = { origin: summary };
  }
}
function renderMeetingCard() {
  const e = activeMeeting, own = window.asterEvents.organizer(e, state.account?.username || '');
  const kind = window.asterEvents.kind(e, state.account?.username || ''), join = window.asterEvents.joinURL(e);
  const status = e.cancelled ? 'Встреча отменена' : own ? 'Вы организатор' : responseName(e.response);
  const links = window.asterEvents.links(e).filter(url => url !== e.location?.trim());
  const attendee = person => `<div class="meeting-person">${avatar(person.name || person.email, 0, person.email)}<div><strong>${esc(person.name || person.email || 'Не указан')}</strong><small>${esc(person.email || '')}</small><span>${esc(person.role === 'resource' ? 'Ресурс' : person.role === 'optional' ? `Необязательный · ${responseName(person.response)}` : responseName(person.response))}</span></div></div>`;
  $('#modal-content').innerHTML = `<header class="meeting-card-header"><div><div class="eyebrow">${icon('calendar')}${e.recurring ? 'Повторяющаяся встреча' : 'Встреча'}</div><h2>${esc(e.title)}</h2><span class="meeting-status ${kind}">${esc(status)}</span></div><button class="icon-button" data-action="close" aria-label="Закрыть">${icon('close')}</button></header><div class="meeting-toolbar">${e.recurring ? '<label class="meeting-scope"><span>Применить к</span><select id="meeting-scope" aria-label="Область действия встречи"><option value="single">Этому повтору</option><option value="series">Всему ряду</option></select></label>' : ''}${!e.cancelled ? `<button class="secondary" data-action="meeting-edit" ${e.canModify === false ? 'disabled title="Нет прав на изменение"' : ''}>${icon('file')}${own ? 'Редактировать' : 'Напоминание'}</button><button class="secondary" data-action="meeting-reply" ${e.canReply === false ? 'disabled' : ''}>${icon('reply')}Ответить</button><button class="secondary" data-action="meeting-reply-all" ${e.canReplyAll === false ? 'disabled' : ''}>Ответить всем</button><button class="secondary" data-action="${own ? 'meeting-invite' : 'meeting-forward'}" ${e.forwardingAllowed === false && !own ? 'disabled title="Пересылка запрещена организатором"' : ''}>${icon('send')}${own ? 'Добавить участников' : 'Переслать'}</button>` : ''}</div><div class="meeting-card-layout"><section class="meeting-main"><div class="meeting-when">${icon('clock')}<div><strong>${esc(dateFormat(e.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</strong><span>${e.allDay ? 'Весь день' : `${esc(time(e.start))}–${esc(time(e.end))}`} · ${esc(T.zone(timeZone))}</span></div></div>${e.location ? `<div class="meeting-location">${icon('globe')}<span>${esc(e.location)}</span>${join && !e.cancelled ? `<button class="primary" data-action="meeting-join">Войти в звонок ↗</button>` : ''}</div>` : join && !e.cancelled ? '<button class="primary" data-action="meeting-join">Войти в звонок ↗</button>' : ''}<div class="meeting-properties"><span>Показывать как: ${esc({ Free: 'Свободен', Tentative: 'Под вопросом', Busy: 'Занят', OOF: 'Нет на месте', WorkingElsewhere: 'В другом месте' }[e.showAs] || 'Занят')}</span><span>Напоминание: ${e.reminderSet ? `${e.reminder} мин` : 'выключено'}</span>${e.sensitivity === 'Private' ? '<span>Частная встреча</span>' : ''}</div>${!own ? `<div id="event-rsvp">${rsvpButtons(e.id, e.changeKey, e.cancelled, e.response, own)}</div>` : ''}<div id="meeting-body"></div>${links.length ? `<section class="meeting-links"><h3>Ссылки</h3>${links.map(url => `<div><button class="meeting-link" data-action="link" data-url="${esc(url)}">${icon('globe')}<span>${esc(url)}</span></button>${join === url && !e.cancelled ? '<button class="secondary" data-action="meeting-join">Войти ↗</button>' : ''}</div>`).join('')}</section>` : ''}${e.attachments.length ? `<section class="meeting-attachments"><h3>${icon('clip')}Вложения</h3>${e.attachments.map(a => `<article>${['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.type) ? `<div class="meeting-image" data-id="${esc(a.id)}"><span class="image-status">${a.size > 5 * 1024 * 1024 ? 'Большое изображение — скачайте файл' : 'Загружаем изображение…'}</span><img data-id="${esc(a.id)}" alt="${esc(a.name)}" hidden></div>` : ''}<button class="attachment" data-action="attachment" data-id="${esc(a.id)}" data-name="${esc(a.name)}">${icon('file')}<span><strong>${esc(a.name)}</strong><small>${bytes(a.size)} · Скачать</small></span></button></article>`).join('')}</section>` : ''}${formError()}</section><aside class="meeting-people"><div class="meeting-people-content"><h3>Организатор</h3>${attendee({ ...e.organizer, response: 'Organizer' })}<h3>Участники <small>${e.attendees.length}</small></h3><div class="meeting-attendee-scroll" tabindex="0" aria-label="Список участников">${e.attendees.map(attendee).join('') || '<p class="form-note">Другие участники не указаны.</p>'}</div></div></aside></div>`;
  renderMeetingBody(e);
}
function renderMeetingBody(e) {
  const target = $('#meeting-body'); if (!target) return;
  if (!e.html) { target.innerHTML = `<div class="plain-body">${esc(e.body || e.preview || 'Нет описания')}</div>`; return; }
  window.asterRichContent.render(target, e.html, {
    dark: state.theme === 'dark', title: 'Описание встречи',
    loadImages: () => e.contentImages ||= state.demo ? demoContentImages(e.html) : api('contentImages', { ref: ref(e), kind: 'event' }),
    openLink: url => window.aster ? api('openLink', { url }).catch(showError) : toast(`Демо: ссылка ${url}`),
  });
}
function meetingPlainBody(e) {
  if (!e.html) return e.body || e.preview || '';
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(e.html, { FORBID_TAGS: ['img'] }), 'text/html');
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n')); doc.querySelectorAll('p,div,li,tr').forEach(node => node.append('\n'));
  return doc.body.textContent.trim();
}
async function editMeeting(invite = false) {
  const original = activeMeeting, origin = activeMeeting.origin, scope = meetingScope();
  const detail = scope === 'series' ? state.demo ? demoMeeting(origin, scope) : await api('eventDetails', { ...ref(origin), scope }) : activeMeeting;
  if (activeMeeting !== original || !$('#modal').open || $('#modal').dataset.meetingCard !== 'true') return;
  const own = window.asterEvents.organizer(detail, state.account?.username || '');
  if (detail.cancelled || detail.canModify === false) throw new Error('Встреча недоступна для редактирования');
  if (!own) {
    const options = [...new Set([0, 5, 10, 15, 30, 60, detail.reminder])].sort((a, b) => a - b);
    modal('Напоминание о встрече', detail.title, `<form id="meeting-reminder-form"><label class="field"><span>Когда напомнить</span><select name="lead"><option value="off" ${!detail.reminderSet ? 'selected' : ''}>Не напоминать</option>${options.map(n => `<option value="${n}" ${detail.reminderSet && detail.reminder === n ? 'selected' : ''}>${n ? `За ${n} мин` : 'В момент начала'}</option>`).join('')}</select></label><p class="form-note">Меняется только ваше напоминание, без отправки обновлений участникам. ${detail.recurring ? `Применяется к ${scope === 'series' ? 'всему ряду' : 'выбранному повтору'}.` : ''}</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="meeting-return">Назад к карточке</button><button type="submit" class="primary">Сохранить</button></div></form>`);
    meetingEdit = { origin, scope, detail, own: false }; return;
  }
  eventModal(); $('#modal').classList.add('meeting-edit-dialog');
  $('#modal .modal-header h2').textContent = own ? scope === 'series' ? 'Редактировать весь ряд' : detail.recurring ? 'Редактировать этот повтор' : 'Редактировать встречу' : 'Личные настройки встречи';
  $('#modal .modal-header p').textContent = own ? 'Изменения расписания и участников будут отправлены участникам. Неизменённые описание и вложения сохранятся.' : 'Расписание и участников изменяет организатор. Вы можете настроить свою копию встречи.';
  const form = $('#event-form'); form.dataset.editing = 'true';
  const values = { title: detail.title, start: localDate(detail.start), end: localDate(detail.end), location: detail.location, attendees: detail.attendees.filter(a => a.role === 'required' || !a.role).map(a => a.email).filter(Boolean).join(', '), body: meetingPlainBody(detail) };
  for (const [name, value] of Object.entries(values)) { form.elements[name].value = value; form.elements[name].disabled = !own; }
  const optional = detail.attendees.filter(a => a.role === 'optional').map(a => a.email).filter(Boolean).join(', ');
  form.elements.attendees.closest('.field').insertAdjacentHTML('afterend', field('optionalAttendees', 'Необязательные участники · email через запятую', optional));
  form.elements.optionalAttendees.disabled = !own || detail.attendees.some(a => a.role === 'optional' && !a.email);
  form.elements.attendees.disabled = !own || detail.attendees.some(a => (a.role === 'required' || !a.role) && !a.email);
  form.querySelector('.planner').hidden = !own;
  form.querySelector('.planner').insertAdjacentHTML('beforebegin', `<div class="meeting-edit-properties"><label class="checkbox"><input name="allDay" type="checkbox" ${detail.allDay ? 'checked' : ''} ${own ? '' : 'disabled'}>Весь день</label><label class="checkbox"><input name="reminderSet" type="checkbox" ${detail.reminderSet ? 'checked' : ''}>Напоминание включено</label>${field('reminder', 'Напоминать за минут', detail.reminder ?? 15, 'number')}<label class="field"><span>Показывать как</span><select name="showAs">${[['Free', 'Свободен'], ['Tentative', 'Под вопросом'], ['Busy', 'Занят'], ['OOF', 'Нет на месте'], ['WorkingElsewhere', 'В другом месте']].map(([value, label]) => `<option value="${value}" ${detail.showAs === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>Конфиденциальность</span><select name="sensitivity">${[['Normal', 'Обычная'], ['Personal', 'Личная'], ['Private', 'Частная'], ['Confidential', 'Конфиденциальная']].map(([value, label]) => `<option value="${value}" ${detail.sensitivity === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><p class="form-note">${detail.recurring ? `Область изменения: ${scope === 'series' ? 'весь ряд; даты начала и окончания относятся к первой встрече ряда' : 'только выбранный повтор'}. Правило повторения сохраняется.` : 'Изменяется только эта встреча.'} При изменении текста описания его форматирование заменится обычным текстом.</p>`);
  form.querySelector('[type="submit"]').textContent = own ? 'Сохранить и отправить обновления' : 'Сохранить личные настройки';
  form.querySelector('.modal-footer').insertAdjacentHTML('afterbegin', '<button type="button" class="secondary" data-action="meeting-return">Назад к карточке</button>');
  meetingEdit = { origin, scope, detail, own, inputs: meetingFormValues(form) };
  if (invite && own) form.elements.attendees.focus();
}
function meetingFormValues(form) {
  return Object.fromEntries(['title', 'start', 'end', 'location', 'attendees', 'optionalAttendees', 'body', 'allDay', 'reminderSet', 'reminder', 'showAs', 'sensitivity'].map(key => [key, ['allDay', 'reminderSet'].includes(key) ? form.elements[key].checked : key === 'reminder' ? Number(form.elements[key].value) : form.elements[key].value]));
}
async function submitMeetingEdit(form) {
  const edit = meetingEdit;
  await submitForm(form, async () => {
    const values = meetingFormValues(form), changes = {};
    for (const [key, value] of Object.entries(values)) if (!form.elements[key].disabled && value !== edit.inputs[key]) changes[key] = ['start', 'end'].includes(key) ? T.fromWall(value, timeZone).toISOString() : value;
    if (!Object.keys(changes).length) { toast('Изменений нет'); return; }
    await saveMeetingChanges(edit, changes);
  });
}
async function submitMeetingReminder(form) {
  const edit = meetingEdit;
  await submitForm(form, async data => {
    const enabled = data.lead !== 'off', changes = {};
    if (enabled !== edit.detail.reminderSet) changes.reminderSet = enabled;
    if (enabled && Number(data.lead) !== edit.detail.reminder) changes.reminder = Number(data.lead);
    if (!Object.keys(changes).length) { $('#modal').close(); toast('Изменений нет'); return; }
    await saveMeetingChanges(edit, changes);
  });
}
async function saveMeetingChanges(edit, changes) {
  if (state.demo) {
    for (const e of window.asterDemo.events.filter(e => edit.scope === 'series' && edit.origin.seriesId ? e.seriesId === edit.origin.seriesId : e.id === edit.origin.id)) {
      const startDelta = changes.start ? Date.parse(changes.start) - Date.parse(edit.detail.start) : 0, endDelta = changes.end ? Date.parse(changes.end) - Date.parse(edit.detail.end) : 0;
      Object.assign(e, Object.fromEntries(Object.entries(changes).filter(([key]) => !['start', 'end', 'attendees', 'optionalAttendees'].includes(key))));
      if (changes.body !== undefined) e.html = '';
      if (changes.start) e.start = new Date(Date.parse(e.start) + startDelta).toISOString();
      if (changes.end) e.end = new Date(Date.parse(e.end) + endDelta).toISOString();
      for (const [key, role] of [['attendees', 'required'], ['optionalAttendees', 'optional']]) if (changes[key] !== undefined) e.attendees = [...(e.attendees || []).filter(a => a.role !== role), ...changes[key].split(/[,;]/).map(email => email.trim()).filter(Boolean).map(email => ({ email, name: email, role, response: 'Unknown' }))];
    }
  } else await api('updateEvent', { ref: ref(edit.origin), scope: edit.scope, expectedChangeKey: edit.detail.changeKey, changes });
  $('#modal').close(); toast(state.demo ? 'Демо: встреча обновлена' : 'Изменения сохранены в Exchange'); await loadView();
}

function meetingMessage(kind) {
  const e = activeMeeting, scope = meetingScope();
  modal(kind === 'forward' ? 'Переслать встречу' : kind === 'reply-all' ? 'Ответить всем участникам' : 'Ответить организатору', `${e.title} · ${scope === 'series' ? 'весь ряд' : 'выбранная встреча'}`, `<form id="meeting-message-form" data-kind="${kind}" data-scope="${scope}">${kind === 'forward' ? field('to', 'Кому · email через запятую', '', 'text', true) : `<p class="form-note">${kind === 'reply-all' ? 'Exchange направит ответ организатору и участникам встречи.' : `Получатель: ${esc(e.organizer.name || e.organizer.email)}`}</p>`}${textField('body', 'Сообщение')}<p class="form-note">${kind === 'forward' ? 'Exchange перешлёт приглашение с исходной встречей и вложениями. Организатор может запретить пересылку.' : 'Это письмо в обсуждении встречи. Ваш статус участия не изменится.'}</p>${formError()}<div class="modal-footer"><button type="button" class="secondary" data-action="meeting-return">Назад</button><button type="submit" class="primary">${icon('send')}Отправить</button></div></form>`);
}
async function submitMeetingMessage(form) {
  const e = activeMeeting;
  await submitForm(form, async data => {
    if (!state.demo) await api('eventMessage', { ref: ref(e.origin), scope: form.dataset.scope, kind: form.dataset.kind, to: data.to || '', body: data.body || '' });
    $('#modal').close(); toast(state.demo ? 'Демо: сообщение не отправлялось' : 'Сообщение отправлено');
  });
}
async function handleMeetingAction(button) {
  const action = button.dataset.action;
  if (action === 'meeting-return') return openMeeting(activeMeeting?.origin || meetingEdit?.origin);
  if (!activeMeeting?.id) return;
  if (action === 'meeting-edit' || action === 'meeting-invite') return editMeeting(action === 'meeting-invite');
  if (action === 'meeting-join') {
    if (state.demo) return toast('Демо: ссылка на созвон не открывалась');
    button.disabled = true;
    try { await api('joinEvent', ref(activeMeeting)); } finally { button.disabled = false; }
    return;
  }
  const kind = { 'meeting-reply': 'reply', 'meeting-reply-all': 'reply-all', 'meeting-forward': 'forward' }[action];
  if (kind) return meetingMessage(kind);
}
let meetingPointerOutside = false;
document.addEventListener('pointerdown', event => { const dialog = document.querySelector('#modal'); if (!dialog?.open) return; const r = dialog.getBoundingClientRect(); meetingPointerOutside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; });
document.addEventListener('click', event => {
  const dialog = document.querySelector('#modal');
  if (dialog?.open && dialog.dataset.meetingCard === 'true' && event.target === dialog && meetingPointerOutside && !modalBusy) { ++meetingRequest; dialog.close(); }
  meetingPointerOutside = false;
});

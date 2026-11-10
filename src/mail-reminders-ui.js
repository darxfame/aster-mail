let demoMailReminders = [];
function mailReminderNotes() {
  return `<p class="form-note">${tr('Напомним, пока Aster запущен и аккаунт подключён, с задержкой до 15 секунд. После сна или запуска пропущенные сроки обрабатываются один раз. Во время демонстрации уведомление откладывается до выхода из режима приватности.')}</p><details class="form-note"><summary>${tr('Хранение и ограничения')}</summary><p>${tr('На этом устройстве зашифрованно сохраняются только идентификатор письма, срок и состояние напоминания. Выход из аккаунта удаляет напоминания. Письмо остаётся в своей папке. Уведомление не содержит темы и текста письма; показ зависит от разрешений системы.')}</p></details>`;
}
function mailReminderModal() {
  const message = state.selected;
  if (!message || isDraftMessage(message) || modalBusy || $('#modal').open) return;
  const account = state.account, demo = state.demo, generation = state.generation, sequence = messageOpenSequence;
  const folder = state.query ? null : state.folder;
  modal(tr('Напомнить позже'), tr('Выберите, когда вернуться к этому письму.'), `<form id="mail-reminder-form"><p>${esc(message.subject)}</p>${field('due', tr('Время напоминания'), T.wall(new Date(Date.now() + 3600000), timeZone).slice(0, 16), 'datetime-local', true)}<p class="form-note">${tr('Часовой пояс:')} ${esc(timeZone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone)}</p><label class="check"><input type="checkbox" name="unread"> ${tr('Сразу пометить письмо непрочитанным и вернуться к списку')}</label>${mailReminderNotes()}${formError()}<button type="submit" class="primary">${tr('Сохранить напоминание')}</button></form>`);
  const form = $('#mail-reminder-form');
  const current = () => form.isConnected && $('#modal').open && account === state.account && demo === state.demo;
  let saved = false;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (saved || modalBusy) return;
    void submitForm(form, async data => {
      if (!current()) throw new Error(tr('Сессия аккаунта завершена'));
      const due = T.fromWall(data.due, timeZone).toISOString();
      if (Date.parse(due) <= Date.now()) throw new Error(tr('Укажите будущее время напоминания.'));
      if (demo) demoMailReminders = window.asterMailReminders.normalize([...demoMailReminders.filter(entry => entry.id !== message.id), { id: message.id, token: crypto.randomUUID(), due, notifiedAt: null }]);
      else await api('setMailReminder', { id: message.id, due });
      saved = true;
      if (!current()) return;
      // A local schedule and an Exchange write are separate outcomes. Never replay
      // the optional write from a timer, or let an uncertain write resubmit the form.
      form.querySelector('button[type="submit"]').disabled = true;
      form.elements.due.disabled = true; form.elements.unread.disabled = true;
      if (data.unread) {
        try {
          if (readingMessages.has(message.id)) await readingMessages.get(message.id);
          if (!current()) return;
          if (!demo) {
            const fresh = await api('message', { id: message.id, refresh: true });
            if (!current()) return;
            const updated = await api('change', { ref: ref(fresh), field: 'IsRead', value: false });
            if (!current()) return;
            if (generation === state.generation) message.changeKey = updated.changeKey || fresh.changeKey;
          }
          if (generation === state.generation && sequence === messageOpenSequence && state.selected === message) {
            applyMessageRead(message, false, folder); $('#modal').close(); returnToMailList(); renderSidebar();
          }
        } catch (error) {
          if (current()) throw Object.assign(new Error(`${tr('Напоминание сохранено. Не удалось подтвердить пометку непрочитанным. Проверьте письмо в OWA перед повтором.')} ${errorText(error)}`), { userFacing: true });
          return;
        }
      }
      if (current()) $('#modal').close();
      if (account === state.account && demo === state.demo) toast(demo ? tr('Демо: напоминание сохранено только в памяти; системных уведомлений нет.') : tr('Напоминание сохранено.'));
    });
  });
}
function mailRemindersModal() {
  if (!ready() || modalBusy || $('#modal').open) return;
  modal(tr('Напоминания о письмах'), '', `<form id="mail-reminders-form"><div class="waiting-list" aria-live="polite"></div>${formError()}<button type="button" class="secondary" data-reminders-refresh>${tr('Обновить список')}</button>${mailReminderNotes()}</form>`);
  const form = $('#mail-reminders-form'), list = form.querySelector('.waiting-list');
  const account = state.account, demo = state.demo;
  const current = () => form.isConnected && $('#modal').open && account === state.account && demo === state.demo;
  let loadSequence = 0;
  async function load() {
    const request = ++loadSequence;
    let loaded = false;
    await submitForm(form, async () => {
      const value = demo ? { entries: demoMailReminders.map(entry => ({ ...entry, subject: window.asterDemo.messages.find(message => message.id === entry.id)?.subject || '' })), supported: true } : await api('mailReminders');
      if (!current() || request !== loadSequence) return;
      loaded = true;
      list.innerHTML = [...value.entries].sort((a, b) => Date.parse(a.due) - Date.parse(b.due)).map(entry => `<article class="waiting-entry" data-reminder-id="${esc(entry.id)}"><strong>${esc(entry.subject || tr('Письмо'))}</strong><span class="${Date.parse(entry.due) <= Date.now() ? 'waiting-overdue' : 'form-note'}">${entry.notifiedAt ? tr('Напоминание сработало') : Date.parse(entry.due) <= Date.now() ? tr('Пора вернуться к письму') : tr('Запланировано')} · ${esc(dateFormat(entry.due, { dateStyle: 'medium', timeStyle: 'short' }))}</span><div class="waiting-entry-actions"><button type="button" class="secondary" data-reminder-open="${esc(entry.id)}">${tr('Открыть письмо')}</button><button type="button" class="secondary" data-reminder-remove="${esc(entry.id)}" data-token="${esc(entry.token)}">${tr('Удалить напоминание')}</button></div></article>`).join('') || `<p>${tr('Напоминаний пока нет. Откройте письмо и нажмите значок колокольчика «Напомнить позже».')}</p>`;
      if (!value.supported || value.privacyActive || demo) {
        const note = document.createElement('p'); note.className = 'form-note'; note.textContent = demo ? tr('Демо: напоминания только в памяти, без системных уведомлений.') : !value.supported ? tr('Системные уведомления недоступны') : tr('Приватность включена. Системные напоминания отложены.'); list.append(note);
      }
      if (value.error) throw new Error(value.error);
    });
    if (!demo && loaded && current() && request === loadSequence) {
      try {
        const value = await api('mailReminderSubjects');
        if (!current() || request !== loadSequence) return;
        for (const row of list.querySelectorAll('[data-reminder-id]')) {
          const title = value.titles.find(item => item.id === row.dataset.reminderId)?.subject;
          if (title) row.querySelector('strong').textContent = title;
        }
        if (value.error) throw new Error(value.error);
      } catch (error) { if (current() && request === loadSequence) form.querySelector('.form-error').textContent = errorText(error); }
    }
  }
  form.querySelector('[data-reminders-refresh]').addEventListener('click', () => { void load(); });
  list.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || modalBusy || !current()) return;
    void (async () => {
      if (button.dataset.reminderRemove) {
        await submitForm(form, async () => {
          if (demo) demoMailReminders = demoMailReminders.filter(entry => entry.id !== button.dataset.reminderRemove);
          else await api('removeMailReminder', { id: button.dataset.reminderRemove, token: button.dataset.token });
        });
        if (current() && !form.querySelector('.form-error').textContent) await load();
      } else if (button.dataset.reminderOpen) {
        await submitForm(form, async () => {
          const id = button.dataset.reminderOpen;
          const message = demo ? window.asterDemo.messages.find(message => message.id === id) : await api('message', { id });
          if (!message) throw new Error(tr('Письмо не найдено'));
          if (!current()) return;
          const generation = state.generation, sequence = messageOpenSequence;
          $('#modal').close(); state.view = 'mail'; state.selected = null; state.query = ''; state.filter = 'all'; $('#search').value = '';
          state.folder = message.folder || message.parentId || 'inbox'; await loadView();
          if (account !== state.account || demo !== state.demo || generation + 1 !== state.generation || sequence !== messageOpenSequence || $('#modal').open) return;
          if (!state.messages.some(item => item.id === id)) state.messages.push(message);
          await openMessage(id, state.generation, { markRead: false });
        });
      }
    })();
  });
  void load();
}
function receiveMailReminderNavigation(data) {
  if (!data.mailReminders) return false;
  if (state.demo || data.sessionId !== state.account?.sessionId) return true;
  if ($('#modal').open) toast(tr('Напоминание доступно в списке «Напоминания о письмах». Завершите работу с открытым окном.'));
  else mailRemindersModal();
  return true;
}

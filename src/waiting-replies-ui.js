let demoWaitingReplies = [];
function receiveWaitingReplyCount(snapshot) {
  if (state.demo || !state.account?.sessionId || snapshot.sessionId !== state.account.sessionId || !Number.isInteger(snapshot.count) || snapshot.count < 0 || snapshot.count > 30) return;
  updateWaitingReplyCount(snapshot.count);
}
function updateWaitingReplyCount(count) {
  state.waitingRepliesCount = count;
  const badge = document.querySelector('[data-waiting-count]');
  if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
  const button = document.querySelector('[data-action="waiting-replies"]');
  if (button) button.setAttribute('aria-label', `${tr('Жду ответа')}${count ? ` · ${count}` : ''}`);
}
async function refreshWaitingReplyCount() {
  const account = state.account, demo = state.demo;
  try {
    const count = demo ? demoWaitingReplies.filter(entry => !entry.replyId).length : account ? await api('waitingRepliesCount') : 0;
    if (account === state.account && demo === state.demo) updateWaitingReplyCount(count);
  } catch { /* The list reports storage errors; badge failures do not block login. */ }
}
function isSentMessage(message) {
  return !isDraftMessage(message) && (message.folder === 'sentitems' || state.folders.some(folder => folder.wellKnown === 'sentitems' && folder.id === message.parentId));
}
function waitingNotes() {
  return `<p class="form-note">${tr('Ответы ищем среди последних 50 писем во «Входящих». Другие папки и вся история не проверяются.')}</p><details class="form-note"><summary>${tr('Хранение и ограничения')}</summary><p>${tr('Ожидания зашифрованы на этом устройстве; темы и текст писем не сохраняются. Выход из аккаунта удаляет ожидания. Проверки работают, пока Aster открыт, и возобновляются после сна. Срок виден в списке; системных напоминаний пока нет.')}</p><p>${tr('Совпадения темы недостаточно. Распознанные автоответы и собственные письма не считаются ответом. Найденный ответ не означает, что ответили все участники.')}</p></details>`;
}
function waitForReplyModal() {
  const message = state.selected;
  if (!message || !isSentMessage(message) || modalBusy || $('#modal').open) return;
  const account = state.account, demo = state.demo;
  modal(tr('Жду ответа'), tr('Отметьте отправленное письмо и выберите срок.'), `<form id="waiting-reply-form"><p>${esc(message.subject)}</p>${field('due', tr('Срок ожидания'), T.wall(new Date(Date.now() + 86400000), timeZone).slice(0, 16), 'datetime-local', true)}<p class="form-note">${tr('Часовой пояс:')} ${esc(timeZone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone)}</p>${waitingNotes()}${formError()}<button class="primary" type="submit">${tr('Ждать ответа')}</button></form>`);
  const form = $('#waiting-reply-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    void submitForm(form, async data => {
      if (account !== state.account || demo !== state.demo) throw new Error(tr('Сессия аккаунта завершена'));
      const due = T.fromWall(data.due, timeZone).toISOString();
      if (Date.parse(due) <= Date.now()) throw new Error(tr('Укажите будущий срок ожидания.'));
      if (demo) demoWaitingReplies = window.asterWaitingReplies.normalize([...demoWaitingReplies.filter(entry => entry.id !== message.id), { id: message.id, internetId: message.internetId || `<${message.id}@example.com>`, sentAt: message.date, due, replyId: demoWaitingReplies.find(entry => entry.id === message.id)?.replyId || null }]);
      else await api('waitForReply', { id: message.id, due });
      if (!form.isConnected || account !== state.account || demo !== state.demo) return;
      $('#modal').close(); void refreshWaitingReplyCount(); toast(tr('Письмо добавлено в ожидания ответа.'));
    });
  });
}
function waitingRepliesModal() {
  if (!ready() || modalBusy || $('#modal').open) return;
  modal(tr('Жду ответа'), tr('Отправленные письма, для которых вы ожидаете ответ.'), `<form id="waiting-list-form"><div class="waiting-list" aria-live="polite"></div>${formError()}<button type="button" class="secondary" data-waiting-refresh>${tr('Проверить ответы')}</button>${waitingNotes()}</form>`);
  const form = $('#waiting-list-form'), list = form.querySelector('.waiting-list');
  const account = state.account, demo = state.demo;
  const current = () => form.isConnected && account === state.account && demo === state.demo;
  let followupRequest = 0;
  async function load(refresh = false) {
    followupRequest++;
    await submitForm(form, async () => {
      let result;
      if (demo) {
        demoWaitingReplies = demoWaitingReplies.map(entry => {
          const reply = window.asterDemo.messages.filter(message => message.folder === 'inbox').sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 50).find(message => window.asterWaitingReplies.replyTo(entry, message));
          return reply ? { ...entry, replyId: reply.id } : entry;
        });
        result = { entries: demoWaitingReplies.map(entry => ({ ...entry, subject: window.asterDemo.messages.find(message => message.id === entry.id)?.subject || '' })), checkedAt: new Date().toISOString() };
      } else result = await api(refresh ? 'refreshWaitingReplies' : 'waitingReplies');
      if (!current()) return;
      updateWaitingReplyCount(result.entries.filter(entry => !entry.replyId).length);
      const entries = [...result.entries].sort((a, b) => Boolean(a.replyId) - Boolean(b.replyId) || Date.parse(a.due) - Date.parse(b.due));
      list.innerHTML = entries.length ? entries.map(entry => `<article class="waiting-entry"><strong>${esc(entry.subject || tr('Отправленное письмо'))}</strong><span class="${!entry.replyId && Date.parse(entry.due) <= Date.now() ? 'waiting-overdue' : 'form-note'}">${entry.replyId ? tr('Найден ответ') : Date.parse(entry.due) <= Date.now() ? tr('Срок ожидания истёк') : tr('Ожидается ответ')} · ${esc(dateFormat(entry.due, { dateStyle: 'medium', timeStyle: 'short' }))}</span><div class="waiting-entry-actions">${!entry.replyId ? `<button type="button" class="secondary" data-waiting-followup="${esc(entry.id)}">${tr('Напомнить об ответе')}</button>` : ''}<button type="button" class="secondary" data-waiting-open="${esc(entry.id)}">${tr('Открыть письмо')}</button>${entry.replyId ? `<button type="button" class="secondary" data-waiting-open="${esc(entry.replyId)}">${tr('Открыть ответ')}</button>` : ''}<button type="button" class="secondary" data-waiting-remove="${esc(entry.id)}">${tr('Снять ожидание')}</button></div></article>`).join('') : `<p>${tr('Ожиданий пока нет. Откройте отправленное письмо и нажмите значок часов «Жду ответа».')}</p>`;
      const status = document.createElement('p'); status.className = 'form-note';
      status.textContent = result.checkedAt ? `${tr('Последняя проверка:')} ${dateFormat(result.checkedAt, { dateStyle: 'medium', timeStyle: 'short' })}` : tr('Ответы ещё не проверены.'); list.append(status);
      if (result.error || result.sourceError) throw new Error([result.error, result.sourceError].filter(Boolean).join('\n'));
    });
  }
  form.querySelector('[data-waiting-refresh]').addEventListener('click', () => { void load(true); });
  list.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || modalBusy || !current()) return;
    const request = ++followupRequest;
    if (button.dataset.waitingFollowup) {
      button.disabled = true;
      const active = () => current() && $('#modal').open && button.isConnected && request === followupRequest;
      void (async () => {
        try {
          const id = button.dataset.waitingFollowup;
          const message = demo ? structuredClone(window.asterDemo.messages.find(message => message.id === id)) : await api('message', { id, refresh: true });
          if (!active()) return;
          if (!message || message.id !== id || message.isDraft === true || message.folder === 'drafts' || state.folders.some(folder => folder.wellKnown === 'drafts' && folder.id === message.parentId) || [...(message.to || []), ...(message.cc || [])].some(person => !person.email) || !window.asterRecipients.reply(message, [], true, true).to) throw new Error(tr('Не удалось определить адресатов напоминания. Откройте исходное письмо и проверьте адреса.'));
          await compose('reply-all', null, null, { message, sent: true, current: active, text: tr('Здравствуйте!\n\nОтвета на моё предыдущее письмо пока нет. Подскажите, пожалуйста, когда сможете ответить?\n\nСпасибо!') });
        } catch (error) { if (active()) form.querySelector('.form-error').textContent = errorText(error); }
        finally { if (button.isConnected) button.disabled = false; }
      })();
      return;
    }
    void (async () => {
      if (button.dataset.waitingRemove) {
        await submitForm(form, async () => {
          if (demo) demoWaitingReplies = demoWaitingReplies.filter(entry => entry.id !== button.dataset.waitingRemove);
          else await api('removeWaitingReply', { id: button.dataset.waitingRemove });
        });
        if (current() && !form.querySelector('.form-error').textContent) await load();
      } else if (button.dataset.waitingOpen) {
        await submitForm(form, async () => {
          const id = button.dataset.waitingOpen;
          const message = demo ? window.asterDemo.messages.find(message => message.id === id) : await api('message', { id });
          if (!message) throw new Error(tr('Письмо не найдено'));
          if (!current()) return;
          const generation = state.generation, sequence = messageOpenSequence;
          $('#modal').close();
          state.view = 'mail'; state.selected = null; state.query = ''; state.filter = 'all'; $('#search').value = '';
          state.folder = resultFolder(message, id);
          await loadView();
          if (account !== state.account || demo !== state.demo || generation + 1 !== state.generation || sequence !== messageOpenSequence || $('#modal').open) return;
          if (!state.messages.some(item => item.id === id)) state.messages.push(message);
          await openMessage(id, state.generation, { markRead: false });
        });
      }
    })();
  });
  function resultFolder(message, id) { return demoWaitingReplies.some(entry => entry.id === id) || message.folder === 'sentitems' || state.folders.some(folder => folder.wellKnown === 'sentitems' && folder.id === message.parentId) ? 'sentitems' : 'inbox'; }
  void load();
}

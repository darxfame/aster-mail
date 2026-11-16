function mailRulesMarkup() {
  return `<h3 class="settings-section-title">${tr('Правила входящей почты')}</h3><p class="form-note">${tr('Правила применяются к новым письмам. Сложные правила и правила Outlook доступны только для просмотра. Изменения сохраняются отдельно.')}</p><button type="button" class="secondary" data-rules-load>${tr('Загрузить из Exchange')}</button> <button type="button" class="secondary" data-rules-new disabled>${tr('Создать правило')}</button><p data-rules-status role="status"></p>${formError()}<div data-rules-list></div><fieldset data-rules-editor hidden disabled></fieldset>`;
}
function setupMailRules(panel) {
  const account = state.account, demo = state.demo, form = panel.closest('form');
  const load = panel.querySelector('[data-rules-load]'), add = panel.querySelector('[data-rules-new]'), list = panel.querySelector('[data-rules-list]'), editor = panel.querySelector('[data-rules-editor]'), status = panel.querySelector('[role="status"]'), errorBox = panel.querySelector('[role="alert"]');
  let items = [], folders = [], selected, sequence = 0, pending = false;
  const current = () => panel.isConnected && state.account === account && state.demo === demo;
  const dirty = value => { panel.dataset.dirty = String(value); setModalDirty(value || form.querySelector('#settings-panel-auto-replies')?.dataset.dirty === 'true'); };
  const discard = () => panel.dataset.dirty !== 'true' || confirm(tr('Отменить несохранённые изменения правила?'));
  const render = () => {
    list.innerHTML = items.length ? items.map((rule, index) => `<p><button type="button" class="secondary" data-rule-index="${index}">${esc(rule.name)} · ${rule.priority} · ${rule.enabled ? tr('Включено') : tr('Выключено')}${rule.editable ? '' : ` · ${tr('Только просмотр')}`}</button></p>`).join('') : `<p class="form-note">${tr('Правил пока нет')}</p>`;
  };
  const edit = rule => {
    selected = rule; dirty(false); editor.hidden = false; editor.disabled = !rule.editable;
    editor.innerHTML = `${field('ruleName', tr('Название правила'), rule.name)}<div class="form-row">${field('ruleSender', tr('Отправитель'), rule.sender)}${field('ruleSubject', tr('Тема содержит · необязательно'), rule.subject)}</div><label class="field"><span>${tr('Перемещать в папку')}</span><select name="ruleFolder"><option value="">${tr('Не перемещать')}</option>${folders.map(folder => `<option value="${esc(folder.id)}" ${[folder.id, folder.wellKnown].includes(rule.folder) ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}${rule.folder && !folders.some(folder => [folder.id, folder.wellKnown].includes(rule.folder)) ? `<option value="${esc(rule.folder)}" selected>${esc(rule.folder)}</option>` : ''}</select></label><label class="checkbox"><input type="checkbox" name="ruleRead" ${rule.markRead ? 'checked' : ''}>${tr('Отмечать как прочитанное')}</label>${rule.id ? `<label class="checkbox"><input type="checkbox" name="ruleEnabled" ${rule.enabled ? 'checked' : ''}>${tr('Включено')}</label>${field('rulePriority', tr('Приоритет правила'), rule.priority, 'number')}` : ''}<button type="button" class="primary" data-rule-save>${tr('Сохранить правило в Exchange')}</button> ${rule.id ? `<button type="button" class="secondary danger" data-rule-delete>${tr('Удалить правило')}</button>` : ''}`;
    if (!rule.editable) status.textContent = tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.');
  };
  panel.addEventListener('input', event => { if (editor.contains(event.target)) dirty(true); });
  panel.addEventListener('keydown', event => { if (event.key === 'Enter' && editor.contains(event.target) && event.target.tagName === 'INPUT') { event.preventDefault(); editor.querySelector('[data-rule-save]')?.click(); } });
  load.onclick = async () => {
    if (!current() || pending || modalBusy || !discard()) return;
    const request = ++sequence;
    load.disabled = true; add.disabled = true; editor.disabled = true; list.innerHTML = ''; errorBox.textContent = ''; status.textContent = tr('Загрузка…');
    try {
      const configuration = demo ? { items: [{ id: 'demo-rule', revision: 'demo', name: tr('Демо: письма от коллеги'), sender: 'anna@example.test', subject: '', folder: '', markRead: true, enabled: true, priority: 0, editable: true }] } : await api('mailRules');
      const receivedFolders = demo ? state.folders : await api('folders');
      if (!current() || request !== sequence) return;
      items = configuration.items; folders = receivedFolders; editor.hidden = true; selected = null; dirty(false); render();
      add.disabled = Boolean(configuration.outlookRuleBlobExists);
      status.textContent = configuration.outlookRuleBlobExists ? tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.') : demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Текущие настройки загружены из Exchange.');
    } catch (error) { if (current() && request === sequence) { status.textContent = ''; errorBox.textContent = errorText(error); } }
    finally { if (current() && request === sequence) load.disabled = false; }
  };
  add.onclick = () => { if (!pending && !modalBusy && discard()) edit({ name: '', sender: '', subject: '', folder: '', markRead: true, editable: true }); };
  panel.addEventListener('click', event => {
    const row = event.target.closest('[data-rule-index]');
    if (row && !pending && !modalBusy && discard()) edit(items[Number(row.dataset.ruleIndex)]);
    const save = event.target.closest('[data-rule-save]'), remove = event.target.closest('[data-rule-delete]');
    if ((!save && !remove) || !current() || !selected?.editable || editor.disabled || pending || modalBusy) return;
    if (remove && !confirm(`${tr('Удалить правило?')}\n${selected.name}`)) return;
    const fields = form.elements;
    const changes = { name: fields.ruleName.value, sender: fields.ruleSender.value, subject: fields.ruleSubject.value, folder: fields.ruleFolder.value, markRead: fields.ruleRead.checked, ...(selected.id ? { enabled: fields.ruleEnabled.checked, priority: Number(fields.rulePriority.value) } : {}) };
    if (save && (!changes.name.trim() || !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(changes.sender) || !changes.folder && !changes.markRead || changes.name.length > 100 || changes.subject.length > 200 || selected.id && (!Number.isSafeInteger(changes.priority) || changes.priority < 0 || changes.priority > 2147483647))) { errorBox.textContent = tr('Укажите имя правила, отправителя и действие: перенос или отметку прочитанным'); return; }
    const snapshot = selected;
    pending = true;
    void submitForm(form, async () => {
      errorBox.textContent = ''; editor.disabled = true; load.disabled = true; add.disabled = true; list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        if (!demo) {
          if (snapshot.id) await api('changeMailRule', { id: snapshot.id, revision: snapshot.revision, action: remove ? 'delete' : 'update', ...(remove ? {} : { changes }) });
          else await api('createMailRule', { ...changes, ...(changes.folder ? {} : { folder: undefined }) });
        }
        if (!current()) return;
        dirty(false); status.textContent = demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Правило сохранено. Загрузите список заново.');
      } catch (error) {
        if (current()) { dirty(false); errorBox.textContent = errorText(error); status.textContent = tr('Перед следующим сохранением загрузите настройки из Exchange заново.'); }
      } finally { pending = false; if (current()) load.disabled = false; }
    });
  });
  if (!account && !demo) { load.disabled = true; status.textContent = tr('Сначала подключите аккаунт OWA'); }
}

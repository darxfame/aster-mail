let demoRules = [{ id: 'demo-rule', revision: 'demo', name: null, sender: 'anna@example.test', subject: '', folder: '', markRead: true, enabled: true, priority: 0, editable: true }];

function mailRulesMarkup() {
  return `<h3 class="settings-section-title">${tr('Правила входящей почты')}</h3>
    <p class="form-note">${tr('Правила применяются к новым письмам по порядку. Изменения сохраняются отдельно в Exchange.')}</p>
    <div class="rules-actions"><button type="button" class="primary" data-rules-new disabled>${tr('Создать правило')}</button><button type="button" class="secondary" data-rules-load>${tr('Загрузить из Exchange')}</button></div>
    <p class="form-note" data-rules-status role="status"></p>${formError()}
    <div data-rules-list></div><fieldset data-rules-editor hidden disabled></fieldset>`;
}
function describeMailRule(rule, folders) {
  const names = { FromAddresses: 'Отправитель', ContainsSubjectStrings: 'Тема содержит', MarkAsRead: 'Отмечать как прочитанное', MoveToFolder: 'Перемещать в папку', CopyToFolder: 'Копировать в папку', Delete: 'Удалить письмо', StopProcessingRules: 'Остановить обработку правил', SentToAddresses: 'Получатель', ContainsBodyStrings: 'Текст содержит', ForwardToRecipients: 'Переслать получателям', RedirectToRecipients: 'Перенаправить получателям' };
  return [['conditions', 'Условия'], ['exceptions', 'Исключения'], ['actions', 'Действия']].map(([key, label]) => {
    const details = rule.details?.[key] || [];
    if (!details.length) return '';
    return `<h4>${tr(label)}</h4><dl class="rule-details">${details.map(({ key, values }) => {
      const display = values.map(value => ['MoveToFolder', 'CopyToFolder'].includes(key) ? folders.find(folder => [folder.id, folder.wellKnown].includes(value))?.name || value : value);
      return `<dt>${esc(Object.hasOwn(names, key) ? tr(names[key]) : key)}</dt><dd>${esc(display.join(', '))}</dd>`;
    }).join('')}</dl>`;
  }).join('');
}
function setupMailRules(panel) {
  const account = state.account, demo = state.demo, form = panel.closest('form');
  const load = panel.querySelector('[data-rules-load]'), add = panel.querySelector('[data-rules-new]'), list = panel.querySelector('[data-rules-list]'), editor = panel.querySelector('[data-rules-editor]'), status = panel.querySelector('[role="status"]'), errorBox = panel.querySelector('[role="alert"]');
  let items = [], folders = [], selected, pending = false, blocked = false;
  const current = () => panel.isConnected && $('#modal').open && state.account === account && state.demo === demo;
  const dirty = value => { panel.dataset.dirty = String(value); setModalDirty(value || form.querySelector('#settings-panel-auto-replies')?.dataset.dirty === 'true'); };
  const discard = () => panel.dataset.dirty !== 'true' || confirm(tr('Отменить несохранённые изменения правила?'));
  const render = () => {
    list.innerHTML = items.length ? items.map((rule, index) => `<button type="button" class="secondary" data-rule-index="${index}" aria-pressed="${rule.id === selected?.id}"><strong>${esc(rule.name)}</strong><span>${rule.enabled ? tr('Включено') : tr('Выключено')}${rule.editable ? '' : ` · ${tr('Только просмотр')}`}</span></button>`).join('') : `<p class="form-note">${tr('Правил пока нет')}</p>`;
  };
  const folderPicker = (name, label, value) => {
    const options = folders.map(folder => {
      const id = value && folder.wellKnown === value ? folder.wellKnown : folder.id;
      return `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(folder.name)}</option>`;
    });
    if (value && !folders.some(folder => folder.id === value || folder.wellKnown === value)) options.push(`<option value="${esc(value)}" selected>${esc(value)}</option>`);
    return `<label class="field"><span>${tr(label)}</span><select name="${name}"><option value="">${tr('Выберите папку · необязательно')}</option>${options.join('')}</select></label>`;
  };
  const edit = rule => {
    selected = rule; dirty(false); editor.hidden = !rule; editor.disabled = !rule?.editable;
    for (const button of list.querySelectorAll('[data-rule-index]')) button.setAttribute('aria-pressed', String(Boolean(rule?.id && items[Number(button.dataset.ruleIndex)]?.id === rule.id)));
    if (!rule) { editor.replaceChildren(); return; }
    const heading = `<legend>${rule.id ? esc(rule.name) : tr('Новое правило')}</legend>`;
    if (!rule.editable) {
      editor.innerHTML = heading + `<p class="form-note">${tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.')}</p>${describeMailRule(rule, folders)}`;
      return;
    }
    editor.innerHTML = heading + `${field('ruleName', tr('Название правила'), rule.name)}
      <h4>${tr('Условия')}</h4>${field('ruleSender', tr('Отправители · адреса через запятую'), rule.sender)}<div class="form-row">${field('ruleSubject', tr('Тема содержит'), rule.subject)}${field('ruleBody', tr('Текст содержит'), rule.body)}</div>
      <h4>${tr('Исключения')}</h4>${field('ruleExceptSubject', tr('Не применять, если тема содержит'), rule.exceptSubject)}
      <h4>${tr('Действия')}</h4><div class="form-row">${folderPicker('ruleFolder', 'Перемещать в папку', rule.folder)}${folderPicker('ruleCopyFolder', 'Копировать в папку', rule.copyFolder)}</div>
      <label class="checkbox"><input type="checkbox" name="ruleRead" ${rule.markRead ? 'checked' : ''}>${tr('Отмечать как прочитанное')}</label><label class="checkbox"><input type="checkbox" name="ruleStop" ${rule.stopProcessing ? 'checked' : ''}>${tr('Остановить обработку правил')}</label>
      ${rule.id ? `<div class="form-row"><label class="checkbox"><input type="checkbox" name="ruleEnabled" ${rule.enabled ? 'checked' : ''}>${tr('Включено')}</label>${field('rulePriority', tr('Приоритет правила'), rule.priority, 'number')}</div>` : ''}
      <div class="rules-actions"><button type="button" class="primary" data-rule-save>${tr('Сохранить правило в Exchange')}</button><button type="button" class="secondary" data-rule-cancel>${tr('Отмена')}</button>${rule.id ? `<button type="button" class="secondary danger" data-rule-delete>${tr('Удалить правило')}</button>` : ''}</div>`;
    form.elements.ruleName.maxLength = 100;
    for (const name of ['ruleSubject', 'ruleBody', 'ruleExceptSubject']) form.elements[name].maxLength = 200;

  };
  const fetchRules = async () => {
    const configuration = demo ? { items: demoRules.map(rule => ({ ...rule, name: rule.name ?? tr('Демо: письма от коллеги') })).sort((a, b) => a.priority - b.priority) } : await api('mailRules');
    if (!current()) return;
    items = configuration.items; blocked = Boolean(configuration.outlookRuleBlobExists);
  };
  const loadFolders = async () => {
    if (demo) return state.folders;
    try { return await api('folders'); }
    catch { return state.folders; } // Rules remain usable if folder names cannot be refreshed.
  };
  const reload = async () => {
    if (!current() || pending || modalBusy || !discard()) return;
    pending = true; load.disabled = true; add.disabled = true; editor.disabled = true;
    errorBox.textContent = ''; status.textContent = tr('Загрузка…');
    try {
      const [, receivedFolders] = await Promise.all([fetchRules(), loadFolders()]);
      if (!current()) return;
      folders = receivedFolders; edit(null); render(); add.disabled = blocked;
      status.textContent = blocked ? tr('Это правило защищено от изменений в Aster. Используйте OWA или Outlook.') : demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Текущие настройки загружены из Exchange.');
    } catch (error) { if (current()) { list.replaceChildren(); status.textContent = ''; errorBox.textContent = errorText(error); } }
    finally { pending = false; if (current()) load.disabled = false; }
  };
  load.onclick = reload;
  add.onclick = () => {
    if (!pending && !modalBusy && discard()) {
      errorBox.textContent = ''; edit({ name: '', sender: '', subject: '', folder: '', markRead: true, editable: true });
      form.elements.ruleName.focus();
    }
  };
  panel.addEventListener('input', event => { if (editor.contains(event.target)) dirty(true); });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Enter' && editor.contains(event.target) && event.target.tagName === 'INPUT') {
      event.preventDefault(); editor.querySelector('[data-rule-save]')?.click();
    }
  });
  panel.addEventListener('click', event => {
    if (pending || modalBusy || !current()) return;
    const row = event.target.closest('[data-rule-index]'), cancel = event.target.closest('[data-rule-cancel]');
    if ((row || cancel) && discard()) {
      errorBox.textContent = ''; edit(row ? items[Number(row.dataset.ruleIndex)] : null);
      if (cancel) add.focus();
      return;
    }
    const save = event.target.closest('[data-rule-save]'), remove = event.target.closest('[data-rule-delete]');
    if ((!save && !remove) || !selected?.editable || editor.disabled) return;
    if (remove && !confirm(`${tr('Удалить правило?')}\n${selected.name}`)) return;
    const fields = form.elements;
    const changes = {
      name: fields.ruleName.value.trim(), sender: fields.ruleSender.value.trim(), subject: fields.ruleSubject.value.trim(),
      body: fields.ruleBody.value.trim(), exceptSubject: fields.ruleExceptSubject.value.trim(),
      folder: fields.ruleFolder.value, copyFolder: fields.ruleCopyFolder.value,
      markRead: fields.ruleRead.checked, stopProcessing: fields.ruleStop.checked,
      ...(selected.id ? { enabled: fields.ruleEnabled.checked, priority: fields.rulePriority.valueAsNumber } : {}),
    };
    const addresses = changes.sender.split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
    if (save && (!changes.name || changes.name.length > 100 || addresses.length > 20 || addresses.some(value => !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(value)) ||
      !addresses.length && !changes.subject && !changes.body || [changes.subject, changes.body, changes.exceptSubject].some(value => value.length > 200) ||
      !changes.folder && !changes.copyFolder && !changes.markRead && !changes.stopProcessing ||
      selected.id && (!Number.isSafeInteger(changes.priority) || changes.priority < 0 || changes.priority > 2147483647))) {
      errorBox.textContent = tr('Укажите название, хотя бы одно условие и действие правила.'); return;
    }
    const snapshot = selected;
    pending = true;
    void submitForm(form, async () => {
      errorBox.textContent = ''; editor.disabled = true; load.disabled = true; add.disabled = true;
      list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        if (demo) {
          if (remove) demoRules = demoRules.filter(rule => rule.id !== snapshot.id);
          else if (snapshot.id) demoRules = demoRules.map(rule => rule.id === snapshot.id ? { ...rule, ...changes } : rule);
          else demoRules.push({ ...changes, id: crypto.randomUUID(), revision: 'demo', enabled: true, editable: true, priority: Math.max(-1, ...demoRules.map(rule => rule.priority)) + 1 });
        } else if (snapshot.id) await api('changeMailRule', { id: snapshot.id, revision: snapshot.revision, action: remove ? 'delete' : 'update', ...(remove ? {} : { changes }) });
        else await api('createMailRule', { ...changes, folder: changes.folder || undefined });
      } catch (error) {
        if (current()) {
          errorBox.textContent = errorText(error);
          status.textContent = tr('Перед следующим сохранением загрузите настройки из Exchange заново.');
        }
        pending = false; if (current()) load.disabled = false;
        return;
      }
      if (!current()) { pending = false; return; }
      dirty(false);
      status.textContent = remove ? tr('Правило удалено.') : tr('Правило сохранено.');
      try {
        await fetchRules();
        if (!current()) return;
        edit(null); render(); add.disabled = blocked;
      } catch (error) {
        if (current()) errorBox.textContent = `${tr('Не удалось обновить список правил.')} ${errorText(error)}`;
      } finally { pending = false; if (current()) load.disabled = false; }
    });
  });
  if (!account && !demo) { load.disabled = true; status.textContent = tr('Сначала подключите аккаунт OWA'); }
}

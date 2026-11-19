let demoRules = [{ id: 'demo-rule', revision: 'demo', name: null, sender: 'anna@example.test', subject: '', folder: '', markRead: true, enabled: true, priority: 0, editable: true }];

function mailRuleReadOnlyReason(reason) {
  if (reason === 'outlook') return tr('В ящике есть клиентские правила Outlook. Редактируйте правила через OWA или Outlook, чтобы сохранить их.');
  if (reason === 'server') return tr('Exchange сообщает, что правило повреждено или недоступно через EWS. Проверьте его в OWA или Outlook.');
  return tr('В этом правиле есть условия или действия, которые Aster пока не редактирует. Откройте правило в OWA или Outlook.');
}
function mailRulesMarkup() {
  return `<div data-rules-intro><h3 class="settings-section-title">${tr('Правила входящей почты')}</h3>
    <p class="form-note">${tr('Правила применяются к новым письмам по порядку. Изменения сохраняются отдельно в Exchange.')}</p></div>
    <div class="rules-actions" data-rules-toolbar><button type="button" class="primary" data-rules-new disabled>${tr('Создать правило')}</button><button type="button" class="secondary" data-rules-load>${tr('Загрузить из Exchange')}</button>${state.account?.server && !state.demo ? `<button type="button" class="secondary" data-rules-owa>${tr('Открыть OWA')}</button>` : ''}</div>
    <p class="form-note" data-rules-status role="status"></p>${formError()}
    <div data-rules-list></div>
    <section class="rules-detail" data-rules-detail hidden>
      <button type="button" class="secondary rules-back" data-rule-cancel>${icon('reply')}${tr('К списку правил')}</button>
      <fieldset data-rules-editor hidden disabled></fieldset>
    </section>`;
}
function describeMailRule(rule, folders) {
  const names = { FromAddresses: 'Отправитель', ContainsSubjectStrings: 'Тема содержит', MarkAsRead: 'Отмечать как прочитанное', MoveToFolder: 'Перемещать в папку', CopyToFolder: 'Копировать в папку', Delete: 'Удалить письмо', StopProcessingRules: 'Остановить обработку правил', SentToAddresses: 'Получатель', SentOnlyToMe: 'Адресовано только мне', HasAttachments: 'Есть вложения', MarkImportance: 'Задать важность', ContainsBodyStrings: 'Текст содержит', ForwardToRecipients: 'Переслать получателям', RedirectToRecipients: 'Перенаправить получателям' };
  return [['conditions', 'Условия'], ['exceptions', 'Исключения'], ['actions', 'Действия']].map(([key, label]) => {
    const details = rule.details?.[key] || [];
    if (!details.length) return '';
    return `<h4>${tr(label)}</h4><dl class="rule-details">${details.map(({ key, values }) => {
      const display = values.map(value => ['MoveToFolder', 'CopyToFolder'].includes(key) ? folders.find(folder => [folder.id, folder.wellKnown].includes(value))?.name || value : ['MarkAsRead', 'StopProcessingRules', 'SentOnlyToMe', 'HasAttachments'].includes(key) && value === 'true' ? tr('Да') : value);
      return `<dt>${esc(Object.hasOwn(names, key) ? tr(names[key]) : key)}</dt><dd>${esc(display.join(', '))}</dd>`;
    }).join('')}</dl>`;
  }).join('');
}
const ruleSections = [
  ['conditions', 'Условия', 'Добавить условие', [
    ['sender', 'ruleSender', 'Получено от', 'senders'], ['subject', 'ruleSubject', 'Тема содержит', 'phrases'],
    ['body', 'ruleBody', 'Текст содержит', 'phrases'], ['sentOnlyToMe', '', 'Адресовано только мне', 'flag'],
    ['hasAttachments', '', 'Есть вложения', 'flag'],
  ]],
  ['actions', 'Действия', 'Добавить действие', [
    ['folder', 'ruleFolder', 'Перемещать в папку', 'folder'], ['copyFolder', 'ruleCopyFolder', 'Копировать в папку', 'folder'],
    ['markRead', '', 'Отмечать как прочитанное', 'flag'], ['importance', 'ruleImportance', 'Задать важность', 'importance'],
  ]],
  ['exceptions', 'Исключения', 'Добавить исключение', [
    ['exceptSubject', 'ruleExceptSubject', 'Тема содержит', 'phrases'], ['exceptBody', 'ruleExceptBody', 'Текст содержит', 'phrases'],
    ['exceptSentOnlyToMe', '', 'Адресовано только мне', 'flag'], ['exceptHasAttachments', '', 'Есть вложения', 'flag'],
  ]],
];

function setupMailRules(panel) {
  const account = state.account, demo = state.demo, form = panel.closest('form');
  const load = panel.querySelector('[data-rules-load]'), add = panel.querySelector('[data-rules-new]'), list = panel.querySelector('[data-rules-list]'), editor = panel.querySelector('[data-rules-editor]'), status = panel.querySelector('[role="status"]'), errorBox = panel.querySelector('[role="alert"]');
  const detail = panel.querySelector('[data-rules-detail]');
  const intro = panel.querySelector('[data-rules-intro]'), toolbar = panel.querySelector('[data-rules-toolbar]');
  const saveButton = form.querySelector('[data-rule-save]');
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
  const ruleRow = ([key, name, label, type], rule) => {
    const value = rule[key], internal = type === 'senders' ? rule.internalSenders || [] : [];
    const present = Boolean(value || internal.length);
    let control = '';
    if (type === 'senders') {
      const people = internal.length ? `<div class="rules-senders" aria-label="${tr('Отправители из справочника Exchange')}">${internal.map(sender => `<label class="checkbox"><input type="checkbox" name="ruleInternalSender" value="${sender.index}" checked>${esc(sender.name)}</label>`).join('')}</div>` : '';
      control = people + field(name, tr('Имя или email отправителя'), value || '');
    } else if (type === 'phrases') control = `<label class="field"><textarea name="${name}" rows="2" maxlength="4019" aria-label="${tr(label)}" placeholder="${tr('Одна фраза на строку')}">${esc(value)}</textarea></label>`;
    else if (type === 'folder') control = folderPicker(name, label, value);
    else if (type === 'importance') control = `<label class="field"><select name="${name}" aria-label="${tr(label)}"><option value="">${tr('Выберите важность')}</option>${[['Low', 'Низкая'], ['Normal', 'Обычная'], ['High', 'Высокая']].map(([level, text]) => `<option value="${level}" ${level === value ? 'selected' : ''}>${tr(text)}</option>`).join('')}</select></label>`;
    return `<div class="rule-row" data-rule-row="${key}" ${present ? '' : 'hidden'}><div class="rule-row-heading"><strong>${tr(label)}</strong><button type="button" class="icon-button" data-rule-remove aria-label="${esc(`${tr('Убрать из правила')}: ${tr(label)}`)}">${icon('close')}</button></div>${control}</div>`;
  };
  function updateRuleSection(section) {
    const picker = section.querySelector('[data-rule-add]');
    for (const option of picker.options) if (option.value) option.disabled = !section.querySelector(`[data-rule-row="${option.value}"]`).hidden;
    picker.disabled = [...picker.options].slice(1).every(option => option.disabled);
    const empty = section.querySelector('[data-rule-empty]');
    empty.hidden = Boolean(section.querySelector('[data-rule-row]:not([hidden])'));
  }
  const edit = rule => {
    selected = rule; dirty(false); detail.hidden = !rule; editor.hidden = !rule; editor.disabled = !rule?.editable;
    list.hidden = Boolean(rule);
    intro.hidden = Boolean(rule);
    toolbar.hidden = Boolean(rule?.editable);
    saveButton.dataset.editing = String(Boolean(rule?.editable));
    saveButton.hidden = panel.hidden || !rule?.editable;
    saveButton.disabled = !rule?.editable;
    add.hidden = Boolean(rule);
    for (const button of list.querySelectorAll('[data-rule-index]')) button.setAttribute('aria-pressed', String(Boolean(rule?.id && items[Number(button.dataset.ruleIndex)]?.id === rule.id)));
    if (!rule) { editor.replaceChildren(); return; }
    const heading = `<legend>${rule.id ? esc(rule.name) : tr('Новое правило')}</legend>`;
    if (!rule.editable) {
      editor.innerHTML = heading + `<p class="form-note">${mailRuleReadOnlyReason(rule.readOnlyReason)}</p>${describeMailRule(rule, folders)}`;
      return;
    }
    const captions = { conditions: 'Письмо должно отвечать всем условиям', actions: 'Применяются все выбранные действия', exceptions: 'Достаточно одного исключения' };
    editor.innerHTML = heading + `<div class="rule-basics">${field('ruleName', tr('Название правила'), rule.name)}
      ${rule.id ? field('rulePriority', tr('Приоритет правила'), rule.priority, 'number') : ''}
      <label class="checkbox"><input type="checkbox" name="ruleEnabled" ${rule.enabled === false ? '' : 'checked'}>${tr('Включено')}</label>
      </div>${ruleSections.map(([key, label, addLabel, rows]) => `<section class="rule-section" data-rule-section="${key}">
        <header><h4>${tr(label)}</h4><p class="form-note">${tr(captions[key])}</p></header>
        <div class="rule-rows">${rows.map(row => ruleRow(row, rule)).join('')}</div>
        <p class="form-note" data-rule-empty>${tr(key === 'conditions' ? 'Условия пока не добавлены' : key === 'actions' ? 'Действия пока не добавлены' : 'Исключений нет')}</p>
        <select data-rule-add aria-label="${tr(addLabel)}"><option value="">+ ${tr(addLabel)}</option>${rows.map(([id, , text]) => `<option value="${id}">${tr(text)}</option>`).join('')}</select>
      </section>`).join('')}
      <label class="checkbox rules-stop"><input type="checkbox" name="ruleStop" ${rule.stopProcessing ? 'checked' : ''}>${tr('Остановить обработку правил')}</label>
      ${rule.id ? `<div class="rules-actions rules-save-actions"><button type="button" class="secondary danger" data-rule-delete>${tr('Удалить правило')}</button></div>` : ''}`;
    form.elements.ruleName.maxLength = 100;
    editor.querySelectorAll('[data-rule-section]').forEach(updateRuleSection);
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
    pending = true; load.disabled = true; add.disabled = true; editor.disabled = true; saveButton.disabled = true;
    errorBox.textContent = ''; status.textContent = tr('Загрузка…');
    try {
      const [, receivedFolders] = await Promise.all([fetchRules(), loadFolders()]);
      if (!current()) return;
      folders = receivedFolders; edit(null); render(); add.disabled = blocked;
      status.textContent = blocked ? mailRuleReadOnlyReason('outlook') : demo ? tr('Демо: вымышленные настройки, Exchange не изменяется.') : tr('Текущие настройки загружены из Exchange.');
    } catch (error) { if (current()) { list.replaceChildren(); status.textContent = ''; errorBox.textContent = errorText(error); } }
    finally { pending = false; if (current()) load.disabled = false; }
  };
  load.onclick = reload;
  const openWeb = panel.querySelector('[data-rules-owa]');
  if (openWeb) openWeb.onclick = () => {
    if (current()) void api('openLink', { url: new URL('/owa/', account.server).href }).catch(error => { if (current()) errorBox.textContent = errorText(error); });
  };
  add.onclick = () => {
    if (!pending && !modalBusy && discard()) {
      errorBox.textContent = ''; status.textContent = ''; edit({ name: '', editable: true });
      form.elements.ruleName.focus();
    }
  };
  panel.addEventListener('input', event => { if (editor.contains(event.target)) dirty(true); });
  panel.addEventListener('change', event => {
    const picker = event.target.closest('[data-rule-add]');
    if (!picker?.value || pending || modalBusy || !current() || editor.disabled) return;
    const section = picker.closest('[data-rule-section]'), row = section.querySelector(`[data-rule-row="${picker.value}"]`);
    picker.value = ''; row.hidden = false; updateRuleSection(section); dirty(true);
    (row.querySelector('input:not([type="checkbox"]), textarea, select') || row.querySelector('[data-rule-remove]')).focus();
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Enter' && editor.contains(event.target) && event.target.matches('input:not([type="checkbox"])') && event.target.getAttribute('aria-expanded') !== 'true') {
      event.preventDefault(); saveButton.click();
    }
  });
  panel.addEventListener('click', event => {
    if (pending || modalBusy || !current()) return;
    const row = event.target.closest('[data-rule-index]'), cancel = event.target.closest('[data-rule-cancel]');
    if ((row || cancel) && discard()) {
      errorBox.textContent = '';
      if (row) status.textContent = '';
      edit(row ? items[Number(row.dataset.ruleIndex)] : null);
      if (cancel) (list.querySelector('button') || add).focus();
      else if (selected?.editable) form.elements.ruleName.focus();
      else detail.querySelector('.rules-back').focus();
      return;
    }
    const removeRow = event.target.closest('[data-rule-remove]');
    if (removeRow && !editor.disabled) {
      const row = removeRow.closest('[data-rule-row]'), section = row.closest('[data-rule-section]');
      for (const input of row.querySelectorAll('input, textarea, select')) {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = '';
      }
      row.hidden = true; updateRuleSection(section); dirty(true); section.querySelector('[data-rule-add]').focus(); return;
    }
    if (event.target.closest('[data-rule-delete]')) submitRule(true);
  });
  saveButton.onclick = () => submitRule(false);
  function submitRule(remove) {
    if (pending || modalBusy || !current() || !selected?.editable || editor.disabled) return;
    if (remove && !confirm(`${tr('Удалить правило?')}\n${selected.name}`)) return;
    const fields = form.elements;
    const changes = { name: fields.ruleName.value.trim(), stopProcessing: fields.ruleStop.checked, enabled: fields.ruleEnabled.checked,
      ...(selected.id ? { priority: fields.rulePriority.valueAsNumber } : {}) };
    for (const [, , , rows] of ruleSections) for (const [key, name, , type] of rows) {
      const visible = !editor.querySelector(`[data-rule-row="${key}"]`).hidden;
      changes[key] = type === 'flag' ? visible : visible ? fields[name].value.trim() : '';
    }
    const removed = [...editor.querySelectorAll('[name="ruleInternalSender"]:not(:checked)')].map(input => Number(input.value));
    const internalCount = (selected.internalSenders?.length || 0) - removed.length;
    const addresses = changes.sender.split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
    changes.sender = addresses.join(', ');
    const invalidPhrases = ['subject', 'body', 'exceptSubject', 'exceptBody'].some(key => {
      const lines = changes[key].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      return lines.length > 20 || lines.some(line => line.length > 200);
    });
    const missingValue = ruleSections.some(([, , , rows]) => rows.some(([key, , , type]) =>
      type !== 'flag' && !editor.querySelector(`[data-rule-row="${key}"]`).hidden && !changes[key] && (key !== 'sender' || !internalCount)));
    if (!remove && (!changes.name || changes.name.length > 100 || missingValue || addresses.length + internalCount > 20 ||
      addresses.some(value => !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)) || invalidPhrases ||
      !addresses.length && !internalCount && !changes.subject && !changes.body && !changes.sentOnlyToMe && !changes.hasAttachments ||
      !changes.folder && !changes.copyFolder && !changes.markRead && !changes.importance && !changes.stopProcessing ||
      selected.id && (!Number.isSafeInteger(changes.priority) || changes.priority < 0 || changes.priority > 2147483647))) {
      errorBox.textContent = missingValue ? tr('Заполните добавленные строки или уберите их из правила.') : tr('Укажите название, хотя бы одно условие и действие правила.');
      errorBox.scrollIntoView({ block: 'nearest' }); return;
    }
    const snapshot = selected;
    pending = true;
    void submitForm(form, async () => {
      errorBox.textContent = ''; editor.disabled = true; load.disabled = true; add.disabled = true; saveButton.disabled = true;
      list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        if (demo) {
          if (remove) demoRules = demoRules.filter(rule => rule.id !== snapshot.id);
          else if (snapshot.id) demoRules = demoRules.map(rule => rule.id === snapshot.id ? { ...rule, ...changes, internalSenders: (rule.internalSenders || []).filter(sender => !removed.includes(sender.index)) } : rule);
          else demoRules.push({ ...changes, id: crypto.randomUUID(), revision: 'demo', editable: true, priority: Math.max(-1, ...demoRules.map(rule => rule.priority)) + 1 });
        } else if (snapshot.id) await api('changeMailRule', { id: snapshot.id, revision: snapshot.revision, action: remove ? 'delete' : 'update', ...(remove ? {} : { changes, ...(removed.length ? { removeInternalSenders: removed } : {}) }) });
        else await api('createMailRule', { ...changes, folder: changes.folder || undefined });
      } catch (error) {
        if (current()) {
          toolbar.hidden = false; errorBox.textContent = errorText(error);
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
        if (current()) { toolbar.hidden = false; errorBox.textContent = `${tr('Не удалось обновить список правил.')} ${errorText(error)}`; }
      } finally { pending = false; if (current()) load.disabled = false; }
    }).then(() => { if (current() && !selected) (list.querySelector('button') || add).focus(); });
  }
  if (!account && !demo) { load.disabled = true; status.textContent = tr('Сначала подключите аккаунт OWA'); }
}

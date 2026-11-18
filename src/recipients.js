(function (root) {
  function token(value, cursor = value.length) {
    const before = value.slice(0, cursor), start = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('\n')) + 1;
    const next = value.slice(cursor).search(/[,;\n]/), end = next < 0 ? value.length : cursor + next;
    return { start, end, query: value.slice(start, cursor).trim() };
  }
  function replace(value, cursor, email) {
    const { start, end } = token(value, cursor), prefix = value.slice(0, start), suffix = value.slice(end);
    const inserted = `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}${email}${suffix ? '' : ', '}`;
    return { value: inserted + suffix, cursor: inserted.length };
  }
  function matches(people, query, excluded = []) {
    const q = query.trim().toLowerCase(), seen = new Set(excluded.map(email => email.toLowerCase()));
    return people.filter(person => {
      const email = person.email?.trim().toLowerCase();
      if (!email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) || seen.has(email) || !`${person.name || ''} ${email}`.toLowerCase().includes(q)) return false;
      seen.add(email); return true;
    }).slice(0, 8);
  }
  function reply(message, ownEmails = [], all = false, sent = false) {
    const seen = new Set(ownEmails.map(email => email.trim().toLowerCase()));
    const take = people => people.map(person => (person?.email || '').trim()).filter(email => {
      const key = email.toLowerCase(); if (!email || seen.has(key)) return false; seen.add(key); return true;
    }).join(', ');
    if (sent && message.from?.email) seen.add(message.from.email.trim().toLowerCase());
    const ownMessage = sent || seen.has(message.from?.email?.trim().toLowerCase());
    let to = take(ownMessage ? message.to || [] : [message.from, ...(all ? message.to || [] : [])]), cc = all ? take(message.cc || []) : '';
    if (!to && cc) { const addresses = cc.split(', '); to = addresses.shift(); cc = addresses.join(', '); }
    return { to, cc };
  }
  const recipients = { token, replace, matches, reply };
  if (typeof module !== 'undefined') { module.exports = recipients; return; }
  root.asterRecipients = recipients;
  const meetingForms = new WeakMap();
  const addresses = value => value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
  const validEmail = email => /^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(email);
  const otherParticipants = input => input.form?.id === 'event-form' ? input.form.elements[{ attendees: 'optionalAttendees', optionalAttendees: 'attendees' }[input.dataset?.participantTarget || input.name]] : null;
  function removeParticipant(input, email) {
    input.value = addresses(input.value).filter(value => value.toLowerCase() !== email.toLowerCase()).join(', ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  recipients.commit = form => (meetingForms.get(form)?.pending || []).every(commit => commit());
  recipients.composePeople = form => {
    const selected = new Set(['to', 'cc', 'bcc'].flatMap(name => addresses(form.elements[name].value).map(email => email.toLowerCase())));
    return (meetingForms.get(form)?.people || []).filter(person => person.name && selected.has(person.email?.toLowerCase()))
      .map(({ name, email }) => ({ name, email }));
  };
  recipients.decorateMeeting = (form, people, mail = false) => {
    const context = { people: people.filter(person => person.role !== 'resource'), drag: null }; meetingForms.set(form, context);
    const columns = document.createElement('div'); columns.className = `meeting-participant-columns${mail ? ' compose-participants' : ''}`;
    form.elements[mail ? 'to' : 'attendees'].closest('.field').before(columns);
    const options = document.createElement('div'); options.className = 'compose-recipient-options';
    const pendingInputs = []; context.pending = pendingInputs;
    for (const name of mail ? ['to', 'cc', 'bcc'] : ['attendees', 'optionalAttendees']) {
      const input = form.elements[name], originalField = input.closest('.field');
      const field = document.createElement('div'); field.className = 'field meeting-participant-field recipient-field';
      originalField.replaceWith(field); columns.append(field);
      const label = document.createElement('label'), count = document.createElement('span'); count.className = 'participant-count'; count.setAttribute('aria-live', 'polite');
      label.textContent = mail ? { to: tr('Кому'), cc: tr('Копия'), bcc: tr('Скрытая копия') }[name] : name === 'attendees' ? tr('Обязательные') : tr('Необязательные'); label.append(count); field.append(label);
      const cards = document.createElement('div'); cards.className = 'participant-cards'; field.append(cards, input);
      input.classList.add('participant-addresses'); input.setAttribute('aria-label', `${label.textContent} · ${tr('Редактировать email')}`);
      if (mail) input.hidden = true;
      input.addEventListener('focus', () => input.classList.add('is-editing'));
      input.addEventListener('blur', () => input.classList.remove('is-editing'));
      const entry = document.createElement('div'); entry.className = 'participant-entry';
      const addInput = document.createElement('input'); addInput.type = 'text'; addInput.dataset.participantTarget = name;
      addInput.id = `participant-add-${name}`; label.htmlFor = addInput.id; addInput.placeholder = tr('Имя или email'); addInput.disabled = input.disabled;
      addInput.setAttribute('aria-label', `${label.textContent} · ${tr('Добавить участника')}`);
      const addButton = document.createElement('button'); addButton.type = 'button'; addButton.className = 'secondary participant-add'; addButton.textContent = '+';
      addButton.setAttribute('aria-label', tr('Добавить участника')); addButton.disabled = input.disabled;
      entry.append(addInput, addButton); field.append(entry);
      let editRow, editInput, editedAddress, editFocusAddress, toggle;
      if (mail) {
        const line = document.createElement('div'); line.className = 'compose-recipient-line';
        cards.replaceWith(line); line.append(cards, entry);
        if (name === 'to') columns.append(options);
        editRow = document.createElement('div'); editRow.className = 'compose-recipient-editor'; editRow.hidden = true;
        editInput = document.createElement('input');
        editInput.type = 'text'; editInput.className = 'compose-recipient-edit';
        editInput.inputMode = 'email'; editInput.autocomplete = 'off'; editInput.spellcheck = false;
        editInput.setAttribute('aria-label', `${label.firstChild.textContent} · ${tr('Редактировать email')}`);
        const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'secondary'; apply.textContent = tr('Готово');
        apply.addEventListener('click', () => { if (commitEdit()) focusEdited(); });
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = '×';
        cancel.setAttribute('aria-label', tr('Отмена'));
        cancel.addEventListener('click', () => { closeEdit(); focusEdited(); });
        editInput.addEventListener('input', () => editInput.setCustomValidity(''));
        editInput.addEventListener('keydown', event => {
          if (!['Enter', 'Escape'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') closeEdit();
          else if (!commitEdit()) return;
          focusEdited();
        });
        editRow.append(editInput, apply, cancel); field.append(editRow);
        pendingInputs.push(commitEdit);
      }
      function closeEdit() {
        editedAddress = undefined;
        editRow.hidden = true; editInput.setCustomValidity('');
      }
      function focusEdited() {
        const button = [...cards.querySelectorAll('.participant-card')].find(card => card.dataset.email === editFocusAddress);
        (button || addInput).focus({ preventScroll: true });
      }
      function commitEdit() {
        if (!editedAddress || input.disabled) return true;
        const values = addresses(input.value), replacement = editInput.value.trim();
        if (!validEmail(replacement) || values.some(email => email !== editedAddress && email.toLowerCase() === replacement.toLowerCase())) {
          editInput.setCustomValidity(tr('Введите полный email, которого ещё нет в этой строке.')); editInput.reportValidity();
          return false;
        }
        const original = editedAddress;
        closeEdit(); editFocusAddress = replacement;
        if (replacement !== original && values.includes(original)) {
          input.value = values.map(email => email === original ? replacement : email).join(', ');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
      function commitPending() {
        const values = addresses(addInput.value);
        if (!values.length || input.disabled) return true;
        const other = otherParticipants(input);
        if (values.some(email => !validEmail(email)) || other?.disabled && values.some(email => addresses(other.value).some(value => value.toLowerCase() === email.toLowerCase()))) {
          if (toggle) showField(true);
          addInput.setCustomValidity(tr('Выберите участника из подсказки или введите полный email.')); addInput.reportValidity();
          return false;
        }
        for (const email of values) {
          if (other && addresses(other.value).some(value => value.toLowerCase() === email.toLowerCase())) removeParticipant(other, email);
          if (!addresses(input.value).some(value => value.toLowerCase() === email.toLowerCase())) input.value = [...addresses(input.value), email].join(', ');
        }
        addInput.value = ''; addInput.setCustomValidity(''); hide(addInput);
        input.dispatchEvent(new Event('input', { bubbles: true })); return true;
      }
      addInput.addEventListener('input', () => addInput.setCustomValidity(''));
      addInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || inputs.get(addInput)?.active >= 0) return;
        event.preventDefault(); commitPending();
      });
      addButton.addEventListener('click', () => { if (commitPending()) addInput.focus(); });
      pendingInputs.push(commitPending);
      function render() {
        const scrollPosition = cards.scrollTop;
        cards.replaceChildren();
        let offset = 0;
        for (const part of input.value.split(/[,;\n]/)) {
          const start = offset + part.search(/\S|$/), end = offset + part.trimEnd().length;
          offset += part.length + 1;
          if (!part.trim()) continue;
          const email = part.trim(), button = document.createElement('button');
          button.type = 'button'; button.className = 'participant-card'; button.dataset.email = email;
          const person = context.people.find(person => person.email?.toLowerCase() === email.toLowerCase());
          const picture = document.createElement('span'); picture.className = 'participant-avatar'; picture.textContent = initials(person?.name || email); picture.setAttribute('aria-hidden', 'true');
          const copy = document.createElement('span'); copy.className = 'participant-copy';
          const title = document.createElement('strong'); title.textContent = person?.name || email;
          copy.append(title);
          if (person?.name && person.name !== email) { const address = document.createElement('small'); address.textContent = email; copy.append(address); }
          if (!mail) button.append(picture);
          button.append(copy);
          button.title = mail ? `${email}\n${tr('Нажмите, чтобы исправить email.')}` : tr('Нажмите, чтобы исправить email. Перетащите, чтобы изменить роль участника.');
          button.disabled = input.disabled; button.draggable = !input.disabled && !otherParticipants(input)?.disabled;
          button.addEventListener('click', event => {
            event.preventDefault();
            if (!mail) { input.focus(); input.setSelectionRange(start, end); return; }
            if (editedAddress !== email && !commitEdit()) return;
            if (!editedAddress) {
              editedAddress = editFocusAddress = email;
              editInput.value = email; editRow.hidden = false;
            }
            editInput.focus(); editInput.select();
          });
          button.addEventListener('dragstart', event => {
            if (editedAddress) { event.preventDefault(); return; }
            context.drag = { input, email, value: input.value }; event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', email);
          });
          button.addEventListener('dragend', () => { context.drag = null; form.querySelectorAll('.participant-drop').forEach(node => node.classList.remove('participant-drop')); });
          if (mail) {
            button.setAttribute('aria-label', person?.name && person.name !== email ? `${person.name} · ${email}` : email);
            const row = document.createElement('div'); row.className = 'compose-recipient-card';
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'participant-remove'; remove.textContent = '×';
            remove.setAttribute('aria-label', `${tr('Удалить адресата')}: ${email}`);
            remove.addEventListener('click', () => { if (editedAddress === email) closeEdit(); removeParticipant(input, email); addInput.focus(); });
            row.append(button, remove); cards.append(row);
          } else cards.append(button);
        }
        const addressCount = addresses(input.value).length;
        count.textContent = mail && !addressCount ? '' : addressCount;
        if (!mail && !cards.children.length) { const empty = document.createElement('p'); empty.className = 'participant-empty'; empty.textContent = tr('Участники не добавлены'); cards.append(empty); }
        cards.scrollTop = scrollPosition;
        if (toggle) updateDisclosure(addressCount);
      }
      function updateDisclosure(size = addresses(input.value).length) {
        const text = name === 'cc' ? tr(field.hidden ? 'Показать копию' : 'Скрыть копию')
          : tr(field.hidden ? 'Показать скрытую копию' : 'Скрыть скрытую копию');
        toggle.textContent = size ? `${text} · ${size}` : text;
        toggle.setAttribute('aria-expanded', String(!field.hidden));
      }
      function showField(visible) {
        field.hidden = !visible;
        updateDisclosure();
      }
      if (mail && name !== 'to') {
        toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'secondary';
        field.id = `recipient-field-${name}`; toggle.setAttribute('aria-controls', field.id);
        showField(false);
        options.append(toggle);
        toggle.addEventListener('click', () => {
          if (!field.hidden && (!commitEdit() || !commitPending())) return;
          showField(field.hidden);
          if (!field.hidden) addInput.focus();
        });
      }
      input.addEventListener('input', () => { if (editedAddress && !addresses(input.value).includes(editedAddress)) closeEdit(); render(); }); render();
      for (const target of toggle ? [field, toggle] : [field]) {
        const beforeAddress = event => mail ? event.target.closest('.compose-recipient-card')?.querySelector('.participant-card')?.dataset.email : null;
        const accepts = (drag, before) => drag && !input.disabled && !drag.input.disabled && drag.input.value === drag.value && (drag.input !== input || before && before !== drag.email);
        target.addEventListener('dragover', event => {
          if (!accepts(context.drag, beforeAddress(event))) return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('participant-drop');
        });
        target.addEventListener('dragleave', event => { if (!target.contains(event.relatedTarget)) target.classList.remove('participant-drop'); });
        target.addEventListener('drop', event => {
          const drag = context.drag, before = beforeAddress(event);
          context.drag = null; target.classList.remove('participant-drop');
          if (!accepts(drag, before)) return;
          event.preventDefault();
          const values = addresses(input.value).filter(value => drag.input !== input || value !== drag.email);
          if (!values.some(value => value.toLowerCase() === drag.email.toLowerCase())) {
            values.splice(before ? values.indexOf(before) : values.length, 0, drag.email);
            input.value = values.join(', ');
          }
          if (drag.input !== input) removeParticipant(drag.input, drag.email);
          if (toggle) showField(true);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          if (mail) { editFocusAddress = drag.email; focusEdited(); }
          else addInput.focus();
        });
      }
    }
    form.addEventListener('submit', event => { for (const commit of pendingInputs) if (!commit()) { event.preventDefault(); event.stopPropagation(); break; } });
    if (!mail) {
      const hint = document.createElement('p'); hint.className = 'form-note';
      hint.textContent = tr('Нажмите, чтобы исправить email. Перетащите, чтобы изменить роль участника.');
      columns.after(hint);
    }
  };
  recipients.decorate = (form, composePeople = []) => {
    if (form.id === 'compose-form') {
      recipients.decorateMeeting(form, composePeople.filter(Boolean), true); return;
    }
    for (const name of ['to', 'cc', 'bcc']) {
      const input = form.elements[name]; if (!input) continue;
      setup(input);
      const label = input.closest('.field').querySelector('span');
      input.setAttribute('aria-label', label.textContent);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'recipient-directory-button';
      button.textContent = tr('Справочник'); button.setAttribute('aria-label', `${tr('Выбрать из справочника:')} ${label.textContent}`);
      button.addEventListener('click', event => {
        event.preventDefault(); input.focus(); search(input);
        if (token(input.value, input.selectionStart ?? input.value.length).query.length < 2) show(input, [], tr('Введите минимум две буквы имени или email для поиска в общем справочнике Exchange.'));
      });
      label.append(button);
    }
  };
  const inputs = new WeakMap(); let nextId = 0, activeInput = null;
  const eligible = input => input.matches('#event-form input[name="attendees"],#event-form input[name="optionalAttendees"],#event-form input[data-participant-target],#meeting-message-form input[name="to"],#compose-form input[data-participant-target],#compose-form input[name="to"],#compose-form input[name="cc"],#compose-form input[name="bcc"]') && !input.disabled;
  function setup(input) {
    if (inputs.has(input)) return inputs.get(input);
    const box = document.createElement('div'); box.className = 'recipient-suggestions'; box.id = `recipients-${++nextId}`; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', tr('Подсказки участников')); box.hidden = true;
    input.closest('.field').classList.add('recipient-field'); input.after(box);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', box.id); input.autocomplete = 'off';
    const context = { box, generation: 0, options: [], active: -1, timer: null }; inputs.set(input, context);
    input.addEventListener('blur', () => hide(input));
    input.addEventListener('click', () => search(input));
    box.addEventListener('pointerdown', event => { const option = event.target.closest('[role="option"]'); if (option) { event.preventDefault(); choose(input, Number(option.dataset.index)); } });
    return context;
  }
  function hide(input) {
    const context = inputs.get(input); if (!context) return;
    context.generation++; clearTimeout(context.timer); context.box.hidden = true; context.active = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  }
  function choose(input, index) {
    const person = inputs.get(input)?.options[index]; if (!person || input.disabled) return;
    if (input.dataset?.participantTarget && input.form.elements[input.dataset.participantTarget].disabled) return;
    const other = otherParticipants(input);
    if (other && addresses(other.value).some(email => email.toLowerCase() === person.email.toLowerCase())) {
      if (other.disabled) return;
      removeParticipant(other, person.email);
    }
    const meeting = meetingForms.get(input.form);
    if (meeting && !meeting.people.some(value => value.email?.toLowerCase() === person.email.toLowerCase())) meeting.people.push(person);
    if (input.dataset?.participantTarget) {
      const target = input.form.elements[input.dataset.participantTarget];
      if (target.disabled) return;
      if (!addresses(target.value).some(email => email.toLowerCase() === person.email.toLowerCase())) target.value = [...addresses(target.value), person.email].join(', ');
      const current = token(input.value, input.selectionStart ?? input.value.length);
      input.value = input.form.id === 'compose-form' ? addresses(input.value.slice(0, current.start) + input.value.slice(current.end)).join(', ') : '';
      hide(input); input.focus(); target.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    const result = replace(input.value, input.selectionStart ?? input.value.length, person.email);
    input.value = result.value; input.setSelectionRange(result.cursor, result.cursor); hide(input); input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function show(input, people, message = '') {
    const context = setup(input); context.options = people; context.active = -1; input.removeAttribute('aria-activedescendant');
    context.box.innerHTML = people.map((person, i) => `<div class="recipient-option" role="option" id="${context.box.id}-${i}" data-index="${i}" aria-selected="false">${avatar(person.name || person.email, 0, person.email)}<div><strong>${esc(person.name || person.email)}</strong><small>${esc(person.email)}${person.source === 'directory' ? tr(' · Справочник Exchange') : ''}</small></div></div>`).join('') + (message ? `<div class="recipient-note" role="status">${esc(message)}</div>` : '');
    context.box.hidden = !people.length && !message; input.setAttribute('aria-expanded', String(!context.box.hidden));
  }
  function search(input) {
    if (activeInput && activeInput !== input) hide(activeInput);
    activeInput = input;
    const context = setup(input); hide(input);
    const cursor = input.selectionStart ?? input.value.length, current = token(input.value, cursor), query = current.query;
    if (query.length < 2 || query.length > 254) return;
    const other = otherParticipants(input);
    const excluded = [input.value.slice(0, current.start), input.value.slice(current.end), ...['attendees', 'optionalAttendees', 'to', 'cc', 'bcc'].filter(name => name !== input.name && (!other || name !== other.name || other.disabled)).map(name => input.form.elements[name]?.value || '')].join(',').split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
    const local = [...(meetingForms.get(input.form)?.people || []), ...addresses(other?.value || '').map(email => ({ email })), ...(state.demo ? window.asterDemo.contacts : [...colleagues(), ...state.contacts])];
    const found = matches(local, query, excluded); show(input, found, tr('Поиск в каталоге…'));
    const generation = context.generation, fingerprint = input.value, account = `${state.demo}|${state.account?.server}|${state.account?.username}|${state.account?.sessionId}`;
    context.timer = setTimeout(async () => {
      const current = () => input.isConnected && document.activeElement === input && context.generation === generation && input.value === fingerprint && input.selectionStart === cursor && account === `${state.demo}|${state.account?.server}|${state.account?.username}|${state.account?.sessionId}`;
      try {
        const result = state.demo ? { items: matches(window.asterDemo.directory, query) } : await api('contacts', { query });
        if (!current()) return;
        const people = matches([...result.items, ...found], '', excluded);
        show(input, people, result.truncated ? tr('Много совпадений в справочнике Exchange. Уточните имя или email.') : people.length ? '' : tr('В справочнике Exchange совпадений нет. Можно ввести полный email вручную.'));
      } catch (error) { if (current()) show(input, found, `${tr("Поиск в общем справочнике не выполнен:")} ${errorText(error)}${tr(". Можно ввести полный email вручную.")}`); }
    }, 250);
  }
  document.addEventListener('focusin', event => {
    if (activeInput && activeInput !== event.target) hide(activeInput);
    if (event.target instanceof HTMLInputElement && eligible(event.target)) search(event.target);
  });
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && eligible(event.target)) {
      if (document.activeElement === event.target) search(event.target);
      else hide(event.target);
    }
  });
  document.addEventListener('keyup', event => {
    if (event.target instanceof HTMLInputElement && eligible(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) search(event.target);
  });
  document.addEventListener('keydown', event => {
    const input = event.target, context = inputs.get(input); if (!context || context.box.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(input); return; }
    if (event.key === 'Enter' && context.active >= 0) { event.preventDefault(); choose(input, context.active); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !context.options.length) return;
    event.preventDefault(); context.active = context.active < 0 ? event.key === 'ArrowDown' ? 0 : context.options.length - 1 : (context.active + (event.key === 'ArrowDown' ? 1 : -1) + context.options.length) % context.options.length;
    const options = [...context.box.querySelectorAll('[role="option"]')]; options.forEach((option, i) => option.setAttribute('aria-selected', String(i === context.active)));
    const option = options[context.active]; input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
  });
})(typeof window === 'undefined' ? {} : window);

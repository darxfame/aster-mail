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
    let to = take(ownMessage ? message.to || [] : [message.from]), cc = all ? take(message.cc || []) : '';
    if (!to && cc) { const addresses = cc.split(', '); to = addresses.shift(); cc = addresses.join(', '); }
    return { to, cc };
  }
  const api = { token, replace, matches, reply };
  if (typeof module !== 'undefined') { module.exports = api; return; }
  root.asterRecipients = api;
  const inputs = new WeakMap(); let nextId = 0;
  const eligible = input => input.matches('#event-form input[name="attendees"],#event-form input[name="optionalAttendees"],#meeting-message-form input[name="to"]') && !input.disabled;
  function setup(input) {
    if (inputs.has(input)) return inputs.get(input);
    const box = document.createElement('div'); box.className = 'recipient-suggestions'; box.id = `recipients-${++nextId}`; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', 'Подсказки участников'); box.hidden = true;
    input.closest('.field').classList.add('recipient-field'); input.after(box);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', box.id); input.autocomplete = 'off';
    const context = { box, generation: 0, options: [], active: -1, timer: null }; inputs.set(input, context);
    input.addEventListener('blur', () => hide(input));
    box.addEventListener('pointerdown', event => { const option = event.target.closest('[role="option"]'); if (option) { event.preventDefault(); choose(input, Number(option.dataset.index)); } });
    return context;
  }
  function hide(input) {
    const context = inputs.get(input); if (!context) return;
    context.generation++; clearTimeout(context.timer); context.box.hidden = true; context.active = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  }
  function choose(input, index) {
    const person = inputs.get(input)?.options[index]; if (!person) return;
    const result = replace(input.value, input.selectionStart ?? input.value.length, person.email);
    input.value = result.value; input.setSelectionRange(result.cursor, result.cursor); hide(input); input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function show(input, people, message = '') {
    const context = setup(input); context.options = people; context.active = -1; input.removeAttribute('aria-activedescendant');
    context.box.innerHTML = people.map((person, i) => `<div class="recipient-option" role="option" id="${context.box.id}-${i}" data-index="${i}" aria-selected="false">${avatar(person.name || person.email, 0, person.email)}<div><strong>${esc(person.name || person.email)}</strong><small>${esc(person.email)}${person.source === 'directory' ? ' · Справочник Exchange' : ''}</small></div></div>`).join('') + (message ? `<div class="recipient-note" role="status">${esc(message)}</div>` : '');
    context.box.hidden = !people.length && !message; input.setAttribute('aria-expanded', String(!context.box.hidden));
  }
  function search(input) {
    const context = setup(input); hide(input);
    const cursor = input.selectionStart ?? input.value.length, current = token(input.value, cursor), query = current.query;
    if (query.length < 2 || query.length > 254) return;
    const excluded = [input.value.slice(0, current.start), input.value.slice(current.end), ...['attendees', 'optionalAttendees'].filter(name => name !== input.name).map(name => input.form.elements[name]?.value || '')].join(',').split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
    const local = state.demo ? window.asterDemo.contacts : [...colleagues(), ...state.contacts];
    const found = matches(local, query, excluded); show(input, found, 'Поиск в каталоге…');
    const generation = context.generation, fingerprint = input.value, account = `${state.demo}|${state.account?.server}|${state.account?.username}`;
    context.timer = setTimeout(async () => {
      const current = () => input.isConnected && document.activeElement === input && context.generation === generation && input.value === fingerprint && account === `${state.demo}|${state.account?.server}|${state.account?.username}`;
      try {
        const result = state.demo ? { items: matches(window.asterDemo.directory, query) } : await api('contacts', { query });
        if (!current()) return;
        const people = matches([...result.items, ...found], '', excluded);
        show(input, people, result.truncated ? 'Много совпадений в справочнике Exchange. Уточните имя или email.' : people.length ? '' : 'В справочнике Exchange совпадений нет. Можно ввести полный email вручную.');
      } catch (error) { if (current()) show(input, found, `Поиск в общем справочнике не выполнен: ${error.message}. Можно ввести полный email вручную.`); }
    }, 250);
  }
  document.addEventListener('focusin', event => { if (event.target instanceof HTMLInputElement && eligible(event.target)) search(event.target); });
  document.addEventListener('input', event => { if (event.target instanceof HTMLInputElement && eligible(event.target)) search(event.target); });
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

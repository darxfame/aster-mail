// Directory suggestions use the same Exchange GAL lookup as participant inputs.
document.addEventListener('DOMContentLoaded', () => {
  const input = $('#search'), form = $('#search-form'), box = document.createElement('div');
  box.id = 'people-search-suggestions'; box.className = 'people-search-suggestions'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', tr('Люди из каталога Exchange')); form.append(box);
  let sequence = 0, timer, results = [], active = -1;
  const accountKey = () => `${state.demo}|${state.account?.server}|${state.account?.username}`;
  function hide() { sequence++; clearTimeout(timer); box.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function show(people, note = '') {
    results = people; active = -1;
    const pinned = new Set(colleagues().map(person => person.email.toLowerCase()));
    box.innerHTML = people.map((person, index) => `<div class="people-suggestion">${avatar(person.name || person.email, index, person.email)}<button type="button" data-person-select="${index}"><strong>${esc(person.name || person.email)}</strong><small>${esc(person.email)}</small></button><button type="button" class="secondary" data-person-pin="${index}" ${pinned.has(person.email.toLowerCase()) ? 'disabled' : ''} aria-label="${tr("Добавить в коллеги:")} ${esc(person.name || person.email)}">${pinned.has(person.email.toLowerCase()) ? tr('В коллегах') : tr('+ В коллеги')}</button></div>`).join('') + (note ? `<p class="recipient-note" role="status">${esc(note)}</p>` : '');
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  async function select(index) { const person = results[index]; if (!person) return; input.value = person.email; state.query = person.email; hide(); await loadView(); }
  input.addEventListener('input', () => {
    hide();
    if (state.view !== 'contacts' || !ready()) return;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-haspopup', 'dialog'); input.setAttribute('aria-controls', box.id); input.autocomplete = 'off';
    const query = input.value.trim(); if (query.length < 2 || query.length > 254) return;
    const local = state.demo ? window.asterDemo.contacts : [...colleagues(), ...state.contacts];
    show(window.asterRecipients.matches(local, query), tr('Поиск в каталоге…'));
    const current = sequence, fingerprint = accountKey();
    timer = setTimeout(async () => {
      try {
        const result = state.demo ? { items: window.asterRecipients.matches(window.asterDemo.directory, query) } : await api('contacts', { query });
        if (sequence !== current || accountKey() !== fingerprint || state.view !== 'contacts' || input.value.trim() !== query) return;
        const found = window.asterRecipients.matches([...result.items, ...window.asterRecipients.matches(local, query)], '');
        show(found, found.length ? '' : tr('Совпадений не найдено'));
      } catch (error) { if (sequence === current && state.view === 'contacts') show(window.asterRecipients.matches(local, query), `${tr("Каталог недоступен:")} ${errorText(error)}`); }
    }, 250);
  });
  box.addEventListener('pointerdown', event => event.preventDefault());
  box.addEventListener('click', async event => {
    const pin = event.target.closest('[data-person-pin]'), choice = event.target.closest('[data-person-select]');
    if (choice) { void select(Number(choice.dataset.personSelect)).catch(showError); return; }
    if (!pin || pin.disabled) return;
    const person = results[Number(pin.dataset.personPin)], list = colleagues();
    if (!person || list.some(p => p.email.toLowerCase() === person.email.toLowerCase())) return;
    if (list.length >= 50) { toast(tr('Можно закрепить до 50 коллег')); return; }
    try { await saveColleagues([...list, person]); } catch (error) { showError(error); return; }
    show(results); renderColleagues(); void refreshColleagues(); toast(tr('Коллега добавлен'));
  });
  input.addEventListener('keydown', event => {
    if (box.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); active = results.length ? (active + (event.key === 'ArrowDown' ? 1 : results.length - 1) + results.length) % results.length : -1;
      box.querySelectorAll('.people-suggestion').forEach((row, index) => row.classList.toggle('active', index === active));
    } else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); void select(active).catch(showError); }
  });
  document.addEventListener('pointerdown', event => { if (!form.contains(event.target)) hide(); });
  form.addEventListener('submit', hide);
  document.addEventListener('click', event => { if (event.target.closest('[data-action="view"],[data-action="disconnect"],[data-action="demo"]')) hide(); });

  // Photos are read lazily; the backend caches them only for the current account.
  const watched = new WeakSet(), cache = new Map(), queue = []; let inFlight = 0, photoAccount = accountKey();
  async function pump() {
    while (inFlight < 4 && queue.length) {
      const { element, email, key } = queue.shift(); if (!element.isConnected || key !== accountKey()) continue;
      inFlight++;
      (async () => {
        try {
          let pending = cache.get(email);
          if (!pending) { pending = state.demo ? Promise.resolve(null) : api('personPhoto', { email }).catch(() => null); cache.set(email, pending); }
          const image = await pending;
          if (image && key === accountKey() && element.isConnected) { const img = document.createElement('img'); img.src = image; img.alt = ''; element.replaceChildren(img); }
        } finally { inFlight--; void pump(); }
      })();
    }
  }
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { visible.unobserve(entry.target); queue.push({ element: entry.target, email: entry.target.dataset.personEmail, key: accountKey() }); }
    void pump();
  });
  function scan() {
    if (photoAccount !== accountKey()) { photoAccount = accountKey(); cache.clear(); queue.length = 0; }
    if (!ready()) return;
    document.querySelectorAll('.avatar[data-person-email]').forEach(element => {
      if (!watched.has(element) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(element.dataset.personEmail)) { watched.add(element); visible.observe(element); }
    });
    if (cache.size > 128) cache.delete(cache.keys().next().value);
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); scan();
});

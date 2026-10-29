// Exchange instants stay in UTC; IANA zones affect presentation and wall-time input only.
(function (root) {
  function zone(value = 'system') {
    const result = !value || value === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : value;
    new Intl.DateTimeFormat('en', { timeZone: result });
    return result;
  }
  function format(value, options = {}, timeZone = 'system') {
    return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: zone(timeZone) }).format(new Date(value));
  }
  function wall(value, timeZone = 'system') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  }
  function civil(value, timeZone = 'system') { return new Date(`${wall(value, timeZone)}Z`); }
  function fromWall(value, timeZone = 'system', strict = true) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Укажите корректные дату и время');
    const target = value.length === 16 ? `${value}:00` : value, stamp = Date.parse(`${target}Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 19) !== target) throw new Error('Некорректная дата');
    // Sample both sides of a DST transition, then verify every candidate by round-trip.
    const offsets = new Set([-36, 0, 36].map(hours => { const at = stamp + hours * 3600000; return +civil(at, timeZone) - at; }));
    const matches = [...offsets].map(offset => stamp - offset).filter(at => wall(at, timeZone) === target).sort((a, b) => a - b);
    if (!matches.length && !strict) {
      const after = [...offsets].map(offset => stamp - offset).filter(at => wall(at, timeZone) >= target).sort((a, b) => a - b);
      if (after.length) return new Date(after[0]);
    }
    if (!matches.length) throw new Error('Это время пропущено при переводе часов. Выберите другое время.');
    if (strict && matches.length > 1) throw new Error('Это время повторяется при переводе часов. Выберите однозначное время или часовой пояс UTC.');
    return new Date(matches[0]);
  }
  function add(value, { days = 0, months = 0 } = {}, timeZone = 'system') {
    const date = civil(value, timeZone);
    if (months) date.setUTCMonth(date.getUTCMonth() + months, 1);
    if (days) date.setUTCDate(date.getUTCDate() + days);
    return fromWall(date.toISOString().slice(0, 19), timeZone, false);
  }
  function exchange(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const input = value.trim(), dotNet = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(input);
    // Our OWA/EWS requests explicitly use UTC. Bare response times share that context.
    const normalized = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(input) ? `${input}Z` : input;
    const date = new Date(dotNet ? Number(dotNet[1]) : normalized);
    return Number.isFinite(+date) ? date.toISOString() : null;
  }
  const api = { zone, format, wall, civil, fromWall, add, exchange };
  if (typeof module !== 'undefined') module.exports = api; else root.asterTime = api;
})(typeof window === 'undefined' ? {} : window);

(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  const T = typeof module !== 'undefined' ? require('./time.js') : root.asterTime;
  const C = typeof module !== 'undefined' ? require('./calendar.js') : root.asterCalendar;
  const defaults = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  const minute = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  function normalize(value, strict = false) {
    if (value === undefined) return { ...defaults, days: [...defaults.days] };
    if (!value || !Array.isArray(value.days) || value.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !(minute(value.end) > minute(value.start))) {
      if (strict) throw Object.assign(new Error(tr('Укажите рабочие дни и время окончания позже начала.')), { userFacing: true });
      return normalize();
    }
    return { days: [...new Set(value.days)].sort(), start: value.start, end: value.end };
  }
  function at(day, minutes, zone, latest = false) {
    const date = T.wall(day, zone).slice(0, 10);
    const full = C.range(day, 'day', zone);
    if (minutes === 1440) return full.end;
    const wall = `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const first = T.fromWall(wall, zone, false);
    // On fall-back days an end boundary includes the second occurrence of a wall time.
    const repeated = (full.end - full.start) - 86400000;
    const last = new Date(+first + repeated);
    return latest && repeated > 0 && T.wall(last, zone) === T.wall(first, zone) ? last : first;
  }
  function range(day, events, value, zone = 'system', now = null) {
    const settings = normalize(value), full = C.range(day, 'day', zone);
    const cutoff = now !== null && now >= +full.start && now < +full.end ? Math.max(+full.start, now - 2 * 3600000) : +full.start;
    const meetings = events.filter(e => !e.cancelled && !e.allDay && Date.parse(e.start) < +full.end && Date.parse(e.end) > cutoff && Date.parse(e.end) > Date.parse(e.start));
    const working = settings.days.includes(T.civil(full.start, zone).getUTCDay());
    let startMinute = minute(settings.start), endMinute = minute(settings.end);
    if (!working && meetings.length) { startMinute = 1440; endMinute = 0; }
    for (const event of meetings) {
      const start = Math.max(Date.parse(event.start), +full.start), end = Math.min(Date.parse(event.end), +full.end);
      const wallStart = T.civil(start, zone), wallEnd = T.civil(end, zone);
      startMinute = Math.min(startMinute, Math.floor((wallStart.getUTCHours() * 60 + wallStart.getUTCMinutes()) / 30) * 30);
      endMinute = Math.max(endMinute, end === +full.end ? 1440 : Math.ceil((wallEnd.getUTCHours() * 60 + wallEnd.getUTCMinutes() + wallEnd.getUTCSeconds() / 60) / 30) * 30);
    }
    let start = at(full.start, startMinute, zone), end = at(full.start, endMinute, zone, true);
    if (cutoff > +full.start) {
      start = new Date(Math.max(+start, cutoff));
      end = new Date(Math.min(+full.end, Math.max(+end, now + 30 * 60000)));
    }
    // Keep an empty late-day schedule usable after working hours; never cross midnight.
    if (+end <= +start) end = new Date(Math.min(+full.end, +start + 3600000));
    return { start, end, startMinute, endMinute, working };
  }
  const api = { normalize, range, at };
  if (typeof module !== 'undefined') module.exports = api; else root.asterWorkSchedule = api;
})(typeof window === 'undefined' ? {} : window);

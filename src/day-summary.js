// Read-only day arithmetic shared by the renderer and regression tests.
(function (root) {
  const T = typeof module !== 'undefined' ? require('./time.js') : root.asterTime;
  const C = typeof module !== 'undefined' ? require('./calendar.js') : root.asterCalendar;
  const W = typeof module !== 'undefined' ? require('./work-schedule.js') : root.asterWorkSchedule;
  const E = typeof module !== 'undefined' ? require('./events.js') : root.asterEvents;
  function merge(intervals) {
    const result = [];
    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      const previous = result.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else result.push({ ...interval });
    }
    return result;
  }
  function day(events, now = Date.now(), timeZone = 'system', workSchedule, email = '') {
    const { start, end } = C.range(now, 'day', timeZone);
    const settings = W.normalize(workSchedule);
    const working = settings.days.includes(T.civil(start, timeZone).getUTCDay());
    const workStart = +W.at(start, Number(settings.start.slice(0, 2)) * 60 + Number(settings.start.slice(3)), timeZone);
    const workEnd = +W.at(start, Number(settings.end.slice(0, 2)) * 60 + Number(settings.end.slice(3)), timeZone, true);
    const relevant = events.filter(event => !event.cancelled && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > Date.parse(event.start));
    const today = relevant.filter(event => Date.parse(event.start) < +end && Date.parse(event.end) > +start);
    const intervals = [], kinds = { organized: [], accepted: [], pending: [], declined: [] };
    for (const event of today) {
      if (!working) continue;
      const interval = { start: Math.max(workStart, Date.parse(event.start)), end: Math.min(workEnd, Date.parse(event.end)) };
      if (interval.end <= interval.start) continue;
      const kind = E.kind(event, email);
      kinds[kind].push(interval);
      if (kind !== 'declined') intervals.push(interval);
    }
    const blocks = merge(intervals);
    const segments = Object.entries(kinds).flatMap(([kind, intervals]) => merge(intervals).map(interval => ({ ...interval, kind })));
    let cursor = Math.max(workStart, now), longest = null, next = null;
    for (const block of [...blocks, { start: workEnd, end: workEnd }]) {
      if (block.start > cursor) {
        if (!next) next = { start: cursor, end: block.start };
        if (!longest || block.start - cursor > longest.end - longest.start) longest = { start: cursor, end: block.start };
      }
      cursor = Math.max(cursor, block.end);
    }
    const scheduledMinutes = blocks.reduce((sum, block) => sum + (block.end - block.start) / 60000, 0);
    return { start, end, today, upcoming: relevant.filter(event => !event.allDay && E.kind(event, email) !== 'declined' && Date.parse(event.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), working, workStart, workEnd, blocks, segments, scheduledMinutes, next: working ? next : null, percent: Math.round(scheduledMinutes * 60000 / (workEnd - workStart) * 100), longest: working ? longest : null };
  }
  const api = { day };
  if (typeof module !== 'undefined') module.exports = api; else root.asterDaySummary = api;
})(typeof window === 'undefined' ? {} : window);

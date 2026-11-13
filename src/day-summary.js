// Read-only day arithmetic shared by the renderer and regression tests.
(function (root) {
  const T = typeof module !== 'undefined' ? require('./time.js') : root.asterTime;
  const C = typeof module !== 'undefined' ? require('./calendar.js') : root.asterCalendar;
  const W = typeof module !== 'undefined' ? require('./work-schedule.js') : root.asterWorkSchedule;
  function merge(intervals) {
    const result = [];
    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      const previous = result.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else result.push({ ...interval });
    }
    return result;
  }
  function day(events, now = Date.now(), timeZone = 'system', workSchedule) {
    const { start, end } = C.range(now, 'day', timeZone);
    const settings = W.normalize(workSchedule);
    const working = settings.days.includes(T.civil(start, timeZone).getUTCDay());
    const workStart = +W.at(start, Number(settings.start.slice(0, 2)) * 60 + Number(settings.start.slice(3)), timeZone);
    const workEnd = +W.at(start, Number(settings.end.slice(0, 2)) * 60 + Number(settings.end.slice(3)), timeZone, true);
    const relevant = events.filter(event => !event.cancelled && !['Decline', 'Declined'].includes(event.response) && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > Date.parse(event.start));
    const today = relevant.filter(event => Date.parse(event.start) < +end && Date.parse(event.end) > +start);
    const blocks = { busy: [], unknown: [] };
    for (const event of today) {
      if (!working || ['Free', 'WorkingElsewhere'].includes(event.showAs) && event.showAsKnown !== false) continue;
      const interval = { start: Math.max(workStart, Date.parse(event.start)), end: Math.min(workEnd, Date.parse(event.end)) };
      if (interval.end <= interval.start) continue;
      const known = event.showAsKnown !== false && ['Busy', 'Tentative', 'OOF'].includes(event.showAs);
      blocks[known ? 'busy' : 'unknown'].push(interval);
    }
    const busy = merge(blocks.busy), unknown = merge(blocks.unknown);
    const occupied = merge([...busy, ...unknown]);
    let cursor = Math.max(workStart, now), longest = null;
    for (const block of [...occupied, { start: workEnd, end: workEnd }]) {
      if (block.start > cursor && (!longest || block.start - cursor > longest.end - longest.start)) longest = { start: cursor, end: block.start };
      cursor = Math.max(cursor, block.end);
    }
    const busyMinutes = busy.reduce((sum, block) => sum + (block.end - block.start) / 60000, 0);
    return { start, end, today, upcoming: relevant.filter(event => !event.allDay && Date.parse(event.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), working, workStart, workEnd, busy, unknown, busyMinutes, percent: Math.round(busyMinutes * 60000 / (workEnd - workStart) * 100), longest: working && !unknown.length ? longest : null };
  }
  const api = { day };
  if (typeof module !== 'undefined') module.exports = api; else root.asterDaySummary = api;
})(typeof window === 'undefined' ? {} : window);

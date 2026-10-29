(function (root) {
  const C = typeof module !== 'undefined' ? require('./calendar.js') : root.asterCalendar;
  function layout(events, day, timeZone = 'system') {
    const { start, end } = C.range(day, 'day', timeZone), dayMinutes = (end - start) / 60000;
    const entries = events.filter(e => !e.allDay && Date.parse(e.start) < +end && Date.parse(e.end) > +start)
      .map(event => ({ event, top: (Math.max(Date.parse(event.start), +start) - start) / 60000, bottom: (Math.min(Date.parse(event.end), +end) - start) / 60000 }))
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let group = [], groupEnd = 0;
    const finish = () => {
      const ends = [];
      for (const entry of group) {
        let column = ends.findIndex(end => end <= entry.top);
        if (column < 0) column = ends.length;
        entry.column = column; ends[column] = entry.bottom;
      }
      for (const entry of group) {
        let span = 1;
        for (let column = entry.column + 1; column < ends.length; column++) {
          if (group.some(other => other.column === column && other.top < entry.bottom && other.bottom > entry.top)) break;
          span++;
        }
        entry.left = entry.column / ends.length; entry.width = span / ends.length; entry.columns = ends.length;
        entry.height = entry.bottom - entry.top;
      }
    };
    for (const entry of entries) {
      if (group.length && entry.top >= groupEnd) { finish(); group = []; }
      group.push(entry); groupEnd = Math.max(...group.map(e => e.bottom));
    }
    finish();
    return { entries, dayMinutes, start, end };
  }
  const api = { layout };
  if (typeof module !== 'undefined') module.exports = api; else root.asterCalendarLayout = api;
})(typeof window === 'undefined' ? {} : window);

/* Shared local-date arithmetic: calendar days must survive daylight-saving changes. */
(function (root) {
  function range(date, view) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    if (view === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    if (view === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
    const end = new Date(start);
    if (view === 'quarter') end.setMonth(end.getMonth() + 3);
    else end.setDate(end.getDate() + (view === 'day' ? 1 : 7));
    return { start, end };
  }
  function move(date, view, direction) {
    const next = new Date(date);
    if (view === 'quarter') next.setMonth(next.getMonth() + direction * 3, 1);
    else next.setDate(next.getDate() + direction * (view === 'day' ? 1 : 7));
    return next;
  }
  function mode(preference, width) { return ['day', 'week', 'quarter'].includes(preference) ? preference : width < 700 ? 'day' : 'week'; }
  const calendar = { range, move, mode };
  if (typeof module !== 'undefined') module.exports = calendar;
  else root.asterCalendar = calendar;
})(typeof window === 'undefined' ? {} : window);

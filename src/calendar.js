/* Calendar boundaries use the selected IANA zone, including daylight-saving changes. */
(function (root) {
  const T = typeof module !== 'undefined' ? require('./time.js') : root.asterTime;
  function range(date, view, timeZone = 'system') {
    const civil = T.civil(date, timeZone); civil.setUTCHours(0, 0, 0, 0);
    if (view === 'week') civil.setUTCDate(civil.getUTCDate() - (civil.getUTCDay() + 6) % 7);
    if (view === 'quarter') civil.setUTCMonth(Math.floor(civil.getUTCMonth() / 3) * 3, 1);
    if (view === 'month') civil.setUTCDate(1);
    const start = T.fromWall(civil.toISOString().slice(0, 19), timeZone, false);
    const end = T.add(start, ['quarter', 'month'].includes(view) ? { months: view === 'quarter' ? 3 : 1 } : { days: view === 'day' ? 1 : 7 }, timeZone);
    return { start, end };
  }
  function move(date, view, direction, timeZone = 'system') {
    return T.add(date, ['quarter', 'month'].includes(view) ? { months: direction * (view === 'quarter' ? 3 : 1) } : { days: direction * (view === 'day' ? 1 : 7) }, timeZone);
  }
  function mode(preference, width) { return ['day', 'week', 'quarter'].includes(preference) ? preference : width < 700 ? 'day' : 'week'; }
  const calendar = { range, move, mode };
  if (typeof module !== 'undefined') module.exports = calendar;
  else root.asterCalendar = calendar;
})(typeof window === 'undefined' ? {} : window);

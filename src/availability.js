(function (root) {
  const T = typeof module !== 'undefined' ? require('./time.js') : root.asterTime;
  const stamp = value => Date.parse(value);
  function status(person, now = Date.now()) {
    if (!person || person.error || now < stamp(person.start) || now >= stamp(person.end)) return { kind: 'unknown', until: null };
    const blocks = person.blocks.filter(b => b.type !== 'Free' && stamp(b.end) > now).sort((a, b) => stamp(a.start) - stamp(b.start));
    const active = blocks.filter(b => stamp(b.start) <= now);
    if (!active.length) return { kind: 'free', until: blocks[0]?.start || person.end, horizon: !blocks.length };
    let end = Math.max(...active.map(b => stamp(b.end)));
    for (const block of blocks) if (stamp(block.start) <= end) end = Math.max(end, stamp(block.end));
    return { kind: active.some(b => b.type === 'NoData') ? 'unknown' : 'busy', type: active[0].type, until: new Date(end).toISOString() };
  }
  function available(people, start, end) {
    const a = stamp(start), b = stamp(end);
    return people.length > 0 && b > a && people.every(p => !p.error && a >= stamp(p.start) && b <= stamp(p.end) && !p.blocks.some(block => block.type !== 'Free' && stamp(block.start) < b && stamp(block.end) > a));
  }
  function suggestions(people, date, minutes, now = Date.now(), timeZone = 'system') {
    const day = T.wall(date, timeZone).slice(0, 10);
    const slots = [], start = T.fromWall(`${day}T09:00`, timeZone), end = T.fromWall(`${day}T18:00`, timeZone);
    for (let at = +start; at + minutes * 60000 <= +end; at += 15 * 60000) {
      if (at >= now && available(people, new Date(at), new Date(at + minutes * 60000))) slots.push(new Date(at).toISOString());
      if (slots.length === 6) break;
    }
    return slots;
  }
  const api = { status, available, suggestions };
  if (typeof module !== 'undefined') module.exports = api; else root.asterAvailability = api;
})(typeof window === 'undefined' ? {} : window);

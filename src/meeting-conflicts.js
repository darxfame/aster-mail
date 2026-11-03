(function (root) {
  function analyze(meeting, events, complete) {
    const start = Date.parse(meeting.start), end = Date.parse(meeting.end);
    const conflicts = [], tentative = [];
    let unknown = !complete || !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
    for (const event of events) {
      if (event.id === meeting.id || event.cancelled || ['Decline', 'Declined'].includes(event.response)) continue;
      const a = Date.parse(event.start), b = Date.parse(event.end);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) { unknown = true; continue; }
      if (a >= end || b <= start) continue;
      // A recurring UID alone cannot identify an occurrence or justify excluding it.
      if (event.calendarType === 'RecurringMaster') { unknown = true; continue; }
      const summary = { id: event.id, start: event.start, end: event.end, title: event.sensitivity === 'Private' ? '' : event.title };
      if (event.showAsKnown === false) unknown = true;
      else if (['Busy', 'OOF'].includes(event.showAs)) conflicts.push(summary);
      else if (event.showAs === 'Tentative') tentative.push(summary);
      else if (!['Free', 'WorkingElsewhere'].includes(event.showAs)) unknown = true;
    }
    return { kind: conflicts.length ? 'busy' : tentative.length ? 'tentative' : unknown ? 'unknown' : 'free', complete: !unknown, conflicts, tentative, start: meeting.start, end: meeting.end };
  }
  const api = { analyze };
  if (typeof module !== 'undefined') module.exports = api; else root.asterMeetingConflicts = api;
})(typeof window === 'undefined' ? {} : window);

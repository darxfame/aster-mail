const P = require('./protocol.cjs');
const C = require('./calendar-events.cjs');
const { analyze } = require('../src/meeting-conflicts.js');
function query(meeting) {
  const start = new Date(meeting.start), end = new Date(meeting.end);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end - start > 31 * 86400000 || meeting.calendarType === 'RecurringMaster') return null;
  const fields = ['item:Subject', 'item:Sensitivity', 'calendar:Start', 'calendar:End', 'calendar:IsCancelled', 'calendar:MyResponseType', 'calendar:LegacyFreeBusyStatus', 'calendar:CalendarItemType'];
  return P.soap(`<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${fields.map(field => `<t:FieldURI FieldURI="${field}"/>`).join('')}</t:AdditionalProperties></m:ItemShape><m:CalendarView MaxEntriesReturned="1000" StartDate="${start.toISOString()}" EndDate="${end.toISOString()}"/><m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds></m:FindItem>`);
}
function normalize(response, meeting) {
  const roots = P.walk(response, o => Object.hasOwn(o, '@_IncludesLastItemInRange'));
  if (roots.length !== 1) return analyze(meeting, [], false);
  const root = roots[0];
  const items = P.walk(root.Items, o => o.ItemId?.['@_Id']).map(C.normalize);
  const validItems = root.Items === '' || root.Items && typeof root.Items === 'object' && Object.keys(root.Items).every(key => key === 'CalendarItem');
  const complete = validItems && Object.hasOwn(root, 'Items') && [true, 'true'].includes(root['@_IncludesLastItemInRange']) && Number(root['@_TotalItemsInView']) === items.length && items.length < 1000;
  return analyze(meeting, items, complete);
}
module.exports = { query, normalize };

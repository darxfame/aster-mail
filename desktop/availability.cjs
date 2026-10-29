const tr = require('../src/i18n.js').text;
// OWA request shape and per-mailbox matching adapted from mac-owa-widget (MIT).
const P = require('./protocol.cjs');
function query(data) {
  const emails = [...new Set(P.emails(data.emails).map(email => email.toLowerCase()))];
  const start = new Date(data.start), end = new Date(data.end);
  if (!emails.length || emails.length > 50 || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end - start > 7 * 86400000) throw new Error(tr('Укажите до 50 участников и период не более семи дней'));
  const payload = P.request('GetUserAvailabilityInternal', {});
  payload.Body = P.typed('GetUserAvailabilityRequest', {
    MailboxDataArray: emails.map(email => P.typed('MailboxData', { Email: P.typed('EmailAddress', { Address: email }) })),
    FreeBusyViewOptions: P.typed('FreeBusyViewOptions', { MergedFreeBusyIntervalInMinutes: 15, RequestedView: 'FreeBusyMerged', TimeWindow: P.typed('Duration', { StartTime: start.toISOString().slice(0, 19), EndTime: end.toISOString().slice(0, 19) }) }),
  });
  return { emails, start: start.toISOString(), end: end.toISOString(), payload: { request: payload } };
}
function rows(value, count) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    if (value.length === count && value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
      const sizes = value.map(v => P.walk(v, row => typeof row.MergedFreeBusy === 'string').length);
      if (sizes.some(n => n === 1) && sizes.every(n => n <= 1)) return value;
    }
  }
  for (const child of Object.values(value)) { const found = rows(child, count); if (found) return found; }
  return null;
}
function normalize(data, request) {
  const responses = rows(data, request.emails.length);
  return request.emails.map((email, i) => {
    const result = { email, start: request.start, end: request.end, blocks: [] };
    const row = responses?.[i], view = P.walk(row, o => typeof o.MergedFreeBusy === 'string')[0];
    const failure = P.walk(row, o => o.ResponseCode && o.ResponseCode !== 'NoError')[0];
    const merged = view?.MergedFreeBusy || '';
    const count = Math.ceil((Date.parse(request.end) - Date.parse(request.start)) / 900000);
    if (failure || !/^[0-4]+$/.test(merged) || merged.length < count) return { ...result, error: failure?.ResponseCode || tr('Нет полных данных занятости') };
    for (let slot = 0; slot < count; slot++) {
      const type = ['Free', 'Tentative', 'Busy', 'OOF', 'NoData'][Number(merged[slot])];
      if (type !== 'Free') result.blocks.push({ start: new Date(Date.parse(request.start) + slot * 900000).toISOString(), end: new Date(Math.min(Date.parse(request.end), Date.parse(request.start) + (slot + 1) * 900000)).toISOString(), type });
    }
    return result;
  });
}
module.exports = { query, rows, normalize };

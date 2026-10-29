const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../src/calendar-layout.js');
const E = require('../src/events.js');
const source = fs.readFileSync(require.resolve('../src/calendar-ui.js'), 'utf8');
function harness(own = true) {
  const handlers = {}, saves = [], requests = [];
  const origin = { id: 'occurrence', start: '2026-10-29T10:00:00Z', end: '2026-10-29T10:30:00Z', recurring: true, isOrganizer: own, changeKey: 'occurrence-key' };
  const master = { ...origin, id: 'master', start: '2026-10-01T10:00:00Z', end: '2026-10-01T10:30:00Z', changeKey: 'master-key' };
  let pending;
  const context = vm.createContext({ Date, state: { generation: 1, view: 'calendar', account: null, demo: false }, window: { asterEvents: E, asterCalendarLayout: L }, $: () => ({ open: false }), ref: value => ({ id: value.id, changeKey: value.changeKey }), api: async (operation, data) => { requests.push({ operation, data }); return data.scope === 'series' ? master : origin; }, modal: () => {}, esc: value => value, dateFormat: value => value, time: value => value, formError: () => '', document: { addEventListener: (type, handler) => { handlers[type] = handler; } }, submitForm: (form, callback) => { pending = callback({ scope: form.scope }); return pending; }, saveMeetingChanges: async (edit, changes) => saves.push({ edit, changes }), calendarDrop: null });
  vm.runInContext(source.slice(source.indexOf('async function prepareCalendarDrop(')), context);
  return { context, origin, saves, requests, submit: async scope => { handlers.submit({ target: { id: 'calendar-move-form', scope }, preventDefault() {} }); await pending; } };
}
test('drop of recurring occurrence saves only that instance and preserves duration', async () => {
  const h = harness();
  await h.context.prepareCalendarDrop(h.origin, { start: '2026-10-30T11:15:00Z', end: '2026-10-30T11:45:00Z' });
  await h.submit('single');
  assert.equal(h.saves[0].edit.detail.changeKey, 'occurrence-key');
  assert.equal(h.saves[0].edit.scope, 'single');
  assert.equal(h.saves[0].changes.start, '2026-10-30T11:15:00.000Z');
  assert.equal(h.saves[0].changes.end, '2026-10-30T11:45:00.000Z');
});
test('series drop applies occurrence displacement to actual master using its version', async () => {
  const h = harness();
  await h.context.prepareCalendarDrop(h.origin, { start: '2026-10-30T11:15:00Z', end: '2026-10-30T11:45:00Z' });
  await h.submit('series');
  assert.equal(h.saves[0].edit.detail.id, 'master'); assert.equal(h.saves[0].edit.detail.changeKey, 'master-key');
  assert.equal(h.saves[0].changes.start, '2026-10-02T11:15:00.000Z');
  assert.equal(h.saves[0].changes.end, '2026-10-02T11:45:00.000Z');
});
test('invitee drops cannot write, and account changes invalidate an outstanding move', async () => {
  const foreign = harness(false);
  await assert.rejects(foreign.context.prepareCalendarDrop(foreign.origin, { start: '2026-10-30T11:15:00Z' }), /только свои/);
  assert.equal(foreign.saves.length, 0);
  const h = harness();
  await h.context.prepareCalendarDrop(h.origin, { start: '2026-10-30T11:15:00Z' });
  h.context.state.generation++;
  await assert.rejects(h.submit('single'), /Календарь изменился/); assert.equal(h.saves.length, 0);
});

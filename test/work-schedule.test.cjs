const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/work-schedule.js');
const T = require('../src/time.js');
const L = require('../src/calendar-layout.js');
const E = require('../src/events.js');
const day = '2026-11-12T12:00:00+03:00', zone = 'Europe/Moscow';
const at = time => T.fromWall(`2026-11-12T${time}`, zone).toISOString();
const event = (id, start, end, extra = {}) => ({ id, start: at(start), end: at(end), ...extra });
test('work preferences normalize per-account defaults and reject invalid user input', () => {
  const { preferences } = require('../desktop/notifications.cjs');
  assert.deepEqual(preferences().workSchedule, { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' });
  assert.deepEqual(W.normalize({ days: [6, 0, 6], start: '10:30', end: '19:15' }, true).days, [0, 6]);
  for (const value of [{days:[7],start:'09:00',end:'18:00'}, {days:[1],start:'18:00',end:'09:00'}, {days:[1],start:'9:00',end:'18:00'}]) {
    assert.throws(() => W.normalize(value, true)); assert.deepEqual(W.normalize(value), W.normalize());
  }
  assert.deepEqual(W.normalize({days:[],start:'10:00',end:'11:00'}, true).days, []);
});
test('working ranges expand around early, late and overnight meetings, but not all-day or cancelled events', () => {
  const events = [event('early','07:15','08:00'),event('late','19:00','20:15'),event('cancelled','00:00','23:00',{cancelled:true}),event('all','00:00','23:59',{allDay:true})];
  const bounds = W.range(day,events,undefined,zone);
  assert.equal(T.wall(bounds.start,zone).slice(11,16),'07:00'); assert.equal(T.wall(bounds.end,zone).slice(11,16),'20:30');
  const midnight = W.range(day,[{id:'night',start:at('23:00'),end:'2026-11-13T01:00:00+03:00'}],undefined,zone);
  assert.equal(T.wall(midnight.end,zone).slice(0,16),'2026-11-13T00:00');
  const weekend = W.range('2026-11-14T12:00:00+03:00',[{start:'2026-11-14T12:00:00+03:00',end:'2026-11-14T13:00:00+03:00'}],undefined,zone);
  assert.equal(weekend.working,false); assert.equal(T.wall(weekend.start,zone).slice(11,16),'12:00');
});
test('widget clips history to two hours, retains ongoing and late meetings and has usable empty late-day bounds', () => {
  const now = Date.parse(at('13:30'));
  const events = [event('old','06:00','07:00'),event('ongoing','11:00','14:00'),event('late','20:00','21:00')];
  const bounds = W.range(day,events,undefined,zone,now), layout = L.layout(events,day,zone,bounds);
  assert.equal(+bounds.start,now-7200000); assert.equal(T.wall(bounds.end,zone).slice(11,16),'21:00');
  assert.deepEqual(layout.entries.map(e=>e.event.id),['ongoing','late']); assert.equal(layout.entries[0].top,0);
  const late = W.range(day,[],undefined,zone,Date.parse(at('23:30')));
  assert.ok(+late.end > Date.parse(at('23:30'))); assert.ok(+late.end <= Date.parse('2026-11-13T00:00:00+03:00'));
});
test('bounded layouts retain DST elapsed duration and gesture mapping', () => {
  const dstDay = '2026-11-01T12:00:00Z', dstZone = 'America/New_York';
  const events = [{id:'dst',start:'2026-11-01T01:30:00-04:00',end:'2026-11-01T02:30:00-05:00'}];
  const range = W.range(dstDay,events,{days:[0],start:'00:00',end:'04:00'},dstZone);
  const layout=L.layout(events,dstDay,dstZone,range);
  assert.equal(layout.dayMinutes,300); assert.equal(layout.entries[0].height,120);
  assert.equal(L.slot(range.start,range.end,90,300).toISOString(),events[0].start.replace('01:30:00-04:00','05:30:00.000Z'));
});
test('focus keeps both ongoing and nearest future meetings, including simultaneous ones, without declined or all-day entries', () => {
  const events=[event('live','11:00','14:00'),event('live2','12:00','14:00'),event('next','15:00','16:00'),event('next2','15:00','16:00'),event('later','17:00','18:00'),event('declined','13:45','14:00',{response:'Decline'}),event('all','00:00','23:59',{allDay:true})];
  assert.deepEqual(E.focusMeetings(events,Date.parse(at('13:30'))).map(e=>e.id),['live','next','live2','next2']);
  assert.deepEqual(E.nearestMeetings(events,Date.parse(at('13:30'))).map(e=>e.id),['live','live2']);
});

test('end boundaries include the later repeated wall time on fall-back days', () => {
  const day='2026-11-01T12:00:00Z', zone='America/New_York';
  const event={id:'second',start:'2026-11-01T01:30:00-05:00',end:'2026-11-01T01:45:00-05:00'};
  const bounds=W.range(day,[event],{days:[0],start:'01:00',end:'01:45'},zone);
  assert.ok(+bounds.end>=Date.parse(event.end));
  assert.equal(L.layout([event],day,zone,bounds).entries[0].height,15);
});

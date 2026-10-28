const test = require('node:test');
const assert = require('node:assert/strict');
const { range, move, mode } = require('../src/calendar.js');
const local = date => [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
test('calendar views respect local days, Monday weeks and year-boundary quarters', () => {
  const date = new Date(2026, 11, 31, 16);
  assert.deepEqual(local(range(date, 'day').end), [2027, 1, 1, 0]);
  assert.deepEqual(local(range(date, 'week').start), [2026, 12, 28, 0]);
  assert.deepEqual(local(range(date, 'quarter').start), [2026, 10, 1, 0]);
  assert.deepEqual(local(range(date, 'quarter').end), [2027, 1, 1, 0]);
  assert.deepEqual(local(move(date, 'quarter', 1)).slice(0, 3), [2027, 3, 1]);
  assert.equal(move(new Date(2024, 1, 28), 'day', 1).getDate(), 29);
  assert.equal(mode('auto', 240), 'day');
  assert.equal(mode('auto', 1000), 'week');
  assert.equal(mode('quarter', 240), 'quarter');
});

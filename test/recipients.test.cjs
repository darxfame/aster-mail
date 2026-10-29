const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recipients.js');
test('participant suggestions match Latin email prefixes and Russian names and exclude duplicates', () => {
  const anna = { name: 'Анна', email: 'anna@example.com' };
  assert.deepEqual(R.matches([anna, anna, { name: 'Ann', email: 'bad-address' }], 'an'), [anna]);
  assert.deepEqual(R.matches([anna], 'ан'), [anna]);
  assert.deepEqual(R.matches([anna], 'AN', ['ANNA@example.com']), []);
});
test('choosing a participant replaces only the current address and preserves surrounding recipients', () => {
  assert.deepEqual(R.replace('an', 2, 'anna@example.com'), { value: 'anna@example.com, ', cursor: 18 });
  const value = 'first@example.com, an, last@example.com';
  const cursor = value.indexOf('an,') + 2;
  assert.equal(R.token(value, cursor).query, 'an');
  assert.equal(R.replace(value, cursor, 'anna@example.com').value, 'first@example.com, anna@example.com, last@example.com');
});
test('reply-all retains other original To recipients and never adds blind recipients', () => {
  const message = {
    from: { email: ' boss@example.com ' },
    to: [{ email: 'ME@example.com' }, { email: 'anna@example.com' }, { email: 'BOSS@example.com' }, { email: 'ANNA@example.com' }, { email: 'me@login.example.com' }],
    cc: [{ email: 'Anna@example.com' }, { email: 'bob@example.com' }, { email: 'me@example.com' }],
    bcc: [{ email: 'private@example.com' }],
  };
  assert.deepEqual(R.reply(message, ['me@example.com', 'me@login.example.com'], true), { to: 'boss@example.com, anna@example.com', cc: 'bob@example.com' });
  assert.deepEqual(R.reply(message, ['me@example.com', 'me@login.example.com']), { to: 'boss@example.com', cc: '' });
});

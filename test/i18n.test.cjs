const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const i18n = require('../src/i18n.js');
const T = require('../src/time.js');
const { preferences, mailAlert } = require('../desktop/notifications.cjs');
const { countdown } = require('../src/events.js');

test('English covers application literals, markup and accessibility labels in both processes', () => {
  i18n.setLanguage('en');
  try {
    for (const directory of ['src', 'desktop']) {
      for (const file of fs.readdirSync(path.join(__dirname, '..', directory)).filter(name => /\.(?:js|cjs)$/.test(name) && name !== 'i18n.js')) {
        const source = fs.readFileSync(path.join(__dirname, '..', directory, file), 'utf8');
        for (const match of source.matchAll(/\btr\(("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\)/g)) {
          const literal = vm.runInNewContext(match[1]);
          assert.doesNotMatch(i18n.text(literal), /[а-яё]/i, `${directory}/${file}: ${literal}`);
        }
      }
    }
  } finally { i18n.setLanguage('ru'); }
});

test('language switches dates, countdowns, validation errors and private notifications without changing content', () => {
  i18n.setLanguage('en');
  try {
    assert.equal(T.format('2026-10-30T12:00:00Z', { month: 'long' }, 'UTC'), 'October');
    assert.throws(() => T.fromWall('invalid'), /valid date and time/);
    assert.equal(countdown(null).label, 'Free');
    assert.equal(mailAlert({ id: '1' }).title, 'New message');
    const message = { id: '1', from: { name: 'Анна' }, subject: 'Встреча', preview: 'Письмо по-русски' };
    assert.equal(mailAlert(message, true).title, 'Анна');
    assert.equal(mailAlert(message, true).body, 'Встреча\nПисьмо по-русски');
    assert.equal(preferences({ language: 'en' }).language, 'en');
    assert.equal(preferences({ language: 'unknown' }).language, 'ru');
    const folders = require('../src/folders.js').tree([{ id: 'server-inbox', wellKnown: 'inbox', name: 'Входящие' }, { id: 'custom', name: 'Входящие' }], [['inbox', i18n.text('Входящие'), 'inbox']]);
    assert.equal(folders[0].name, 'Inbox');
    assert.equal(folders[1].name, 'Входящие');
    assert.equal(i18n.text('Unknown text <b>kept</b>'), 'Unknown text <b>kept</b>');
  } finally { i18n.setLanguage('ru'); }
  assert.equal(i18n.text('Настройки'), 'Настройки');
  assert.equal(T.format('2026-10-30T12:00:00Z', { month: 'long' }, 'UTC'), 'октябрь');
});

test('browser language preference translates static nodes reversibly and survives disabled storage', () => {
  const source = fs.readFileSync(require.resolve('../src/i18n.js'), 'utf8');
  for (const saved of ['en', 'ru', null, 'disabled']) {
    const label = { textContent: 'Настройки', parentElement: { closest: () => null } };
    const attrs = { title: 'Обновить', 'aria-label': 'Обновить' };
    const button = { getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; } };
    let done = false;
    const document = { title: 'Aster · ближайшие встречи', body: {}, documentElement: {},
      createTreeWalker: () => ({ nextNode: () => done ? false : (done = true), currentNode: label }),
      querySelectorAll: () => [button] };
    const window = { document };
    vm.runInNewContext(source, { window, document, NodeFilter: { SHOW_TEXT: 4 }, navigator: { language: 'en-US' },
      localStorage: { getItem() { if (saved === 'disabled') throw new Error(); return saved; } } });
    const expected = saved === 'ru' ? 'ru' : 'en';
    assert.equal(window.asterI18n.language, expected);
    assert.equal(label.textContent, expected === 'en' ? 'Settings' : 'Настройки');
    assert.equal(attrs.title, expected === 'en' ? 'Refresh' : 'Обновить');
    window.asterI18n.setLanguage('ru');
    assert.equal(label.textContent, 'Настройки');
    assert.equal(document.documentElement.lang, 'ru');
  }
});

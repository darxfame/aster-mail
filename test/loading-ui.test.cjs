const { test } = require('node:test');
const assert = require('node:assert/strict');
const { markup } = require('../src/loading-ui.js');

test('loading placeholders are labelled, noninteractive and bounded for each view', () => {
  for (const kind of ['mail', 'reader', 'calendar', 'contacts']) {
    const html = markup(kind, 'Loading <fictional> "content"');
    assert.match(html, /role="status" aria-busy="true"/);
    assert.match(html, /aria-label="Loading &lt;fictional&gt; &quot;content&quot;"/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /<(button|input|a|iframe|script)\b/);
    assert.ok(html.length < 10000);
  }
  for (const [mode, days] of [['day', 1], ['week', 7], ['quarter', 3]]) assert.match(markup('calendar', 'Loading', mode), new RegExp(`--skeleton-days:${days}`));
  assert.throws(() => markup('unknown', 'Loading'), /Unknown loading placeholder/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { windowsChrome } = require('../desktop/window-chrome.cjs');
test('Windows keeps native overlay controls while other platform chrome remains unchanged', () => {
  for (const theme of ['light', 'dark']) {
    const chrome = windowsChrome(theme, 'win32');
    assert.equal(chrome.titleBarStyle, 'hidden');
    assert.equal(chrome.autoHideMenuBar, true);
    assert.equal(chrome.titleBarOverlay.color, '#00000000');
    assert.equal(chrome.titleBarOverlay.symbolColor, theme === 'dark' ? '#eceef2' : '#242933');
    assert.deepEqual(windowsChrome(theme, 'darwin'), {});
    assert.deepEqual(windowsChrome(theme, 'linux'), {});
  }
  assert.throws(() => windowsChrome('invalid', 'win32'), /Invalid window theme/);
});

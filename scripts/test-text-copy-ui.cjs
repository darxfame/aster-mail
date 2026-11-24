// Run the real app with a fictional message and an isolated profile.
const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
app.setPath('userData', process.argv[2]);
require('../desktop/main.cjs');

async function waitFor(check, description) {
  for (let i = 0; i < 200; i++) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function click(contents, point, button) {
  for (const type of ['mouseDown', 'mouseUp']) {
    contents.sendInputEvent({ type, ...point, button, clickCount: 1 });
  }
}

async function verifyShortcut(contents, expected) {
  const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
  for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode: 'C', modifiers });
  await verifyCopy(contents, expected);
}

async function verifyCopy(contents, expected) {
  const copied = await waitFor(() => contents.executeJavaScript('window.copiedText'), 'the native copy event');
  assert.equal(copied, expected);
  await contents.executeJavaScript('window.copiedText = null; void 0');
}

async function renderer(contents, source) {
  const result = await contents.executeJavaScript(`try { ${source} } catch (error) { ({ fixtureError: error.stack }); }`);
  if (result?.fixtureError) throw new Error(result.fixtureError);
  return result;
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const window = await waitFor(() => BrowserWindow.getAllWindows().find(candidate =>
      candidate.webContents.getURL().endsWith('/src/index.html') && !candidate.webContents.isLoading()), 'the main window');
    const contents = window.webContents;
    const js = source => renderer(contents, source);
    await waitFor(() => js('document.querySelector("[data-action=demo]")?.disabled === false'), 'the demo entry point');
    await js('document.querySelector("[data-action=demo]").click(); void 0');
    await waitFor(() => js('state.demo && state.messages.length > 0'), 'the demo inbox');
    await js("openMessage(state.messages[0].id).then(() => null)");
    await js(`state.selected.subject = 'Fictional subject'; state.selected.html = '<p>Fictional HTML body</p>'; renderReader(); void 0`);
    await waitFor(() => js('Boolean(document.querySelector(".email-frame")?.contentDocument?.querySelector("p"))'), 'the HTML message');
    window.focus();

    // Observe trusted Chromium copy commands without writing to the user's clipboard.
    const setup = `window.watchCopy = doc => doc.addEventListener('copy', event => {
      event.preventDefault();
      if (!event.isTrusted) return;
      const field = doc.activeElement;
      window.copiedText = typeof field?.selectionStart === 'number'
        ? field.value.slice(field.selectionStart, field.selectionEnd) : doc.getSelection().toString();
    }); watchCopy(document);`;
    await js(`${setup} document.querySelector('#reader').focus(); getSelection().selectAllChildren(document.querySelector('#reader h2')); void 0`);
    await verifyShortcut(contents, 'Fictional subject');

    const point = await js(`(() => {
      const frame = document.querySelector('.email-frame'), doc = frame.contentDocument, p = doc.querySelector('p');
      watchCopy(doc);
      const range = doc.createRange(); range.selectNodeContents(p);
      const outer = frame.getBoundingClientRect(), inner = range.getBoundingClientRect();
      return { x: Math.round(outer.left + inner.left + 5), y: Math.round(outer.top + inner.top + 5) };
    })()`);
    click(contents, point, 'left');
    await waitFor(() => js('document.activeElement.matches(".email-frame")'), 'focus in the message frame');
    await js(`const doc = document.activeElement.contentDocument; doc.getSelection().selectAllChildren(doc.querySelector('p')); void 0`);
    await verifyShortcut(contents, 'Fictional HTML body');

    let popup;
    Menu.prototype.popup = function (options) { popup = { menu: this, window: options.window }; };
    click(contents, point, 'right');
    await waitFor(() => popup, 'the copy context menu');
    assert.equal(popup.window, window);
    assert.equal(popup.menu.items[0].label, await js("tr('Копировать')"));
    popup.menu.items[0].click();
    await verifyCopy(contents, 'Fictional HTML body');

    await js("compose('new').then(() => detachCompose('new')).catch(error => ({ fixtureError: error.stack }))");
    const editor = await waitFor(() => BrowserWindow.getAllWindows().find(candidate =>
      candidate.webContents.getURL().endsWith('#compose') && candidate.isVisible()), 'the detached composer');
    editor.focus();
    await renderer(editor.webContents, `${setup}
      const field = document.querySelector('#compose-form input[name=subject]');
      field.value = 'Fictional draft'; field.focus(); field.select(); void 0;`);
    await verifyShortcut(editor.webContents, 'Fictional draft');
    console.log('Native copy passed for the reader, HTML frame and detached composer');
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    // The fixture owns no real account. End it without running native window teardown.
    process.exit(code);
  }
});

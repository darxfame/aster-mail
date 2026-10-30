const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/updates-ui.js'), 'utf8');
const available = { installed: '0.1.24', status: 'available', autoCheck: true, available: { version: '0.1.25', notes: '<b>Fictional notes</b>' }, error: '' };
function fixture(api = async () => assert.fail('Unexpected request')) {
  const dialog = { open: false }, panel = { dataset: { installFlow: 'true' }, innerHTML: '' }, listeners = {}, shown = [];
  const version = { classList: { toggle() {} } };
  const document = { visibilityState: 'visible', querySelector: selector => selector === '#modal' ? dialog : selector === '#updates-panel' ? dialog.open ? panel : null : version,
    addEventListener(name, callback) { listeners[name] = callback; } };
  const context = vm.createContext({ errorText: require('../src/errors.js').message, document, window: { aster: {}, asterI18n: { locale: 'en-GB' }, addEventListener() {} },
    tr: value => value, esc: value => String(value).replaceAll('<', '&lt;'), modalBusy: false, modalDirty: false, modalSequence: 0, api,
    modal(title, description, body) { context.modalSequence++; dialog.open = true; shown.push({ title, description, body }); }, toast() {}, setTimeout: callback => callback() });
  vm.runInContext(source, context);
  return { context, dialog, panel, listeners, shown };
}
test('startup snapshot prompts once after boot and waits for an open form or hidden window', () => {
  const f = fixture(); f.context.receiveUpdate(available); assert.equal(f.shown.length, 0);
  f.dialog.open = true; f.context.enableUpdatePrompts(); assert.equal(f.shown.length, 0);
  f.dialog.open = false; f.context.modalDirty = true; f.context.maybePromptUpdate(); assert.equal(f.shown.length, 0);
  f.context.modalDirty = false; f.context.document.visibilityState = 'hidden'; f.context.maybePromptUpdate(); assert.equal(f.shown.length, 0);
  f.context.document.visibilityState = 'visible'; f.context.maybePromptUpdate(); assert.equal(f.shown.length, 1);
  assert.match(f.panel.innerHTML, /installUpdate/); assert.match(f.panel.innerHTML, /&lt;b>Fictional notes/);
  f.dialog.open = false; f.context.receiveUpdate(available); assert.equal(f.shown.length, 1);
});
test('disabled automatic checks and failed checks never show an unsolicited prompt', () => {
  const f = fixture(); f.context.enableUpdatePrompts();
  f.context.receiveUpdate({ ...available, autoCheck: false });
  f.context.receiveUpdate({ ...available, error: 'Offline' });
  assert.equal(f.shown.length, 0);
});
test('one explicit Update action downloads a verified installer then opens it', async () => {
  const calls = [];
  const f = fixture(async operation => { calls.push(operation); return { ...available, status: 'ready' }; });
  f.context.receiveUpdate(available); f.context.enableUpdatePrompts(); assert.equal(calls.length, 0);
  const button = { dataset: { update: 'installUpdate' } };
  await f.listeners.click({ target: { closest: () => button } });
  assert.deepEqual(calls, ['downloadUpdate', 'openUpdateInstaller']);
});
test('download errors or closing the prompt while downloading prevent installer launch', async () => {
  for (const close of [false, true]) {
    const calls = [];
    const f = fixture(async operation => {
      calls.push(operation);
      if (close) f.dialog.open = false;
      return { ...available, status: close ? 'ready' : 'available', error: close ? '' : 'SHA-256 mismatch' };
    });
    f.context.receiveUpdate(available); f.context.enableUpdatePrompts();
    await f.listeners.click({ target: { closest: () => ({ dataset: { update: 'installUpdate' } }) } });
    assert.deepEqual(calls, ['downloadUpdate']);
  }
});

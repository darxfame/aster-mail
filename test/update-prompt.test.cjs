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
    tr: value => value, bytes: value => `${value} B`, esc: value => String(value).replaceAll('<', '&lt;'), modalBusy: false, modalDirty: false, modalSequence: 0, api,
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
test('paused and retrying downloads expose resume, pause and cancel controls', () => {
  const f = fixture(); f.context.enableUpdatePrompts(); f.context.receiveUpdate(available);
  f.context.receiveUpdate({ ...available, status: 'downloading', progress: 25, received: 100, speed: 40, available: { ...available.available, size: 400 } });
  assert.match(f.panel.innerHTML, /100 B \/ 400 B/);
  assert.match(f.panel.innerHTML, /pauseUpdateDownload/);
  assert.match(f.panel.innerHTML, /cancelUpdateDownload/);
  f.context.receiveUpdate({ ...available, status: 'downloading', progress: 25, retryAt: Date.now() + 1000 });
  assert.match(f.panel.innerHTML, /Повторяем загрузку/);
  f.context.receiveUpdate({ ...available, status: 'paused', progress: 25, received: 100 });
  assert.match(f.panel.innerHTML, /Продолжить загрузку/);
  assert.doesNotMatch(f.panel.innerHTML, /pauseUpdateDownload/);
});
test('pause or cancel invalidates a pending install action even if a late result says ready', async () => {
  for (const operation of ['pauseUpdateDownload', 'cancelUpdateDownload']) {
    const calls = [];
    let finish;
    const f = fixture(async name => {
      calls.push(name);
      if (name === 'downloadUpdate') return new Promise(resolve => { finish = resolve; });
      return { ...available, status: 'paused' };
    });
    f.context.receiveUpdate(available); f.context.enableUpdatePrompts();
    const installing = f.listeners.click({ target: { closest: () => ({ dataset: { update: 'installUpdate' } }) } });
    await f.listeners.click({ target: { closest: () => ({ dataset: { update: operation } }) } });
    finish({ ...available, status: 'ready' }); await installing;
    assert.deepEqual(calls, ['downloadUpdate', operation]);
  }
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


test('closing the prompt during installer activation sends cancellation to the backend', async () => {
  const calls = []; let finish;
  const f = fixture(async operation => { calls.push(operation); if (operation === 'openUpdateInstaller') return new Promise(resolve => { finish = resolve; }); return { ...available, status: 'ready' }; });
  f.context.receiveUpdate({ ...available, status: 'ready' }); f.context.enableUpdatePrompts();
  const opening = f.listeners.click({ target: { closest: () => ({ dataset: { update: 'installUpdate' } }) } });
  f.dialog.open = false; f.listeners.close(); finish({ ...available, status: 'ready' }); await opening;
  assert.deepEqual(calls, ['openUpdateInstaller', 'cancelUpdateInstall']);
});

test('restart updates expose the macOS action in settings and disable duplicate actions while preparing', async () => {
  const calls = [];
  const f = fixture(async name => { calls.push(name); return { ...available, status: 'ready', available: { ...available.available, restart: true } }; });
  f.context.receiveUpdate({ ...available, available: { ...available.available, restart: true } }); f.context.enableUpdatePrompts();
  assert.match(f.shown[0].body, /Обновить и перезапустить/);
  f.panel.dataset.installFlow = '';
  f.context.renderUpdates(); assert.match(f.panel.innerHTML, /data-update="installUpdate"/);
  await f.listeners.click({ target: { closest: () => ({ dataset: { update: 'installUpdate' } }) } });
  assert.deepEqual(calls, ['downloadUpdate', 'openUpdateInstaller']);
  f.context.receiveUpdate({ ...available, status: 'ready', installing: true, available: { ...available.available, restart: true } });
  assert.match(f.panel.innerHTML, /Подготавливаем обновление/);
  assert.match(f.panel.innerHTML, /data-update="installUpdate" disabled/);
  f.context.receiveUpdate({ ...available, status: 'ready', staged: true });
  assert.match(f.panel.innerHTML, /установится при выходе/);
  assert.match(f.panel.innerHTML, /data-update="checkUpdates" disabled/);
});

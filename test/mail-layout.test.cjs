const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
function fixture() {
  const listeners = {}, saved = [], attributes = {}, css = {};
  const separator = { previousElementSibling: { clientWidth: 340 }, setPointerCapture() {}, setAttribute: (key, value) => { attributes[key] = value; }, getAttribute: key => attributes[key], matches: () => true };
  const state = { generation: 1, account: {} }, workspace = { clientWidth: 1200 };
  const context = vm.createContext({ state, window: { aster: {} }, interfaceScale: 1,
    $: selector => selector === '#workspace' ? workspace : { open: false },
    localPreferences: { getItem: () => '600', setItem: (...args) => saved.push(args) },
    document: { body: { classList: { toggle() {}, add() {}, remove() {} } }, documentElement: { style: { setProperty: (key, value) => { css[key] = value; } } }, querySelector: () => separator, addEventListener: (name, callback) => { listeners[name] = callback; } },
  });
  vm.runInContext(source.slice(source.indexOf('let preferredMailListWidth =')), context);
  context.installMailLayout();
  return { context, listeners, state, workspace, separator, attributes, saved, css };
}
test('list width fits the reader, restores its account preference and supports keyboard resizing', () => {
  const f = fixture();
  assert.equal(f.context.clampMailListWidth(900, 1200), 720);
  assert.equal(f.context.clampMailListWidth(720, 800), 414);
  assert.equal(f.context.clampMailListWidth(-50, 1200), 260);
  f.context.restoreMailListWidth(); assert.equal(f.attributes['aria-valuenow'], '600');
  f.listeners.keydown({ target: f.separator, key: 'ArrowRight', preventDefault() {} });
  assert.equal(f.css['--mail-list-width'], '620px'); assert.deepEqual(f.saved[0], ['aster-mail-list-width', '620']);
});
test('dragging resizes without persisting every pixel and retirement never saves a previous account width', () => {
  const f = fixture(), event = { button: 0, pointerId: 1, clientX: 340, target: { closest: () => f.separator }, preventDefault() {} };
  f.listeners.pointerdown(event); f.listeners.pointermove({ pointerId: 1, clientX: 460 });
  assert.equal(f.css['--mail-list-width'], '460px'); assert.equal(f.saved.length, 0);
  f.state.generation++; f.state.account = {};
  f.listeners.pointerup({ pointerId: 1, type: 'pointerup' }); assert.equal(f.saved.length, 0);
});
test('interface scale validates bounds and uses native zoom without changing message formatting', async () => {
  const app = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const calls = [], saved = [];
  const context = vm.createContext({ window: { aster: {} }, tr: value => value, api: async (...args) => calls.push(args), localPreferences: { setItem: (...args) => saved.push(args) } });
  vm.runInContext(app.slice(app.indexOf('let interfaceScale ='), app.indexOf('let toastTimer,')), context);
  await context.applyInterfaceScale('1.25');
  assert.equal(calls[0][0], 'setInterfaceScale'); assert.equal(calls[0][1].scale, 1.25);
  assert.deepEqual(saved, [['aster-interface-scale', '1.25']]);
  for (const scale of [0, 4, NaN]) await assert.rejects(context.applyInterfaceScale(scale));
  assert.equal(calls.length, 1);
});

test('short reader windows collapse attachments without overriding a user expansion on every resize', () => {
  const details = { dataset: {}, open: true };
  const context = vm.createContext({ window: { innerHeight: 450 }, document: { querySelectorAll: () => [details] } });
  vm.runInContext(source.slice(source.indexOf('function applyReaderDensity('), source.indexOf('function renderSignaturePreview(')), context);
  context.applyReaderDensity(); assert.equal(details.open, false);
  details.open = true; context.applyReaderDensity(); assert.equal(details.open, true);
  context.window.innerHeight = 800; context.applyReaderDensity(); assert.equal(details.open, true);
  context.window.innerHeight = 450; context.applyReaderDensity(); assert.equal(details.open, false);
});

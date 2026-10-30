const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
function fixture() {
  const opened = [], focused = [], scrolled = [];
  const state = { view: 'mail', filter: 'all', messages: ['a', 'b', 'c'].map(id => ({ id, read: false })) };
  const target = { closest: selector => selector === '#messages,#reader' }, body = { closest: () => null };
  const buttons = state.messages.map(m => ({ dataset: { id: m.id }, focus: () => focused.push(m.id), scrollIntoView: () => scrolled.push(m.id) }));
  const reader = { focus: () => focused.push(state.selected.id) };
  const context = vm.createContext({ $: () => reader, state, mailBatchBusy: false, document: { body, querySelector: () => null, querySelectorAll: () => buttons },
    filteredMessages: () => state.messages.filter(m => state.filter !== 'unread' || !m.read),
    openMessage: id => { opened.push(id); state.selected = state.messages.find(m => m.id === id); },
  });
  vm.runInContext(source.slice(source.indexOf('function navigateMailMessage('), source.indexOf("document.addEventListener('keydown', navigateMailMessage)")), context);
  function key(key = 'ArrowDown', extra = {}) { const event = { key, target, preventDefault() { this.prevented = true; }, ...extra }; context.navigateMailMessage(event); return event; }
  return { context, state, key, opened, focused, scrolled, target, body };
}
test('arrows open loaded mail immediately in order, scroll the selected row and stop at boundaries', () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) f.key();
  f.key('ArrowUp');
  assert.deepEqual(f.opened, ['a', 'b', 'c', 'b']);
  assert.deepEqual(f.focused, f.opened); assert.deepEqual(f.scrolled, f.opened);
  assert.equal(f.state.selected.id, 'b');
});
test('unread navigation retains the opened position when marking read hides the current row', () => {
  const f = fixture(); f.state.filter = 'unread';
  f.key(); f.state.messages[0].read = true;
  f.key(); f.state.messages[1].read = true;
  f.key(); assert.deepEqual(f.opened, ['a', 'b', 'c']);
  f.key('ArrowUp'); assert.equal(f.opened.length, 3);
});
test('text fields, editors, dialogs, checkboxes, modifiers and other views retain their keys', () => {
  const f = fixture();
  for (const field of ['defaultPrevented', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.ok(!f.key('ArrowDown', { [field]: true }).prevented);
  for (const target of [{ closest: () => true }, { closest: () => null, isContentEditable: true }, { closest: () => null }]) assert.ok(!f.key('ArrowDown', { target }).prevented);
  f.context.document.querySelector = () => ({}); assert.ok(!f.key().prevented);
  f.context.document.querySelector = () => null; f.state.view = 'calendar'; assert.ok(!f.key().prevented);
  assert.deepEqual(f.opened, []);
});
test('HTML mail frames and body focus after a compact reader rerender can navigate', () => {
  const f = fixture();
  const frame = { isConnected: true, matches: () => true };
  const target = { closest: () => null, ownerDocument: { defaultView: { frameElement: frame } } };
  f.key('ArrowDown', { target }); f.key('ArrowDown', { target: f.body });
  assert.deepEqual(f.opened, ['a', 'b']);
  frame.isConnected = false; assert.ok(!f.key('ArrowDown', { target }).prevented);
});

test('marking a clicked unread row read retains keyboard focus in the reader when the row disappears', () => {
  const app = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const active = { dataset: { action: 'message', id: 'a' }, isConnected: false };
  const reader = { id: 'reader', focus() { this.focused = true; } };
  let buttons = [active];
  const container = { id: 'messages', contains: () => true, querySelectorAll: () => buttons };
  const context = vm.createContext({ document: { activeElement: active }, $: () => reader });
  vm.runInContext(app.slice(app.indexOf('function preserveListFocus('), app.indexOf('let modalDirty =')), context);
  const restore = context.preserveListFocus(container);
  buttons = [{ dataset: { mailSelect: 'b' }, focus: () => assert.fail('A checkbox must not steal mail navigation') }];
  restore(); assert.equal(reader.focused, true); assert.equal(reader.tabIndex, -1);
});

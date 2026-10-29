const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');

test('background rerenders restore the same mail action without moving focus from other regions', () => {
  const oldButton = { dataset: { action: 'mail-star', id: 'mail-2' }, isConnected: false };
  const other = { dataset: { action: 'message', id: 'mail-2' }, focus() { throw new Error('Wrong action'); } };
  let restored;
  const replacement = { dataset: { ...oldButton.dataset }, focus(options) { restored = options; } };
  let buttons = [oldButton];
  const container = { contains: element => element === oldButton, querySelectorAll: () => buttons };
  const document = { activeElement: oldButton };
  const context = vm.createContext({ tr: value => value, document });
  vm.runInContext(source.slice(source.indexOf('function preserveListFocus('), source.indexOf('let modalDirty =')), context);
  const restore = context.preserveListFocus(container);
  buttons = [other, replacement]; restore();
  assert.equal(restored.preventScroll, true);
  restored = null; document.activeElement = {};
  context.preserveListFocus(container)();
  assert.equal(restored, null);
});

test('unsaved form changes reach native lifecycle protection and stay protected after cancellation', () => {
  const events = {}, windowEvents = {}, flags = [];
  let onClose;
  const context = vm.createContext({ tr: value => value,
    window: { aster: { setUnsavedChanges: value => flags.push(value) }, addEventListener: (name, callback) => { windowEvents[name] = callback; } },
    document: { addEventListener(name, callback) { events[name] = callback; } },
    $: () => ({ addEventListener(_name, callback) { onClose = callback; } }),
    confirm: () => false,
    modalBusy: false, resumeConnectionReads() {},
  });
  vm.runInContext(source.slice(source.indexOf('let modalDirty ='), source.indexOf('new ResizeObserver(')), context);
  events.input({ target: { closest: () => ({}) } });
  assert.deepEqual(flags, [true]);
  assert.equal(context.confirmDiscardChanges(), false);
  let stopped = false;
  events.click({ target: { closest: selector => selector.includes('meeting-return') ? {} : null }, preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true, 'returning to a meeting card cannot discard cancelled edits');
  assert.deepEqual(flags, [true]);
  let prevented = false;
  windowEvents.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'native preload owns the native beforeunload prompt');
  onClose();
  assert.deepEqual(flags, [true, false]);
  assert.equal(context.confirmDiscardChanges(), true);
});

test('keyboard move offers nested folders and rejects a navigation that overtook the dialog', async () => {
  const mailSource = fs.readFileSync(require.resolve('../src/mail-ui.js'), 'utf8');
  const handlers = {}, moved = [];
  let markup, submission;
  const state = { selected: { id: 'mail-1', subject: 'Report', parentId: 'real-inbox' }, folder: 'inbox', generation: 4, demo: false, folders: [{ id: 'real-inbox', name: 'Inbox', wellKnown: 'inbox' }, { id: 'projects', name: 'Projects', parentId: 'real-inbox' }] };
  const context = vm.createContext({ tr: value => value,
    state, document: { addEventListener: (name, callback) => { handlers[name] = callback; } },
    window: { asterFolders: require('../src/folders.js') }, systemFolders: [['inbox', 'Inbox', 'inbox'], ['archive', 'Archive', 'archive']],
    $: selector => selector === '#modal' ? { open: false, close() {} } : { focus() {} },
    esc: String, formError: () => '', modal: (_title, _description, body) => { markup = body; },
    submitForm: (_form, operation) => { submission = operation({ folder: 'projects' }); },
    moveDroppedMail: async (...args) => { moved.push(args); },
  });
  vm.runInContext(mailSource.slice(mailSource.indexOf('let mailMoveContext;'), mailSource.indexOf('async function moveDroppedMail(')), context);
  handlers.click({ target: { closest: () => ({}) } });
  assert.match(markup, /<select name="folder" required>/);
  assert.match(markup, /Inbox \/ Projects/);
  assert.doesNotMatch(markup, /value="inbox"/);
  const event = { target: { id: 'mail-move-form' }, preventDefault() {} };
  handlers.submit(event); await submission;
  assert.deepEqual(moved, [['mail-1', 'projects']]);
  state.generation++;
  handlers.submit(event);
  await assert.rejects(submission, /Папка изменилась/);
  assert.equal(moved.length, 1);
});

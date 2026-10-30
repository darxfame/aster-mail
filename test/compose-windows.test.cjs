const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ComposeWindows } = require('../desktop/compose-windows.cjs');
function fixture() {
  let answer = 0;
  const children = [];
  class Child extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, setZoomFactor() {}, setWindowOpenHandler(handler) { this.openHandler = handler; } });
      children.push(this);
    }
    loadFile(page, options) { this.loaded = { page, options }; return Promise.resolve(); }
    show() { this.visible = true; }
    focus() {}
    destroy() { this.emit('closed'); }
  }
  const windows = new ComposeWindows({ BrowserWindow: Child, page: '/fictional/index.html', tr: value => value, dialog: { showMessageBoxSync: () => answer } });
  const context = (id = '') => ({ account: { sessionId: 'alice' }, snapshot: { dirty: true, data: { draftReference: id ? { id } : null } } });
  return { windows, children, context, answer: value => { answer = value; } };
}
test('parallel compose windows isolate payloads, acknowledge readiness and restrict IPC to their own session and frame', async () => {
  const f = fixture();
  const first = f.windows.create(f.context(), 1), second = f.windows.create(f.context(), 1);
  assert.equal(f.children.length, 2); assert.notEqual(f.children[0], f.children[1]);
  for (const child of f.children) {
    const wc = child.webContents;
    const entry = f.windows.authorize(wc, wc.mainFrame, 'composeContext');
    assert.equal(child.options.webPreferences.nodeIntegration, false);
    assert.equal(child.options.webPreferences.sandbox, true);
    assert.deepEqual(wc.openHandler(), { action: 'deny' });
    assert.equal(child.loaded.options.hash, 'compose');
    for (const operation of ['connect', 'restore', 'disconnect', 'saveLocalData', 'downloadUpdate', 'detachCompose']) assert.throws(() => f.windows.authorize(wc, wc.mainFrame, operation, 'alice'));
    assert.throws(() => f.windows.authorize(wc, {}, 'send', 'alice'));
    assert.throws(() => f.windows.authorize(wc, wc.mainFrame, 'send', 'bob'));
    entry.ready(); assert.equal(entry.context, undefined); assert.equal(child.visible, true);
  }
  await Promise.all([first, second]); f.windows.destroyAll(); assert.equal(f.windows.entries.size, 0);
});
test('cancellation protects dirty drafts, active writes block close and duplicate server draft editors are rejected', async () => {
  const f = fixture(), pending = f.windows.create(f.context('draft-1'), 1);
  const child = f.children[0], entry = f.windows.entries.get(child.webContents);
  assert.equal(f.windows.confirmAll(), false);
  f.answer(1); assert.equal(f.windows.confirmAll(), true);
  entry.busy = true; assert.equal(f.windows.confirmAll(), false);
  let prevented = false; child.emit('close', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  assert.throws(() => f.windows.create(f.context('draft-1'), 1), /уже открыт/);
  entry.busy = false; entry.ready(); await pending; f.windows.destroyAll();
});
test('a failed child never acknowledges transfer, so the original editor can retain its contents', async () => {
  const f = fixture(), pending = f.windows.create(f.context(), 1);
  f.children[0].destroy(); await assert.rejects(pending, /закрыто/); assert.equal(f.windows.entries.size, 0);
});

test('detaching a read message omits in-flight image promises and keeps forwarding metadata cloneable', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/compose-ui.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(0, source.indexOf('// Transfer')), context);
  const snapshot = context.composeMessageSnapshot({ id: 'mail', changeKey: 'fresh', from: { email: 'fictional@example.com' }, html: '<p>Original</p>', attachments: [{ id: 'file', name: 'example.txt' }], contentImages: Promise.resolve({ images: {} }) });
  assert.equal(snapshot.contentImages, undefined);
  const transferred = structuredClone(snapshot);
  assert.equal(transferred.id, 'mail'); assert.equal(transferred.attachments[0].id, 'file'); assert.equal(transferred.html, '<p>Original</p>');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AttachmentPreviews } = require('../desktop/attachment-previews.cjs');
function fixture() {
  const sessions = [], children = [];
  class Child extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; }; children.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() { this.visible = true; }
    focus() {}
    isDestroyed() { return this.destroyed === true; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const session = { fromPartition(name, options) {
    const isolated = new EventEmitter();
    Object.assign(isolated, { name, options, protocol: { handle(scheme, fn) { isolated.handler = fn; }, unhandle() { isolated.handler = null; } },
      setPermissionRequestHandler(fn) { isolated.permission = fn; }, setPermissionCheckHandler(fn) { isolated.check = fn; }, webRequest: { onBeforeRequest(fn) { isolated.request = fn; } }, clearStorageData: async () => {} });
    sessions.push(isolated); return isolated;
  } };
  const owner = new EventEmitter(); owner.isDestroyed = () => false;
  const previews = new AttachmentPreviews({ BrowserWindow: Child, session });
  const context = () => ({ owner, revision: previews.begin(owner), assertActive() {} });
  const file = { name: 'fictional.pdf', bytes: Buffer.from('%PDF-1.7\nfictional\n%%EOF') };
  return { previews, owner, context, file, children, sessions };
}
test('PDF preview is memory-only, credential-free and rejects every outside network destination', async () => {
  const f = fixture(); await f.previews.open(f.file, f.context());
  const child = f.children[0], isolated = f.sessions[0];
  assert.equal(child.visible, true); assert.equal(child.options.webPreferences.nodeIntegration, false); assert.equal(child.options.webPreferences.sandbox, true);
  assert.equal(child.options.webPreferences.webSecurity, true); assert.equal(child.options.webPreferences.session, isolated);
  assert.equal(isolated.name.startsWith('persist:'), false); assert.equal(isolated.options.cache, false);
  const response = isolated.handler({ url: child.url, method: 'GET' });
  assert.equal(response.headers.get('content-type'), 'application/pdf'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.file.bytes);
  assert.equal(isolated.handler({ url: 'https://outside.example.test/', method: 'GET' }).status, 403);
  for (const url of ['https://outside.example.test/', 'http://127.0.0.1/', 'file:///private/path']) isolated.request({ url }, result => assert.equal(result.cancel, true));
  assert.deepEqual(child.openHandler(), { action: 'deny' }); assert.equal(isolated.check(), false);
  let cancelled = false; child.webContents.emit('will-frame-navigate', { url: 'file:///private/path', preventDefault() { cancelled = true; } }); assert.equal(cancelled, true);
  f.previews.closeAll(); assert.equal(child.destroyed, true); assert.equal(isolated.handler, null);
});
test('closing or retiring the editor invalidates outstanding reads before a PDF can open', async () => {
  const f = fixture(), pending = f.context(); f.previews.close(f.owner);
  await assert.rejects(f.previews.open(f.file, pending), /закрыт/); assert.equal(f.children.length, 0);
  await f.previews.open(f.file, f.context()); f.owner.emit('destroyed'); assert.equal(f.previews.windows.size, 0);
  await assert.rejects(f.previews.open({ name: 'fake.pdf', bytes: Buffer.from('not pdf') }, f.context()), /PDF/);
});

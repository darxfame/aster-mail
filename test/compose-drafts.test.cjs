const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../desktop/protocol.cjs');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');

test('resumed compose updates the same draft, preserves untouched original HTML and does not duplicate its signature', async () => {
  for (const save of [true, false]) {
    const calls = [];
    let closed = false, refreshed = false;
    const draft = { id: 'draft', changeKey: 'version', html: '<p>Original <img src="cid:logo@example.com"></p>', text: '', attachments: [{ size: 8 }] };
    const data = { to: '', cc: '', bcc: 'anna@example.com', subject: 'Resume' };
    const context = vm.createContext({
      composeData: { draftReference: { id: draft.id, changeKey: draft.changeKey }, draftOriginal: draft, draftInitial: '<p>Sanitized initial</p>', editor: { read: () => ({ body: 'Original', bodyHtml: '<p>Sanitized initial</p>' }) }, attachments: [], signature: null },
      state: { demo: false, folder: 'inbox', folders: [] },
      $: selector => selector === '#compose-form' ? { reportValidity: () => true } : { close: () => { closed = true; } },
      submitForm: (_form, operation) => operation({ ...data }),
      api: async (operation, payload) => { calls.push({ operation, payload }); },
      toast() {}, loadView: async () => { refreshed = true; },
    });
    vm.runInContext(source.slice(source.indexOf('async function sendCompose('), source.indexOf('async function handleAction(')), context);
    await context.sendCompose(save);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'editDraft');
    assert.equal(calls[0].payload.action, save ? 'save' : 'send');
    assert.equal(calls[0].payload.ref.id, 'draft');
    assert.equal(calls[0].payload.ref.changeKey, 'version');
    assert.equal(calls[0].payload.bodyHtml, draft.html);
    assert.equal(calls[0].payload.bcc, 'anna@example.com');
    assert.equal(calls[0].payload.attachments.length, 0);
    assert.equal(closed, true); assert.equal(refreshed, true);
  }
});

test('edited draft sends edited HTML and an uncertain write leaves the compose dialog open', async () => {
  const failure = new Error('Result unknown');
  let payload;
  const context = vm.createContext({
    composeData: { draftReference: { id: 'draft', changeKey: 'version' }, draftOriginal: { html: 'original', attachments: [] }, draftInitial: 'initial', editor: { read: () => ({ body: 'Edited', bodyHtml: '<b>Edited</b>' }) }, attachments: [] },
    state: { demo: false }, $: () => ({ reportValidity: () => true, close() { assert.fail('Failed compose must remain open'); } }),
    submitForm: (_form, operation) => operation({ to: 'anna@example.com', subject: 'Edited' }),
    api: async (_operation, data) => { payload = data; throw failure; },
  });
  vm.runInContext(source.slice(source.indexOf('async function sendCompose('), source.indexOf('async function handleAction(')), context);
  await assert.rejects(context.sendCompose(false), error => error === failure);
  assert.equal(payload.bodyHtml, '<b>Edited</b>');
});

test('BCC-only new messages are validated and encoded without losing blind recipients', () => {
  const xml = P.sendSOAP({ to: '', cc: '', bcc: 'anna@example.com', body: 'Private recipient' });
  assert.match(xml, /<t:BccRecipients><t:Mailbox><t:EmailAddress>anna@example.com/);
  assert.doesNotMatch(xml, /<t:ToRecipients>/);
  assert.throws(() => P.sendSOAP({ to: '', bcc: 'not-an-address', body: 'Invalid' }));
  assert.throws(() => P.sendSOAP({ to: '', cc: '', bcc: '', body: 'No recipient' }));
});

test('draft editor retains only inert CID images and never mounts remote or data images', () => {
  const editorSource = fs.readFileSync(require.resolve('../src/mail-editor.js'), 'utf8');
  const removed = [];
  const images = ['cid:logo@example.com', 'https://tracker.example.com/pixel', 'data:image/svg+xml,unsafe', 'file:///secret', 'cid:invalid content'];
  const context = vm.createContext({
    preserveCidImages: true,
    root: { asterRichContent: { sanitize(_value, options) {
      assert.equal(options.images, true);
      return { body: { innerHTML: 'sanitized' }, querySelectorAll: () => images.map(src => ({ getAttribute: () => src, remove: () => removed.push(src) })) };
    } } },
  });
  vm.runInContext(editorSource.slice(editorSource.indexOf('    function clean('), editorSource.indexOf('    if (html !== undefined)')), context);
  assert.equal(context.clean('untrusted'), 'sanitized');
  assert.deepEqual(removed, images.slice(1));
});

test('late draft and signature reads cannot replace a newer composer, dialog or navigation', async () => {
  for (const mode of ['new', 'draft']) for (const invalidation of ['composeSequence++', 'modalSequence++', 'state.generation++']) {
    let finish;
    const state = { account: {}, demo: false, generation: 1, folder: 'inbox', folders: [], selected: { id: 'draft' } };
    const originalCompose = { editor: 'newer unsaved text' };
    const context = vm.createContext({
      modalBusy: false, composeSequence: 0, modalSequence: 0, composeData: originalCompose, state,
      ready: () => true, isDraftMessage: () => true, ref: value => ({ id: value.id }), syncSignature: true,
      getServerSignature: () => new Promise(resolve => { finish = resolve; }),
      api: () => new Promise(resolve => { finish = resolve; }),
      modal() { assert.fail('An overtaken composer must not mount'); },
    });
    vm.runInContext(source.slice(source.indexOf('async function compose('), source.indexOf('function localDate(')), context);
    const pending = context.compose(mode);
    vm.runInContext(invalidation, context);
    finish({ autoAddSignature: true }); await pending;
    assert.equal(context.composeData, originalCompose);
  }
});

test('pending submissions block keyboard edits and report failures in the visible form alert', async () => {
  let fail;
  const errorBox = {}, attributes = new Map();
  const form = {
    classList: { add() {}, remove() {} }, isConnected: false,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    querySelector(selector) { assert.equal(selector, '.form-error[role="alert"]'); return errorBox; },
  };
  const context = vm.createContext({
    modalBusy: false, document: { activeElement: {} },
    FormData: class { *[Symbol.iterator]() { yield ['to', 'anna@example.com']; } },
  });
  vm.runInContext(source.slice(source.indexOf('async function submitForm('), source.indexOf('async function sendCompose(')), context);
  const pending = context.submitForm(form, () => new Promise((_resolve, reject) => { fail = reject; }));
  assert.equal(form.inert, true); assert.equal(attributes.get('aria-busy'), 'true');
  await context.submitForm(form, () => assert.fail('A second submission must not run'));
  fail(new Error('Результат отправки неизвестен')); await pending;
  assert.equal(form.inert, false); assert.equal(attributes.has('aria-busy'), false);
  assert.match(errorBox.textContent, /Результат отправки неизвестен/);
});

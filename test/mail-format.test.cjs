const test = require('node:test');
const assert = require('node:assert/strict');
const { styleAllowed } = require('../src/rich-content.js');
const P = require('../desktop/protocol.cjs');

test('HTML editing and outgoing serialization collapse source indentation while plain text preserves spaces', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const noop = { addEventListener() {} };
  const toolbar = { ...noop, querySelectorAll: () => [] };
  const linkForm = { querySelector: () => noop };
  const root = { asterRichContent: { sanitize: value => ({ body: { innerHTML: value }, querySelectorAll: () => [] }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/mail-editor.js'), 'utf8'), { window: root, tr: value => value });
  for (const html of [undefined, '<p>First</p>\n    <p><b>Second</b> line</p>']) {
    const editor = { ...noop, style: {}, classList: { toggle() {} }, innerText: 'First\nSecond line' };
    const target = { querySelector: selector => selector === '.compose-editor' ? editor : selector === '.format-toolbar' ? toolbar : linkForm };
    const mounted = root.asterMailEditor.mount(target, '  plain text\n    indented', { html });
    assert.equal(editor.style.whiteSpace, html ? 'normal' : 'pre-wrap');
    assert.ok(mounted.read().bodyHtml.startsWith(`<div style="white-space: ${html ? 'normal' : 'pre-wrap'}">`));
    if (html) assert.equal(editor.innerHTML, html);
    else assert.equal(editor.textContent, '  plain text\n    indented');
  }
});

test('mail formatting permits text styling but excludes network, positioning and CSS expressions', () => {
  for (const [name,value] of [['color','#c03060'],['font-family','Georgia, serif'],['font-size','24px'],['font-weight','bold'],['text-align','center'],['text-decoration','underline line-through'],['background-color','rgb(255, 240, 166)']]) assert.equal(styleAllowed(name,value),true,`${name}: ${value}`);
  for (const [name,value] of [['background','url(https://example.com/tracker)'],['background-color','url(https://example.com)'],['color','var(--text)'],['color','expression(alert(1))'],['position','fixed'],['font-size','999px'],['font-family','url(https://example.com/font)'],['margin-left','-99px']]) assert.equal(styleAllowed(name,value),false,`${name}: ${value}`);
});
test('new mail, drafts and replies send HTML formatting while retaining reference keys and explicit recipients', () => {
  const data = {to:'anna@example.com',cc:'',subject:'Formatting',body:'Formatted text',bodyHtml:'<p style="text-align: center"><b>Formatted</b> <a href="https://example.com">text</a></p>'};
  const sent = P.sendSOAP(data);
  assert.match(sent,/<t:Body BodyType="HTML">&lt;p style=&quot;text-align: center&quot;&gt;/);
  assert.match(sent,/&lt;b&gt;Formatted&lt;\/b&gt;/);
  assert.match(P.sendSOAP(data,true),/MessageDisposition="SaveOnly"/);
  const reply = P.sendSOAP({...data,kind:'reply-all',reference:{id:'original',changeKey:'fresh-key'}});
  assert.match(reply,/<t:NewBodyContent BodyType="HTML">/);
  assert.match(reply,/<t:ReferenceItemId Id="original" ChangeKey="fresh-key"/);
  assert.match(reply,/<t:CcRecipients><\/t:CcRecipients>/);
});

test('edited history replaces the response body instead of appending a second original quote', () => {
  for (const [kind, element] of [['reply', 'ReplyToItem'], ['reply-all', 'ReplyAllToItem'], ['forward', 'ForwardItem']]) {
    for (const save of [false, true]) {
      const xml = P.sendSOAP({ kind, reference: { id: 'original', changeKey: 'fresh-key' }, to: 'anna@example.com', subject: 'Reply', body: 'Answer\nEdited quote', bodyHtml: '<p>Answer</p><blockquote><b>Edited quote</b></blockquote>', replaceBody: true }, save);
      assert.match(xml, new RegExp(`<t:${element}>`));
      assert.match(xml, /<t:Subject>Reply<\/t:Subject><t:Body BodyType="HTML">/);
      assert.match(xml, /&lt;blockquote&gt;&lt;b&gt;Edited quote/);
      assert.match(xml, /<t:ReferenceItemId Id="original" ChangeKey="fresh-key"/);
      assert.doesNotMatch(xml, /NewBodyContent/);
    }
  }
});

test('attachment batches share a size limit, preserve earlier files and support removal', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const error = {}, picked = { replaceChildren(...rows) { this.rows = rows; } };
  const context = vm.createContext({ tr: value => value, composeData: { attachments: [] }, modalBusy: false, markModalDirty() {}, bytes: n => String(n), $: selector => selector === '#picked-files' ? picked : error, document: { createElement() { return { setAttribute() {}, addEventListener(name, fn) { this[name] = fn; }, append(child) { this.child = child; } }; } } });
  vm.runInContext(source.slice(source.indexOf('function addComposeFiles('), source.indexOf("document.addEventListener('change'", source.indexOf('function addComposeFiles('))), context);
  const first = { name: '<b>file.txt', size: 10 }, second = { name: 'next.txt', size: 20 };
  context.addComposeFiles([first]); context.addComposeFiles([second]);
  assert.deepEqual(Array.from(context.composeData.attachments), [first, second]);
  assert.equal(picked.rows[0].textContent, '<b>file.txt · 10 ');
  context.addComposeFiles([{ name: 'large', size: 20 * 1024 * 1024 }]);
  assert.match(error.textContent, /превышает 20 МБ/);
  assert.equal(context.composeData.attachments.length, 2);
  picked.rows[0].child.click();
  assert.deepEqual(Array.from(context.composeData.attachments), [second]);
});

test('compose accepts file drops, rejects drops during sending and leaves text drags alone', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const classes = new Set(), added = [];
  const dialog = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) }, contains: value => value === 'inside' };
  const context = vm.createContext({ tr: value => value, modalBusy: false, $: () => dialog, addComposeFiles: files => added.push(...files) });
  const start = source.indexOf("  const dialog = $('#modal');", source.indexOf('async function compose('));
  vm.runInContext(source.slice(start, source.indexOf('  composeData.editor =', start)), context);
  let prevented = 0;
  const file = { name: 'fictional.txt', size: 3 };
  const event = { dataTransfer: { types: ['Files'], files: [file] }, preventDefault() { prevented++; } };
  dialog.ondragover(event); assert.equal(event.dataTransfer.dropEffect, 'copy'); assert.ok(classes.has('compose-file-drop'));
  dialog.ondrop(event); assert.deepEqual(added, [file]); assert.equal(classes.size, 0);
  context.modalBusy = true; dialog.ondragover(event); dialog.ondrop(event);
  assert.equal(event.dataTransfer.dropEffect, 'none'); assert.equal(added.length, 1);
  const before = prevented;
  dialog.ondragover({ ...event, dataTransfer: { types: ['text/html'] } }); assert.equal(prevented, before);
});

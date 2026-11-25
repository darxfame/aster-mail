// Exercise clipboard payloads in the Electron editor without changing the system clipboard.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { sendSOAP } = require('../desktop/protocol.cjs');

app.setPath('userData', process.argv[2]);
require('../desktop/main.cjs');

async function waitFor(check) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the composer');
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const window = await waitFor(() => BrowserWindow.getAllWindows().find(candidate =>
      candidate.webContents.getURL().endsWith('/src/index.html') && !candidate.webContents.isLoading()));
    const js = code => window.webContents.executeJavaScript(code);
    await waitFor(() => js('document.querySelector("[data-action=demo]")?.disabled === false'));
    await js(`document.querySelector('[data-action=demo]').click(); compose()`);
    await js(`window.addEventListener('error', event => { window.pasteError = event.error?.stack || event.message; });
      window.bodyEditor = document.querySelector('#compose-body');
      window.selectBody = (start, end = start) => {
        bodyEditor.focus();
        getSelection().setBaseAndExtent(bodyEditor.firstChild, start, bodyEditor.firstChild, end);
      };
      window.paste = data => bodyEditor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      bodyEditor.textContent = 'before replace after'; selectBody(7, 14);
      window.canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
      canvas.getContext('2d').fillRect(0, 0, 20, 20);
      window.imageData = new DataTransfer();
      new Promise(resolve => canvas.toBlob(blob => {
        imageData.items.add(new File([blob], 'clipboard.png', { type: blob.type }));
        paste(imageData); resolve();
      }));`);
    assert.equal(await js('window.pasteError'), undefined);
    assert.equal(await js(`bodyEditor.querySelectorAll('img').length`), 1, 'paste places a bitmap in the editor');
    assert.equal(await js("bodyEditor.innerText.trim()"), 'before  after');
    await waitFor(() => js('bodyEditor.querySelector("img")?.naturalWidth === 20'));
    assert.equal(await js('modalDirty'), true);
    const read = `(() => {
      const files = [], body = composeData.editor.read('', files);
      return { html: body.bodyHtml, ids: files.map(file => file.contentId) };
    })()`;
    const pasted = await js(read);
    assert.equal(pasted.ids.length, 1);
    assert.match(pasted.html, /before <img[^>]+src="cid:aster-image-[^"]+"[^>]*> after/);
    await js("document.execCommand('undo')");
    assert.deepEqual((await js(read)).ids, []);
    assert.equal(await js('bodyEditor.innerText'), 'before replace after');
    await js("document.execCommand('redo')");
    assert.deepEqual(await js(read), pasted);

    await js(`getSelection().selectAllChildren(bodyEditor); getSelection().collapseToEnd();
      const text = new DataTransfer(); text.setData('text/plain', '<note>'); paste(text); void 0;`);
    assert.match((await js(read)).html, /&lt;note&gt;/);
    await js(`const rich = new DataTransfer(); rich.setData('text/html', '<b>formatted</b><img src="https://example.test/no.png" onerror="alert(1)">'); paste(rich); void 0;`);
    assert.match((await js(read)).html, /<b>formatted<\/b>/);
    assert.doesNotMatch((await js(read)).html, /example\.test|onerror/);
    assert.deepEqual((await js(read)).ids, pasted.ids);
    await js(`const oversized = new DataTransfer();
      oversized.items.add(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
      paste(oversized); void 0;`);
    assert.equal(await js(`document.querySelector('#compose-form .compose-footer .form-error').textContent`), await js("tr('Изображение из буфера должно быть размером до 5 МБ')"));
    assert.deepEqual((await js(read)).ids, pasted.ids);

    await js("detachCompose('new')");
    const detached = await waitFor(() => BrowserWindow.getAllWindows().find(candidate =>
      candidate.webContents.getURL().endsWith('#compose') && candidate.isVisible()));
    const child = code => detached.webContents.executeJavaScript(code);
    await waitFor(() => child("document.querySelector('#compose-body img')?.naturalWidth === 20"));
    assert.deepEqual((await child(read)).ids, pasted.ids);
    await child(`state.demo = false;
      state.account = { server: 'https://mail.example.test', sessionId: 'fictional' };
      api = async (operation, data) => { window.outgoing = { operation, data }; throw new Error('Fictional draft write'); };
      composeData.attachments.push(new File(['ordinary'], 'note.txt', { type: 'text/plain' }));
      (async () => { await sendCompose(true); return true; })();`);
    const { operation, data } = await child('window.outgoing');
    assert.equal(operation, 'draft');
    assert.ok(data.bodyHtml.includes(`src="cid:${pasted.ids[0]}"`));
    assert.deepEqual(data.attachments.map(({ name, type, inline, contentId }) => ({ name, type, inline, contentId })), [
      { name: 'image.png', type: 'image/png', inline: true, contentId: pasted.ids[0] },
      { name: 'note.txt', type: 'text/plain', inline: undefined, contentId: undefined },
    ]);
    assert.equal(Buffer.from(data.attachments[0].content, 'base64').readUInt32BE(16), 20);
    const reopened = {
      id: 'fixture-draft', subject: 'Saved bitmap', folder: 'drafts', isDraft: true, html: data.bodyHtml,
      to: [], cc: [], bcc: [], attachments: [],
      contentImages: { images: { [`cid:${pasted.ids[0]}`]: `data:image/png;base64,${data.attachments[0].content}` } },
    };
    await js(`compose('draft', null, null, { message: ${JSON.stringify(reopened)} })`);
    await waitFor(() => js("document.querySelector('#compose-body img')?.naturalWidth === 20"));
    assert.ok((await js(read)).html.includes(`src="cid:${pasted.ids[0]}"`));
    assert.deepEqual((await js(read)).ids, [], 'Reopening an existing draft keeps its attachment without uploading it again');
    const replySource = { id: 'fictional-original', changeKey: 'fixture-key', subject: 'Example', from: { email: 'sender@example.test' }, text: 'Original message', to: [], cc: [] };
    const formattedReply = '<p>Hello!</p>\n<p>Example paragraph.</p>\n<p><strong>Details</strong><br>Manual line break</p>\n<ul>\n<li>First item</li>\n<li>Second item</li>\n</ul>';
    const expectedReply = 'Hello!\n\nExample paragraph.\n\nDetails\nManual line break\n\nFirst item\nSecond item';
    await js(`(async () => {
      await compose('reply', null, null, { message: ${JSON.stringify(replySource)} });
      window.bodyEditor = document.querySelector('#compose-body');
      bodyEditor.focus();
      const formatted = new DataTransfer();
      formatted.setData('text/html', ${JSON.stringify(formattedReply)});
      paste(formatted);
    })()`);
    assert.equal(await js('bodyEditor.innerText'), expectedReply);
    await js(`state.demo = false;
      state.account = { server: 'https://mail.example.test', sessionId: 'fictional' };
      waitForComposeSend = async () => true;
      api = async (operation, data) => { window.replyPayload = { operation, data }; throw new Error('Fictional reply write'); };
      sendCompose(false);`);
    const reply = await js('window.replyPayload');
    assert.equal(reply.operation, 'send');
    assert.equal(reply.data.kind, 'reply');
    assert.deepEqual(reply.data.reference, { id: replySource.id, changeKey: replySource.changeKey });
    assert.equal(reply.data.replaceBody, undefined);
    assert.equal(reply.data.body, expectedReply);
    assert.match(sendSOAP(reply.data), /<t:NewBodyContent BodyType="HTML">.*&lt;strong&gt;Details&lt;\/strong&gt;/s);
    const renderedReply = await js(`(() => {
      const external = document.createElement('div');
      external.innerHTML = window.replyPayload.data.bodyHtml;
      document.body.append(external);
      try { return external.innerText; } finally { external.remove(); }
    })()`);
    assert.equal(renderedReply, expectedReply);
    await js(`state.demo = true; state.account = null;
      compose('new'); window.bodyEditor = document.querySelector('#compose-body'); bodyEditor.focus();
      const plain = new DataTransfer();
      plain.setData('text/plain', 'First line\\r\\n\\r\\nSecond line\\nThird line');
      paste(plain); void 0;`);
    assert.equal(await js('composeData.editor.read().body'), 'First line\n\nSecond line\nThird line');
    console.log('Clipboard images, formatted reply spacing and plain-text line breaks passed.');
  } catch (error) {
    console.error(error);
    code = 1;
  }
  process.send(code, () => process.exit(code));
});

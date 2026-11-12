// Actual Chromium UI, fictional account and injected calls only. Never connects to Exchange.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-auto-replies-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`UI did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await waitFor('Boolean(document.querySelector("[data-action=demo]"))');
    await js('document.querySelector("[data-action=demo]").click()');
    await waitFor('state.demo && state.messages.length > 0');
    const html = '<html>\r\n<body>\r\n<div>\r\n<p>Добрый день!<br style="font-size:12px">Я отсутствую.</p>\r\n<p>Вернусь &amp; отвечу.</p>\r\n</div>\r\n</body></html>';
    assert.equal(await js(`autoReplyText(${JSON.stringify(html)})`), 'Добрый день!\nЯ отсутствую.\n\nВернусь & отвечу.');
    assert.equal(await js(`autoReplyText('Первая строка\\nВторая строка\\n\\nАбзац')`), 'Первая строка\nВторая строка\n\nАбзац');
    assert.equal(await js(`autoReplyText('<div>Первая<div>Вторая</div>Третья</div>')`), 'Первая\nВторая\nТретья');
    const outlook = '<p class="MsoNormal">Добрый день.</p>' + '<p class="MsoNormal">&nbsp;</p>'.repeat(4)
      + '<p style="margin:0cm">Коллеги, с 27.07 по 09.08 буду в отпуске.</p><p style="margin:0cm">В период отсутствия прошу обращаться</p>'
      + '<p class="MsoNormal">к&nbsp;&nbsp; Петру&nbsp;&nbsp; (person@example.test).</p><p class="MsoNormal">Буду недоступен.</p>' + '<p class="MsoNormal">&nbsp;</p>'.repeat(2);
    const outlookText = 'Добрый день.\n\nКоллеги, с 27.07 по 09.08 буду в отпуске.\nВ период отсутствия прошу обращаться\nк Петру (person@example.test).\nБуду недоступен.';
    assert.equal(await js(`autoReplyText(${JSON.stringify(outlook)})`), outlookText);
    assert.equal(await js(`autoReplyText('<pre> A  B\\n\\n\\nC </pre>')`), ' A  B\n\n\nC ');
    assert.equal(await js(`autoReplyText('Добрый день.\\n\\n\\n\\nКоллеги, прошу обращаться к  сотруднику.\\n\\n')`), 'Добрый день.\n\nКоллеги, прошу обращаться к сотруднику.');
    assert.equal(await js(`autoReplyText('<div style="white-space:pre-wrap"> A  B\\n\\n\\nC </div>')`), ' A  B\n\n\nC ');
    const requests = [];
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://external.example.test/*'] }, (request, callback) => { requests.push(request.url); callback({ cancel: true }); });
    assert.equal(await js(`autoReplyText('<p style="margin:0;background-image:url(https://external.example.test/background)">Text<img src="https://external.example.test/image"></p>')`), 'Text');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(requests.length, 0, 'Source styles and images must not trigger any network requests');
    await js('settingsModal()');
    await js('document.querySelector("#settings-tab-auto-replies").click()');
    assert.equal(await js('document.querySelector("#auto-replies-fields").disabled'), true);
    await js('document.querySelector("#auto-replies-load").click()');
    await waitFor('!document.querySelector("#auto-replies-fields").disabled');
    assert.equal(await js('document.querySelector("#auto-replies-period").hidden'), false, 'Date controls remain visible even before Scheduled is selected');
    assert.equal(await js('document.querySelector("#settings-form").elements.oofStart.disabled'), true);
    await js(`(() => {
      const form=document.querySelector('#settings-form');
      form.elements.oofState.value='Scheduled'; form.elements.oofState.dispatchEvent(new Event('input',{bubbles:true})); form.elements.oofState.dispatchEvent(new Event('change',{bubbles:true}));
      form.elements.oofStart.value='2026-11-12T09:00'; form.elements.oofEnd.value='2026-11-13T18:00';
      form.elements.oofInternal.value='Я в отпуске до 13 ноября. По срочным вопросам обратитесь к коллеге.';
      form.elements.oofAudience.value='Known'; form.elements.oofAudience.dispatchEvent(new Event('change',{bubbles:true}));
      form.elements.oofExternal.value='Спасибо за письмо. Отвечу после возвращения.';
    })()`);
    assert.equal(await js('modalDirty'), true);
    assert.equal(await js('document.querySelector("#settings-form").elements.oofStart.disabled'), false);
    assert.equal(await js('document.querySelector("#auto-replies-period").hidden'), false);
    const output = path.join(root, 'release/auto-replies-ui'); await fs.mkdir(output, { recursive: true });
    for (const scale of [1, 2]) {
      window.webContents.setZoomFactor(scale);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await js(`(() => {const p=document.querySelector('#settings-panel-auto-replies');return p.scrollWidth<=p.clientWidth+1;})()`), true);
      await fs.writeFile(path.join(output, `auto-replies-${scale * 100}.jpg`), (await window.webContents.capturePage()).toJPEG(85));
    }
    window.webContents.setZoomFactor(1);
    await js('document.querySelector("#auto-replies-save").click()');
    await waitFor('!modalBusy && !modalDirty');
    assert.equal(await js('demoAutoReplies.state'), 'Scheduled');
    assert.equal(await js('document.querySelector("#auto-replies-fields").disabled'), true);
    await js('document.querySelector("#auto-replies-load").click()');
    await waitFor('!document.querySelector("#auto-replies-fields").disabled');
    assert.equal(await js('document.querySelector("[name=oofInternal]").value'), 'Я в отпуске до 13 ноября. По срочным вопросам обратитесь к коллеге.');
    await js(`setModalDirty(false);document.querySelector('#modal').close();applyLanguage('en');state.theme='dark';document.body.classList.add('dark');settingsModal()`);
    await js('document.querySelector("#settings-tab-auto-replies").click();document.querySelector("#auto-replies-load").click()');
    await waitFor('!document.querySelector("#auto-replies-fields").disabled');
    assert.equal(await js('document.querySelector("#auto-replies-save").textContent'), 'Save automatic replies to Exchange');
    assert.equal(await js('document.querySelector("#settings-panel-auto-replies").hidden'), false);
    await new Promise(resolve => setTimeout(resolve, 150));
    await fs.writeFile(path.join(output, 'auto-replies-en-dark.jpg'), (await window.webContents.capturePage()).toJPEG(85));
    await js(`setModalDirty(false);document.querySelector('#modal').close();applyLanguage('ru');state.theme='light';document.body.classList.remove('dark')`);
    // A fictional desktop API verifies failures and stale reads in the actual renderer.
    await js(`(() => {
      setModalDirty(false);document.querySelector('#modal').close();
      state.demo=false;state.account={sessionId:'fictional'};window.fixtureCalls=[];
      api=async (operation,data)=>{fixtureCalls.push(operation);if(operation==='autoReplies')return {...demoAutoReplies,internal:${JSON.stringify(outlook + '<script>throw 1</script>')},revision:'fictional'};if(operation==='saveAutoReplies'){window.fixtureOofWrite=data;throw new Error('Fictional lost response');}return [];};
    })()`);
    await js('settingsModal()');
    await js('document.querySelector("#settings-tab-auto-replies").click();document.querySelector("#auto-replies-load").click()');
    await waitFor('!document.querySelector("#auto-replies-fields").disabled');
    assert.equal(await js('document.querySelector("[name=oofInternal]").value'), outlookText);
    await js('document.querySelector("#auto-replies-save").click()');
    await waitFor('!modalBusy && Boolean(document.querySelector("#auto-replies-error").textContent)');
    assert.equal(await js('document.querySelector("#auto-replies-fields").disabled'), true);
    assert.equal(await js('Object.hasOwn(fixtureOofWrite,"internal")'), false, 'Unchanged Exchange markup must not be replaced by normalized display text');
    await js('document.querySelector("#auto-replies-save").click()');
    assert.equal(await js('fixtureCalls.filter(value=>value==="saveAutoReplies").length'), 1);
    // A response for a closed settings form cannot populate its replacement.
    await js(`(() => {api=operation=>operation==='autoReplies'?new Promise(resolve=>window.finishRead=resolve):Promise.resolve([]);document.querySelector('#auto-replies-load').click();setModalDirty(false);document.querySelector('#modal').close();})()`);
    await js('settingsModal()');
    await js('finishRead({...demoAutoReplies, internal:"Stale reply"})');
    assert.equal(await js('document.querySelector("#auto-replies-fields").disabled'), true);
    assert.equal(await js('document.querySelector("[name=oofInternal]").value'), '');
    await js(`api=async()=>[];applyInterfaceScale=async()=>{throw new Error('Fictional general settings failure')};document.querySelector('#settings-form').requestSubmit()`);
    await waitFor('!modalBusy && Boolean(document.querySelector(".settings-footer .form-error").textContent)');
    assert.equal(await js('document.querySelector(".settings-footer .form-error").textContent'), 'Fictional general settings failure');
    assert.equal(await js('document.querySelector("#auto-replies-error").textContent'), '');
    console.log('Automatic reply UI passed: demo, schedule, text safety, failed writes, stale reads, 100%/200% layout.');
  } finally {
    window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

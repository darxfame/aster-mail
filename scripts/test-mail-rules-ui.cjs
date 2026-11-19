// Rules UI uses fictional data only; no Exchange writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-rules-ui-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Rules did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error(code); throw error; });
    await window.loadFile(path.resolve(__dirname, '../src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    await js(`(async () => {
      await openMessage(state.messages.find(message => !message.meeting).id);
      window.readerBefore = document.querySelector('#reader');
      window.selectedBefore = state.selected;
      state.demo = false;
      state.account = { server: 'https://mail.example.test', username: 'fictional', sessionId: 'fictional' };
      window.aster = {};
      window.rulesCalls = [];
      window.failWrite = false;
      window.confirm = () => true;
      let rules = [
        { id: 'rule1', revision: 'a'.repeat(64), name: 'Invoices <safe>', sender: '', internalSenders: [{ index: 0, name: 'Lab <robot>' }], subject: 'Invoice', folder: 'target', markRead: true, priority: 1, enabled: true, editable: true },
        { id: 'complex', revision: 'b'.repeat(64), name: 'Complex Outlook', priority: 2, enabled: true, editable: false, readOnlyReason: 'outlook',
          details: { conditions: [{ key: 'ContainsBodyStrings', values: ['<safe>'] }], exceptions: [], actions: [{ key: 'StopProcessingRules', values: ['true'] }] } },
      ];
      api = async (operation, data) => {
        rulesCalls.push({ operation, data });
        if (operation === 'notificationSettings') return { ...notificationPreferences };
        if (operation === 'mailRules') return { items: structuredClone(rules) };
        if (operation === 'contacts') return { items: [{ name: 'Fictional Contact', email: 'contact@example.test', source: 'directory' }] };
        if (operation === 'folders') return [{ id: 'target', name: 'Invoices' }];
        if (operation === 'moduleCatalog') return [];
        if (failWrite) throw new Error('Lost response');
        if (operation === 'createMailRule') rules.push({ ...data, id: 'created', priority: 3, editable: true });
        if (operation === 'changeMailRule') {
          if (data.action === 'delete') rules = rules.filter(rule => rule.id !== data.id);
          else Object.assign(rules.find(rule => rule.id === data.id), data.changes);
        }
        return true;
      };
    })()`);
    await js('settingsModal()');
    assert.equal(await js('rulesCalls.some(c => c.operation === "mailRules")'), false, 'Rules are read when the panel opens');
    await js('document.querySelector("#modal").close();asterMcpUI({method:"panel",input:{panel:"rules"},sessionId:"fictional"})');
    await waitFor('document.querySelectorAll("[data-rule-index]").length===2');
    const openRule = index => js(`if (!document.querySelector('[data-rules-detail]').hidden) document.querySelector('.rules-back').click();document.querySelectorAll('[data-rule-index]')[${index}].click()`);
    await openRule(0);
    assert.equal(await js('document.querySelector("#settings-form").elements.ruleName.value'), 'Invoices <safe>');
    assert.equal(await js('document.querySelector("[name=ruleInternalSender]").checked'), true);
    assert.equal(await js('document.querySelector("[name=ruleInternalSender]").closest("label").textContent'), 'Lab <robot>');
    assert.equal(await js('document.querySelector("[name=ruleSender]").value'), '');
    assert.equal(await js('document.querySelector("[data-rules-list]").hidden'), true);
    assert.equal(await js('document.querySelector("[data-rule-row=copyFolder]").hidden'), true);
    assert.equal(await js('document.querySelector(".settings-footer [data-rule-save]").hidden'), false);
    await js('document.querySelector("#settings-tab-general").click()');
    assert.equal(await js('document.querySelector("[data-rule-save]").hidden'), true);
    await js('document.querySelector("#settings-tab-rules").click()');
    assert.equal(await js('document.querySelector("[data-rule-save]").hidden'), false);


    assert.equal(await js('document.querySelector("[data-rules-list] safe")===null'), true);
    await js(`document.querySelector('#settings-form').elements.ruleEnabled.checked=false;document.querySelector('[data-rule-save]').click()`);
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.find(c => c.operation === "changeMailRule").data.changes.enabled'), false);
    assert.match(await js('document.querySelector("[data-rule-index]").textContent'), /Выключено/);
    await openRule(1);
    assert.equal(await js('document.querySelector("[data-rules-editor]").disabled'), true);
    assert.match(await js('document.querySelector("[data-rules-editor] .form-note").textContent'), /клиентские правила Outlook/);
    await js('document.querySelector("[data-rules-owa]").click()');
    assert.equal(await js('rulesCalls.find(call => call.operation === "openLink").data.url'), 'https://mail.example.test/owa/');

    assert.equal(await js('document.querySelector(".rule-details").textContent.includes("<safe>") && !document.querySelector(".rule-details safe")'), true);
    await openRule(0);
    await js('failWrite = true; document.querySelector("[data-rule-save]").click()');
    await waitFor('!modalBusy');
    assert.equal(await js('document.querySelector("[data-rules-editor]").disabled'), true);
    assert.equal(await js('document.querySelector("[data-rules-status]").textContent'), 'Перед следующим сохранением загрузите настройки из Exchange заново.');
    assert.equal(await js('document.querySelector("#reader")===readerBefore && state.selected===selectedBefore'), true);
    await js('document.querySelector("[data-rule-save]").click()');
    assert.equal(await js('rulesCalls.filter(c => c.operation === "changeMailRule").length'), 2);
    await js('document.querySelector("[data-rules-load]").click()');
    await waitFor('!document.querySelector("[data-rules-load]").disabled');
    await js(`(() => {
      failWrite = false;
      document.querySelector('[data-rules-new]').click();
      const fields = document.querySelector('#settings-form').elements;
      fields.ruleName.value = 'New rule';
      window.addRuleRow = (section, key) => {
        const picker = document.querySelector('[data-rule-section=' + section + '] [data-rule-add]');
        picker.value = key; picker.dispatchEvent(new Event('change', { bubbles: true }));
      };
      addRuleRow('conditions', 'sender');
      fields.ruleSender.value = 'Fictional';
      fields.ruleSender.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor('Boolean(document.querySelector("[data-rule-row=sender] [role=option]"))');
    await js(`(() => {
      const fields = document.querySelector('#settings-form').elements;
      for (const key of ['ArrowDown', 'Enter']) fields.ruleSender.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      addRuleRow('conditions', 'body');
      fields.ruleBody.value = 'invoice' + String.fromCharCode(10) + 'billing';
      addRuleRow('conditions', 'hasAttachments');
      document.querySelector('[data-rule-row=hasAttachments] [data-rule-remove]').click();
      addRuleRow('exceptions', 'exceptBody');
      fields.ruleExceptBody.value = 'internal';
      addRuleRow('actions', 'copyFolder');
      addRuleRow('actions', 'importance');
      fields.ruleImportance.value = 'High';
      fields.ruleEnabled.checked = false;
      document.querySelector('[data-rule-save]').click();
    })()`);
    assert.equal(await js('rulesCalls.filter(call => call.operation === "createMailRule").length'), 0, 'An empty added row must keep the editor open');
    assert.match(await js('document.querySelector("#settings-panel-rules [role=alert]").textContent'), /Заполните добавленные строки/);
    await js('document.querySelector("[name=ruleCopyFolder]").value="target";document.querySelector("[data-rule-save]").click()');
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.filter(c => c.operation === "createMailRule").length'), 1);
    assert.equal(await js('rulesCalls.find(c => c.operation === "createMailRule").data.copyFolder'), 'target');
    const saved = await js('rulesCalls.find(c => c.operation === "createMailRule").data');
    assert.equal(saved.body, 'invoice\nbilling');
    assert.equal(saved.sender, 'contact@example.test');
    assert.equal(saved.exceptBody, 'internal');
    assert.equal(saved.hasAttachments, false);
    assert.equal(saved.importance, 'High');
    assert.equal(saved.enabled, false);

    assert.equal(await js('document.querySelectorAll("[data-rule-index] strong")[2].textContent'), 'New rule');
    await openRule(0);
    await js('document.querySelector("[data-rule-delete]").click()');
    await waitFor('!modalBusy');
    assert.equal(await js('rulesCalls.filter(c => c.operation === "changeMailRule").at(-1).data.action'), 'delete');
    assert.equal(await js('document.querySelectorAll("[data-rule-index]").length'), 2);
    await openRule(1);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.mkdir(path.resolve(__dirname, '../release/screenshots'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../release/screenshots/mail-rules.png'), (await window.webContents.capturePage()).toPNG());
    await js('state.theme = "dark"; applyTheme();');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.resolve(__dirname, '../release/screenshots/mail-rules-dark.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(560, 620);
    window.webContents.setZoomFactor(1.25);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await js(`(() => {
      const panel = document.querySelector('#settings-panel-rules');
      return panel.scrollWidth <= panel.clientWidth + 1;
    })()`), true, 'Rule editor fits in a narrow zoomed window');
    console.log('PASS: explicit rules settings, safe text, edit/toggle/delete, protected rules, uncertain write lock, reader preserved.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });

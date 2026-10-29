const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('settings tabs expose only the selected panel without replacing form values', () => {
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const panels = { '#general': { hidden: false }, '#signature': { hidden: true } };
  const form = { signature: 'Unsaved signature', querySelectorAll: () => tabs, querySelector: id => panels[id] };
  const tabs = ['general', 'signature'].map(id => ({
    closest: () => form,
    getAttribute: () => id,
    setAttribute(name, value) { this[name] = value; },
  }));
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function selectSettingsTab('), source.indexOf('async function settingsModal(')), context);
  context.selectSettingsTab(tabs[1]);
  assert.equal(panels['#general'].hidden, true);
  assert.equal(panels['#signature'].hidden, false);
  assert.deepEqual(tabs.map(tab => [tab['aria-selected'], tab.tabIndex]), [['false', -1], ['true', 0]]);
  context.selectSettingsTab(tabs[0]);
  assert.equal(panels['#general'].hidden, false);
  assert.equal(panels['#signature'].hidden, true);
  assert.equal(form.signature, 'Unsaved signature');
});

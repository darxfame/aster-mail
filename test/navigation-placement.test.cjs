const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
test('navigation defaults left despite legacy bottom settings and preserves only the new explicit bottom choice', () => {
  for (const [preferences, expected] of [[{}, 'sidebar'], [{ 'aster-navigation-placement': 'bottom' }, 'sidebar'], [{ 'aster-navigation-placement-v2': 'bottom' }, 'bottom']]) {
    const dock = {}, destinations = [];
    const nodes = new Map();
    const node = key => { if (!nodes.has(key)) nodes.set(key, { dataset: {}, setAttribute() {}, append(value) { assert.equal(value, dock); destinations.push('sidebar'); }, prepend(value) { assert.equal(value, dock); destinations.push('bottom'); } }); return nodes.get(key); };
    const c = vm.createContext({ tr: value => value, localPreferences: { getItem: key => preferences[key] }, state: { view: 'mail' },
      $: key => key === '.bottom-dock' ? dock : node(key), preserveListFocus: () => () => {}, renderFolderTree: () => '', miniMonthHTML: () => '',
      icon: () => '', esc: value => value, initials: () => 'A', renderConnection() {}, sidebarCollapsed: false, compactSidebarExpanded: false,
      window: { innerWidth: 1440 }, document: { body: { classList: { toggle() {} } }, querySelectorAll: () => [] } });
    vm.runInContext(source.slice(source.indexOf('let navigationPlacement ='), source.indexOf('const calendarMode =')), c);
    vm.runInContext(source.slice(source.indexOf('function renderSidebar('), source.indexOf('function welcome(')), c);
    c.renderSidebar(); c.state.view = 'calendar'; c.renderSidebar();
    assert.deepEqual(destinations, [expected, expected]);
  }
});

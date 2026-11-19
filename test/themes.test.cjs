const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sdk = require('../src/theme-sdk.js');
const { ThemeStore } = require('../desktop/theme-store.cjs');
const { manifest, fromFiles, features } = require('../desktop/modules.cjs');
const fixture = require('./fixtures/theme/module.json');
const schema = require('../docs/modules/theme.schema.json');

test('palette modules accept only verified colors and no runtime, permissions or contributions', () => {
  assert.deepEqual([...schema.properties.colors.required].sort(), Object.keys(sdk.tokens).sort());
  assert.deepEqual(manifest(fixture).palette, fixture.palette);
  const files = new Map([['module.json', Buffer.from(JSON.stringify(fixture))]]);
  assert.equal(fromFiles(files).files.size, 1);
  assert.ok(features.includes('appearance.palette'));
  assert.throws(() => fromFiles(new Map([...files, ['main.js', Buffer.from('')]])));
  for (const fields of [{ main: 'main.js' }, { commands: [] }, { permissions: ['network'] }, { files: ['style.css'] }]) {
    assert.throws(() => manifest({ ...fixture, ...fields }));
  }
  const { palette } = fixture;
  assert.throws(() => sdk.normalize({ ...palette, colors: { ...palette.colors, background: 'url(https://example.test)' } }), /format/);
  assert.throws(() => sdk.normalize({ ...palette, colors: { ...palette.colors, onAccent: palette.colors.accent } }), /contrast/);
  assert.throws(() => sdk.normalize({ ...palette, base: 'light' }), /contrast/);
});

test('mode-specific selections persist and disabling a module clears only its selection', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-themes-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'themes.json'), store = new ThemeStore(file);
  const selection = { light: 'fixture.theme.light', dark: fixture.id };
  // Legacy standalone files lack mode-specific picks.
  await fs.writeFile(file, JSON.stringify({ selected: fixture.id, themes: [fixture.palette] }));
  assert.deepEqual(await store.read(), { light: null, dark: null });
  await store.change('select', selection);
  assert.deepEqual(await new ThemeStore(file).read(), selection);
  await store.change('remove', fixture.id);
  assert.deepEqual(await store.read(), { ...selection, dark: null });
  await assert.rejects(store.change('select', selection, () => { throw new Error('disabled'); }), /disabled/);
  await Promise.all([store.change('select', selection), store.change('clear')]);
  assert.deepEqual(await store.read(), { light: null, dark: null });
});

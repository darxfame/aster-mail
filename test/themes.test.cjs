const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sdk = require('../src/theme-sdk.js');
const { ThemeStore, readTheme } = require('../desktop/theme-store.cjs');
const example = require('../examples/themes/northern-tide.json');
const schema = require('../docs/modules/theme.schema.json');

test('theme SDK validates the documented roles, opaque colors and readable palettes', () => {
  assert.deepEqual([...schema.properties.colors.required].sort(), Object.keys(sdk.tokens).sort());
  assert.deepEqual(sdk.normalize(example), example);
  assert.throws(() => sdk.normalize({ ...example, themeVersion: 2 }), /format/);
  assert.throws(() => sdk.normalize({ ...example, script: 'main.js' }), /format/);
  assert.throws(() => sdk.normalize({ ...example, colors: { ...example.colors, background: 'url(https://example.test)' } }), /format/);
  assert.throws(() => sdk.normalize({ ...example, colors: { ...example.colors, onAccent: example.colors.accent } }), /contrast/);
  assert.throws(() => sdk.normalize({ ...example, base: 'light' }), /contrast/);
});

test('theme imports are bounded, selection persists, and queued changes cannot resurrect a cleared theme', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-themes-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'themes.json'), store = new ThemeStore(file);
  const source = path.join(folder, 'example.json');
  await fs.writeFile(source, ' '.repeat(sdk.maxBytes + 1));
  await assert.rejects(readTheme(source), /format/);
  await fs.writeFile(source, '\uFEFF' + JSON.stringify(example));
  const parsed = await readTheme(source);
  await store.change('import', parsed);
  await assert.rejects(store.change('import', parsed), /duplicate/);
  await assert.rejects(store.change('select', 'missing'), /format/);
  assert.equal((await store.read()).selected, null);
  await store.change('select', parsed.id);
  assert.deepEqual(await new ThemeStore(file).read(), { themes: [parsed], selected: parsed.id });
  const removed = await store.change('remove', parsed.id);
  assert.deepEqual(removed, { themes: [], selected: null });
  await Promise.all([store.change('import', parsed), store.change('select', parsed.id), store.change('clear')]);
  assert.deepEqual(await new ThemeStore(file).read(), { themes: [], selected: null });
});

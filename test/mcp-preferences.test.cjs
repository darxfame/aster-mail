const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aster-mcp-preferences-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const prompts = [];
  let starts = 0, closes = 0, failStart = false;
  const create = () => {
    const context = vm.createContext({ fs, path, crypto, tr: value => value,
      app: { getPath: () => directory, getVersion: () => 'fixture' },
      dialog: { showMessageBox: async (...args) => { prompts.push(args.at(-1)); } },
      Menu: { getApplicationMenu: () => null }, window: null, mcpEnabled: false, mcpChanging: false, mcpBridge: null,
      mcpHost: () => ({}),
      require: () => ({ start: async () => { starts++; if (failStart) throw new Error('Fixture failure'); return { close: async () => { closes++; } }; } }),
    });
    vm.runInContext(source.slice(source.indexOf('async function loadMcpEnabled('), source.indexOf('const { normalizeServer }')), context);
    return context;
  };
  return { directory, create, prompts, starts: () => starts, closes: () => closes, failStart: () => { failStart = true; } };
}

test('MCP defaults off and keeps explicit enable/disable across host instances', async t => {
  const f = await fixture(t), first = f.create();
  assert.equal(await first.loadMcpEnabled(), false);
  await first.setMcpEnabled(true);
  assert.equal(first.mcpEnabled, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'mcp-preferences.json'), 'utf8')), { enabled: true });
  const restarted = f.create();
  assert.equal(await restarted.loadMcpEnabled(), true);
  await restarted.setMcpEnabled(true);
  assert.equal(f.starts(), 2);
  await restarted.setMcpEnabled(false);
  assert.equal(restarted.mcpEnabled, false);
  assert.equal(f.closes(), 1);
  assert.equal(await f.create().loadMcpEnabled(), false);
  assert.equal(f.prompts.length, 0);
});

test('MCP startup failure preserves the saved choice for the next launch', async t => {
  const f = await fixture(t), context = f.create();
  f.failStart();
  await context.setMcpEnabled(true);
  assert.equal(context.mcpEnabled, false);
  assert.equal(context.mcpChanging, false);
  assert.equal(await f.create().loadMcpEnabled(), true);
  assert.equal(f.prompts.length, 1);
});

test('invalid MCP preference never enables access and write failures leave the previous file intact', async t => {
  const f = await fixture(t), context = f.create(), file = path.join(f.directory, 'mcp-preferences.json');
  await fs.writeFile(file, '{"enabled":"true"}');
  assert.equal(await context.loadMcpEnabled(), false);
  await fs.writeFile(file, 'broken');
  assert.equal(await context.loadMcpEnabled(), false);
  assert.equal(f.prompts.length, 1);
  await context.setMcpEnabled(true);
  context.fs = { ...fs, rename: async () => { throw new Error('Fixture disk failure'); } };
  await context.setMcpEnabled(false);
  assert.equal(context.mcpEnabled, false);
  assert.equal(context.mcpBridge, null);
  assert.equal(f.closes(), 1);
  assert.equal(f.prompts.length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { enabled: true });
  assert.deepEqual(await fs.readdir(f.directory), ['mcp-preferences.json']);
});

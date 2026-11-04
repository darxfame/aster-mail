const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile, spawn } = require('node:child_process');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..'), home = path.join(root, '.tools', 'xerj');
const pin = require('../tools/xerj.json');
const executable = path.join(home, 'bin', process.platform === 'win32' ? 'xerj.exe' : 'xerj');
async function approve(action, args) {
  if (args.includes('--approved')) return;
  if (!process.stdin.isTTY) throw new Error(`Ask the user before using Xerj for ${action}; pass --approved only after explicit consent for this operation.`);
  const prompt = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
  try { if (!/^(y|yes|да)$/i.test((await prompt.question(`Разрешить Xerj: ${action}? [y/N] `)).trim())) throw new Error('Xerj operation cancelled'); } finally { prompt.close(); }
}
async function setup() {
  const asset = pin.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('No pinned Xerj binary for this platform; install the official version manually.');
  let url = asset.url, response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Unsafe Xerj download destination');
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url).href; continue; }
    break;
  }
  if (!response?.ok) throw new Error('Xerj download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > asset.size) throw new Error('Xerj archive exceeds pinned size'); chunks.push(chunk); }
  const archiveBytes = Buffer.concat(chunks);
  if (size !== asset.size || crypto.createHash('sha256').update(archiveBytes).digest('hex') !== asset.sha256) throw new Error('Xerj archive SHA-256 mismatch');
  await fs.mkdir(path.join(home, 'bin'), { recursive: true, mode: 0o700 });
  const archive = path.join(home, `${crypto.randomUUID()}.archive`);
  try {
    await fs.writeFile(archive, archiveBytes, { mode: 0o600, flag: 'wx' });
    const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
    const list = (await execute(tar, ['-tf', archive], { maxBuffer: 1024 * 1024 })).stdout.split(/\r?\n/).filter(Boolean);
    const names = list.filter(name => path.posix.basename(name) === path.basename(executable));
    if (names.length !== 1 || names[0].startsWith('/') || names[0].split('/').includes('..')) throw new Error('Unexpected Xerj archive layout');
    const temporary = `${executable}.${crypto.randomUUID()}.tmp`;
    const extraction = spawn(tar, ['-xOf', archive, names[0]], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const done = new Promise((resolve, reject) => { extraction.on('error', reject); extraction.on('close', code => code === 0 ? resolve() : reject(new Error('Xerj extraction failed'))); }); done.catch(() => {});
    const output = await fs.open(temporary, 'wx', 0o700), digest = crypto.createHash('sha256'); let extracted = 0;
    try {
      for await (const chunk of extraction.stdout) { extracted += chunk.length; if (extracted > 512 * 1024 * 1024) throw new Error('Xerj binary exceeds size limit'); await output.writeFile(chunk); digest.update(chunk); }
      await done; if (extracted < 1000) throw new Error('Missing Xerj executable');
      await output.close(); await fs.rename(temporary, executable);
      await fs.writeFile(path.join(home, 'installed.json'), JSON.stringify({ version: pin.version, archiveSha256: asset.sha256, binarySha256: digest.digest('hex') }, null, 2), { mode: 0o600 });
    } finally { extraction.kill(); await output.close().catch(() => {}); await fs.rm(temporary, { force: true }); }
    console.log(`Installed optional Xerj ${pin.version}. No server started and no data indexed.`);
  } finally { await fs.rm(archive, { force: true }); }
}
async function verifiedBinary() {
  const installed = JSON.parse(await fs.readFile(path.join(home, 'installed.json'), 'utf8'));
  const digest = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(executable)) digest.update(chunk);
  if (installed.version !== pin.version || installed.archiveSha256 !== pin.assets[`${process.platform}-${process.arch}`]?.sha256 || digest.digest('hex') !== installed.binarySha256) throw new Error('Xerj binary changed; repeat setup explicitly.');
}
async function main(args) {
  const action = args[0] || 'status';
  if (action === 'status') { try { await verifiedBinary(); console.log(`Xerj ${pin.version}: installed, optional, consent required before every use.`); } catch { console.log('Optional Xerj is not installed. Run npm run xerj -- setup after approval.'); } return; }
  await approve(action, args);
  if (action === 'setup') return setup();
  await verifiedBinary();
  const forwarded = args.filter(value => value !== '--approved');
  if (forwarded.some(value => ['--insecure', 'init', 'feedback', '--open-pr', '--allow-insecure-network-bind'].includes(value))) throw new Error('Automatic config changes, unauthenticated service and feedback publication are not enabled for this project.');
  const dataDirectory = path.join(home, 'state');
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.XERJ_URL = 'http://127.0.0.1:19200';
  env.XERJ_DISABLE_FEEDBACK = 'true';
  let command = forwarded, stdio = 'inherit', log;
  if (action === 'serve') {
    if (forwarded.length !== 1) throw new Error('serve uses the project configuration and accepts no extra arguments.');
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const config = path.join(home, 'xerj.toml');
    await fs.writeFile(config, `[server]\nbind_address = "127.0.0.1"\nrest_port = 18080\ngrpc_port = 18081\nes_compat_port = 19200\ndata_dir = ${JSON.stringify(dataDirectory)}\n[auth]\nenabled = true\n[embedding]\nmode = "lexical"\n[rerank]\nenabled = false\n`, { mode: 0o600 });
    log = await fs.open(path.join(home, 'server.log'), 'a', 0o600);
    command = ['--config', config]; stdio = ['ignore', log.fd, log.fd];
    console.log('Starting optional Xerj on 127.0.0.1:19200 with auth enabled. Server output stays in private .tools/xerj/server.log. Ctrl+C stops it.');
  } else {
    if (!['--version', '--help', 'search', 'autoindex', 'def', 'batch-search', 'gain', 'hub', 'code', 'corpus', 'ask'].includes(action)) throw new Error('Unsupported optional Xerj operation. Use serve, search, autoindex, def, batch-search, hub or metadata commands.');
    if (action === 'autoindex') {
      const references = await fs.realpath(path.join(home, 'references'));
      const target = await fs.realpath(path.resolve(root, forwarded[1] || ''));
      if (target !== references && !target.startsWith(references + path.sep)) throw new Error('Only approved reference copies under .tools/xerj/references may be indexed by this wrapper.');
    }
    try { const key = (await fs.readFile(path.join(dataDirectory, 'admin.key'), 'utf8')).trim(); env.XERJ_API_KEY = key; env.XERJ_AUTH = `ApiKey ${key}`; } catch { /* Metadata commands do not need a running node. */ }
  }
  const child = spawn(executable, command, { stdio, windowsHide: true, cwd: root, env });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { if (log) void log.close(); process.exitCode = code === null ? 1 : code; });
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { approve };

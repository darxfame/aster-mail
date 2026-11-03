const G = require('./module-github.cjs');
const M = require('./modules.cjs');
const tr = require('../src/i18n.js').text;
const repository = 'https://github.com/darxfame/aster-mail-modules';
const api = 'https://api.github.com/repos/darxfame/aster-mail-modules';
const raw = 'https://raw.githubusercontent.com/darxfame/aster-mail-modules';
function invalid() { throw new Error(tr('Каталог модулей недействителен или изменился. Обновите список.')); }
function parse(input) {
  if (!input || input.catalogVersion !== 1 || Object.keys(input).some(key => !['catalogVersion', 'modules'].includes(key)) || !Array.isArray(input.modules) || input.modules.length > 20) invalid();
  const ids = new Set();
  return input.modules.map(item => {
    if (!item || Object.keys(item).some(key => !['manifest', 'description', 'commit', 'directory', 'digest'].includes(key)) || typeof item.description !== 'string' || item.description.length > 1000 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(item.description) || !/^[a-f0-9]{40}$/.test(item.commit) || !/^[a-f0-9]{64}$/.test(item.digest) || typeof item.directory !== 'string') invalid();
    if (item.directory) M.relative(item.directory);
    const manifest = M.manifest(item.manifest);
    if (ids.has(manifest.id)) invalid(); ids.add(manifest.id);
    return { manifest, description: item.description, commit: item.commit, directory: item.directory, digest: item.digest };
  });
}
async function list(read, signal) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 60000);
  const get = async (url, limit) => {
    if (controller.signal.aborted) throw new Error(tr('Загрузка модуля отменена'));
    const bytes = await read(url, limit, controller.signal);
    if (controller.signal.aborted) throw new Error(tr('Загрузка модуля отменена'));
    if (!Buffer.isBuffer(bytes) || bytes.length > limit) invalid();
    return JSON.parse(bytes.toString('utf8'));
  };
  try {
    const revision = (await get(`${api}/commits/main`, 2 * 1024 * 1024)).sha;
    if (!/^[a-f0-9]{40}$/.test(revision)) invalid();
    let document;
    try { document = await get(`${raw}/${revision}/catalog.json`, 512 * 1024); }
    catch (error) { if (error.status === 404) return { revision, modules: [], published: false }; throw error; }
    return { revision, modules: parse(document), published: true };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
async function install(input, read, signal, host, guard) {
  const catalog = await list(read, signal); guard();
  if (input.revision !== catalog.revision) invalid();
  const item = catalog.modules.find(item => item.manifest.id === input.id && item.digest === input.digest);
  if (!item) invalid();
  const bundle = await G.load({ url: repository, ref: item.commit, directory: item.directory }, read, signal); guard();
  if (bundle.digest !== item.digest || !require('node:util').isDeepStrictEqual(bundle.manifest, item.manifest)) invalid();
  // The card discloses the approved package's permissions; its explicit Connect click grants them.
  await host.install(bundle, true); guard();
}
module.exports = { repository, parse, list, install };

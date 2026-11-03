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
function indexEntries(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.modules) || input.modules.length > 20) invalid();
  const ids = new Set();
  return input.modules.map(item => {
    const safeText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
    const strings = (values, maximum) => Array.isArray(values) && values.length <= maximum && values.every(value => safeText(value, 200));
    const origins = values => strings(values, 8) && values.every(value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.hostname.includes('*'); } catch { return false; } });
    if (!item || !/^[a-z][a-z0-9.-]{2,79}$/.test(item.id) || ids.has(item.id) || !safeText(item.name, 80) || !/^\d+\.\d+\.\d+$/.test(item.version) || !safeText(item.version, 40) || !safeText(item.description || item.name, 1000) || !strings(item.permissions, 20) || !origins(item.networkOrigins || [])) invalid();
    if (!item.source || item.source.repository !== repository || !/^[a-f0-9]{40}$/.test(item.source.commit) || typeof item.source.directory !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) invalid();
    if (item.source.directory) M.relative(item.source.directory);
    if (item.optionalOrigins && (!Array.isArray(item.optionalOrigins) || item.optionalOrigins.length > 8 || item.optionalOrigins.some(rule => !rule || !safeText(rule.domain, 253) || typeof rule.includeSubdomains !== 'boolean'))) invalid();
    if (item.meetingLinks && (!safeText(item.meetingLinks.scheme, 32) || !origins(item.meetingLinks.origins))) invalid();
    if (item.authentication && (!origins(item.authentication.origins) || !origins(item.authentication.identityOrigins || []))) invalid();
    ids.add(item.id);
    return { ...item, description: item.description || item.name };
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
    if (document.schemaVersion === 1) {
      const modules = [];
      for (const item of indexEntries(document)) {
        const { commit, directory } = item.source;
        const root = `${raw}/${commit}/${directory ? directory.split('/').map(encodeURIComponent).join('/') + '/' : ''}`;
        let manifest, compatible = false;
        try {
          const definition = await get(root + 'module.json', 16000);
          try {
            manifest = M.manifest(definition);
            compatible = item.host?.apiVersion === 1 && Array.isArray(item.host.features) && item.host.features.every(feature => M.features.includes(feature)) && ['id', 'name', 'version', 'permissions', 'networkOrigins', 'networkHeaders', 'optionalOrigins', 'meetingLinks', 'authentication'].every(key => require('node:util').isDeepStrictEqual(['networkOrigins', 'networkHeaders'].includes(key) ? definition[key] || [] : definition[key], ['networkOrigins', 'networkHeaders'].includes(key) ? item[key] || [] : item[key]));
          } catch { /* Unsupported contracts remain visible, never installable. */ }
        } catch (error) { if (error.status !== 404) throw error; }
        if (!compatible) manifest = { id: item.id, name: item.name, version: item.version, permissions: item.permissions, networkOrigins: item.networkOrigins || [], optionalOrigins: item.optionalOrigins, meetingLinks: item.meetingLinks, authentication: item.authentication };
        modules.push({ manifest, description: item.description, commit, directory, digest: item.sha256, compatible });
      }
      return { revision, modules, published: true };
    }
    return { revision, modules: parse(document), published: true };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
async function install(input, read, signal, host, guard) {
  const catalog = await list(read, signal); guard();
  if (input.revision !== catalog.revision) invalid();
  const item = catalog.modules.find(item => item.manifest.id === input.id && item.digest === input.digest);
  if (!item || item.compatible === false) invalid();
  const bundle = await G.load({ url: repository, ref: item.commit, directory: item.directory }, read, signal); guard();
  if (bundle.digest !== item.digest || !require('node:util').isDeepStrictEqual(bundle.manifest, item.manifest)) invalid();
  // The card discloses the approved package's permissions; its explicit Connect click grants them.
  await host.install(bundle, true); guard();
}
async function browse({ net, session }, sender) {
  const isolated = session.fromPartition(`aster-module-catalog-${require('node:crypto').randomUUID()}`, { cache: false });
  const controller = new AbortController(), cancel = () => controller.abort();
  sender.once('destroyed', cancel);
  if (sender.isDestroyed()) cancel();
  try { return await list((url, limit, signal) => G.getBytes(net, isolated, url, limit, signal), controller.signal); }
  finally { sender.removeListener('destroyed', cancel); await Promise.allSettled([isolated.closeAllConnections(), isolated.clearStorageData()]); }
}
module.exports = { repository, parse, list, install, browse };

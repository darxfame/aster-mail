const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const tr = require('../src/i18n.js').text;
const permissions = ['ui', 'network', 'storage', 'calendar.read', 'meeting.draft', 'events'];
function invalid() { throw new Error(tr('Некорректный модуль или неподдерживаемая версия API')); }
function text(value, maximum = 80) { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) invalid(); return value; }
function relative(value) { text(value, 200); if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) invalid(); return value; }
function origin(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== `${url.origin}/`) invalid(); return url.origin; }
function bounded(value, maximum = 65536) { const encoded = JSON.stringify(value); if (!encoded || Buffer.byteLength(encoded) > maximum) invalid(); return JSON.parse(encoded); }
function manifest(input) {
  const m = bounded(input, 16000);
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(key => !['apiVersion', 'id', 'version', 'type', 'name', 'main', 'files', 'permissions', 'networkOrigins', 'networkHeaders', 'commands', 'views'].includes(key))) invalid();
  if (m.apiVersion !== 1 || !/^[a-z][a-z0-9.-]{2,79}$/.test(m.id) || typeof m.version !== 'string' || m.version.length > 40 || !/^\d+\.\d+\.\d+$/.test(m.version) || !['integration', 'workflow', 'panel', 'hybrid'].includes(m.type)) invalid();
  text(m.name); relative(m.main); if (!/\.m?js$/.test(m.main)) invalid();
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 199 || new Set(m.files.map(value => String(value).toLowerCase())).size !== m.files.length) invalid();
  for (const name of m.files) { relative(name); if (name === 'module.json' || !/\.(?:js|mjs|json|html|css|svg|png|jpg|jpeg|woff2|txt|md)$|(?:^|\/)(?:LICENSE|NOTICE)$/.test(name)) invalid(); }
  if (!m.files.includes(m.main)) invalid();
  if (!Array.isArray(m.permissions) || new Set(m.permissions).size !== m.permissions.length || m.permissions.some(value => !permissions.includes(value))) invalid();
  m.networkOrigins = (m.networkOrigins || []).map(origin);
  if (m.networkOrigins.length > 8 || m.networkOrigins.length && !m.permissions.includes('network')) invalid();
  m.networkHeaders = (m.networkHeaders || []).map(value => { if (typeof value !== 'string' || !/^x-[a-z][a-z0-9-]{0,63}$/i.test(value)) invalid(); return value.toLowerCase(); });
  if (m.networkHeaders.length > 8 || m.networkHeaders.length && !m.permissions.includes('network')) invalid();
  const ids = new Set();
  for (const key of ['commands', 'views']) {
    m[key] ||= []; if (!Array.isArray(m[key]) || m[key].length > 12) invalid();
    for (const item of m[key]) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(name => !(key === 'commands' ? ['id', 'title', 'slot'] : ['id', 'title', 'file', 'slot', 'height']).includes(name))) invalid();
      if (!/^[a-z][a-z0-9-]{0,49}$/.test(item.id) || ids.has(item.id)) invalid();
      ids.add(item.id); text(item.title);
      if (key === 'commands' && !['topbar', 'calendar', 'meeting.create', 'internal'].includes(item.slot)) invalid();
      if (key === 'views') { relative(item.file); if (!m.files.includes(item.file) || !/\.html$/.test(item.file) || !['panel', 'meeting.create'].includes(item.slot)) invalid(); item.height ??= 220; if (!Number.isInteger(item.height) || item.height < 100 || item.height > 500) invalid(); }
    }
  }
  return m;
}
function fromFiles(files) {
  if (!(files instanceof Map) || files.size > 200 || [...files.values()].some(value => !Buffer.isBuffer(value)) || [...files.values()].reduce((size, value) => size + value.length, 0) > 10 * 1024 * 1024) invalid();
  const definition = manifest(JSON.parse(files.get('module.json')?.toString('utf8') || 'null'));
  if (files.size !== definition.files.length + 1 || definition.files.some(name => !files.has(name))) invalid();
  const digest = crypto.createHash('sha256');
  for (const name of [...files.keys()].sort()) digest.update(name).update('\0').update(crypto.createHash('sha256').update(files.get(name)).digest());
  return { manifest: definition, files, digest: digest.digest('hex') };
}
async function readPackage(directory) {
  let size = 0;
  async function read(name, limit) {
    relative(name);
    let parent = directory;
    for (const part of name.split('/').slice(0, -1)) { parent = path.join(parent, part); const stat = await fs.lstat(parent); if (!stat.isDirectory() || stat.isSymbolicLink()) invalid(); }
    const file = path.join(directory, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) invalid();
    const handle = await fs.open(file, require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat(); if (!opened.isFile() || opened.size > limit) invalid();
      const bytes = Buffer.alloc(opened.size + 1); let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (offset !== opened.size) invalid(); size += offset; return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  }
  const files = new Map([['module.json', await read('module.json', 16000)]]);
  const definition = manifest(JSON.parse(files.get('module.json').toString('utf8')));
  for (const name of definition.files) files.set(name, await read(name, 10 * 1024 * 1024 - size));
  return fromFiles(files);
}
async function installPackage(root, bundle) {
  const directory = path.join(root, bundle.manifest.id, `${bundle.manifest.version}-${bundle.digest}`);
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  const temporary = `${directory}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.mkdir(temporary, { mode: 0o700 });
    for (const [name, bytes] of bundle.files) { await fs.mkdir(path.dirname(path.join(temporary, name)), { recursive: true, mode: 0o700 }); await fs.writeFile(path.join(temporary, name), bytes, { mode: 0o600, flag: 'wx' }); }
    try { await fs.rename(temporary, directory); } catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
function recordDirectory(root, record) {
  if (!/^[a-z][a-z0-9.-]{2,79}$/.test(record.id) || !/^\d+\.\d+\.\d+$/.test(record.version) || !/^[a-f0-9]{64}$/.test(record.digest)) invalid();
  return path.join(root, record.id, `${record.version}-${record.digest}`);
}
function records(input) {
  if (!Array.isArray(input) || input.length > 8) invalid();
  const ids = new Set();
  return input.map(record => {
    if (!record || typeof record !== 'object' || typeof record.enabled !== 'boolean' || ids.has(record.id)) invalid();
    recordDirectory('', record); ids.add(record.id);
    if (record.source && (record.source.type !== 'github' || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(record.source.repository) || !/^[a-f0-9]{40}$/.test(record.source.commit))) invalid();
    if (record.source?.directory) relative(record.source.directory);
    return { ...(record.source ? { source: bounded(record.source, 1000) } : {}), id: record.id, version: record.version, digest: record.digest, enabled: record.enabled, data: bounded(record.data === undefined ? {} : record.data, 16000) };
  });
}
// The sandbox's only network path. No account transport, cookies, redirects or retries.
function requestJSON(net, isolatedSession, definition, data, signal) {
  bounded(data); const url = new URL(data.url);
  if (!definition.permissions.includes('network') || !definition.networkOrigins.includes(url.origin) || url.protocol !== 'https:' || url.username || url.password || url.hash || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(data.method || 'GET')) invalid();
  const headers = data.headers || {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.entries(headers).some(([name, value]) => !(definition.networkHeaders || []).includes(name.toLowerCase()) || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value))) invalid();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error(tr('Сессия аккаунта завершена')));
    const request = net.request({ url: url.href, method: data.method || 'GET', session: isolatedSession, credentials: 'omit', useSessionCookies: false, redirect: 'manual' });
    let settled = false;
    const failure = () => Object.assign(new Error(tr('Результат запроса модуля неизвестен. Проверьте сервис перед повтором.')), { code: 'network-unknown' });
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    const cancel = () => { finish(failure()); request.abort(); };
    const timer = setTimeout(cancel, 30000); signal.addEventListener('abort', cancel, { once: true });
    request.on('login', (_info, callback) => callback()); request.on('redirect', cancel); request.on('error', () => finish(failure()));
    request.on('response', response => {
      const chunks = []; let size = 0;
      response.on('error', cancel); response.on('aborted', cancel);
      response.on('end', () => { if (settled) return; if (response.statusCode < 200 || response.statusCode >= 300) return finish(Object.assign(failure(), { code: 'http-error', status: response.statusCode })); try { finish(null, bounded(JSON.parse(Buffer.concat(chunks).toString('utf8')))); } catch { finish(failure()); } });
      response.on('data', chunk => { if (settled) return; size += chunk.length; if (size > 65536) cancel(); else chunks.push(chunk); });
    });
    request.setHeader('Content-Type', 'application/json'); request.setHeader('Accept', 'application/json');
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    if (data.bearer !== undefined) { if (typeof data.bearer !== 'string' || data.bearer.length > 4096 || /[\r\n]/.test(data.bearer)) { cancel(); return; } request.setHeader('Authorization', `Bearer ${data.bearer}`); }
    request.end(data.body === undefined ? undefined : JSON.stringify(data.body));
  });
}
function permissionSummary(values) {
  const labels = { ui: tr('Открытие собственных панелей'), network: tr('Доступ к указанным сервисам'), storage: tr('Защищённые настройки модуля'), 'calendar.read': tr('Чтение основного календаря'), 'meeting.draft': tr('Заполнение черновика встречи'), events: tr('События приложения и модулей') };
  return values.map(value => labels[value]).join(', ');
}
module.exports = { fromFiles, relative, records, permissionSummary, manifest, readPackage, installPackage, recordDirectory, bounded, requestJSON };

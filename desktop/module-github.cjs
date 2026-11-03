const M = require('./modules.cjs');
const tr = require('../src/i18n.js').text;
function location(input) {
  const url = new URL(input.url);
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_.-]{1,100}$/.test(part) || ['.', '..'].includes(part))) throw new Error(tr('Укажите ссылку на репозиторий GitHub без пути к файлу'));
  const [owner, rawRepo] = parts, repo = rawRepo.replace(/\.git$/, '');
  if (!repo || ['.', '..'].includes(repo)) throw new Error(tr('Некорректный адрес репозитория'));
  const ref = input.ref || 'HEAD', directory = input.directory || '';
  if (typeof ref !== 'string' || !/^[a-zA-Z0-9._/-]{1,200}$/.test(ref) || ref.startsWith('/') || ref.endsWith('/') || ref.includes('..') || ref.includes('//')) throw new Error(tr('Некорректная ветка, тег или commit'));
  if (directory) M.relative(directory);
  return { owner, repo, ref, directory, repository: `https://github.com/${owner}/${repo}` };
}
function getBytes(net, isolated, url, limit, signal) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'raw.githubusercontent.com'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password || parsed.hash) throw new Error('Unsupported GitHub destination');
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error(tr('Загрузка модуля отменена')));
    const request = net.request({ url, method: 'GET', session: isolated, credentials: 'omit', useSessionCookies: false, redirect: 'manual' });
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    const cancel = () => { finish(new Error(tr('Загрузка модуля отменена'))); request.abort(); };
    const timer = setTimeout(cancel, 30000); signal.addEventListener('abort', cancel, { once: true });
    request.on('login', (_info, callback) => callback());
    request.on('redirect', () => { finish(new Error(tr('Перенаправление при загрузке модуля запрещено'))); request.abort(); });
    request.on('error', () => finish(new Error(tr('Не удалось загрузить модуль с GitHub'))));
    request.on('response', response => {
      const chunks = []; let size = 0;
      response.on('error', cancel); response.on('aborted', cancel);
      response.on('end', () => {
        if (settled) return;
        if (response.statusCode !== 200) return finish(Object.assign(new Error(`${tr('GitHub вернул HTTP')} ${response.statusCode}`), { status: response.statusCode }));
        finish(null, Buffer.concat(chunks));
      });
      response.on('data', chunk => { if (settled) return; size += chunk.length; if (size > limit) { finish(new Error(tr('Пакет модуля превышает допустимый размер'))); request.abort(); } else chunks.push(chunk); });
    });
    request.setHeader('User-Agent', 'Aster-Mail-Module-Installer');
    request.setHeader('Accept', parsed.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream');
    request.end();
  });
}
async function load(input, read, signal) {
  const source = location(input), controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timeout = setTimeout(abort, 120000);
  const guard = () => { if (controller.signal.aborted) throw new Error(tr('Загрузка модуля отменена')); };
  const get = async (url, limit) => { guard(); const bytes = await read(url, limit, controller.signal); guard(); if (!Buffer.isBuffer(bytes) || bytes.length > limit) throw new Error(tr('Пакет модуля превышает допустимый размер')); return bytes; };
  try {
    const commit = JSON.parse((await get(`https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`, 2 * 1024 * 1024)).toString('utf8')).sha;
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(tr('GitHub не вернул точный commit модуля'));
    const root = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/${source.directory ? source.directory.split('/').map(encodeURIComponent).join('/') + '/' : ''}`;
    const files = new Map([['module.json', await get(root + 'module.json', 16000)]]);
    const definition = M.manifest(JSON.parse(files.get('module.json').toString('utf8')));
    let size = files.get('module.json').length;
    // Sequential reads keep the total memory ceiling and cancellation deterministic.
    for (const name of definition.files) {
      const bytes = await get(root + name.split('/').map(encodeURIComponent).join('/'), 10 * 1024 * 1024 - size);
      size += bytes.length; files.set(name, bytes);
    }
    const bundle = M.fromFiles(files); guard();
    return { ...bundle, source: { type: 'github', repository: source.repository, commit, directory: source.directory } };
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
module.exports = { location, load, getBytes };

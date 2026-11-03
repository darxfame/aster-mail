const tr = require('../src/i18n.js').text;
const { normalizeServer } = require('./protocol.cjs');
function createTransport(net, credentials, accountSession, signal) {
  const origin = normalizeServer(credentials.server);
  function transport(url, options = {}) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error(tr('Сессия аккаунта завершена; операция не повторялась.')));
      if (new URL(url).origin !== origin) return reject(new Error(tr('Запрос к постороннему серверу заблокирован')));
      const req = net.request({ url, method: options.method || 'GET', session: accountSession, useSessionCookies: true, redirect: 'manual' });
      let attempts = 0, redirects = 0, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => { finish(Object.assign(new Error(tr('Сервер не ответил за 30 секунд. Проверьте VPN и подключение.')), { connectionError: true })); req.abort(); }, 30000);
      const cancel = () => { finish(new Error(tr('Сессия аккаунта завершена. Результат начатой операции неизвестен; проверьте OWA перед повтором.'))); req.abort(); };
      signal.addEventListener('abort', cancel, { once: true });
      const interrupted = () => finish(Object.assign(new Error(tr('Соединение прервано. Результат операции неизвестен; проверьте OWA перед повтором.')), { connectionError: true }));
      req.on('close', () => { if (!settled) interrupted(); });
      req.on('login', (info, callback) => {
        if (settled || signal.aborted || info.isProxy || info.host !== new URL(origin).hostname || attempts++ > 0) return callback();
        callback(credentials.username, credentials.password);
      });
      req.on('redirect', (_status, _method, destination) => {
        if (options.followRedirects === false) {
          finish(null, { status: _status, text: '', headers: { location: destination } });
          req.abort(); return;
        }
        if (++redirects > 5 || new URL(destination).origin !== origin) {
          finish(new Error(tr('OWA перенаправляет на другой сервер. Межсерверный SSO пока не поддерживается.')));
          req.abort(); return;
        }
        req.followRedirect();
      });
      req.on('error', error => {
        const code = /\bERR_(?:CERT_[A-Z_]+|SSL_[A-Z_]+|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|TIMED_OUT)\b/.exec(String(error?.code || '') + ' ' + String(error?.message || ''))?.[0];
        finish(Object.assign(new Error(tr('Не удалось подключиться к OWA. Проверьте адрес, VPN и сертификат сервера.')), { connectionError: true, ...(code ? { code } : {}) }));
      });
      req.on('response', res => {
        const chunks = []; let size = 0;
        res.on('error', interrupted);
        res.on('aborted', interrupted);
        res.on('end', () => {
          const length = res.headers?.['content-length'], encoding = String(res.headers?.['content-encoding'] || 'identity').toLowerCase();
          if (length !== undefined && encoding === 'identity' && options.method !== 'HEAD' && ![204, 304].includes(res.statusCode) && Number(length) !== size) return interrupted();
          const buffer = Buffer.concat(chunks);
          finish(null, { status: res.statusCode, text: options.binary ? '' : buffer.toString('utf8'), buffer, headers: Object.fromEntries(['www-authenticate', 'content-type', 'ms-asprotocolversions', 'ms-asprotocolcommands', 'x-responsecode'].filter(key => res.headers?.[key] !== undefined).map(key => [key, res.headers[key]])) });
        });
        res.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > 30 * 1024 * 1024) { finish(new Error(tr('Ответ превышает лимит 30 МБ'))); req.abort(); }
          else chunks.push(chunk);
        });
      });
      for (const [key, value] of Object.entries(options.headers || {})) req.setHeader(key, value);
      req.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 AsterMail/0.1');
      if (options.body) req.write(options.body);
      req.end();
    });
  }
  return transport;
}
module.exports = { createTransport };

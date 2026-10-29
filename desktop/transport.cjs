const { normalizeServer } = require('./protocol.cjs');
function createTransport(net, credentials, accountSession, signal) {
  const origin = normalizeServer(credentials.server);
  function transport(url, options = {}) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Сессия аккаунта завершена; операция не повторялась.'));
      if (new URL(url).origin !== origin) return reject(new Error('Запрос к постороннему серверу заблокирован'));
      const req = net.request({ url, method: options.method || 'GET', session: accountSession, useSessionCookies: true, redirect: 'manual' });
      let attempts = 0, redirects = 0, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => { finish(new Error('Сервер не ответил за 30 секунд. Проверьте VPN и подключение.')); req.abort(); }, 30000);
      const cancel = () => { finish(new Error('Сессия аккаунта завершена. Результат начатой операции неизвестен; проверьте OWA перед повтором.')); req.abort(); };
      signal.addEventListener('abort', cancel, { once: true });
      req.on('login', (info, callback) => {
        if (signal.aborted || info.isProxy || info.host !== new URL(origin).hostname || attempts++ > 0) return callback();
        callback(credentials.username, credentials.password);
      });
      req.on('redirect', (_status, _method, destination) => {
        if (++redirects > 5 || new URL(destination).origin !== origin) {
          finish(new Error('OWA перенаправляет на другой сервер. Межсерверный SSO пока не поддерживается.'));
          req.abort(); return;
        }
        req.followRedirect();
      });
      req.on('error', () => finish(new Error('Не удалось подключиться к OWA. Проверьте адрес, VPN и сертификат сервера.')));
      req.on('response', res => {
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 30 * 1024 * 1024) { finish(new Error('Ответ превышает лимит 30 МБ')); req.abort(); }
          else chunks.push(chunk);
        });
        res.on('error', () => finish(new Error('Соединение прервано. Результат операции неизвестен; проверьте OWA перед повтором.')));
        res.on('end', () => { const buffer = Buffer.concat(chunks); finish(null, { status: res.statusCode, text: options.binary ? '' : buffer.toString('utf8'), buffer }); });
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

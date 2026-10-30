const test = require('node:test');
const assert = require('node:assert/strict');
const { message } = require('../src/errors.js');
const { preferences } = require('../desktop/notifications.cjs');
test('HTTP failures describe the failed operation without inventing deletion or connection loss', () => {
  const error = Object.assign(new Error('OWA GetItem: HTTP 404'), { status: 404 });
  const ordinary = message(error, { operation: 'message' });
  assert.match(ordinary, /открыть письмо.*сервер вернул ошибку/);
  assert.doesNotMatch(ordinary, /HTTP|GetItem|удал[её]н|перемещ|соединени|подключени/);
  assert.match(message(error, { operation: 'message', debug: true }), /Технические сведения: OWA GetItem: HTTP 404/);
  assert.match(message(new Error('Exchange: ErrorItemNotFound'), { operation: 'message' }), /Письмо не найдено на сервере/);
  assert.match(message(new Error('OWA GetItem: HTTP 401')), /отклонил авторизацию/);
  assert.match(message(new Error('EWS ResolveNames: ErrorAccessDenied')), /запретил доступ/);
  assert.match(message(new Error('Exchange: ErrorInvalidOperation')), /не поддерживает/);
  assert.doesNotMatch(message(new Error('Invalid request'), { operation: 'send' }), /сервер|неизвестен/);
});
test('renderer shows a friendly HTTP error while keeping an established connection connected', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  for (const debugErrors of [false, true]) {
    const nodes = { '#error': {}, '#status': {} };
    const error = new Error('OWA GetItem: HTTP 404');
    const context = vm.createContext({ tr: value => value, state: { account: { sessionId: 'active' } }, mailWrites: 0, mailWriteEpoch: 0,
      connectionState: { status: 'connected' }, notificationPreferences: { debugErrors }, $: key => nodes[key], renderConnection() { throw new Error('Connection state must not change'); },
      window: { asterErrors: { message }, aster: { invoke: async () => ({ ok: false, error: error.message, userFacing: false }) } },
    });
    vm.runInContext(source.slice(source.indexOf('async function api('), source.indexOf('let pendingMailAlerts')), context);
    vm.runInContext(source.slice(source.indexOf('function errorText('), source.indexOf('function clearError(')), context);
    await context.api('message', { id: 'fictional' }).catch(context.showError);
    assert.equal(context.connectionState.status, 'connected');
    assert.match(nodes['#error'].textContent, /сервер вернул ошибку/);
    assert.equal(nodes['#error'].textContent.includes('HTTP 404'), debugErrors);
  }
});
test('debug errors are opt-in, bounded to safe codes and hide exception values and secrets', () => {
  assert.equal(preferences().debugErrors, false);
  assert.equal(preferences({ debugErrors: 'true' }).debugErrors, false);
  assert.equal(preferences({ debugErrors: true }).debugErrors, true);
  const error = new TypeError('api is not a function; https://alice:secret@private.example/ token=secret; mail body');
  assert.doesNotMatch(message(error), /api|function|secret|private|mail body/);
  const detail = message(error, { debug: true });
  assert.match(detail, /api is not a function/);
  assert.doesNotMatch(detail, /secret|alice|private|mail body/);
  assert.doesNotMatch(message(new SyntaxError('Unexpected token SECRET_MAIL_BODY'), { debug: true }), /SECRET_MAIL_BODY/);
  const presented = { message: detail, userFacing: true };
  assert.equal(message(presented, { debug: true }), detail);
  assert.equal(message(presented), message(error));
});
test('plain-language validation and write-uncertainty instructions survive presentation', () => {
  assert.equal(message(new Error('Укажите логин и пароль')), 'Укажите логин и пароль');
  const text = message(new Error('OWA CreateItem: HTTP 500'), { operation: 'send' });
  assert.doesNotMatch(text, /HTTP|CreateItem/);
  assert.match(text, /Результат операции может быть неизвестен.*Проверьте OWA перед повтором/);
  const interrupted = new Error('OWA GetItem: HTTP 500. Результат операции неизвестен; проверьте OWA перед повтором.');
  assert.match(message(interrupted), /Результат операции может быть неизвестен/);
  const network = Object.assign(new Error('Connection failed'), { code: 'ERR_CERT_AUTHORITY_INVALID' });
  assert.match(message(network), /доверие сертификату/);
  assert.doesNotMatch(message(network), /ERR_CERT/);
  assert.match(message(network, { debug: true }), /ERR_CERT_AUTHORITY_INVALID/);
});

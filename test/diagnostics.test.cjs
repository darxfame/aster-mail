const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../desktop/diagnostics.cjs');

function setup(respond) {
  const calls = [];
  const client = { origin: 'https://mail.example.com', canary: 'fictional-canary',
    async transport(url, options) { calls.push({ url, ...options }); return respond(url, options); },
  };
  return { client, calls };
}
const soap = body => ({ status: 200, text: `<Envelope><Header><ServerVersionInfo MajorVersion="15" MinorVersion="2" MajorBuildNumber="1" MinorBuildNumber="0"/></Header><Body><ResponseCode>NoError</ResponseCode>${body}</Body></Envelope>` });

test('diagnostics verify read operations and advertised services without returning mailbox data', async () => {
  const { client, calls } = setup((url, options) => {
    if (url.includes('/owa/')) return { status: 200, text: JSON.stringify({ Body: { FolderId: { Id: 'private-folder-id' } } }) };
    if (url.includes('/autodiscover/')) return { status: 200, text: '<Autodiscover><Response><Account><Action>settings</Action><Protocol Type="mapiHttp"><MailStore><ExternalUrl>https://other.example.com/mapi/emsmdb/?MailboxId=private</ExternalUrl></MailStore></Protocol><Protocol><Type>EXPR</Type><EwsUrl>https://mail.example.com/EWS/Exchange.asmx</EwsUrl></Protocol></Account></Response></Autodiscover>' };
    if (url.includes('/mapi/')) return { status: 200, text: 'Generic proxy page' };
    if (url.includes('ActiveSync')) return { status: 200, headers: { 'ms-asprotocolversions': '14.1,16.0', 'ms-asprotocolcommands': 'Sync,FolderSync' } };
    if (options.body.includes('<m:GetFolder>')) return soap('<Folder><FolderId Id="private-folder-id"/></Folder>');
    if (options.body.includes('<m:FindItem')) return soap('<RootFolder><Items><Item><Subject>private subject</Subject></Item></Items></RootFolder>');
    if (options.body.includes('<m:ResolveNames')) return { status: 200, text: '<Envelope><ResponseCode>ErrorNameResolutionNoResults</ResponseCode></Envelope>' };
    return soap('');
  });
  const report = await run(client, 'fictional@example.com');
  assert.equal(report.rows.filter(row => row.status === 'ok').length, 9);
  const autodiscover = report.rows.find(row => row.name.startsWith('Autodiscover'));
  assert.equal(autodiscover.status, 'detected');
  assert.match(autodiscover.detail, /mapiHttp/);
  assert.equal(report.rows.find(row => row.name.startsWith('MAPI')).status, 'unknown');
  assert.equal(report.rows.find(row => row.name.startsWith('ActiveSync')).status, 'detected');
  assert.doesNotMatch(JSON.stringify(report), /private|fictional-canary|fictional@example/);
  assert.ok(calls.every(call => new URL(call.url).origin === client.origin && call.followRedirects === false));
  assert.ok(calls.every(call => !/CreateItem|SendItem|UpdateItem|DeleteItem|GetItem|GetAttachment/.test(call.body || '')));
  const discovery = calls.find(call => call.url.includes('/autodiscover/'));
  assert.equal(discovery.headers['X-MapiHttpCapability'], '1');
  assert.match(discovery.body, /fictional@example.com/);
  assert.equal(calls.filter(call => call.body?.includes('MaxEntriesReturned="1"')).length, 3);
});

test('OWA authentication failure does not hide EWS access and never claims MAPI is working', async () => {
  const { client, calls } = setup(url => url.includes('/EWS/') ? soap('<Folder><FolderId Id="fictional"/></Folder><RootFolder/>') : { status: 401, text: 'secret', headers: { 'www-authenticate': 'Negotiate secret-token, NTLM secret-token' } });
  client.canary = null;
  client.authenticate = async () => { throw new Error('Сервер отклонил логин или пароль'); };
  const report = await run(client, '', { authenticate: true });
  assert.equal(report.rows.find(row => row.name === 'OWA · вход').status, 'unknown');
  assert.equal(report.rows.find(row => row.name.startsWith('EWS · почта')).status, 'ok');
  assert.equal(report.rows.find(row => row.name.startsWith('Autodiscover')).status, 'skipped');
  assert.match(report.rows.find(row => row.name.startsWith('MAPI')).detail, /HTTP 401.*Negotiate, NTLM/);
  assert.doesNotMatch(JSON.stringify(report), /secret/);
  assert.equal(calls.some(call => call.url.includes('/owa/')), false);
});

test('HTML, XML redirects, Exchange failures and network errors remain inconclusive', async () => {
  const { client } = setup(url => {
    if (url.includes('/autodiscover/')) return { status: 200, text: '<Autodiscover><Response><Account><Action>redirectUrl</Action><RedirectUrl>https://evil.example/autodiscover?token=secret</RedirectUrl></Account></Response></Autodiscover>' };
    if (url.includes('/EWS/')) return { status: 200, text: '<Envelope><ResponseCode>ErrorAccessDenied</ResponseCode></Envelope>' };
    if (url.includes('/mapi/')) return { status: 302, headers: { location: 'https://login.example/sso?token=secret' } };
    throw new Error('secret transport failure');
  });
  const report = await run(client, 'fictional@example.com');
  assert.ok(report.rows.every(row => row.status === 'unknown' || row.status === 'skipped'));
  assert.match(report.rows.find(row => row.name.startsWith('EWS')).detail, /ErrorAccessDenied/);
  assert.doesNotMatch(JSON.stringify(report), /secret/);
  assert.match(report.rows.find(row => row.name.startsWith('Autodiscover')).detail, /https:\/\/evil.example\/autodiscover/);
  client.transport = async () => ({ status: 200, text: '<!DOCTYPE html><html><body>Login secret</body></html>' });
  const htmlReport = await run(client, 'fictional@example.com');
  assert.ok(htmlReport.rows.every(row => row.status !== 'ok' && row.status !== 'detected'));
  assert.doesNotMatch(JSON.stringify(htmlReport), /secret/);
});

test('diagnostic session is isolated, single-flight, cleaned up and rejects an overtaken account', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
  let finish, probe, signal, cleanups = 0;
  const context = vm.createContext({
    accountEpoch: 1, client: { syncId: 'fictional-session' },
    account: { server: 'https://mail.example.com', username: 'fictional@example.com', password: 'fictional-password' },
    connection: { controller: new AbortController() },
    normalizeServer: value => value, AbortController, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'fictional-id' }, net: {},
    session: { fromPartition(partition, options) {
      assert.equal(partition.startsWith('persist:'), false);
      assert.equal(options.cache, false);
      return { async clearStorageData() { cleanups++; } };
    } },
    createTransport(_net, credentials, _session, controllerSignal) {
      assert.notEqual(credentials, context.account); signal = controllerSignal;
      return async () => {};
    },
    OWAClient: class { constructor(credentials) { probe = this; this.account = credentials; } },
    require: () => ({ run: () => new Promise(resolve => { finish = resolve; }) }),
  });
  vm.runInContext(source.slice(source.indexOf('let diagnosticRun ='), source.indexOf('\nconst methods =')), context);
  const pending = context.diagnoseProtocols({ sessionId: 'fictional-session' });
  await assert.rejects(context.diagnoseProtocols({ sessionId: 'fictional-session' }), /уже выполняется/);
  context.accountEpoch++;
  context.connection.controller.abort();
  assert.equal(signal.aborted, true);
  finish({ rows: [] });
  await assert.rejects(pending, /Аккаунт изменился/);
  assert.equal(probe.account.password, '');
  assert.equal(context.account.password, 'fictional-password');
  assert.equal(cleanups, 1);
  await assert.rejects(context.diagnoseProtocols({ sessionId: 'outdated-session' }), /Сессия аккаунта/);
});

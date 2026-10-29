const test = require('node:test');
const assert = require('node:assert/strict');
const { MailCache } = require('../desktop/mail-cache.cjs');
const { OWAClient } = require('../desktop/owa.cjs');
const P = require('../desktop/protocol.cjs');
const R = require('../src/recipients.js');
test('session cache deduplicates reads, isolates returned objects, expires and permits a forced refresh', async () => {
  let now = 0, calls = 0;
  const cache = new MailCache({ now: () => now });
  const load = async () => ({ body: 'History', count: ++calls });
  const [a, b] = await Promise.all([cache.get('message', load), cache.get('message', load)]);
  assert.equal(calls, 1); a.body = 'edited'; assert.equal(b.body, 'History');
  assert.equal((await cache.get('message', load)).body, 'History');
  await cache.get('message', load, { refresh: true }); assert.equal(calls, 2);
  now = 30001; await cache.get('message', load); assert.equal(calls, 3);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.entries.size, 0);
});
test('memory and entry limits evict old mail, failures never cache, stale reads cannot repopulate after logout', async () => {
  const cache = new MailCache({ maxBytes: 100, maxEntries: 2 });
  for (const key of ['a','b','c']) await cache.get(key, async () => ({ body: 'x'.repeat(20) }));
  assert.ok(cache.bytes <= 100); assert.ok(cache.entries.size <= 2); assert.equal(cache.entries.has('a'), false);
  let finish;
  const pending = cache.get('pending', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.clear(); finish({ body: 'private history' }); await pending;
  assert.equal(cache.entries.size, 0);
  await assert.rejects(cache.get('failed', async () => { throw new Error('HTTP 429'); }), /429/);
  assert.equal(cache.pending.size, 0); assert.equal(cache.entries.size, 0);
});
function client(handler) {
  const calls = [];
  const c = new OWAClient({ server:'https://mail.example.com', username:'CORP\\account', password:'fake' }, async (url, options) => {
    calls.push({url,options}); return handler(url, options);
  }, async () => 'canary'); c.canary = 'canary';
  return { c, calls };
}
const json = Body => ({status:200,text:JSON.stringify({Body})});
test('real mail reads share cache; changed versions and mutation failures invalidate safely without retry', async () => {
  const { c, calls } = client((_url, options) => {
    if (options.headers.Action === 'UpdateItem') return json({ResponseCode:'ErrorChangeKeyRequiredForWriteOperations'});
    return json({Items:[{ItemId:{Id:'message',ChangeKey:'ck'},Subject:'History',Body:{BodyType:'Text',Value:'Full original history'}}]});
  });
  await c.message({id:'message',changeKey:'ck'}); await c.message({id:'message',changeKey:'ck'}); assert.equal(calls.length,1);
  await c.message({id:'message',changeKey:'new'}); assert.equal(calls.length,2);
  await assert.rejects(c.change({ref:{id:'message',changeKey:'ck'},field:'IsRead',value:true}), /ChangeKey/);
  assert.equal(calls.length,3); assert.equal(c.mailCache.entries.size,0);
  await c.message({id:'message',changeKey:'ck'}); assert.equal(calls.length,4);
});
test('reply-all uses sender and CC only, excludes primary address, UPN and case-insensitive duplicates', () => {
  const from = {email:'Anna@example.com'}, m = {from,to:[{email:'someone@example.com'}],cc:[{email:'me@example.com'},{email:'ME@LOGIN.EXAMPLE.COM'},{email:'anna@EXAMPLE.com'},{email:'pavel@example.com'},{email:'PAVEL@EXAMPLE.COM'}]};
  assert.deepEqual(R.reply(m,['me@example.com','me@login.example.com'],true),{to:'Anna@example.com',cc:'pavel@example.com'});
  assert.deepEqual(R.reply(m,['me@example.com'],false),{to:'Anna@example.com',cc:''});
  assert.deepEqual(R.reply({from:{email:' ME@example.com '},cc:[{email:'anna@example.com'}]},['me@example.com'],true),{to:'anna@example.com',cc:''});
  const xml = P.sendSOAP({kind:'reply-all',reference:{id:'original',changeKey:'ck'},to:'anna@example.com',cc:'',body:'New text'});
  assert.match(xml, /<t:CcRecipients><\/t:CcRecipients>/); assert.match(xml, /NewBodyContent/);
});
test('domain login resolves own SMTP and UPN once from OWA configuration', async () => {
  const {c,calls}=client(()=>json({UserSessionSettings:{UserEmailAddress:'Me@example.com',UserPrincipalName:'me@login.example.com'}}));
  assert.deepEqual(await c.identity(),{email:'Me@example.com',emails:['me@example.com','me@login.example.com']});
  await c.identity(); assert.equal(calls.length,1);
});
test('reader prefers the complete normalized body over unique-only fragments in a conversation', () => {
  const m = P.message({ItemId:{Id:'m'},UniqueBody:{BodyType:'HTML',Value:'Only new answer'},NormalizedBody:{BodyType:'HTML',Value:'New answer<blockquote>Earlier conversation</blockquote>'}});
  assert.match(m.html,/Earlier conversation/);
});

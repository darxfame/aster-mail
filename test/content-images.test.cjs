const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../desktop/content-images.cjs');
const image = { ContentType: 'image/png', Content: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
test('inline and external images render as validated raster data with explicit load failures', async () => {
  const current = { html: '<img src="cid:logo"><img src="https://images.example.com/banner?a=1&amp;b=2"><img src="javascript:bad"><img src="https://images.example.com/missing">', attachments: [{ id: 'attachment', contentId: '<logo>', size: 8 }] };
  const calls = [];
  const result = await I.load(current, async id => { assert.equal(id, 'attachment'); return image; }, async url => { calls.push(url); if (url.endsWith('/missing')) throw new Error('HTTP 404'); return image; }, 'https://images.example.com');
  assert.match(result.images['cid:logo'], /^data:image\/png;base64,/);
  assert.match(result.images['https://images.example.com/banner?a=1&b=2'], /^data:image\/png;base64,/);
  assert.equal(result.images['javascript:bad'], undefined);
  assert.match(result.errors['https://images.example.com/missing'], /404/);
  assert.equal(calls.length, 2);
  assert.throws(() => I.sourceURL('https://user:password@example.com/image'));
  assert.throws(() => I.sourceURL('file:///etc/passwd'));
});
test('image reads run in parallel with at most three requests and retain per-image failures', async () => {
  let active=0, peak=0;
  const current={html:Array.from({length:7},(_,i)=>`<img src="https://images.example.com/${i}">`).join(''),attachments:[]};
  const result=await I.load(current,()=>assert.fail('Not inline'),async url=>{
    active++; peak=Math.max(peak,active); await new Promise(resolve=>setImmediate(resolve)); active--;
    if(url.endsWith('/3')) throw new Error('HTTP 404'); return image;
  }, 'https://images.example.com');
  assert.equal(peak,3); assert.equal(Object.keys(result.images).length,6); assert.match(result.errors['https://images.example.com/3'],/404/);
});

test('automatic images are restricted to the exact HTTPS OWA origin before dispatch', async () => {
  const origin = 'https://mail.example.com:8443';
  let requests = 0;
  for (const src of ['http://mail.example.com:8443/a', 'https://mail.example.com/a', 'https://evil.example/a', 'https://mail.example.com.evil.test/a', 'http://127.0.0.1:8000/a', 'https://10.0.0.1/a', 'https://[::1]/a', 'https://user:pass@mail.example.com:8443/a', '//evil.example/a', 'javascript:bad']) {
    const result = await I.load({ html: `<img src="${src}">`, attachments: [] }, null, () => { requests++; return image; }, origin);
    assert.equal(Object.keys(result.images).length, 0, src);
    assert.ok(result.errors[src], src);
  }
  assert.equal(requests, 0);
  const result = await I.load({ html: '<img src="/owa/logo.png"><img src="https://mail.example.com:8443/logo.png">', attachments: [] }, null, async url => { assert.equal(new URL(url).origin, origin); requests++; return image; }, origin);
  assert.equal(requests, 2); assert.equal(Object.keys(result.images).length, 2);
});

test('image redirects cannot leave OWA, cookies are omitted, and logout aborts image reads', async () => {
  const origin = 'https://mail.example.com';
  for (const destination of ['https://evil.example/a', 'http://127.0.0.1/a', 'https://mail.example.com:8443/a']) {
    const calls = [], lifetime = new AbortController();
    const session = { fetch: async (url, options) => { calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.referrerPolicy, 'no-referrer'); return new Response(null, { status: 302, headers: { location: destination } }); } };
    await assert.rejects(I.fetchContentImage(`${origin}/image`, origin, session, lifetime.signal));
    assert.equal(calls.length, 1);
  }
  const lifetime = new AbortController(); let observedSignal;
  const pending = I.fetchContentImage(`${origin}/image`, origin, { fetch: (_url, { signal }) => { observedSignal = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } }, lifetime.signal);
  lifetime.abort(); await assert.rejects(pending); assert.equal(observedSignal.aborted, true);
  await assert.rejects(I.fetchContentImage(`${origin}/image`, origin, { fetch: () => assert.fail('Closed session reached network') }, lifetime.signal));
  const successful = await I.fetchContentImage('/owa/logo.png', origin, { fetch: async () => new Response(Buffer.from(image.Content, 'base64'), { headers: { 'content-type': image.ContentType } }) }, new AbortController().signal);
  assert.deepEqual(successful, image);
});

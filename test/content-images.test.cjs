const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../desktop/content-images.cjs');
const image = { ContentType: 'image/png', Content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=' };
test('encoded CID references resolve locally and missing CIDs never become remote requests', async () => {
  const current = { html: '<img src="cid:logo%40example.com"><img src="cid:missing">', attachments: [{ id: 'local', contentId: '<logo@example.com>', size: 8 }] };
  const result = await I.load(current, async id => { assert.equal(id, 'local'); return image; }, () => assert.fail('CID must not reach the network'), 'https://mail.example.com');
  assert.match(result.images['cid:logo%40example.com'], /^data:image\/png/);
  assert.match(result.errors['cid:missing'], /не найдено во вложениях/);
});
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

test('automatic images accept HTTP/HTTPS hosts but reject unsafe addresses before dispatch', async () => {
  const origin = 'https://mail.example.com:8443';
  let requests = 0;
  for (const src of ['http://127.0.0.1:8000/a', 'https://10.0.0.1/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://localhost/a', 'https://user:pass@mail.example.com:8443/a', 'javascript:bad', 'file:///picture.png']) {
    const result = await I.load({ html: `<img src="${src}">`, attachments: [] }, null, () => { requests++; return image; }, origin);
    assert.equal(Object.keys(result.images).length, 0, src);
    assert.ok(result.errors[src], src);
  }
  assert.equal(requests, 0);
  const result = await I.load({ html: '<img src="/owa/logo.png"><img src="https://mail.example.com:8443/logo.png"><img src="https://it/picture.png"><img src="//cdn.example.com/picture.png"><img src="http://it/picture.png">', attachments: [] }, null, async () => { requests++; return image; }, origin);
  assert.equal(requests, 5); assert.equal(Object.keys(result.images).length, 5);
});
test('known analytics beacons do not use image slots or reach the network', async () => {
  const beacon = 'http://www.google-analytics.com/collect?v=1&t=event&tid=fictional';
  const result = await I.load({ html: `<img src="${beacon}" width="1" height="1"><img src="https://it/picture.png">`, attachments: [] }, null, async url => { assert.equal(url,'https://it/picture.png'); return image; }, 'https://mail.example.com');
  assert.deepEqual(Object.keys(result.images), ['https://it/picture.png']); assert.deepEqual(result.errors,{});
  assert.deepEqual(I.sources(`<img src="https://www.google-analytics.com/g/collect">`),[]);
});

test('image redirects accept HTTPS hosts, reject unsafe targets, omit cookies, and abort at logout', async () => {
  const origin = 'https://mail.example.com';
  for (const destination of ['http://127.0.0.1/a', 'https://127.0.0.1/a', 'https://user:password@cdn.example.com/a', 'file:///picture.png']) {
    const calls = [], lifetime = new AbortController();
    const session = { fetch: async (url, options) => { calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.referrerPolicy, 'no-referrer'); return new Response(null, { status: 302, headers: { location: destination } }); } };
    await assert.rejects(I.fetchContentImage(`${origin}/image`, origin, session, lifetime.signal));
    assert.equal(calls.length, 1);
  }
  const redirects = [];
  const redirected = await I.fetchContentImage(`${origin}/image`, origin, { fetch: async (url, options) => {
    redirects.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    return redirects.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://it/picture.png' } }) : new Response(Buffer.from(image.Content, 'base64'), { headers: { 'content-type': image.ContentType } });
  } }, new AbortController().signal);
  assert.deepEqual(redirected, image); assert.deepEqual(redirects, [`${origin}/image`, 'https://it/picture.png']);
  const lifetime = new AbortController(); let observedSignal;
  const pending = I.fetchContentImage(`${origin}/image`, origin, { fetch: (_url, { signal }) => { observedSignal = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } }, lifetime.signal);
  lifetime.abort(); await assert.rejects(pending); assert.equal(observedSignal.aborted, true);
  await assert.rejects(I.fetchContentImage(`${origin}/image`, origin, { fetch: () => assert.fail('Closed session reached network') }, lifetime.signal));
  const successful = await I.fetchContentImage('/owa/logo.png', origin, { fetch: async () => new Response(Buffer.from(image.Content, 'base64'), { headers: { 'content-type': image.ContentType } }) }, new AbortController().signal);
  assert.deepEqual(successful, image);
});

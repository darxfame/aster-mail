const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../desktop/content-images.cjs');
const image = { ContentType: 'image/png', Content: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
test('inline and external images render as validated raster data with explicit load failures', async () => {
  const current = { html: '<img src="cid:logo"><img src="https://images.example.com/banner?a=1&amp;b=2"><img src="javascript:bad"><img src="https://images.example.com/missing">', attachments: [{ id: 'attachment', contentId: '<logo>', size: 8 }] };
  const calls = [];
  const result = await I.load(current, async id => { assert.equal(id, 'attachment'); return image; }, async url => { calls.push(url); if (url.endsWith('/missing')) throw new Error('HTTP 404'); return image; });
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
  });
  assert.equal(peak,3); assert.equal(Object.keys(result.images).length,6); assert.match(result.errors['https://images.example.com/3'],/404/);
});

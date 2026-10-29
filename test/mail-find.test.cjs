const test = require('node:test');
const assert = require('node:assert/strict');
const { rangesIn } = require('../src/mail-find.js');

function body(parts) {
  const nodes = parts.map(([data, block = 'paragraph']) => data === null ? { nodeType: 1, tagName: 'BR' } : {
    nodeType: 3, data, length: data.length,
    parentElement: { closest: selector => selector.startsWith('script') ? block === 'hidden' : block },
  });
  return { nodes, ownerDocument: {
    createTreeWalker: () => { let index = 0; return { nextNode: () => nodes[index++] }; },
    createRange: () => ({ setStart(node, offset) { this.start = [node, offset]; }, setEnd(node, offset) { this.end = [node, offset]; } }),
  } };
}

test('literal case-insensitive search crosses inline formatting with original Unicode offsets', () => {
  const doc = body([['ПрИ'], ['Вет [тест]. İ 😀']]);
  const { ranges } = rangesIn(doc, 'привет');
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0].start, [doc.nodes[0], 0]);
  assert.deepEqual(ranges[0].end, [doc.nodes[1], 3]);
  assert.equal(rangesIn(doc, '[тест].').ranges.length, 1);
  assert.deepEqual(rangesIn(doc, '😀').ranges[0].end, [doc.nodes[1], doc.nodes[1].length]);
  assert.equal(rangesIn(doc, '.*').ranges.length, 0);
});

test('search respects paragraphs and line breaks, excludes hidden text and leaves text untouched', () => {
  const doc = body([['one', 'first'], ['two', 'second'], [null], ['three', 'second'], ['secret', 'hidden']]);
  const before = doc.nodes.map(node => node.data);
  for (const query of ['onetwo', 'twothree', 'secret', 'missing', '']) assert.equal(rangesIn(doc, query).ranges.length, 0, query);
  assert.equal(rangesIn(doc, 'two').ranges.length, 1);
  assert.deepEqual(doc.nodes.map(node => node.data), before);
});

test('large messages cap highlights and report whether matches were omitted', () => {
  assert.equal(rangesIn(body([['a '.repeat(1001)]]), 'a').ranges.length, 1000);
  assert.equal(rangesIn(body([['a '.repeat(1001)]]), 'a').truncated, true);
  assert.equal(rangesIn(body([['a '.repeat(1000)]]), 'a').truncated, false);
});

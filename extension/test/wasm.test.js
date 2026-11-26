'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { Forth } = require('../src/forth');
const { WASM } = require('../src/wasmlink');

test('the kernel in WebAssembly: lines, words, errors, recovery', { skip: !fs.existsSync(WASM) && 'needs wasm/forth.wasm (wasm/build.sh)' }, async () => {
  const f = new Forth();
  assert.ok(await f.connect('wasm'));
  try {
    assert.strictEqual(f.port, 'no board');
    let r = await f.run(': SQ ( n -- n2 ) DUP * ;');
    assert.strictEqual(r.error, null);
    r = await f.run('7 SQ .');
    assert.strictEqual(r.text.trim(), '49');
    r = await f.run('NOPE');
    assert.strictEqual(r.error, -13);
    r = await f.run('1 2 3');                     // the error left it working
    assert.deepStrictEqual(f.stack.items, ['1', '2', '3']);
    assert.ok(f.words.includes('SQ'));
    r = await f.run(': L 10 0 DO I . LOOP ; L');
    assert.strictEqual(r.text.trim(), '0 1 2 3 4 5 6 7 8 9');
  } finally { await f.disconnect(); }
});

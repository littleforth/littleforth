'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Index } = require('../src/model');
const S = require('../src/stacklens');
const ix = t => { const i = new Index(require('../data/builtins.json'), require('../data/rp2350.json')); i.setFile('/x.fth', t); return i; };
const run = t => S.analyse(t, ix(t));

test('stack after each line, inside and outside definitions', () => {
  const t = [': SQ ( n -- n2 )', '  DUP', '  * ;', '3 4', 'SWAP SQ'].join('\n');
  const r = run(t);
  assert.deepStrictEqual(r.lines.get(1).stack, ['n', 'n']);
  assert.deepStrictEqual(r.lines.get(2).stack, []);
  assert.deepStrictEqual(r.lines.get(3).stack, ['3', '4']);
  assert.deepStrictEqual(r.lines.get(4).stack, ['4', 'n2']);
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(run('1 2 3 ROT').lines.get(0).stack, ['2', '3', '1']);
});

test('a definition that leaves the wrong number', () => {
  const r = run(': BAD ( a b -- c ) DUP ;');
  assert.match(r.problems[0].message, /BAD leaves 3 items; its comment says 1/);
});

test('branches that disagree, and a loop that grows the stack', () => {
  let r = run(': B ( f -- x ) IF 1 ELSE 1 2 THEN ;');
  assert.match(r.problems[0].message, /branches of this IF … ELSE leave 1 and 2/);
  r = run(': L ( -- ) 10 0 DO I LOOP ;');
  assert.match(r.problems[0].message, /loop's body changes the depth by 1/);
  r = run(': OK ( n -- ) 0 DO I . LOOP ;');
  assert.deepStrictEqual(r.problems, []);
});

test('underflow inside a definition; unknown words stop the lens', () => {
  let r = run(': U ( a -- ) + ;');
  assert.match(r.problems[0].message, /\+ needs 2 items; 1 on the stack here/);
  r = run('1 FROB 2');
  assert.strictEqual(r.lines.get(0).sure, false);
});

test('registers and strings', () => {
  const r = run('SIO.GPIO_OUT @ S" hi" TYPE');
  assert.deepStrictEqual(r.lines.get(0).stack, ['x']);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/hotreload');

const v1 = ['VARIABLE N', ': SQ ( n -- n2 ) DUP * ;', ': CUBE ( n -- n3 )', '  DUP SQ * ;', ': HI ." hi" ;', '5 N !'].join('\n');

test('nothing changed: nothing sent', () => {
  assert.deepStrictEqual(H.plan(v1, v1).send, []);
});

test('a changed word and the words that use it', () => {
  const v2 = v1.replace('DUP * ;', 'DUP *  1+ ;');
  const p = H.plan(v1, v2);
  assert.deepStrictEqual(p.send.map(c => c.names[0]), ['SQ', 'CUBE']);
  assert.deepStrictEqual(p.changed, ['SQ']);
  assert.deepStrictEqual(p.send[1].from, 2);
  assert.deepStrictEqual(p.send[1].to, 3);
});

test('a new word is sent; whitespace at line ends is not a change; a removed one is listed', () => {
  const v2 = v1.replace(': HI ." hi" ;', ': HELLO ." hello" ;   ') + '   ';
  const p = H.plan(v1, v2);
  assert.deepStrictEqual(p.send.map(c => c.names[0]), ['HELLO']);
  assert.deepStrictEqual(p.removed, ['HI']);
});

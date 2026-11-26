'use strict';
// The register tab: the whole-value box and clickable bits only when it can be written.
const test = require('node:test');
const assert = require('node:assert');
require('./vscode-stub');
const { registerHtml } = require('../src/inspector');

test('register tab: value box, clickable bits, full description', () => {
  const desc = 'Once a LOCK bit is written to 1, ACCESSCTRL silently ignores writes from that master. LOCK is writable only by a Secure, Privileged processor or debugger.';
  const rw = registerHtml({ name: 'ACCESSCTRL.LOCK', addr: 0x40060000, desc, value: 4,
    fields: [['DEBUG', 3, 1, 'rw', ''], ['DMA', 2, 1, 'r', '']] });
  assert.match(rw, /id="whole" value="\$00000004"/);
  assert.match(rw, /data-bit="2" data-v="0"/);
  assert.match(rw, /data-bit="31" data-v="1"/);
  assert.ok(rw.includes('processor or debugger.'));
  const ro = registerHtml({ name: 'X.STATUS', addr: 0x40000000, access: 'r', value: 1, fields: [['A', 0, 1, 'r', '']] });
  assert.doesNotMatch(ro, /id="whole"|data-bit=/);
});

test('a word defined in two files: the one sent to the board wins', () => {
  const M = require('../src/model');
  const ix = new M.Index({}, {});
  ix.setFile('C:/ex/other/blink.fth', ': BLINK ( n -- ) MASK GPIO.SET ! ;\n');
  ix.setFile('C:/ex/rp2350/blink.fth', ': BLINK ( n -- ) LED-INIT ;\n');
  assert.strictEqual(ix.word('blink').path, 'C:/ex/other/blink.fth');
  ix.prefer = () => ['c:/ex/rp2350/blink.fth'];
  assert.strictEqual(ix.word('BLINK').path, 'C:/ex/rp2350/blink.fth');
});

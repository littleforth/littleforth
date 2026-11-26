// model.test.js - node --test test/   (no VS Code needed)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const m = require('../src/model');

const ROOT = path.resolve(__dirname, '..', '..');
const B = require('../data/builtins.json');
const RP = require('../data/rp2350.json');
const LIB = path.join(ROOT, 'lib', 'rp2350', 'drivers');

function forthFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? forthFiles(p) : /\.(fth|fr)$/.test(e.name) ? [p] : [];
  });
}

function pico() {
  const ix = new m.Index(B, RP);
  for (const f of forthFiles(LIB)) ix.setFile(f, fs.readFileSync(f, 'latin1'));
  return ix;
}

test('definitions match the Flet IDE (tools/forthsource.py) on every Forth file we have', () => {
  const files = ['examples', 'lib/rp2350/drivers', 'test', 'dev/archive/ide/tests/fixtures'].filter(d => fs.existsSync(path.join(ROOT, d))).flatMap(d => forthFiles(path.join(ROOT, d)));
  const py = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})
import forthsource as source
print(json.dumps({p: {k: [v[0], v[1], v[3]] for k, v in source.definitions(p).items()} for p in sys.argv[1:]}))
`, ...files]).toString());
  for (const f of files) {
    const js = m.definitions(fs.readFileSync(f, 'latin1'), f);
    const got = Object.fromEntries(Object.entries(js).map(([k, d]) => [k, [d.stack, d.note, d.line + 1]]));
    assert.deepStrictEqual(got, py[f], f);
  }
  assert.ok(files.length > 20);
});

test('numbers follow the kernel', () => {
  assert.strictEqual(m.number('42', 10), 42);
  assert.strictEqual(m.number('-1', 10), 0xFFFFFFFF);
  assert.strictEqual(m.number('$FF', 10), 255);
  assert.strictEqual(m.number('ff', 16), 255);
  assert.strictEqual(m.number('#10', 16), 10);
  assert.strictEqual(m.number('%101', 10), 5);
  assert.strictEqual(m.number("'A'", 10), 65);
  assert.strictEqual(m.number('FF', 10), null);
  assert.strictEqual(m.number('$', 10), null);
  assert.strictEqual(m.number('-', 10), null);
});

test('registers, peripherals and instance words resolve as the kernel does', () => {
  const ix = pico();
  const r = ix.classify('sio.gpio_oe_set');
  assert.strictEqual(r.kind, 'register');
  assert.strictEqual(r.reg.addr, 0xD0000038);
  assert.strictEqual(ix.classify('UART1.UARTFR').reg.addr, 0x40078018);
  assert.strictEqual(ix.classify('IO_BANK0.IRQSUMMARY_PROC0_SECURE0').kind, 'register');   // a shortened name, prefix given back
  assert.strictEqual(ix.classify('ADC', 16).kind, 'periph');                             // the table comes before numbers
  const i = ix.classify('UART1.EMIT');
  assert.strictEqual(i.kind, 'instance');
  assert.strictEqual(i.def.name, 'UART.EMIT');
  assert.strictEqual(i.stack, '( c -- )');
  assert.strictEqual(ix.classify('UARTX.EMIT').kind, 'unknown');
  assert.strictEqual(ix.classify('DUP').kind, 'builtin');
});

test('completion after INSTANCE. offers its words and registers', () => {
  const labels = pico().complete('UART1.').map(c => c.label);
  assert.ok(labels.includes('UART1.EMIT'));
  assert.ok(labels.includes('UART1.UARTDR'));
  assert.ok(!labels.includes('UART1.CLK'), 'a constant takes no base');
});

test('the libraries and examples check clean', () => {
  const ix = pico();
  for (const f of [path.join(ROOT, 'lib', 'thumb2', 'call.fth'), path.join(ROOT, 'lib', 'save.fth'), ...forthFiles(LIB), path.join(ROOT, 'examples', 'rp2350', 'blink.fth'), path.join(ROOT, 'examples', 'rp2350', 'timer-irq.fth'),
    path.join(ROOT, 'lib', 'thumb2', 'asm.fth'), path.join(ROOT, 'examples', 'rp2350', 'asm-blink.fth')]) {
    ix.setFile(f, fs.readFileSync(f, 'latin1'));
    assert.deepStrictEqual(ix.check(fs.readFileSync(f, 'latin1')), [], f);
  }
});

test('check finds unknown words and use before definition', () => {
  const p = pico().check(': A ( -- ) B EMTI ;\n: B ( -- ) ;\nHEX 1F DECIMAL 1F\n');
  assert.deepStrictEqual(p.map(x => [x.line, x.start, x.message.split(' ')[0]]), [[0, 11, 'B'], [0, 13, 'EMTI'], [2, 15, '1F']]);
  assert.match(p[0].message, /before its definition \(line 2\)/);
});

test('comments and strings are not tokens', () => {
  assert.deepStrictEqual(m.tokens(': X ( a -- b ) ." hi there" S" x" 1 \\ rest').map(t => t.text), [':', 'X', '1']);
});

test('defining words made in Forth (CODE, reg:): what they define is known, in other files too', () => {
  const ix = pico();
  const asm = path.join(ROOT, 'lib', 'thumb2', 'asm.fth');
  ix.setFile('/w/mine.fth', 'CODE 3+ ( n -- n+3 )  tos tos 3 adds,  ret,  END-CODE\n: SIX 3+ 3+ ;\n7 K: SEVEN\n');
  assert.strictEqual(ix.word('3+').stack, '( n -- n+3 )', 'CODE always defines (ARM-syntax blocks need nothing loaded)');
  assert.strictEqual(ix.word('SEVEN'), null, 'K: is not known yet');
  ix.setFile('/w/k.fth', ': K: ( n \"name\" -- ) CONSTANT ;\n');        // now it is: mine.fth read again
  assert.strictEqual(ix.word('SEVEN').stack, 'K:');
  ix.setFile(asm, fs.readFileSync(asm, 'latin1'));
  assert.strictEqual(ix.word('TOS').stack, 'REG:');
  assert.ok(ix.word('ADDS,'));
  const four = 'CODE 4+ ( n -- n+4 ) tos tos 4 adds, ret, END-CODE 1 4+ .\n';
  ix.setFile('/w/four.fth', four);
  assert.deepStrictEqual(ix.check(four), []);
  const d = m.definitions(': K: ( "name" -- ) CREATE , ;\n5 K: FIVE\n', 'x');
  assert.deepStrictEqual([...d.definers], ['K:']);
  assert.strictEqual(d.FIVE.stack, 'K:');
});

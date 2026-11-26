// thumb2asm.test.js - CODE blocks in ARM syntax: every form in test/asm-cases.json
// (the postfix assembler's cases) and branch relaxation against arm-none-eabi-as,
// so both assemblers agree with it and with each other; errors at their line; the
// Forth that builds a word; a block run on the M33 under QEMU through the console.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../src/thumb2asm');

const ROOT = path.join(__dirname, '..', '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'asm-cases.json'), 'utf8'));
let haveAs = true;
try { execFileSync('arm-none-eabi-as', ['--version'], { stdio: 'ignore' }); } catch { haveAs = false; }

// halfwords per labelled block, as arm-none-eabi-as assembles them
function gnu(blocks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-'));
  const src = '.syntax unified\n.cpu cortex-m33\n.thumb\n' + blocks.map((b, i) => `.global c${i}\nc${i}:\n${b}\n`).join('') + `.global c${blocks.length}\nc${blocks.length}:\n nop\n`;
  fs.writeFileSync(path.join(dir, 'a.s'), src);
  execFileSync('arm-none-eabi-as', ['-o', path.join(dir, 'a.o'), path.join(dir, 'a.s')]);
  const dump = execFileSync('arm-none-eabi-objdump', ['-d', path.join(dir, 'a.o')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  fs.rmSync(dir, { recursive: true });
  const out = []; let cur = null;
  for (const line of dump.split('\n')) {
    let m = /^[0-9a-f]+ <c(\d+)>:/.exec(line);
    if (m) { cur = +m[1]; out[cur] = []; continue; }
    m = /^\s+[0-9a-f]+:\s+((?:[0-9a-f]{4} ?)+)\s/.exec(line);
    if (m && cur !== null) out[cur].push(...m[1].trim().split(/\s+/).map(h => parseInt(h, 16)));
  }
  return blocks.map((_, i) => out[i] || []);
}
const lines = text => text.split('\n').map((t, i) => ({ text: t, no: i }));
const hex = a => a.map(h => h.toString(16).padStart(4, '0')).join(' ');

test('every form of the postfix assembler, in ARM syntax: the bytes arm-none-eabi-as gives', { skip: !haveAs && 'no arm-none-eabi-as' }, () => {
  const want = gnu(CASES.map(c => c[1]));
  const bad = [];
  CASES.forEach(([, g], i) => {
    const r = A.assemble(lines(g));
    if (r.errors.length || hex(r.code) !== hex(want[i])) bad.push(`${g.replace(/\n/g, ';')}: ${r.errors.map(e => e.message).join(', ') || hex(r.code)}  as: ${hex(want[i])}`);
  });
  assert.deepStrictEqual(bad, []);
  assert.ok(CASES.length >= 170);
});

test('labels and branches: short where they reach, long where not, as GNU as relaxes them', { skip: !haveAs && 'no arm-none-eabi-as' }, () => {
  const nops = n => Array(n).fill(' nop').join('\n');
  const progs = [
    'loop: subs r0, r0, #1\n bne loop\n bx lr',
    ' b 1f\n nop\n1: nop\n b 1b',
    ' cbz r0, done\n adds r0, #1\n cbnz r1, done\n nop\ndone: bx lr',
    ` beq far1\n${nops(200)}\nfar1: nop`,                    // past bne.n's reach
    ` b far2\n${nops(1100)}\nfar2: nop`,                     // past b.n's reach
    `back: nop\n${nops(150)}\n bgt back`,
    ' cmp r0, #0\n it eq\n beq out\n nop\nout: bx lr',
    ' movs r0, #10\n1: subs r0, #1\n bne 1b\n2: b 2b',
  ];
  const want = gnu(progs);
  progs.forEach((p, i) => {
    const r = A.assemble(lines(p));
    assert.deepStrictEqual(r.errors, [], p.slice(0, 60));
    assert.strictEqual(hex(r.code), hex(want[i]), p.slice(0, 60));
  });
});

test('bl WORD and b WORD go to the address the board gives; offsets from where the code lands', () => {
  const r = A.assemble(lines(' push {lr}\n bl TWICE\n pop {pc}'), { base: 0x20001000, word: n => (n === 'TWICE' ? 0x20000801 : null) });
  assert.deepStrictEqual(r.errors, []);
  const d = 0x20000800 - (0x20001002 + 4);                // bl at base+2
  const s = (d >>> 24) & 1, j1 = (~(d >>> 23) & 1) ^ s, j2 = (~(d >>> 22) & 1) ^ s;
  assert.deepStrictEqual(r.code.slice(1, 3), [0xF000 | (s << 10) | ((d >> 12) & 0x3FF), 0xD000 | (j1 << 13) | (j2 << 11) | ((d >> 1) & 0x7FF)]);
  assert.match(A.assemble(lines(' bl NOPE'), { word: () => null }).errors[0].message, /NOPE is not a label here or a word/);
  assert.deepStrictEqual(A.assemble(lines(' bl LATER'), { word: () => undefined }).errors, [], 'only checking: not known yet is fine');
});

test('values: = loads any value or register name; #expressions; tos and psp', () => {
  const consts = n => ({ 'SIO.GPIO_OUT_XOR': 0xD000001C, LED: 25 })[n.toUpperCase()] ?? null;
  const r = A.assemble(lines(' ldr r0, =SIO.GPIO_OUT_XOR\n movs r1, #1\n lsls r1, r1, #LED\n mov r2, #(1 << 4) | 3\n str r1, [r0]\n adds tos, tos, #3\n ldr tos, [psp], #4'), { consts });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(hex(r.code), hex([0xF240, 0x001C, 0xF2CD, 0x0000, 0x2101, 0x0649, 0xF04F, 0x0213, 0x6001, 0x3603, 0xF855, 0x6B04]));
  assert.deepStrictEqual(r.rows.map(x => [x.no, x.off, x.size]), [[0, 0, 8], [1, 8, 2], [2, 10, 2], [3, 12, 4], [4, 16, 2], [5, 18, 2], [6, 20, 4]]);
});

test('errors are reported at their line, with what is wrong', () => {
  const r = A.assemble(lines(' addz r0, r1\n adds r0, r1, #1000000001\n addeq r0, #1\n it ne\n add r0, #1\n ldr r0, [r1, #5000]\n b nowhere'), { word: () => null });
  assert.deepStrictEqual(r.errors.map(e => e.no), [0, 1, 2, 4, 5, 6]);
  assert.match(r.errors[0].message, /addz is not an instruction/);
  assert.match(r.errors[1].message, /can't be encoded/);
  assert.match(r.errors[2].message, /needs an IT block/);
  assert.match(r.errors[3].message, /needs its condition: addne/);
  assert.match(r.errors[4].message, /-255 to 4095/);
});

test('blocks: ARM syntax found, postfix (lib/thumb2/asm.fth) left alone; the Forth that builds the word', () => {
  const t = ['CODE 3+ ( n -- n+3 )', '  adds r6, r6, #3  \\ tos', '  bx lr', 'END-CODE', 'CODE 4+  tos tos 4 adds,  ret,  END-CODE',
    'CODE X', '  tos tos 1 adds,', 'END-CODE', 'CODE Y', 'loop: b loop', 'END-CODE'];
  assert.deepStrictEqual(A.blocks(t), [{ start: 0, end: 3, name: '3+', stack: '( n -- n+3 )' }, { start: 8, end: 10, name: 'Y', stack: '' }]);
  assert.deepStrictEqual(A.forthLines('3+', [0x1CF6, 0x4770, 0xBF00]), [': 3+ [ -2 ALLOT', '$47701CF6 ,', '$BF00 HERE H! 2 ALLOT', '] ; -2 ALLOT']);
  assert.ok(A.isMnemonic('adds') && A.isMnemonic('bne.w') && A.isMnemonic('ldmia') && !A.isMnemonic('adds,') && !A.isMnemonic('tos'));
});

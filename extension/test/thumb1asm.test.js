// thumb1asm.test.js - the ARM-syntax assembler's ARMv6-M mode (opts.arch
// 'v6m', for Cortex-M0 boards): the instructions it takes give the bytes
// arm-none-eabi-as -mcpu=cortex-m0 gives, the Thumb-2 ones are refused,
// `ldr rd, =v` comes from a literal pool, and bl to a builtin goes through
// call_bi with the builtin's index after it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../src/thumb2asm');

let haveAs = true;
try { execFileSync('arm-none-eabi-as', ['--version'], { stdio: 'ignore' }); } catch { haveAs = false; }
const skip = !haveAs && 'no arm-none-eabi-as';

const lines = src => src.trim().split('\n').map((text, no) => ({ text: ' ' + text.trim(), no }));
const v6m = (src, o = {}) => A.assemble(lines(src), { arch: 'v6m', ...o });

// halfwords gas gives for src, assembled for the Cortex-M0 at an aligned address
function gas(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.s'), '.syntax unified\n.cpu cortex-m0\n.thumb\n.balign 4\n' + src + '\n');
    execFileSync('arm-none-eabi-as', ['-o', path.join(dir, 'a.o'), path.join(dir, 'a.s')]);
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', '-j', '.text', path.join(dir, 'a.o'), path.join(dir, 'a.bin')]);
    const b = fs.readFileSync(path.join(dir, 'a.bin'));
    const h = Array.from({ length: b.length >> 1 }, (_, i) => b.readUInt16LE(2 * i));
    if (h.length % 2 === 0 && h[h.length - 1] === 0x46C0) h.pop();     // gas pads the section to 4 with a nop
    return h;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// every ARMv6-M instruction class, with low and high registers where allowed
const ALL = `
movs r0, #0
movs r7, #255
mov r8, r0
mov r0, r12
mov sp, r7
adds r1, r2, #7
adds r3, #200
adds r0, r1, r2
add r8, r3
add r0, sp, #1020
add sp, #508
sub sp, #4
subs r1, r2, #1
subs r3, #255
subs r0, r1, r7
rsbs r2, r3, #0
negs r2, r3
cmp r0, #255
cmp r1, r2
cmp r8, r9
cmn r1, r2
ands r0, r1
orrs r2, r3
eors r4, r5
bics r6, r7
mvns r0, r1
adcs r1, r2
sbcs r3, r4
rors r5, r6
tst r0, r1
muls r0, r1, r0
lsls r0, r1, #31
lsrs r2, r3, #32
asrs r4, r5, #1
lsls r0, r1
lsrs r2, r3
asrs r4, r5
ldr r0, [r1]
ldr r0, [r1, #124]
ldr r2, [sp, #1020]
ldr r3, [r4, r5]
ldrh r0, [r1, #62]
ldrh r0, [r1, r2]
ldrb r0, [r1, #31]
ldrb r0, [r1, r2]
ldrsh r0, [r1, r2]
ldrsb r0, [r1, r2]
str r0, [r1, #4]
str r6, [r5]
str r2, [sp, #8]
str r3, [r4, r5]
strh r0, [r1, #2]
strh r0, [r1, r2]
strb r0, [r1]
strb r0, [r1, r2]
ldm r5!, {r6}
ldm r0!, {r1, r2, r3}
stm r1!, {r2, r4}
push {r4, r5, lr}
pop {r4, pc}
sxth r0, r1
sxtb r0, r1
uxth r0, r1
uxtb r0, r1
rev r0, r1
rev16 r2, r3
revsh r4, r5
bx lr
blx r3
cpsid i
cpsie i
nop
wfi
wfe
sev
yield
bkpt #0
svc #1
mrs r0, ipsr
mrs r1, primask
msr primask, r2
msr msp, r3
dmb sy
dsb sy
isb sy
`;

test('v6m: each ARMv6-M instruction gives the bytes arm-none-eabi-as -mcpu=cortex-m0 gives', { skip }, () => {
  const bad = [];
  for (const l of ALL.trim().split('\n')) {
    const r = v6m(l);
    if (r.errors.length) { bad.push(`${l}: ${r.errors[0].message}`); continue; }
    const w = gas(l);
    if (r.code.join() !== w.join()) bad.push(`${l}: ${r.code.map(h => h.toString(16))} against ${w.map(h => h.toString(16))}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('v6m: what gas refuses for the Cortex-M0 is refused, with a reason', { skip }, () => {
  const no = [
    'add r0, r1, #1', 'movw r0, #5', 'movt r0, #5', 'ldr.w r0, [r1]', 'ldr r0, [r1, #-4]', 'ldr r0, [r1, #4]!',
    'str r0, [r1], #4', 'udiv r0, r1, r2', 'sdiv r0, r1, r2', 'mul r0, r1, r2', 'mla r0, r1, r2, r3', 'clz r0, r1',
    'ubfx r0, r1, #2, #3', 'bfi r0, r1, #2, #3', 'orr.w r0, r1, #256', 'and r0, r1, r2, lsl #2', 'push.w {r4, r8}',
    'ldrd r0, r1, [r2]', 'strex r0, r1, [r2]', 'tbb [r0, r1]', 'lsls.w r0, r1, #3', 'mvn r0, #0x10000',
  ];
  for (const l of no) {
    assert.throws(() => gas(l), undefined, `gas takes ${l}: not a refusal case`);
    const r = v6m(l);
    assert.ok(r.errors.length, `${l} accepted: ${r.code.map(h => h.toString(16))}`);
    assert.match(r.errors[0].message, /ARMv6-M|not|no |out of|immediate|register|can't/i, l);
  }
  for (const [src, msg] of [['it eq\nmoveq r0, #1', /not on ARMv6-M/], ['cbz r0, 1f\n1: nop', /not on ARMv6-M/],
    ['add r0, r1, #1', /adds, which sets the flags/]]) assert.match(v6m(src).errors[0].message, msg);
});

test('v6m: branches are short; out of reach is an error, not a long form', { skip }, () => {
  const src = 'beq 1f\nb 1f\nbl 1f\n1: bx lr';
  assert.deepStrictEqual(v6m(src).code, gas(src));
  const far = 'beq 1f\n' + 'nop\n'.repeat(200) + '1: bx lr';
  assert.match(v6m(far).errors[0].message, /256 bytes/);
  const far2 = 'b 1f\n' + 'nop\n'.repeat(1100) + '1: bx lr';
  assert.match(v6m(far2).errors[0].message, /2 KB/);
  const bl = 'bl 1f\n' + 'nop\n'.repeat(1100) + '1: bx lr';
  assert.deepStrictEqual(v6m(bl).code, gas(bl));
  assert.match(v6m('b DUP', { word: () => 0x1000 }).errors[0].message, /use bl/);
});

test('v6m: ldr rd, =value from a pool after the code, as gas places it', { skip }, () => {
  for (const base of [0x20000100, 0x20000102]) {
    const src = 'ldr r0, =0x12345678\nldr r1, =5\nldr r2, =0x12345678\nldr r7, =-1\nbx lr';
    const r = v6m(src, { base });
    assert.deepStrictEqual(r.errors, []);
    // gas, at the same alignment, with its pool at .ltorg
    const g = gas((base & 2 ? 'nop\n' : '') + src + '\n.balign 4\n.ltorg').slice(base & 2 ? 1 : 0);
    assert.deepStrictEqual(r.code.map(h => h.toString(16)), g.slice(0, r.code.length).map(h => h.toString(16)));
  }
  assert.match(v6m('ldr r8, =5').errors[0].message, /r0-r7/);
  assert.match(v6m('ldr r0, =5\n' + 'nop\n'.repeat(520) + 'bx lr').errors[0].message, /out of reach/);
});

test('v6m: bl to flash out of reach is bl call_bi, then the xt less KBASE', () => {
  const callBi = 0x20000040, base = 0x20000400, kbase = 0x08000000;
  const r = v6m('bl DUP\nbl SQ\nbx lr', {
    base, far: n => (n === 'DUP' ? { callBi, off: 0x1235 } : null), word: n => (n === 'SQ' ? 0x20000201 : null),
  });
  assert.deepStrictEqual(r.errors, []);
  const blTo = (from, to) => { const d = to - (from + 4), s = (d >>> 24) & 1, j1 = (~(d >>> 23) & 1) ^ s, j2 = (~(d >>> 22) & 1) ^ s;
    return [0xF000 | (s << 10) | ((d >> 12) & 0x3FF), 0xD000 | (j1 << 13) | (j2 << 11) | ((d >> 1) & 0x7FF)]; };
  assert.deepStrictEqual(r.code, [...blTo(base, callBi), 0x1235, ...blTo(base + 6, 0x20000200), 0x4770]);
  assert.deepStrictEqual(r.rows.map(x => [x.off, x.size]), [[0, 6], [6, 4], [10, 2]]);
  // the decoder reads it back as one call, to KBASE + the halfword
  const D = require('../src/thumbdis');
  D.setFar({ callBi, kbase, names: [] });
  try {
    const b = Buffer.alloc(2 * r.code.length); r.code.forEach((h, i) => b.writeUInt16LE(h, 2 * i));
    const row = D.disassemble(b, base)[0];
    assert.match(row.text, /bl 0x8001234 @ call_bi/);
    assert.strictEqual(row.size, 6);
  } finally { D.setFar(null); }
});

test('without arch the Thumb-2 forms stay', () => {
  const r = A.assemble(lines('add r0, r1, #1\ncbz r0, 1f\nnop\n1: ldr r0, =0x12345678'), {});
  assert.deepStrictEqual(r.errors, []);
  // add.w, cbz, nop (bf00), movw, movt: no literal pool
  assert.deepStrictEqual(r.code.map(h => h.toString(16)), ['f101', '1', 'b100', 'bf00', 'f245', '6078', 'f2c1', '2034']);
});

// review 2026-11-18: the halfword after bl call_bi is not read as an instruction
test('annotate: the halfword after bl call_bi is skipped, even when it looks like an inline body', () => {
  const T = require('../src/thumb');
  const D = require('../src/thumbdis');
  const base = 0x20000400, callBi = 0x20000040;
  const r = v6m('push {lr}\nbl DUP\npop {pc}', { base, far: () => ({ callBi, off: 0x76 }) });
  const b = Buffer.alloc(2 * r.code.length); r.code.forEach((h, i) => b.writeUInt16LE(h, 2 * i));
  D.setFar({ callBi, kbase: 0, names: [] });
  try {
    const notes = T.annotate(b, { '2*': [0x0076] }, base);
    assert.ok(!Object.values(notes).some(t => /2\*/.test(t)), JSON.stringify(notes));
    assert.deepStrictEqual(Object.keys(notes).map(Number), [0, 8]);
  } finally { D.setFar(null); }
});

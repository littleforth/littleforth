// asmhelp.test.js - instruction explanations: a sentence, the effect, how to read the
// syntax. Every instruction the assembler takes and the decoder prints from the kernel
// images gets one, with effects that use that instruction's own registers.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/asmhelp');
const A = require('../src/thumb2asm');
const CORPUS = require('./thumbdis-fixed.json');
const ALL = [];
for (const [, , rows] of CORPUS) for (const [, ins] of rows) if (!/^\./.test(ins)) ALL.push(ins);
const X = t => H.explain(t);
const fx = t => X(t).fx.map(f => f[0]).join('\n');

test('every mnemonic the assembler takes is explained', () => {
  assert.deepStrictEqual(A.MNEMONICS.filter(m => !X(`${m} r0, r1`)), []);
});

test('every instruction decoded from the kernel images has a sentence', () => {
  const bad = new Set(ALL.filter(i => { const x = X(i); return !x || !x.sentence || /undefined|NaN/.test(x.sentence); }).map(i => i.split(' ')[0]));
  assert.deepStrictEqual([...bad], []);
});

test('the effects name every register the instruction uses', () => {
  const SHOW = { r6: 'TOS(r6)', r5: 'PSP(r5)', sp: 'RSP(sp)', lr: 'LR', pc: 'PC', sl: 'r10', fp: 'r11', ip: 'r12' };
  const bad = [];
  for (const ins of ALL) {
    const x = X(ins);
    if (!x.fx.length) continue;                       // nop, barriers: nothing moves
    const body = x.fx.map(f => f[0]).join(' ');
    const ops = ins.replace(/\s*@.*$/, '').split(' ').slice(1).join(' ');
    for (const m of ops.matchAll(/\b(r1[0-2]|r\d|sp|lr|pc|sl|fp|ip)\b/g)) {
      if (!body.includes(SHOW[m[1]] || m[1])) { bad.push(`${ins}: ${m[1]}`); break; }
    }
  }
  assert.deepStrictEqual(bad.slice(0, 10), []);
});

test('the sentences for the code generator\'s patterns and common instructions', () => {
  const S = t => X(t).sentence;
  assert.strictEqual(S('ldr.w r6, [r5], #4'), 'Pop the data stack: TOS takes the cell PSP points at, then PSP moves up one cell.');
  assert.strictEqual(S('ldr.w tos, [psp], #4'), S('ldr.w r6, [r5], #4'));
  assert.match(S('str.w r6, [r5, #-4]!'), /^Push onto the data stack/);
  assert.match(S('pop {pc}'), /^Word exit/);
  assert.match(S('add sp, #8'), /^End of a DO loop/);
  assert.strictEqual(S('adds r0, r0, #3'), 'Add 3 to r0, and set the flags from the result.');
  assert.strictEqual(S('addmi.w r6, r6, #4294967295'), 'Only if the last result was negative (set up by the IT before it): subtract 1 from TOS.');
  assert.strictEqual(S('bne.w 0x100'), 'If the last comparison was not equal, jump to 0x100.');
  assert.strictEqual(S('ldrb r0, [r1, #3]'), 'Load a byte from memory at r1 + 3 into r0.');
  assert.strictEqual(S('orr.w r0, r0, #32'), 'Set the bits of r0 that are set in 0x20.');
  assert.strictEqual(S('lsls r0, r1, #2'), 'Shift r1 left by 2 bits (× 4) into r0, and set the flags from the result.');
  assert.strictEqual(S('ite eq'), 'Make the next two instructions conditional: the first runs if the last comparison was equal, the second if not.');
  assert.strictEqual(S('bfi r0, r1, #4, #1'), 'Copy the low bit of r1 into bit 4 of r0, keeping its other bits.');
});

test('effects: role names, memory in brackets', () => {
  assert.strictEqual(fx('ldr.w r6, [r5], #4'), 'TOS(r6) ← [PSP(r5)]\nPSP(r5) ← PSP(r5) + 4');
  assert.strictEqual(fx('str.w r6, [r5, #-4]!'), 'PSP(r5) ← PSP(r5) - 4\n[PSP(r5)] ← TOS(r6)');
  assert.strictEqual(fx('push {r4, lr}'), 'RSP(sp) ← RSP(sp) - 8\n[RSP(sp)] ← r4, LR');
  assert.strictEqual(fx('bne.w 0x100'), 'if Z = 0 (not equal): PC ← 0x100');
});

test('reading the syntax', () => {
  assert.strictEqual(X('ldr.w r6, [r5], #4').decode, 'ldr = load a word · .w = the 4-byte form · [r5], #4 = use r5 as the address, then add 4 to it');
  assert.strictEqual(X('adds r0, r0, #3').decode, 'add·s = add, and set the flags · #3 = the number 3');
  assert.strictEqual(X('bne.w 0x100').decode, 'b·ne = branch (jump), if not equal · .w = the 4-byte form');
  assert.match(X('str.w r6, [r5, #-4]!').decode, /subtract 4 from r5 first, then use it; ! keeps the new r5/);
  assert.match(X('ubfx r0, r1, #3, #2').decode, /starting at bit 3, 2 bits wide/);
});

test('a line still being typed never throws, and nothing else is explained', () => {
  for (const m of A.MNEMONICS) for (const ops of ['', 'r0', 'r0,', 'r0, [r1', 'r0, #', '{r4', 'r0, r1, #3, #']) {
    assert.doesNotThrow(() => X(`${m} ${ops}`), `${m} ${ops}`);
  }
  assert.strictEqual(X('.short 0xffff'), null);
  assert.strictEqual(X('frob r1'), null);
  assert.match(H.role('tos'), /^r6 = TOS/);
});

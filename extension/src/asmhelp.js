// asmhelp.js - what a Thumb-2 instruction does, for hovers in CODE blocks, the
// SEE inspector and Memory's code view. Takes our source syntax or the decoder's
// (objdump's) alike. Three parts: what it does in words, the exact effect, and
// how to read the syntax.
//
//   ldr.w r6, [r5], #4
//   Pop the data stack: TOS takes the cell PSP points at, then PSP moves up one cell.
//     TOS(r6) ← [PSP(r5)]
//     PSP(r5) ← PSP(r5) + 4
//   ldr = load a word · .w = the 4-byte form · [r5], #4 = use r5 as the address, then add 4 to it
//
// [x] is the word at address x. Effects follow ARM's definitions (Armv7-M
// Architecture Reference Manual, A7.7); instruction names are ARM's titles.
'use strict';
const A = require('./thumb2asm');

// ---- registers: the kernel's roles ----
const CANON = { tos: 'r6', psp: 'r5', rsp: 'sp', r13: 'sp', r14: 'lr', r15: 'pc', sl: 'r10', fp: 'r11', ip: 'r12' };
const canon = r => CANON[r] || r;
const SHOW = { r6: 'TOS(r6)', r5: 'PSP(r5)', sp: 'RSP(sp)', lr: 'LR', pc: 'PC' };
const SCRATCH = 'scratch, free to use in a CODE word', KEPT = 'kept: save it before use in a CODE word';
const ROLE = {
  r6: 'r6 = TOS, the top of the data stack, kept in a register',
  r5: 'r5 = PSP, the data stack pointer: the rest of the stack, in memory',
  sp: 'sp = RSP, the return stack: return addresses, DO loop index and limit, >R',
  lr: 'LR (r14) = the return address the last BL left',
  pc: 'PC (r15) = the address of the instruction running',
};
for (const r of ['r0', 'r1', 'r2', 'r3', 'r12']) ROLE[r] = `${r}: ${SCRATCH}`;
for (const r of ['r4', 'r7', 'r8', 'r9', 'r10', 'r11']) ROLE[r] = `${r}: ${KEPT}`;
const REG_RE = /^(r1[0-5]|r\d|sp|lr|pc|ip|fp|sl|tos|psp|rsp)$/i;
const isReg = s => REG_RE.test(s);

// ---- instructions: ARM's name, and what it is for ----
const INFO = {
  mov: ['Move', 'copy a value into a register'], mvn: ['Bitwise NOT', 'copy with every bit inverted'],
  movw: ['Move (16-bit immediate)', 'load a 16-bit constant'], movt: ['Move Top', 'set the top half of a register, keeping the bottom half'],
  mov32: ['MOVW + MOVT', 'load any 32-bit constant (our assembler\'s shorthand)'],
  add: ['Add', ''], addw: ['Add (12-bit immediate)', 'add a constant'], adc: ['Add with Carry', 'add, plus the carry: the high word of a 64-bit add'],
  sub: ['Subtract', ''], subw: ['Subtract (12-bit immediate)', 'subtract a constant'], sbc: ['Subtract with Carry', 'subtract, less the borrow: the high word of a 64-bit subtract'],
  rsb: ['Reverse Subtract', 'subtract the other way round'], neg: ['Negate', 'change the sign'],
  mul: ['Multiply', 'multiply, keeping the low 32 bits'], mla: ['Multiply Accumulate', 'multiply and add'],
  mls: ['Multiply and Subtract', 'multiply and subtract: with a divide, gives a remainder'],
  smull: ['Signed Multiply Long', 'multiply to a full 64-bit signed result'], umull: ['Unsigned Multiply Long', 'multiply to a full 64-bit unsigned result'],
  sdiv: ['Signed Divide', 'divide, rounding toward zero (dividing by 0 gives 0)'], udiv: ['Unsigned Divide', 'divide (dividing by 0 gives 0)'],
  and: ['Bitwise AND', 'keep only the bits set in both'], orr: ['Bitwise OR', 'set bits'], orn: ['Bitwise OR NOT', 'set the bits clear in the second value'],
  eor: ['Bitwise Exclusive OR', 'flip bits'], bic: ['Bit Clear', 'clear bits'],
  lsl: ['Logical Shift Left', 'shift left, zeros in: multiplies by a power of 2'],
  lsr: ['Logical Shift Right', 'shift right, zeros in: unsigned divide by a power of 2'],
  asr: ['Arithmetic Shift Right', 'shift right, copying the sign bit in: signed divide by a power of 2'],
  ror: ['Rotate Right', 'rotate: bits out of the bottom come in at the top'],
  cmp: ['Compare', 'compare two values: set the flags for a conditional instruction'],
  cmn: ['Compare Negative', 'compare with the negative of a value'],
  tst: ['Test', 'test whether any of some bits are set'], teq: ['Test Equivalence', 'test whether two values are equal, flags only'],
  clz: ['Count Leading Zeros', 'count the zero bits above the highest set bit'], rbit: ['Reverse Bits', 'reverse the order of the bits'],
  rev: ['Byte-Reverse Word', 'swap the byte order (big- and little-endian)'], rev16: ['Byte-Reverse Packed Halfword', 'swap the bytes in each half'],
  revsh: ['Byte-Reverse Signed Halfword', 'swap a signed halfword\'s bytes'],
  uxtb: ['Unsigned Extend Byte', 'keep the low byte'], uxth: ['Unsigned Extend Halfword', 'keep the low halfword'],
  sxtb: ['Signed Extend Byte', 'keep the low byte, as a signed number'], sxth: ['Signed Extend Halfword', 'keep the low halfword, as a signed number'],
  ubfx: ['Unsigned Bit Field Extract', 'read a field of bits'], sbfx: ['Signed Bit Field Extract', 'read a field of bits, as a signed number'],
  bfi: ['Bit Field Insert', 'write a field of bits, leaving the rest'], bfc: ['Bit Field Clear', 'clear a field of bits'],
  ldr: ['Load Register', 'read a word from memory'], ldrb: ['Load Register Byte', 'read a byte from memory'],
  ldrh: ['Load Register Halfword', 'read a halfword from memory'], ldrsb: ['Load Register Signed Byte', 'read a signed byte from memory'],
  ldrsh: ['Load Register Signed Halfword', 'read a signed halfword from memory'], ldrd: ['Load Register Dual', 'read two words from memory'],
  str: ['Store Register', 'write a word to memory'], strb: ['Store Register Byte', 'write a byte to memory'],
  strh: ['Store Register Halfword', 'write a halfword to memory'], strd: ['Store Register Dual', 'write two words to memory'],
  push: ['Push Multiple Registers', 'save registers on the return stack'], pop: ['Pop Multiple Registers', 'restore registers from the return stack'],
  ldm: ['Load Multiple', 'read consecutive words into several registers'], stm: ['Store Multiple', 'write several registers to consecutive words'],
  ldmdb: ['Load Multiple Decrement Before', 'read the words below an address into several registers'],
  stmdb: ['Store Multiple Decrement Before', 'write several registers below an address: a push'],
  b: ['Branch', 'jump to another address'], bl: ['Branch with Link', 'call: jump, keeping the return address in LR'],
  bx: ['Branch and Exchange', 'jump to the address in a register'], blx: ['Branch with Link and Exchange', 'call the address in a register'],
  cbz: ['Compare and Branch on Zero', 'jump if a register is zero, without touching the flags'],
  cbnz: ['Compare and Branch on Nonzero', 'jump if a register is not zero, without touching the flags'],
  it: ['If-Then', 'make the next instructions conditional, without a branch'],
  nop: ['No Operation', 'do nothing: padding'], yield: ['Yield', 'hint that this is a busy-wait loop'],
  wfi: ['Wait For Interrupt', 'sleep until an interrupt is pending'], wfe: ['Wait For Event', 'sleep until an event or interrupt'],
  sev: ['Send Event', 'wake anything waiting in WFE'], cpsid: ['Change Processor State', 'turn interrupts off'],
  cpsie: ['Change Processor State', 'turn interrupts on'], bkpt: ['Breakpoint', 'stop for the debugger'],
  svc: ['Supervisor Call', 'raise a software interrupt'],
  dsb: ['Data Synchronization Barrier', 'wait until every earlier memory access has finished'],
  dmb: ['Data Memory Barrier', 'keep memory accesses in order across this point'],
  isb: ['Instruction Synchronization Barrier', 'refetch the following instructions (after changing code or system registers)'],
  mrs: ['Move to Register from Special register', 'read a special register'], msr: ['Move to Special register from Register', 'write a special register'],
};
for (const [a, b] of [['ldmia', 'ldm'], ['ldmfd', 'ldm'], ['stmia', 'stm'], ['stmea', 'stm'], ['stmfd', 'stmdb'], ['ldmea', 'ldmdb']]) INFO[a] = INFO[b];
for (const n of ['itt', 'ite', 'ittt', 'itte', 'itet', 'itee', 'itttt', 'ittte', 'ittet', 'ittee', 'itett', 'itete', 'iteet', 'iteee']) INFO[n] = INFO.it;

const COND = { eq: 'Z = 1 (equal)', ne: 'Z = 0 (not equal)', cs: 'C = 1 (unsigned ≥)', hs: 'C = 1 (unsigned ≥)',
  cc: 'C = 0 (unsigned <)', lo: 'C = 0 (unsigned <)', mi: 'N = 1 (negative)', pl: 'N = 0 (zero or positive)',
  vs: 'V = 1 (overflow)', vc: 'V = 0 (no overflow)', hi: 'C = 1 and Z = 0 (unsigned >)', ls: 'C = 0 or Z = 1 (unsigned ≤)',
  ge: 'N = V (signed ≥)', lt: 'N ≠ V (signed <)', gt: 'Z = 0 and N = V (signed >)', le: 'Z = 1 or N ≠ V (signed ≤)' };
const CNAME = Object.fromEntries(Object.entries(A.CONDS).map(([k, v]) => [v, k]));
const INVERSE = { eq: 'ne', ne: 'eq', cs: 'cc', hs: 'lo', cc: 'cs', lo: 'hs', mi: 'pl', pl: 'mi', vs: 'vc', vc: 'vs', hi: 'ls', ls: 'hi', ge: 'lt', lt: 'ge', gt: 'le', le: 'gt' };

// ---- operands ----
function split(s) {                                // commas outside [] and {}
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const immVal = s => { const t = String(s).replace(/^#/, '').trim(); const v = /^-?0x/i.test(t) ? parseInt(t, 16) : Number(t); return Number.isFinite(v) ? v | 0 : null; };
const num = v => (Math.abs(v) < 4096 ? String(v) : '0x' + (v >>> 0).toString(16));
// A register shown with its role, or a constant as a number, or the text as written
function val(s) {
  if (s === undefined || s === null || !String(s).trim()) return '?';
  const t = String(s).trim();
  if (isReg(t)) { const r = canon(t.toLowerCase()); return SHOW[r] || r; }
  const v = /^#/.test(t) || /^-?(0x[0-9a-f]+|\d+)$/i.test(t) ? immVal(t) : null;
  return v === null ? t : num(v);
}
// The second operand of a data instruction, with an optional shift: r1, lsl #2 -> (r1 << 2)
const bitsOf0 = (l, w) => (w === 1 ? `bit ${l}` : `bits ${l + w - 1}..${l}`);
const SHIFTOP = { lsl: '<<', lsr: '>>', asr: '>>', ror: 'rotated right' };
function op2(ops, i) {
  const x = val(ops[i]);
  const sh = ops[i + 1] && /^(lsl|lsr|asr|ror)\s+#?(\d+)$/i.exec(ops[i + 1]);
  return sh ? `(${x} ${SHIFTOP[sh[1].toLowerCase()]} ${sh[2]})` : x;
}
const listRegs = s => s.replace(/[{}]/g, '').split(',').map(x => x.trim()).filter(Boolean);
function regsIn(text) { const out = []; for (const m of text.toLowerCase().matchAll(/\b(r1[0-5]|r\d|sp|lr|pc|ip|fp|sl|tos|psp|rsp)\b/g)) { const r = canon(m[1]); if (!out.includes(r)) out.push(r); } return out; }

// What moving a pointer by d bytes means, when the pointer is a stack
function stackNote(base, d) {
  const which = base === 'r5' ? 'data stack' : base === 'sp' ? 'return stack' : null;
  if (!which || !d || d % 4) return '';
  const n = Math.abs(d) / 4;
  return `${['', 'one cell', 'two cells', 'three cells', 'four cells'][n] || `${n} cells`} ${d > 0 ? 'up' : 'down'}: the ${which} ${d > 0 ? 'shrinks' : 'grows'}`;
}
const move = (base, d) => [`${val(base)} ← ${val(base)} ${d < 0 ? '-' : '+'} ${num(Math.abs(d))}`, stackNote(canon(base.toLowerCase()), d)];

// ---- effects ----
// Each effect is [text, note]; the note is printed aligned after the text.
const BIN = { add: '+', addw: '+', sub: '-', subw: '-', and: 'AND', orr: 'OR', eor: 'XOR', bic: 'AND NOT', orn: 'OR NOT', mul: '×' };

function memEffects(base, rt, rest, ops) {
  const load = /^ldr/.test(base);
  const size = /b$/.test(base) ? 'byte' : /h$/.test(base) ? 'halfword' : 'word';
  const signed = /^ldrs/.test(base);
  const dual = /d$/.test(base);
  const addrText = rest.slice(rest.indexOf(',') + 1).trim().replace(/^[^,[]*,\s*(?=\[)/, '');   // ldrd rt, rt2, [...]
  const m = /^\[([^\]]*)\](!?)(?:,\s*(.*))?$/.exec(addrText);
  if (!m) return null;
  const inner = split(m[1]);
  const bn = inner[0];
  let addr = val(bn), pre = null, post = null;
  if (inner[1] !== undefined) {
    if (isReg(inner[1])) {
      const sh = inner[2] && /^lsl\s+#?(\d+)$/i.exec(inner[2]);
      addr = `${val(bn)} + ${sh ? `(${val(inner[1])} << ${sh[1]})` : val(inner[1])}`;
    } else {
      const d = immVal(inner[1]);
      if (m[2]) pre = d;
      else if (d) addr = `${val(bn)} ${d < 0 ? '-' : '+'} ${num(Math.abs(d))}`;
    }
  }
  if (m[3] !== undefined) post = immVal(m[3]);
  const fx = [];
  if (pre !== null) fx.push(move(bn, pre));
  const where = `[${addr}]`;
  const what = size === 'word' ? '' : signed ? `one ${size}, sign-extended` : load ? `one ${size}, zero-extended` : `its low ${size}`;
  const rt2 = dual ? ops[1] : null;
  if (load) {
    fx.push([`${val(rt)} ← ${where}`, canon(bn.toLowerCase()) === 'pc' ? 'a constant stored after the code' : what]);
    if (rt2) fx.push([`${val(rt2)} ← [${addr} + 4]`, '']);
  } else {
    fx.push([`${where} ← ${val(rt)}`, what]);
    if (rt2) fx.push([`[${addr} + 4] ← ${val(rt2)}`, '']);
  }
  if (post !== null) fx.push(move(bn, post));
  const purpose = pre !== null ? 'move the pointer, then ' : '';
  const after = post !== null ? ', then move the pointer' : '';
  return { fx, purpose, after };
}

function effects(mn, word, rest) {
  const b = mn.base, ops = split(rest), s = mn.s;
  const fx = [];
  const flagsArith = () => fx.push(['N Z C V set from the result', '']);
  const flagsLogic = () => fx.push(['N Z set from the result', '']);
  let purpose = '', after = '';
  if (/^(ldr|str)/.test(b)) {
    if (b === 'ldr' && /=/.test(rest)) { fx.push([`${val(ops[0])} ← ${rest.slice(rest.indexOf('=') + 1).trim()}`, '']); return { fx, purpose: '', after: '', name: 'LDR (literal)', what: 'load any 32-bit value or address' }; }
    const r = memEffects(b, ops[0], rest, ops);
    return r;
  }
  if (b in BIN && ops.length >= 2) {
    let [d, n, i] = ops.length === 2 ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2];
    let sym = BIN[b], rhs = op2(ops, i);
    const v = immVal(ops[i]);
    if (/^(and|orr|eor|bic|orn)$/.test(b) && v !== null && !isReg(ops[i])) rhs = '0x' + (v >>> 0).toString(16);
    if ((b === 'add' || b === 'sub' || b === 'addw' || b === 'subw') && v !== null && v < 0 && /^#?-?\d+$/.test(ops[i].trim()) === false && (v >>> 0) > 0x7FFFFFFF) {
      sym = sym === '+' ? '-' : '+'; rhs = num(-v);
    } else if ((b === 'add' || b === 'sub') && v !== null && v < 0) { sym = sym === '+' ? '-' : '+'; rhs = num(-v); }
    const c = canon(d.toLowerCase());
    let note = '';
    if (c === canon(n.toLowerCase()) && (c === 'r5' || c === 'sp') && v !== null && (sym === '+' || sym === '-')) note = stackNote(c, sym === '+' ? v : -v);
    fx.push([`${val(d)} ← ${val(n)} ${sym} ${rhs}`, note]);
    if (s) (b === 'add' || b === 'sub' ? flagsArith : flagsLogic)();
  } else if (b === 'adc' || b === 'sbc') {
    const [d, n, i] = ops.length === 2 ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2];
    fx.push([b === 'adc' ? `${val(d)} ← ${val(n)} + ${op2(ops, i)} + C` : `${val(d)} ← ${val(n)} - ${op2(ops, i)} - NOT C`, '']);
    if (s) flagsArith();
  } else if (b === 'rsb') {
    const [d, n, i] = ops.length === 2 ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2];
    fx.push([`${val(d)} ← ${op2(ops, i)} - ${val(n)}`, '']);
    if (s) flagsArith();
  } else if (b === 'neg') {
    fx.push([`${val(ops[0])} ← 0 - ${val(ops[1] || ops[0])}`, '']);
    if (s) flagsArith();
  } else if (b === 'mov' || b === 'mvn') {
    fx.push([`${val(ops[0])} ← ${b === 'mvn' ? 'NOT ' : ''}${op2(ops, 1)}`, '']);
    if (s) flagsLogic();
  } else if (b === 'movw' || b === 'mov32') {
    fx.push([`${val(ops[0])} ← ${val(ops[1])}`, '']);
  } else if (b === 'movt') {
    fx.push([`top half of ${val(ops[0])} ← ${val(ops[1])}`, 'the bottom half is kept']);
  } else if (b in SHIFTOP) {
    const [d, m, n] = ops.length === 2 ? [ops[0], ops[0], ops[1]] : ops;
    fx.push([`${val(d)} ← ${val(m)} ${SHIFTOP[b]} ${val(n)}`, b === 'lsr' ? 'zeros come in at the top' : b === 'asr' ? 'the sign bit is copied in' : '']);
    if (s) fx.push(['N Z C set from the result', 'C: the last bit shifted out']);
  } else if (b === 'mla' || b === 'mls') {
    fx.push([`${val(ops[0])} ← ${val(ops[3])} ${b === 'mla' ? '+' : '-'} ${val(ops[1])} × ${val(ops[2])}`, '']);
  } else if (b === 'umull' || b === 'smull') {
    fx.push([`${val(ops[1])}:${val(ops[0])} ← ${val(ops[2])} × ${val(ops[3])}`, `64 bits, ${b === 'umull' ? 'unsigned' : 'signed'}: high word first`]);
  } else if (b === 'sdiv' || b === 'udiv') {
    const [d, n, m] = ops.length === 2 ? [ops[0], ops[0], ops[1]] : ops;
    fx.push([`${val(d)} ← ${val(n)} ÷ ${val(m)}`, b === 'sdiv' ? 'signed, rounded toward zero' : 'unsigned']);
  } else if (b === 'cmp' || b === 'cmn') {
    fx.push([`N Z C V ← the flags of ${val(ops[0])} ${b === 'cmp' ? '-' : '+'} ${op2(ops, 1)}`, 'the result itself is not kept']);
  } else if (b === 'tst' || b === 'teq') {
    fx.push([`N Z ← the flags of ${val(ops[0])} ${b === 'tst' ? 'AND' : 'XOR'} ${op2(ops, 1)}`, b === 'tst' ? 'Z = 1: none of the bits set' : 'Z = 1: equal']);
  } else if (b === 'clz') {
    fx.push([`${val(ops[0])} ← the number of zero bits above the highest set bit of ${val(ops[1])}`, '32 if it is 0']);
  } else if (b === 'rbit' || b === 'rev' || b === 'rev16' || b === 'revsh') {
    fx.push([`${val(ops[0])} ← ${val(ops[1])} with its ${b === 'rbit' ? 'bit order reversed' : b === 'rev' ? 'byte order reversed' : 'bytes swapped in each half'}`, '']);
  } else if (/^[us]xt[bh]$/.test(b)) {
    const w = b[3] === 'b' ? 'byte' : 'halfword';
    fx.push([b[0] === 'u' ? `${val(ops[0])} ← ${val(ops[1] || ops[0])} AND ${w === 'byte' ? '0xFF' : '0xFFFF'}` : `${val(ops[0])} ← the low ${w} of ${val(ops[1] || ops[0])}, sign-extended`, '']);
  } else if (b === 'ubfx' || b === 'sbfx') {
    const l = immVal(ops[2]), w = immVal(ops[3]);
    fx.push([`${val(ops[0])} ← ${bitsOf0(l, w)} of ${val(ops[1])}, moved down to bit 0`, b === 'sbfx' ? 'sign-extended' : '']);
  } else if (b === 'bfi') {
    const l = immVal(ops[2]), w = immVal(ops[3]);
    fx.push([`${bitsOf0(l, w)} of ${val(ops[0])} ← ${w === 1 ? 'the low bit' : `the low ${w} bits`} of ${val(ops[1])}`, 'the other bits are kept']);
  } else if (b === 'bfc') {
    const l = immVal(ops[1]), w = immVal(ops[2]);
    fx.push([`${bitsOf0(l, w)} of ${val(ops[0])} ← 0`, 'the other bits are kept']);
  } else if (b === 'push' || b === 'pop' || b === 'stmdb' && canon((ops[0] || '').replace('!', '').toLowerCase()) === 'sp' && ops[0].includes('!') || b === 'ldm' && canon((ops[0] || '').replace('!', '').toLowerCase()) === 'sp' && ops[0].includes('!')) {
    const list = listRegs(b === 'push' || b === 'pop' ? rest : ops[1]);
    const regs = list.map(val).join(', ');
    const n = 4 * list.length;
    if (b === 'push' || b === 'stmdb') { fx.push(move('sp', -n)); fx.push([`[RSP(sp)] ← ${regs}`, list.length > 1 ? 'lowest register at the lowest address' : '']); }
    else { fx.push([`${regs} ← [RSP(sp)]`, list.some(r => canon(r.toLowerCase()) === 'pc') ? 'loading PC returns' : '']); fx.push(move('sp', n)); }
  } else if (/^(ldm|stm)/.test(b)) {
    const wb = /!$/.test(ops[0]), bn = ops[0].replace('!', '');
    const list = listRegs(ops[1] || '');
    const down = /db$|ea$|fd$/.test(b) && /^stm/.test(b) || /db$|ea$/.test(b) && /^ldm/.test(b);
    if (down && wb) fx.push(move(bn, -4 * list.length));
    fx.push(/^ldm/.test(b) ? [`${list.map(val).join(', ')} ← the words from [${val(bn)}]${down && !wb ? ' down' : ''}`, list.some(r => canon(r.toLowerCase()) === 'pc') ? 'loading PC returns' : ''] : [`the words from [${val(bn)}] ← ${list.map(val).join(', ')}`, '']);
    if (!down && wb) fx.push(move(bn, 4 * list.length));
  } else if (b === 'b' || b === 'bl') {
    const t = rest.trim();
    if (b === 'bl') { fx.push(['LR ← the address of the next instruction', 'where the call returns to']); fx.push([`PC ← ${t}`, '']); }
    else fx.push([mn.cond !== null ? `if ${COND[CNAME[mn.cond]]}: PC ← ${t}` : `PC ← ${t}`, '']);
  } else if (b === 'bx' || b === 'blx') {
    if (b === 'blx') fx.push(['LR ← the address of the next instruction', '']);
    fx.push([`PC ← ${val(ops[0])}`, canon(ops[0].toLowerCase()) === 'lr' ? 'return to the caller' : '']);
  } else if (b === 'cbz' || b === 'cbnz') {
    fx.push([`if ${val(ops[0])} ${b === 'cbz' ? '=' : '≠'} 0: PC ← ${ops[1]}`, '']);
  } else if (/^it/.test(b)) {
    const c = rest.trim().toLowerCase();
    const pat = 't' + b.slice(2);
    pat.split('').forEach((x, i) => fx.push([`instruction ${i + 1} runs only if ${COND[x === 't' ? c : INVERSE[c]] || c}`, '']));
  } else if (b === 'cpsid' || b === 'cpsie') {
    fx.push([`PRIMASK ← ${b === 'cpsid' ? 1 : 0}`, `interrupts ${b === 'cpsid' ? 'off' : 'on'}`]);
  } else if (b === 'mrs') {
    fx.push([`${val(ops[0])} ← ${ops[1]}`, '']);
  } else if (b === 'msr') {
    fx.push([`${ops[0]} ← ${val(ops[1])}`, '']);
  }
  if (mn.cond !== null && mn.cond !== undefined && !/^(b|it)/.test(b) && fx.length) {
    fx.unshift([`only if ${COND[CNAME[mn.cond]]}:`, 'set by an IT before it']);
  }
  return { fx, purpose, after };
}

// ---- the sentence: what this instruction does, in words ----
const SAY = { r6: 'TOS', r5: 'PSP', sp: 'RSP', lr: 'LR', pc: 'PC' };
function say(s) {
  if (s === undefined || s === null || !String(s).trim()) return '?';
  const t = String(s).trim();
  if (isReg(t)) { const r = canon(t.toLowerCase()); return SAY[r] || r; }
  const v = /^#/.test(t) || /^-?(0x[0-9a-f]+|\d+)$/i.test(t) ? immVal(t) : null;
  return v === null ? t : num(v);
}
const sayList = rs => { const n = rs.map(say); return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]; };
const COND_SAY = { eq: 'the last comparison was equal', ne: 'the last comparison was not equal',
  cs: 'the carry is set (unsigned greater or equal)', hs: 'it was unsigned greater or equal',
  cc: 'the carry is clear (unsigned less)', lo: 'it was unsigned less', mi: 'the last result was negative',
  pl: 'the last result was zero or positive', vs: 'the last result overflowed', vc: 'the last result did not overflow',
  hi: 'it was unsigned greater', ls: 'it was unsigned less or equal', ge: 'it was greater or equal (signed)',
  lt: 'it was less (signed)', gt: 'it was greater (signed)', le: 'it was less or equal (signed)' };
const COND_SHORT = { eq: 'equal', ne: 'not equal', cs: 'carry set', hs: 'unsigned higher or same', cc: 'carry clear',
  lo: 'unsigned lower', mi: 'minus (negative)', pl: 'plus (zero or positive)', vs: 'overflow', vc: 'no overflow',
  hi: 'unsigned higher', ls: 'unsigned lower or same', ge: 'greater or equal', lt: 'less than', gt: 'greater than', le: 'less or equal' };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const bitsOf = (l, w) => (w === 1 ? `bit ${l}` : `bits ${l + w - 1}..${l}`);
const lowBits = w => (w === 1 ? 'the low bit' : `the low ${w} bits`);

// [rn, #x]!  [rn], #x  [rn, rm, lsl #n] -> {base, off (number), reg, shift, pre, post, text}
function parseMem(rest) {
  const at = rest.indexOf('[');
  if (at < 0) return null;
  const m = /^\[([^\]]*)\](!?)(?:,\s*(.*))?$/.exec(rest.slice(at).trim());
  if (!m) return null;
  const inner = split(m[1]);
  const out = { base: inner[0], off: 0, reg: null, shift: 0, pre: !!m[2], post: null, text: rest.slice(at).trim() };
  if (inner[1] !== undefined) {
    if (isReg(inner[1])) { out.reg = inner[1]; const sh = inner[2] && /^lsl\s+#?(\d+)$/i.exec(inner[2]); out.shift = sh ? Number(sh[1]) : 0; }
    else out.off = immVal(inner[1]) || 0;
  }
  if (m[3] !== undefined) out.post = immVal(m[3]);
  return out;
}
const addrSay = p => (p.reg ? `${say(p.base)} + ${p.shift ? `${say(p.reg)} × ${1 << p.shift}` : say(p.reg)}` : p.off && !p.pre ? `${say(p.base)} ${p.off < 0 ? '-' : '+'} ${Math.abs(p.off)}` : say(p.base));
const moveSay = (base, d) => `${d < 0 ? 'move' : 'move'} ${say(base)} ${d < 0 ? 'down' : 'up'} ${d % 4 === 0 && ['r5', 'sp'].includes(canon(base.toLowerCase())) ? (Math.abs(d) === 4 ? 'one cell' : `${Math.abs(d) / 4} cells`) : `by ${Math.abs(d)}`}`;

// The code generator's patterns: the sentence says what they are for in Forth
const IDIOM = [
  [/^str(\.w)? r6, \[r5, #-4\]!$/, 'Push onto the data stack: PSP moves down one cell, then TOS is saved there, making room for a new top.'],
  [/^ldr(\.w)? r6, \[r5\], #4$/, 'Pop the data stack: TOS takes the cell PSP points at, then PSP moves up one cell.'],
  [/^ldr(\.w)? r0, \[r5\], #4$/, 'Pop the second item into r0 (for a word that takes two): r0 takes the cell PSP points at, then PSP moves up one cell.'],
  [/^push(\.w)? \{lr\}$/, 'Word entry: save LR, the return address, on the return stack, so this word can call others.'],
  [/^push(\.w)? \{r4, lr\}$/, 'Word entry: save r4 and LR, the return address, on the return stack.'],
  [/^pop(\.w)? \{pc\}$/, 'Word exit (;): take the return address off the return stack into PC, which returns to the caller.'],
  [/^pop(\.w)? \{r4, pc\}$/, 'Word exit (;): restore r4, and take the return address into PC, which returns to the caller.'],
  [/^bx lr$/, 'Return to the caller: jump to the address in LR.'],
  [/^cmp(\.w)? r6, #0$/, 'Compare TOS with 0, setting the flags for the IF, UNTIL or WHILE branch that follows.'],
  [/^ldr(\.w)? r0, \[sp(, #0)?\]$/, 'Read the DO loop\'s index (I) from the top of the return stack into r0.'],
  [/^ldr(\.w)? (r[01]), \[sp, #4\]$/, m => `Read the DO loop's limit from the return stack into ${m[2]}.`],
  [/^ldr(\.w)? r0, \[sp, #8\]$/, 'Read the outer loop\'s index (J) from the return stack into r0.'],
  [/^add(\.w)? sp, #8$/, 'End of a DO loop: drop its index and limit from the return stack.'],
];

const VERB = { add: ['Add', 'to'], addw: ['Add', 'to'], sub: ['Subtract', 'from'], subw: ['Subtract', 'from'] };
// bit operations: [in place, into another register]
const BITS = { and: ['Keep only the bits of D that are also set in X', 'Keep only the bits of N that are also set in X, into D'],
  orr: ['Set the bits of D that are set in X', 'Take N with the bits set in X also set, into D'],
  eor: ['Flip the bits of D that are set in X', 'Take N with the bits set in X flipped, into D'],
  bic: ['Clear the bits of D that are set in X', 'Take N with the bits set in X cleared, into D'],
  orn: ['Set the bits of D that are clear in X', 'Take N with the bits clear in X set, into D'] };

function sentence(mn, rest) {
  const b = mn.base, ops = split(rest), flags = mn.s ? ', and set the flags from the result' : '';
  if (/^(ldr|str)/.test(b)) {
    if (b === 'ldr' && /=/.test(rest)) return `Put ${rest.slice(rest.indexOf('=') + 1).trim()} (a constant or address) into ${say(ops[0])}.`;
    const p = parseMem(rest);
    if (!p) return null;
    const load = /^ldr/.test(b), dual = /d$/.test(b);
    const size = dual ? 'two words' : /b$/.test(b) ? (/^ldrs/.test(b) ? 'a signed byte' : 'a byte') : /h$/.test(b) ? (/^ldrs/.test(b) ? 'a signed halfword' : 'a halfword') : 'a word';
    const regs = dual ? `${say(ops[0])} and ${say(ops[1])}` : say(ops[0]);
    if (load && canon(p.base.toLowerCase()) === 'pc') return `Load a constant stored in the code, ${p.off} bytes past PC, into ${regs}.`;
    let s = load ? `load ${size} from memory at ${addrSay(p)} into ${regs}` : `store ${regs === say(ops[0]) && size !== 'a word' ? `the low ${size.replace(/^a (signed )?/, '')} of ${regs}` : regs} into memory at ${addrSay(p)}`;
    if (p.pre && p.off) s = `${moveSay(p.base, p.off)}, then ${s}`;
    if (p.post) s = `${s}, then ${moveSay(p.base, p.post)}`;
    return cap(s) + '.';
  }
  const two = ops.length === 2;
  if (b in VERB || b in BITS || b === 'mul') {
    let [d, n, i] = two ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2];
    let x = op2(ops, i).replace(/TOS\(r6\)/g, 'TOS').replace(/PSP\(r5\)/g, 'PSP').replace(/RSP\(sp\)/g, 'RSP');
    let base = b.replace(/w$/, '');
    const v = immVal(ops[i]);
    if ((base === 'add' || base === 'sub') && v !== null && v < 0 && !isReg(ops[i])) { base = base === 'add' ? 'sub' : 'add'; x = num(-v); }
    if (b === 'mul') return two || d === n ? `Multiply ${say(d)} by ${x}${flags}.` : `Multiply ${say(n)} by ${x} and put the result in ${say(d)}${flags}.`;
    if (b in BITS) {
      const xs = v !== null && !isReg(ops[i]) ? '0x' + (v >>> 0).toString(16) : x;
      return BITS[b][d === n ? 0 : 1].replace('D', say(d)).replace('N', say(n)).replace('X', xs) + flags + '.';
    }
    const [verb, prep] = VERB[base];
    return canon(d.toLowerCase()) === canon(n.toLowerCase()) ? `${verb} ${x} ${prep} ${say(d)}${flags}.` : `Put ${say(n)} ${base === 'add' ? '+' : '-'} ${x} into ${say(d)}${flags}.`;
  }
  if (b === 'adc' || b === 'sbc') { const [d, n, i] = two ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2]; return `Put ${say(n)} ${b === 'adc' ? '+' : '-'} ${say(ops[i])} ${b === 'adc' ? '+ the carry' : '- the borrow'} into ${say(d)}${flags}.`; }
  if (b === 'rsb') { const [d, n, i] = two ? [ops[0], ops[0], 1] : [ops[0], ops[1], 2]; return immVal(ops[i]) === 0 ? `Negate ${say(n)} into ${say(d)}${flags}.` : `Put ${say(ops[i])} - ${say(n)} into ${say(d)}${flags}.`; }
  if (b === 'neg') return `Negate ${say(ops[1] || ops[0])} into ${say(ops[0])}${flags}.`;
  if (b === 'mov') return isReg(ops[1] || '') ? `Copy ${say(ops[1])} into ${say(ops[0])}${flags}.` : `Put ${say(ops[1])} into ${say(ops[0])}${flags}.`;
  if (b === 'mvn') return `Put ${say(ops[1])} with every bit inverted into ${say(ops[0])}${flags}.`;
  if (b === 'movw' || b === 'mov32') return `Put ${say(ops[1])} into ${say(ops[0])}${b === 'movw' ? ' (the top half becomes 0)' : ''}.`;
  if (b === 'movt') return `Put ${say(ops[1])} into the top half of ${say(ops[0])}, keeping the bottom half.`;
  if (b in SHIFTOP) {
    const [d, m, n] = two ? [ops[0], ops[0], ops[1]] : ops;
    const dir = b === 'lsl' ? 'left' : b === 'ror' ? 'right (rotating)' : 'right';
    const k = immVal(n), times = k !== null && b !== 'ror' && k < 31 ? ` (${b === 'lsl' ? '×' : '÷'} ${1 << k}${b === 'asr' ? ', keeping the sign' : ''})` : '';
    const what = `${isReg(n) ? `the number of bits in ${say(n)}` : `${say(n)} bit${k === 1 ? '' : 's'}`}${times}`;
    return d === m ? `Shift ${say(d)} ${dir} by ${what}${flags}.` : `Shift ${say(m)} ${dir} by ${what} into ${say(d)}${flags}.`;
  }
  if (b === 'mla') return `Multiply ${say(ops[1])} by ${say(ops[2])}, add ${say(ops[3])}, and put the result in ${say(ops[0])}.`;
  if (b === 'mls') return `Multiply ${say(ops[1])} by ${say(ops[2])}, subtract that from ${say(ops[3])}, and put the result in ${say(ops[0])}.`;
  if (b === 'umull' || b === 'smull') return `Multiply ${say(ops[2])} by ${say(ops[3])} (${b === 'umull' ? 'unsigned' : 'signed'}): the 64-bit result goes in ${say(ops[1])} (high) and ${say(ops[0])} (low).`;
  if (b === 'sdiv' || b === 'udiv') { const [d, n, m] = two ? [ops[0], ops[0], ops[1]] : ops; return `Divide ${say(n)} by ${say(m)} (${b === 'sdiv' ? 'signed, rounding toward zero' : 'unsigned'}) and put the result in ${say(d)}.`; }
  if (b === 'cmp') return `Compare ${say(ops[0])} with ${op2(ops, 1).replace(/\(r\d\)|\(sp\)/g, '')}, setting the flags for the conditional instruction that follows.`;
  if (b === 'cmn') return `Compare ${say(ops[0])} with minus ${say(ops[1])}, setting the flags.`;
  if (b === 'tst') return `Test whether any of the bits of ${say(ops[1])} are set in ${say(ops[0])}: Z = 1 if none are.`;
  if (b === 'teq') return `Test whether ${say(ops[0])} equals ${say(ops[1])}, setting only the flags: Z = 1 if equal.`;
  if (b === 'clz') return `Count the zero bits above the highest set bit of ${say(ops[1])} (32 if it is 0) into ${say(ops[0])}.`;
  if (b === 'rbit') return `Put ${say(ops[1])} with its bit order reversed into ${say(ops[0])}.`;
  if (/^rev/.test(b)) return `Put ${say(ops[1])} with its ${b === 'rev' ? 'byte order reversed' : 'bytes swapped in each half'} into ${say(ops[0])}.`;
  if (/^[us]xt[bh]$/.test(b)) return `Put the low ${b[3] === 'b' ? 'byte' : 'halfword'} of ${say(ops[1] || ops[0])} into ${say(ops[0])}, ${b[0] === 'u' ? 'with zeros above' : 'as a signed number'}.`;
  if (b === 'ubfx' || b === 'sbfx') { const l = immVal(ops[2]), w = immVal(ops[3]); return `Take ${bitsOf(l, w)} of ${say(ops[1])}, move them down to bit 0, and put them in ${say(ops[0])}${b === 'sbfx' ? ' as a signed number' : ''}.`; }
  if (b === 'bfi') { const l = immVal(ops[2]), w = immVal(ops[3]); return `Copy ${lowBits(w)} of ${say(ops[1])} into ${bitsOf(l, w)} of ${say(ops[0])}, keeping its other bits.`; }
  if (b === 'bfc') { const l = immVal(ops[1]), w = immVal(ops[2]); return `Clear ${bitsOf(l, w)} of ${say(ops[0])}, keeping its other bits.`; }
  if (b === 'push') return `Save ${sayList(listRegs(rest))} on the return stack.`;
  if (b === 'pop') { const l = listRegs(rest); return `Restore ${sayList(l)} from the return stack${l.some(r => canon(r.toLowerCase()) === 'pc') ? ': loading PC returns to the caller' : ''}.`; }
  if (/^(ldm|stm)/.test(b)) {
    const bn = (ops[0] || '').replace('!', ''), l = listRegs(ops[1] || ''), wb = /!$/.test(ops[0] || '');
    if (canon(bn.toLowerCase()) === 'sp' && wb) return /^stm/.test(b) ? `Save ${sayList(l)} on the return stack.` : `Restore ${sayList(l)} from the return stack${l.some(r => canon(r.toLowerCase()) === 'pc') ? ': loading PC returns to the caller' : ''}.`;
    return /^ldm/.test(b) ? `Load ${sayList(l)} from consecutive words at ${say(bn)}${wb ? `, then move ${say(bn)} past them` : ''}.` : `Store ${sayList(l)} into consecutive words at ${say(bn)}${wb ? `, then move ${say(bn)} past them` : ''}.`;
  }
  if (b === 'b') return mn.cond !== null ? `If ${COND_SAY[CNAME[mn.cond]]}, jump to ${rest.trim()}.` : `Jump to ${rest.trim()}.`;
  if (b === 'bl') return `Call ${rest.trim()}: jump there, keeping the return address in LR.`;
  if (b === 'bx') return `Jump to the address in ${say(ops[0])}.`;
  if (b === 'blx') return `Call the address in ${say(ops[0])}, keeping the return address in LR.`;
  if (b === 'cbz' || b === 'cbnz') return `If ${say(ops[0])} is ${b === 'cbz' ? '' : 'not '}0, jump to ${ops[1]} (the flags are not touched).`;
  if (/^it/.test(b)) {
    const c = rest.trim().toLowerCase(), pat = ('t' + b.slice(2)).split('');
    const n = ['', 'next instruction', 'next two instructions', 'next three instructions', 'next four instructions'][pat.length];
    if (pat.every(x => x === 't')) return `Make the ${n} conditional: ${pat.length > 1 ? 'they run' : 'it runs'} only if ${COND_SAY[c] || c}.`;
    const yes = pat.map((x, i) => (x === 't' ? i : -1)).filter(i => i >= 0), no = pat.map((x, i) => (x === 'e' ? i : -1)).filter(i => i >= 0);
    const ord = is => sayList(is.map(i => ['the first', 'the second', 'the third', 'the fourth'][i])).replace(/ and the /g, ' and ');
    return `Make the ${n} conditional: ${ord(yes)} ${yes.length > 1 ? 'run' : 'runs'} if ${COND_SAY[c] || c}, ${ord(no).replace(/^the /, 'the ')} if not.`;
  }
  if (b === 'mrs') return `Read the special register ${ops[1]} into ${say(ops[0])}.`;
  if (b === 'msr') return `Write ${say(ops[1])} into the special register ${ops[0]}.`;
  return INFO[b] ? cap(INFO[b][1] || INFO[b][0]) + '.' : null;
}

// ---- reading the syntax ----
const BASE_SAY = { ldr: 'load a word', ldrb: 'load a byte', ldrh: 'load a halfword', ldrsb: 'load a signed byte', ldrsh: 'load a signed halfword',
  ldrd: 'load two words', str: 'store a word', strb: 'store a byte', strh: 'store a halfword', strd: 'store two words',
  b: 'branch (jump)', bl: 'branch with link (call)', bx: 'branch to a register', blx: 'call a register', cbz: 'compare and branch if zero',
  cbnz: 'compare and branch if not zero', ldm: 'load multiple', ldmia: 'load multiple, increment after', stm: 'store multiple',
  stmia: 'store multiple, increment after', stmdb: 'store multiple, decrement before', ldmdb: 'load multiple, decrement before' };
function decode(mn, word, rest) {
  const w = word.toLowerCase(), b = mn.base;
  const name = BASE_SAY[b] || (INFO[b] ? INFO[b][0].toLowerCase() : b);
  const parts = [];
  const body = w.replace(/\.[wn]$/, '');
  const suffix = body.slice(b.length);
  if (/^it/.test(b)) parts.push(`${b} = if-then: t = then, e = else`);
  else if (suffix) {
    const bits = [];
    if (mn.s) bits.push('s');
    if (mn.cond !== null && mn.cond !== undefined) bits.push(CNAME[mn.cond] in COND_SHORT ? suffix.replace(/^s/, '') : '');
    const meaning = [mn.s ? 'and set the flags' : '', mn.cond !== null && mn.cond !== undefined ? `if ${COND_SHORT[suffix.replace(/^s/, '')] || suffix}` : ''].filter(Boolean).join(', ');
    parts.push(`${b}·${bits.filter(Boolean).join('·')} = ${name}, ${meaning}`);
  } else parts.push(`${b} = ${name}`);
  if (/\.w$/.test(w)) parts.push('.w = the 4-byte form');
  if (/\.n$/.test(w)) parts.push('.n = the 2-byte form');
  const p = /^(ldr|str)/.test(b) ? parseMem(rest) : null;
  if (p) {
    const bn = p.base;
    if (p.pre) parts.push(`${p.text} = ${p.off < 0 ? 'subtract' : 'add'} ${Math.abs(p.off)} ${p.off < 0 ? 'from' : 'to'} ${bn} first, then use it; ! keeps the new ${bn}`);
    else if (p.post !== null) parts.push(`${p.text} = use ${bn} as the address, then ${p.post < 0 ? 'subtract' : 'add'} ${Math.abs(p.post)} ${p.post < 0 ? 'from' : 'to'} it`);
    else if (p.reg) parts.push(`${p.text} = the address ${bn} + ${p.reg}${p.shift ? ` × ${1 << p.shift}` : ''}`);
    else if (p.off) parts.push(`${p.text} = the address ${bn} ${p.off < 0 ? '-' : '+'} ${Math.abs(p.off)}`);
    else parts.push(`${p.text} = the address in ${bn}`);
  } else if (/=/.test(rest) && b === 'ldr') parts.push(`=${rest.split('=')[1].trim()} = a constant the assembler stores for you`);
  else if (/\{/.test(rest)) parts.push(`{…} = a list of registers${/!/.test(rest) ? '; ! = update the base afterwards' : ''}`);
  else {
    const im = /#(-?\w+)/.exec(rest);
    const sh = /,\s*(lsl|lsr|asr|ror)\s+#(\d+)/i.exec(rest);
    const bf = /^(ubfx|sbfx|bfi|bfc)$/.test(b) && /#(\d+),\s*#(\d+)\s*$/.exec(rest);
    if (bf) parts.push(`#${bf[1]}, #${bf[2]} = starting at bit ${bf[1]}, ${bf[2]} bit${bf[2] === '1' ? '' : 's'} wide`);
    else if (sh && !(b in SHIFTOP)) parts.push(`${sh[1]} #${sh[2]} = shifted ${/l/.test(sh[1][1]) ? 'left' : 'right'} ${sh[2]} first`);
    else if (im) parts.push(`#${im[1]} = the number ${say('#' + im[1])}`);
  }
  return parts.join(' · ');
}

// Explain one instruction. -> {text, sentence, fx: [[text, note]], decode} or null
function explain(text) {
  const t = text.replace(/\s*[@;].*$/, '').replace(/\s+/g, ' ').trim();
  if (!t || /^\./.test(t)) return null;
  const sp = t.indexOf(' ');
  const word = sp < 0 ? t : t.slice(0, sp), rest = sp < 0 ? '' : t.slice(sp + 1);
  const mn = A.mnemonic(word);
  if (!mn || !INFO[mn.base]) return null;
  let e = null, s = null, d = '';
  try { e = effects(mn, word, rest); } catch { /* a line still being typed */ }
  if (!e || e.fx.some(f => /NaN|undefined|\?/.test(f[0]))) e = { fx: [] };
  try { s = sentence(mn, rest); } catch { /* as above */ }
  if (!s || /NaN|undefined|\?\b|\? /.test(s)) s = cap(INFO[mn.base][1] || INFO[mn.base][0]) + '.';
  try { d = decode(mn, word, rest); } catch { d = ''; }
  const norm = `${word.toLowerCase()} ${rest}`.trim().replace(/\btos\b/g, 'r6').replace(/\bpsp\b/g, 'r5').replace(/\brsp\b/g, 'sp');
  for (const [re, x] of IDIOM) { const m = re.exec(norm); if (m) { s = typeof x === 'function' ? x(m) : x; break; } }
  if (mn.cond !== null && mn.cond !== undefined && !/^(b|it)/.test(mn.base) && !/^If /.test(s)) s = `Only if ${COND_SAY[CNAME[mn.cond]]} (set up by the IT before it): ${s[0].toLowerCase()}${s.slice(1)}`;
  return { text: t, sentence: s, fx: e.fx.filter(f => !/^only if/.test(f[0])), decode: d };
}

function plain(x) {
  return [x.text, x.sentence, ...x.fx.map(f => '  ' + f[0]), x.decode].filter(Boolean).join('\n');
}

function markdown(x) {
  const out = [x.sentence];
  if (x.fx.length) out.push('```\n' + x.fx.map(f => f[0]).join('\n') + '\n```');
  if (x.decode) out.push(x.decode.split(' · ').map(p => { const i = p.indexOf(' = '); return i < 0 ? p : `\`${p.slice(0, i)}\` = ${p.slice(i + 3)}`; }).join(' · '));
  return out.join('\n\n');
}

// Plain text for a tooltip (a title attribute), or '' when there is nothing to say.
function tooltip(text) { const x = explain(text); return x ? plain(x) : ''; }
// One register's role, for a hover on the register itself: '' if it has none.
function role(r) { const c = canon(r.toLowerCase()); return isReg(r) ? ROLE[c] || '' : ''; }

module.exports = { explain, markdown, plain, tooltip, role };

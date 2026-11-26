// thumb2asm.js - assembles CODE ... END-CODE blocks written in ARM's own syntax
// (as the books, objdump and our Disassembly view write it) for the M33:
//
//   CODE 3+ ( n -- n+3 )
//       adds r6, r6, #3        \ tos is r6, psp r5: tos and psp work too
//       bx   lr
//   END-CODE
//
// The extension sends the machine code itself, so the board needs nothing
// loaded. The encodings are lib/thumb2/asm.fth's (the postfix assembler):
// test/thumb2asm.test.js holds both to arm-none-eabi-as on the same forms.
// Labels (`loop:`, `1:` with `1b`/`1f`), every branch (relaxed to the short
// form when it reaches, as GNU as does), `bl WORD` to call a Forth word,
// `ldr rd, =value` for any 32-bit value or register name (movw/movt), IT blocks
// with their condition suffixes checked. No vscode here.
//
// opts.arch 'v6m' (Cortex-M0, M0+): only the ARMv6-M
// instructions (the 16-bit ones but CBZ, CBNZ and IT; BL, MRS, MSR, DMB, DSB,
// ISB), short branches only, `ldr rd, =value` from a literal pool after the
// code, and `bl WORD` to flash through call_bi (opts.far(name) gives
// {callBi, off}: bl call_bi, then off, the word's xt less KBASE).
'use strict';

const REGS = { sp: 13, lr: 14, pc: 15, ip: 12, fp: 11, tos: 6, psp: 5 };
for (let i = 0; i < 16; i++) REGS['r' + i] = i;
const CONDS = { eq: 0, ne: 1, cs: 2, hs: 2, cc: 3, lo: 3, mi: 4, pl: 5, vs: 6, vc: 7, hi: 8, ls: 9, ge: 10, lt: 11, gt: 12, le: 13, al: 14 };
const SYSREGS = { apsr: 0, iapsr: 1, eapsr: 2, xpsr: 3, ipsr: 5, epsr: 6, iepsr: 7, msp: 8, psp: 9, msplim: 10, psplim: 11,
  primask: 16, basepri: 17, basepri_max: 18, faultmask: 19, control: 20 };

class AsmError extends Error {}
const fail = m => { throw new AsmError(m); };

// ---- operands ----
function splitOperands(s) {                       // commas outside [] and {}
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function evalExpr(src, consts) {                  // + - * / & | ^ ~ << >> ( ), numbers and names
  const toks = src.match(/0x[0-9a-f]+|0b[01]+|\$[0-9a-f]+|%[01]+|\d+|<<|>>|[A-Za-z_.][\w.]*|[-+*/&|^~()]/gi) || [];
  if (toks.join('') !== src.replace(/\s+/g, '')) fail(`can't read the value ${src}`);
  let i = 0;
  const atom = () => {
    const t = toks[i++];
    if (t === undefined) fail(`the value ${src} is incomplete`);
    if (t === '(') { const v = expr(0); if (toks[i++] !== ')') fail(`a ) is missing in ${src}`); return v; }
    if (t === '-') return -atom();
    if (t === '+') return atom();
    if (t === '~') return ~atom();
    if (/^0x/i.test(t)) return parseInt(t.slice(2), 16);
    if (/^0b/i.test(t)) return parseInt(t.slice(2), 2);
    if (t[0] === '$') return parseInt(t.slice(1), 16);
    if (t[0] === '%') return parseInt(t.slice(1), 2);
    if (/^\d/.test(t)) return parseInt(t, 10);
    const v = consts ? consts(t) : null;
    if (v === null || v === undefined) fail(`${t} is not a number, register name or constant`);
    return v;
  };
  const PREC = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
  const expr = min => {
    let v = atom();
    while (i < toks.length && PREC[toks[i]] >= min) {
      const op = toks[i++], r = expr(PREC[op] + 1);
      v = op === '+' ? v + r : op === '-' ? v - r : op === '*' ? Math.imul(v, r) : op === '/' ? Math.trunc(v / r)
        : op === '&' ? v & r : op === '|' ? v | r : op === '^' ? v ^ r : op === '<<' ? v << r : v >>> r;
    }
    return v;
  };
  const v = expr(0);
  if (i !== toks.length) fail(`can't read the value ${src}`);
  return v | 0;
}

function operand(s, consts) {
  const t = s.trim(), l = t.toLowerCase();
  if (l in REGS) return { k: 'reg', n: REGS[l] };
  if (l.endsWith('!') && l.slice(0, -1) in REGS) return { k: 'reg', n: REGS[l.slice(0, -1)] };   // ldm r0!, {...}
  if (t[0] === '{') {
    if (!t.endsWith('}')) fail(`a } is missing in ${t}`);
    let mask = 0;
    for (const part of t.slice(1, -1).split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
      const m = /^(\w+)\s*-\s*(\w+)$/.exec(part);
      const [a, b] = m ? [m[1], m[2]] : [part, part];
      if (!(a in REGS) || !(b in REGS)) fail(`${part} is not a register`);
      for (let r = REGS[a]; r <= REGS[b]; r++) mask |= 1 << r;
    }
    return { k: 'list', mask };
  }
  if (t[0] === '[') {
    const m = /^\[([^\]]*)\]\s*(!?)$/.exec(t);
    if (!m) fail(`can't read the address ${t}`);
    const parts = m[1].split(',').map(x => x.trim());
    const rn = operand(parts[0], consts);
    if (rn.k !== 'reg') fail(`${parts[0]} is not a register`);
    const off = parts[1] !== undefined ? operand(parts[1], consts) : { k: 'imm', v: 0 };
    return { k: 'mem', rn: rn.n, off, mode: m[2] ? 'pre' : 'off' };
  }
  if (t[0] === '=') return { k: 'lit', v: evalExpr(t.slice(1).trim(), consts) };
  if (t[0] === '#') return { k: 'imm', v: evalExpr(t.slice(1).trim(), consts) };
  if (/^\d+[bf]$/i.test(t)) return { k: 'label', name: t.toLowerCase() };
  if (/^[A-Za-z_.][\w.]*$/.test(t) && !(consts && consts(t) !== null && consts(t) !== undefined)) return { k: 'label', name: t };
  return { k: 'imm', v: evalExpr(t, consts) };
}

// ---- encodings (as lib/thumb2/asm.fth) ----
const lo = n => n < 8;
function mimm(v) {
  v >>>= 0;
  if (v < 256) return v;
  const b0 = v & 0xFF, b1 = (v >>> 8) & 0xFF;
  if (v === ((b0 << 16) | b0) >>> 0) return 0x100 | b0;
  if (v === ((b1 << 24) | (b1 << 8)) >>> 0) return 0x200 | b1;
  if (v === ((b0 << 24) | (b0 << 16) | (b0 << 8) | b0) >>> 0) return 0x300 | b0;
  for (let rot = 8; rot < 32; rot++) {
    const x = ((v << rot) | (v >>> (32 - rot))) >>> 0;
    if (x < 256 && x > 127) return (rot << 7) | (x & 0x7F);
  }
  return null;
}
const split12 = imm => [(imm & 0x800) >> 1, ((imm & 0x700) << 4) | (imm & 0xFF)];
function wide(op, s, rd, rn, x) {
  const hw1 = (op << 5) | (s << 4) | rn;
  if (x.k === 'reg') return [0xEA00 | hw1, (rd << 8) | x.n];
  const m = mimm(x.v);
  if (m === null) fail(`#${x.v} can't be encoded as an immediate here (ldr ${'r' + rd}, =value loads any value)`);
  const [i, h2] = split12(m);
  return [0xF000 | hw1 | i, h2 | (rd << 8)];
}
function plain16(base, rd, v) {                  // movw/movt/addw/subw: imm16 or imm12
  const [i, h2] = split12(v & 0xFFF);
  return [base | i | ((v >>> 12) & 0xF), h2 | (rd << 8)];
}

// ---- mnemonics: name -> {s: may take S, fn(ops, st) -> halfwords} ----
const T = {};
const reg = (o, what = 'a register') => { if (!o || o.k !== 'reg') fail(`${what} is needed`); return o.n; };
const imm = o => { if (!o || o.k !== 'imm') fail('an immediate (#n) is needed'); return o.v; };
const three = ops => (ops.length === 2 ? [ops[0], ops[0], ops[1]] : ops);   // `adds r0, #1` = adds r0, r0, #1
const narrowOk = (st, s) => !st.wide && (s ? 1 : 0) === (st.itn === 0 ? 1 : 0);

const DP = { and: [0, 0], bic: [1, 14], orr: [2, 12], orn: [3, -1], eor: [4, 1], adc: [10, 5], sbc: [11, 6] };
for (const [name, [op, nop]] of Object.entries(DP)) {
  T[name] = { s: true, fn: (ops, st) => {
    const [d, n, x] = three(ops); const rd = reg(d), rn = reg(n);
    if (x.k === 'reg' && nop >= 0 && lo(rd) && lo(rn) && lo(x.n) && rd === rn && narrowOk(st, st.s)) return [0x4000 | (nop << 6) | (x.n << 3) | rd];
    if (x.k !== 'reg') imm(x);
    return wide(op, st.s, rd, rn, x);
  } };
}
function addsub(ops, st, sub) {
  let [d, n, x] = three(ops); const rd = reg(d), rn = reg(n);
  if (x.k === 'reg') {
    const rm = x.n;
    if (lo(rd) && lo(rn) && lo(rm) && narrowOk(st, st.s)) return [(sub ? 0x1A00 : 0x1800) | (rm << 6) | (rn << 3) | rd];
    if (!sub && !st.s && rd === rn && !st.wide) return [0x4400 | ((rd & 8) << 4) | (rm << 3) | (rd & 7)];
    return wide(sub ? 13 : 8, st.s, rd, rn, x);
  }
  let v = imm(x);
  if (v < 0) { v = -v; sub = !sub; }
  if (!st.s && rn === 13 && (v & 3) === 0 && !st.wide) {
    if (rd === 13 && v < 512) return [(sub ? 0xB080 : 0xB000) | (v >> 2)];
    if (!sub && lo(rd) && v < 1024) return [0xA800 | (rd << 8) | (v >> 2)];
  }
  if (narrowOk(st, st.s) && lo(rd) && lo(rn)) {
    if (rd === rn && v < 256) return [(sub ? 0x3800 : 0x3000) | (rd << 8) | v];
    if (v < 8) return [(sub ? 0x1E00 : 0x1C00) | (v << 6) | (rn << 3) | rd];
  }
  if (mimm(v) !== null) return wide(sub ? 13 : 8, st.s, rd, rn, { k: 'imm', v });
  if (!st.s && v < 4096) return plain16(sub ? 0xF2A0 : 0xF200, rd, v).map((h, k) => (k ? h : (h & ~0xF) | rn));
  fail(`#${v} can't be encoded as an immediate here`);
}
T.add = { s: true, fn: (o, st) => addsub(o, st, false) };
T.sub = { s: true, fn: (o, st) => addsub(o, st, true) };
T.addw = { s: false, fn: ops => { const [d, n, x] = three(ops); return plain16(0xF200, reg(d), imm(x)).map((h, k) => (k ? h : h | reg(n))); } };
T.subw = { s: false, fn: ops => { const [d, n, x] = three(ops); return plain16(0xF2A0, reg(d), imm(x)).map((h, k) => (k ? h : h | reg(n))); } };
T.rsb = { s: true, fn: (ops, st) => {
  const [d, n, x] = three(ops); const rd = reg(d), rn = reg(n);
  if (x.k === 'imm' && x.v === 0 && lo(rd) && lo(rn) && narrowOk(st, st.s)) return [0x4240 | (rn << 3) | rd];
  return wide(14, st.s, rd, rn, x);
} };
T.neg = { s: true, fn: (ops, st) => T.rsb.fn([ops[0], ops[1], { k: 'imm', v: 0 }], st) };
T.mov = { s: true, fn: (ops, st) => {
  const rd = reg(ops[0]), x = ops[1];
  if (x.k === 'reg') {
    if (!st.s && !st.wide) return [0x4600 | ((rd & 8) << 4) | (x.n << 3) | (rd & 7)];
    if (st.s && lo(rd) && lo(x.n) && narrowOk(st, true)) return [(x.n << 3) | rd];
    return wide(2, st.s, rd, 15, x);
  }
  const v = imm(x);
  if (lo(rd) && v >= 0 && v < 256 && narrowOk(st, st.s)) return [0x2000 | (rd << 8) | v];
  if (mimm(v) !== null) return wide(2, st.s, rd, 15, x);
  if (!st.s && v >= 0 && v < 65536) return plain16(0xF240, rd, v);
  fail(`#${v} can't be encoded as an immediate here (ldr r${rd}, =value loads any value)`);
} };
T.mvn = { s: true, fn: (ops, st) => {
  const rd = reg(ops[0]), x = ops[1];
  if (x.k === 'reg' && lo(rd) && lo(x.n) && narrowOk(st, st.s)) return [0x43C0 | (x.n << 3) | rd];
  return wide(3, st.s, rd, 15, x);
} };
T.movw = { s: false, fn: ops => plain16(0xF240, reg(ops[0]), imm(ops[1]) & 0xFFFF) };
T.movt = { s: false, fn: ops => plain16(0xF2C0, reg(ops[0]), imm(ops[1]) & 0xFFFF) };
function mov32(rd, v) {                           // any value: one or two instructions, flags kept
  v |= 0;
  const st = { s: 0, itn: 1, wide: false };       // as `mov` inside IT: never the flag-setting 16-bit form
  if (mimm(v) !== null) return wide(2, 0, rd, 15, { k: 'imm', v });
  if (mimm(~v) !== null) return wide(3, 0, rd, 15, { k: 'imm', v: ~v });
  const out = plain16(0xF240, rd, v & 0xFFFF);
  if ((v >>> 16) !== 0) out.push(...plain16(0xF2C0, rd, v >>> 16));
  void st;
  return out;
}
T.mov32 = { s: false, fn: ops => mov32(reg(ops[0]), ops[1].k === 'lit' ? ops[1].v : imm(ops[1])) };
T.cmp = { s: false, fn: (ops, st) => {
  const rn = reg(ops[0]), x = ops[1];
  if (x.k === 'reg') {
    if (lo(rn) && lo(x.n)) return [0x4280 | (x.n << 3) | rn];
    return [0x4500 | ((rn & 8) << 4) | (x.n << 3) | (rn & 7)];
  }
  const v = imm(x);
  if (lo(rn) && v >= 0 && v < 256 && !st.wide) return [0x2800 | (rn << 8) | v];
  return v < 0 ? wide(8, 1, 15, rn, { k: 'imm', v: -v }) : wide(13, 1, 15, rn, x);
} };
const TEST = { cmn: [8, 0x42C0], tst: [0, 0x4200], teq: [4, 0] };
for (const [name, [op, nar]] of Object.entries(TEST)) {
  T[name] = { s: false, fn: (ops, st) => {
    const rn = reg(ops[0]), x = ops[1];
    if (x.k === 'reg' && nar && lo(rn) && lo(x.n) && !st.wide) return [nar | (x.n << 3) | rn];
    return wide(op, 1, 15, rn, x);
  } };
}
const SHIFT = { lsl: 0, lsr: 1, asr: 2, ror: 3 };
for (const [name, type] of Object.entries(SHIFT)) {
  T[name] = { s: true, fn: (ops, st) => {
    const [d, m, x] = three(ops); const rd = reg(d), rm = reg(m);
    if (x.k === 'reg') {
      if (lo(rd) && lo(rm) && lo(x.n) && rd === rm && narrowOk(st, st.s)) return [0x4000 | ([2, 3, 4, 7][type] << 6) | (x.n << 3) | rd];
      return [0xFA00 | (type << 5) | (st.s << 4) | rm, 0xF000 | (rd << 8) | x.n];
    }
    const n = imm(x) & 31;
    if (type < 3 && lo(rd) && lo(rm) && narrowOk(st, st.s)) return [(type << 11) | (n << 6) | (rm << 3) | rd];
    return [0xEA4F | (st.s << 4), ((n >> 2) << 12) | (rd << 8) | ((n & 3) << 6) | (type << 4) | rm];
  } };
}
T.mul = { s: true, fn: (ops, st) => {
  const [d, n, m] = ops.length === 2 ? [ops[0], ops[1], ops[0]] : ops; const rd = reg(d), rn = reg(n), rm = reg(m);
  if (lo(rd) && lo(rn) && rd === rm && narrowOk(st, st.s)) return [0x4340 | (rn << 3) | rd];
  if (st.s) fail('muls takes r0-r7 with the result in the last register (muls r0, r1, r0)');
  return [0xFB00 | rn, 0xF000 | (rd << 8) | rm];
} };
T.mla = { s: false, fn: ops => [0xFB00 | reg(ops[1]), (reg(ops[3]) << 12) | (reg(ops[0]) << 8) | reg(ops[2])] };
T.mls = { s: false, fn: ops => [0xFB00 | reg(ops[1]), (reg(ops[3]) << 12) | (reg(ops[0]) << 8) | 0x10 | reg(ops[2])] };
T.smull = { s: false, fn: ops => [0xFB80 | reg(ops[2]), (reg(ops[0]) << 12) | (reg(ops[1]) << 8) | reg(ops[3])] };
T.umull = { s: false, fn: ops => [0xFBA0 | reg(ops[2]), (reg(ops[0]) << 12) | (reg(ops[1]) << 8) | reg(ops[3])] };
T.sdiv = { s: false, fn: ops => { const [d, n, m] = three(ops); return [0xFB90 | reg(n), 0xF0F0 | (reg(d) << 8) | reg(m)]; } };
T.udiv = { s: false, fn: ops => { const [d, n, m] = three(ops); return [0xFBB0 | reg(n), 0xF0F0 | (reg(d) << 8) | reg(m)]; } };
const TWO = { rev: [0xF080, 0xBA00], rev16: [0xF090, 0xBA40], revsh: [0xF0B0, 0xBAC0], rbit: [0xF0A0, 0] };
for (const [name, [h2, nar]] of Object.entries(TWO))
  T[name] = { s: false, fn: (ops, st) => { const rd = reg(ops[0]), rm = reg(ops[1]);
    return nar && lo(rd) && lo(rm) && !st.wide ? [nar | (rm << 3) | rd] : [0xFA90 | rm, h2 | (rd << 8) | rm]; } };
T.clz = { s: false, fn: ops => { const rd = reg(ops[0]), rm = reg(ops[1]); return [0xFAB0 | rm, 0xF080 | (rd << 8) | rm]; } };
const EXT = { uxtb: [0xFA5F, 0xB2C0], uxth: [0xFA1F, 0xB280], sxtb: [0xFA4F, 0xB240], sxth: [0xFA0F, 0xB200] };
for (const [name, [h1, nar]] of Object.entries(EXT))
  T[name] = { s: false, fn: (ops, st) => { const rd = reg(ops[0]), rm = reg(ops[1]);
    return lo(rd) && lo(rm) && !st.wide ? [nar | (rm << 3) | rd] : [h1, 0xF080 | (rd << 8) | rm]; } };
const bf = (rd, lsb, v) => (((lsb >> 2) << 12) | (rd << 8) | ((lsb & 3) << 6) | v);
T.ubfx = { s: false, fn: ops => [0xF3C0 | reg(ops[1]), bf(reg(ops[0]), imm(ops[2]), imm(ops[3]) - 1)] };
T.sbfx = { s: false, fn: ops => [0xF340 | reg(ops[1]), bf(reg(ops[0]), imm(ops[2]), imm(ops[3]) - 1)] };
T.bfi = { s: false, fn: ops => [0xF360 | reg(ops[1]), bf(reg(ops[0]), imm(ops[2]), imm(ops[2]) + imm(ops[3]) - 1)] };
T.bfc = { s: false, fn: ops => [0xF36F, bf(reg(ops[0]), imm(ops[1]), imm(ops[1]) + imm(ops[2]) - 1)] };

// loads and stores: wide hw1 (register and 8-bit forms; +0x80 the 12-bit one), narrow offset base, scale, narrow register base
const MEM = { ldr: [0xF850, 0x6800, 4, 0x5800], str: [0xF840, 0x6000, 4, 0x5000], ldrb: [0xF810, 0x7800, 1, 0x5C00],
  strb: [0xF800, 0x7000, 1, 0x5400], ldrh: [0xF830, 0x8800, 2, 0x5A00], strh: [0xF820, 0x8000, 2, 0x5200],
  ldrsb: [0xF910, 0, 0, 0x5600], ldrsh: [0xF930, 0, 0, 0x5E00] };
for (const [name, [w, nimm, scale, nreg]] of Object.entries(MEM)) {
  T[name] = { s: false, fn: (ops, st) => {
    const rt = reg(ops[0]);
    if (ops[1] && ops[1].k === 'lit') { if (name !== 'ldr') fail('=value goes with ldr'); return mov32(rt, ops[1].v); }
    const a = ops[1];
    if (!a || a.k !== 'mem') fail('an address is needed: [rn], [rn, #n], [rn, rm], [rn, #n]! or [rn], #n');
    let mode = a.mode, x = a.off;
    if (ops[2]) { if (a.off.k !== 'imm' || a.off.v !== 0 || mode !== 'off') fail('[rn], #n takes nothing inside the []'); mode = 'post'; x = ops[2]; }
    const rn = a.rn;
    if (mode !== 'off') {
      const v = imm(x);
      if (v < -255 || v > 255) fail('the offset must be -255 to 255');
      return [w | rn, (rt << 12) | (mode === 'pre' ? 0xD00 : 0x900) | (v >= 0 ? 0x200 : 0) | Math.abs(v)];
    }
    if (x.k === 'reg') {
      if (lo(rt) && lo(rn) && lo(x.n) && !st.wide) return [nreg | (x.n << 6) | (rn << 3) | rt];
      return [w | rn, (rt << 12) | x.n];
    }
    const v = imm(x);
    if (scale && v >= 0 && v % scale === 0 && v / scale < 32 && lo(rt) && lo(rn) && !st.wide) return [nimm | ((v / scale) << 6) | (rn << 3) | rt];
    if ((nimm === 0x6000 || nimm === 0x6800) && rn === 13 && lo(rt) && (v & 3) === 0 && v >= 0 && v < 1024 && !st.wide)
      return [(nimm + 0x3000) | (rt << 8) | (v >> 2)];
    if (v >= 0 && v < 4096) return [w | 0x80 | rn, (rt << 12) | v];
    if (v < 0 && v > -256) return [w | rn, (rt << 12) | 0xC00 | -v];
    fail('the offset must be -255 to 4095');
  } };
}
for (const [name, load] of [['ldrd', 1], ['strd', 0]]) {
  T[name] = { s: false, fn: ops => {
    const rt = reg(ops[0]), rt2 = reg(ops[1]), a = ops[2];
    if (!a || a.k !== 'mem') fail('an address is needed');
    let mode = a.mode, v = imm(a.off);
    if (ops[3]) { mode = 'post'; v = imm(ops[3]); }
    const pw = mode === 'pre' ? 0x120 : mode === 'post' ? 0x20 : 0x100;
    return [0xE840 | pw | (v >= 0 ? 0x80 : 0) | (load << 4) | a.rn, (rt << 12) | (rt2 << 8) | (Math.abs(v) >> 2)];
  } };
}
const one = mask => { for (let i = 0; i < 16; i++) if (mask === 1 << i) return i; return -1; };
T.push = { s: false, fn: (ops, st) => {
  const m = ops[0] && ops[0].k === 'list' ? ops[0].mask : fail('a register list is needed: {r4, lr}');
  if (!(m & 0xBF00) && !st.wide) return [0xB400 | ((m & 0x4000) >> 6) | (m & 0xFF)];
  const r = one(m);
  return r >= 0 ? [0xF84D, (r << 12) | 0xD04] : [0xE92D, m];
} };
T.pop = { s: false, fn: (ops, st) => {
  const m = ops[0] && ops[0].k === 'list' ? ops[0].mask : fail('a register list is needed: {r4, pc}');
  if (!(m & 0x7F00) && !st.wide) return [0xBC00 | ((m & 0x8000) >> 7) | (m & 0xFF)];
  const r = one(m);
  return r >= 0 ? [0xF85D, (r << 12) | 0xB04] : [0xE8BD, m];
} };
function multi(ops, st, kind) {                    // ldm/stm/ldmdb/stmdb rn{!}, {list}
  const rn = reg(ops[0]), m = ops[1] && ops[1].k === 'list' ? ops[1].mask : fail('a register list is needed');
  const wb = st.bang;
  if (kind === 'ldm' && wb && lo(rn) && !(m & 0xFF00) && !(m & (1 << rn)) && !st.wide) return [0xC800 | (rn << 8) | m];
  if (kind === 'stm' && wb && lo(rn) && !(m & 0xFF00) && !st.wide) return [0xC000 | (rn << 8) | m];
  const base = { ldm: 0xE890, stm: 0xE880, ldmdb: 0xE910, stmdb: 0xE900 }[kind];
  return [base | (wb ? 0x20 : 0) | rn, m];
}
for (const k of ['ldm', 'stm', 'ldmdb', 'stmdb']) T[k] = { s: false, fn: (o, st) => multi(o, st, k) };
T.ldmia = T.ldmfd = T.ldm; T.stmia = T.stmea = T.stm; T.stmfd = T.stmdb; T.ldmea = T.ldmdb;
T.bx = { s: false, fn: ops => [0x4700 | (reg(ops[0]) << 3)] };
T.blx = { s: false, fn: ops => [0x4780 | (reg(ops[0]) << 3)] };
for (const [n, h] of [['nop', 0xBF00], ['yield', 0xBF10], ['wfe', 0xBF20], ['wfi', 0xBF30], ['sev', 0xBF40]])
  T[n] = { s: false, fn: (ops, st) => (st.wide ? [0xF3AF, 0x8000 | (h & 0xF0) >> 4] : [h]) };
for (const [n, h] of [['cpsie', 0xB660], ['cpsid', 0xB670]])
  T[n] = { s: false, fn: (ops, st, raw) => { const f = (raw[0] || 'i').toLowerCase(); return [h | (f.includes('i') ? 2 : 0) | (f.includes('f') ? 1 : 0)]; } };
T.bkpt = { s: false, fn: ops => [0xBE00 | (ops[0] ? imm(ops[0]) & 0xFF : 0)] };
T.svc = { s: false, fn: ops => [0xDF00 | (imm(ops[0]) & 0xFF)] };
for (const [n, opt] of [['dsb', 4], ['dmb', 5], ['isb', 6]]) T[n] = { s: false, fn: () => [0xF3BF, 0x8F0F | (opt << 4)] };
const sysreg = s => { const v = SYSREGS[(s || '').toLowerCase().replace(/_nzcvq$/, '')]; if (v === undefined) fail(`${s} is not a special register`); return v; };
T.mrs = { s: false, fn: (ops, st, raw) => [0xF3EF, 0x8000 | (reg(ops[0]) << 8) | sysreg(raw[1])] };
T.msr = { s: false, fn: (ops, st, raw) => [0xF380 | reg(operand(raw[1])), 0x8800 | sysreg(raw[0])] };

// ---- reading a line: label, mnemonic with S, condition and .w/.n, operands ----
const BRANCH = new Set(['b', 'bl', 'cbz', 'cbnz']);
function mnemonic(word) {
  const w = word.toLowerCase();
  const m = /^(.*?)(\.w|\.n)?$/.exec(w);
  const body = m[1], width = m[2] || '';
  const tryBase = (base, rest) => {
    if (BRANCH.has(base)) { if (rest === '' || (base === 'b' && rest in CONDS)) return { base, s: 0, cond: rest ? CONDS[rest] : null, width }; return null; }
    if (/^it[te]{0,3}$/.test(base)) return rest === '' ? { base, s: 0, cond: null, width } : null;
    const t = T[base];
    if (!t) return null;
    if (rest === '') return { base, s: 0, cond: null, width };
    if (rest in CONDS) return { base, s: 0, cond: CONDS[rest], width };
    if (t.s && rest[0] === 's' && (rest.length === 1 || rest.slice(1) in CONDS))
      return { base, s: 1, cond: rest.length > 1 ? CONDS[rest.slice(1)] : null, width };
    return null;
  };
  for (let n = body.length; n > 0; n--) {
    const r = tryBase(body.slice(0, n), body.slice(n));
    if (r) return r;
  }
  return null;
}
const isMnemonic = word => !!mnemonic(word) && !/,$/.test(word);

function stripComment(text) {                    // \ comment; ( ... ) is a stack comment only on the CODE line
  const i = text.search(/(^|\s)\\(\s|$)/);
  return i < 0 ? text : text.slice(0, i);
}

// One line -> {label?, inst?}
function parseLine(text) {
  let t = stripComment(text).trim();
  const out = {};
  const lm = /^([A-Za-z_.][\w.]*|\d+):\s*/.exec(t);
  if (lm) { out.label = lm[1]; t = t.slice(lm[0].length); }
  if (!t) return out;
  const sp = t.search(/\s/);
  const word = sp < 0 ? t : t.slice(0, sp), rest = sp < 0 ? '' : t.slice(sp).trim();
  const mn = mnemonic(word);
  if (!mn) fail(`${word} is not an instruction this assembler knows`);
  out.inst = { mn, raw: splitOperands(rest), word };
  return out;
}

// ---- a block ----
// lines: [{text, no, col}] between CODE and END-CODE. opts: base (the code's address),
// consts(name) -> value | null (register names), word(name) -> xt | null | undefined
// (undefined: not known yet, as when only checking). -> {code: [halfwords], rows: [{no, off, size}], errors: [{no, message}]}
// ARMv6-M has the 16-bit instructions (CBZ, CBNZ and IT are refused before)
// and, of the 32-bit ones, BL, MRS, MSR and the barriers
function v6mOnly(code, word) {
  if (code.length === 1) return;
  const h1 = code[0];
  if (code.length === 2 && (h1 === 0xF3EF || (h1 & 0xFFF0) === 0xF380 || h1 === 0xF3BF)) return;   // mrs, msr, dmb/dsb/isb
  const s = /^(add|sub|mov|and|orr|eor|bic|mvn|adc|sbc|lsl|lsr|asr|ror|neg|mul)$/.test(word.replace(/s$/, '')) && !/s$/.test(word);
  fail(`${word}: no ARMv6-M (Cortex-M0) form for this${s ? `; ${word}s, which sets the flags, may be` : ' (r0-r7, small immediates)'}`);
}

function assemble(lines, opts = {}) {
  const base = opts.base || 0, consts = opts.consts || (() => null), v6m = opts.arch === 'v6m';
  const errors = [], items = [], labels = new Map(), numeric = [];
  let itq = [];                                    // conditions still expected in an IT block
  for (const ln of lines) {
    let p;
    try { p = parseLine(ln.text); } catch (e) { if (!(e instanceof AsmError)) throw e; errors.push({ no: ln.no, message: e.message }); continue; }
    if (p.label !== undefined) {
      const lab = { at: items.length };
      if (/^\d+$/.test(p.label)) numeric.push({ name: p.label, at: items.length }); else {
        if (labels.has(p.label)) errors.push({ no: ln.no, message: `${p.label} is a label already` });
        labels.set(p.label, lab);
      }
    }
    if (!p.inst) continue;
    const { mn, raw } = p.inst;
    const it = { ln, mn, raw, itn: itq.length, size: 2, ops: null };
    try {
      if (v6m && (/^it[te]{0,3}$/.test(mn.base) || mn.base === 'cbz' || mn.base === 'cbnz')) fail(`${p.inst.word}: not on ARMv6-M (Cortex-M0): use cmp and a branch`);
      if (/^it[te]{0,3}$/.test(mn.base)) {
        if (itq.length) fail('an IT block inside an IT block');
        const c = CONDS[(raw[0] || '').toLowerCase()];
        if (c === undefined || c === 14 && mn.base.length > 2) fail('it needs a condition: it eq, ite ne, ...');
        const pat = mn.base.slice(2);
        let mask = 0;
        for (let k = 0; k < pat.length; k++) mask |= (pat[k] === 't' ? (c & 1) : (c & 1) ^ 1) << (3 - k);
        mask |= 1 << (3 - pat.length);
        it.code = [0xBF00 | (c << 4) | mask];
        itq = [c, ...[...pat].map(x => (x === 't' ? c : c ^ 1))];
        it.itn = 0;
        items.push(it);
        continue;
      }
      if (itq.length) {
        const want = itq.shift();
        if (mn.cond === null) fail(`inside the IT block this needs its condition: ${p.inst.word}${Object.keys(CONDS).find(k => CONDS[k] === want)}`);
        if (mn.cond !== want) fail(`the IT block wants ${Object.keys(CONDS).find(k => CONDS[k] === want)} here`);
      } else if (mn.cond !== null && mn.base !== 'b') fail(`a condition (${p.inst.word}) needs an IT block before it`);
      if (BRANCH.has(mn.base)) {
        const reg0 = mn.base === 'cbz' || mn.base === 'cbnz' ? operand(raw[0]) : null;
        const target = operand(raw[reg0 ? 1 : 0] || '');
        it.branch = { reg: reg0 ? reg(reg0) : null, target };
        it.size = mn.base === 'bl' || mn.width === '.w' ? 4 : 2;
        if (target.k !== 'label') fail('a branch needs a label or a word');
        const local = /^\d+[bf]$/.test(target.name) || lines.some(l => { const q = /^\s*([A-Za-z_.][\w.]*):/.exec(stripComment(l.text)); return q && q[1] === target.name; });
        if (!local) {
          if (mn.base === 'cbz' || mn.base === 'cbnz') fail(`${target.name}: cbz and cbnz reach only a label ahead`);
          it.size = 4; it.branch.word = target.name;
          if (v6m && mn.base === 'bl' && opts.far && opts.far(target.name)) it.size = 6;   // bl call_bi, halfword
          if (v6m && mn.base === 'b') fail(`b ${target.name}: ARMv6-M's b reaches 2 KB, not a word; use bl`);
        }
        if (v6m && mn.width === '.w' && mn.base !== 'bl') fail(`${p.inst.word}: no 32-bit branch on ARMv6-M (Cortex-M0)`);
      } else {
        const ops = raw.map(r => ((mn.base === 'mrs' || mn.base === 'msr') && SYSREGS[r.toLowerCase()] !== undefined ? { k: 'sys' } : operand(r, consts)));
        // [rn], #n : the post-indexed offset rides as a third operand
        it.ops = ops;
        if (v6m && mn.base === 'ldr' && ops[1] && ops[1].k === 'lit') {   // from the literal pool
          if (!lo(reg(ops[0]))) fail('ldr =value on ARMv6-M: r0-r7 only');
          it.lit = { rd: reg(ops[0]), v: ops[1].v | 0 }; it.code = [0x4800]; it.size = 2;
          items.push(it);
          continue;
        }
        it.code = T[mn.base].fn(ops, { s: mn.s, itn: it.itn, wide: mn.width === '.w', bang: /!$/.test(raw[0] || '') }, raw);
        if (v6m) v6mOnly(it.code, p.inst.word);
        if (v6m && it.code.length === 1 && it.code[0] === 0xBF00) it.code = [0x46C0];   // nop as gas gives it for ARMv6-M
        if (mn.width === '.n' && it.code.length !== 1) fail(`${p.inst.word}: there is no 16-bit form for this`);
        it.size = it.code.length * 2;
      }
      items.push(it);
    } catch (e) {
      if (!(e instanceof AsmError)) throw e;
      errors.push({ no: ln.no, message: e.message });
    }
  }
  if (itq.length && !errors.length) errors.push({ no: lines.length ? lines[lines.length - 1].no : 0, message: 'the IT block is not finished' });

  // branches: short where they reach, else long (as GNU as relaxes them)
  const offsets = () => { const o = []; let a = 0; for (const it of items) { o.push(a); a += it.size; } o.push(a); return o; };
  const target = (it, i, off) => {
    const n = it.branch.target.name;
    if (it.branch.word !== undefined) return null;
    if (/^\d+[bf]$/.test(n)) {
      const num = n.slice(0, -1), back = n.endsWith('b');
      const c = numeric.filter(x => x.name === num && (back ? x.at <= i : x.at > i));
      if (!c.length) fail(`no label ${num}: ${back ? 'before' : 'after'} this`);
      return off[(back ? c[c.length - 1] : c[0]).at];
    }
    const l = labels.get(n);
    if (!l) fail(`${n} is not a label in this block`);
    return off[l.at];
  };
  for (let pass = 0; pass < 20; pass++) {
    const off = offsets(); let changed = false;
    items.forEach((it, i) => {
      if (!it.branch || it.size === 4) return;
      let d;
      try { d = target(it, i, off) - (off[i] + 4); } catch (e) { return; }
      const ok = it.mn.base === 'b' && it.mn.cond === null && it.itn === 0 ? d >= -2048 && d <= 2046
        : it.mn.base === 'b' ? d >= -256 && d <= 254 : d >= 0 && d <= 126;
      if (!ok) { if (it.mn.base === 'cbz' || it.mn.base === 'cbnz' || v6m) return; it.size = 4; changed = true; }
    });
    if (!changed) break;
  }
  const off = offsets(), code = [], rows = [];
  // ARMv6-M literal pool: each value once, word-aligned after the code
  const pool = [...new Set(items.filter(it => it.lit).map(it => it.lit.v))];
  const poolStart = (base + off[off.length - 1] + 3) & ~3;
  const poolAt = v => poolStart + 4 * pool.indexOf(v);
  items.forEach((it, i) => {
    try {
      if (it.branch) {
        const at = base + off[i];
        let dest;
        if (it.branch.word !== undefined && it.size === 6) {           // ARMv6-M: bl call_bi, xt less KBASE
          const f = opts.far(it.branch.word);
          const d6 = f.callBi - (at + 4);
          if (opts.base !== undefined && (d6 < -(1 << 24) || d6 >= 1 << 24)) fail('call_bi is out of reach');   // no base: a first pass
          const s6 = (d6 >>> 24) & 1, j1 = (~(d6 >>> 23) & 1) ^ s6, j2 = (~(d6 >>> 22) & 1) ^ s6;
          it.code = [0xF000 | (s6 << 10) | ((d6 >> 12) & 0x3FF), 0xD000 | (j1 << 13) | (j2 << 11) | ((d6 >> 1) & 0x7FF), f.off];
          rows.push({ no: it.ln.no, off: off[i], size: it.size });
          code.push(...it.code);
          return;
        }
        if (it.branch.word !== undefined) {
          const xt = opts.word ? opts.word(it.branch.word) : undefined;
          if (xt === null) fail(`${it.branch.word} is not a label here or a word on the board`);
          dest = xt === undefined ? at + 4 : xt & ~1;
        } else dest = base + target(it, i, off);
        const d = dest - (at + 4);
        const cond = it.mn.cond === null || it.itn > 0 ? 14 : it.mn.cond;
        if (it.mn.base === 'cbz' || it.mn.base === 'cbnz') {
          if (d < 0 || d > 126) fail('cbz and cbnz reach 126 bytes ahead at most');
          it.code = [(it.mn.base === 'cbz' ? 0xB100 : 0xB900) | ((d >> 6) & 1) << 9 | ((d >> 1) & 31) << 3 | it.branch.reg];
        } else if (it.size === 2) {
          if (v6m && (cond === 14 ? d < -2048 || d > 2046 : d < -256 || d > 254)) fail(`out of reach on ARMv6-M: ${cond === 14 ? 'b reaches 2 KB' : 'a conditional branch reaches 256 bytes'}; use bl for further`);
          it.code = cond === 14 ? [0xE000 | ((d >> 1) & 0x7FF)] : [0xD000 | (cond << 8) | ((d >> 1) & 0xFF)];
        } else if (cond === 14) {
          if (d < -(1 << 24) || d >= 1 << 24) fail('the branch is out of reach');
          const s = (d >>> 24) & 1, j1 = (~(d >>> 23) & 1) ^ s, j2 = (~(d >>> 22) & 1) ^ s;
          it.code = [0xF000 | (s << 10) | ((d >> 12) & 0x3FF), (it.mn.base === 'bl' ? 0xD000 : 0x9000) | (j1 << 13) | (j2 << 11) | ((d >> 1) & 0x7FF)];
        } else {
          if (d < -(1 << 20) || d >= 1 << 20) fail('the branch is out of reach');
          it.code = [0xF000 | (((d >>> 20) & 1) << 10) | (cond << 6) | ((d >> 12) & 0x3F),
            0x8000 | (((d >> 18) & 1) << 13) | (((d >> 19) & 1) << 11) | ((d >> 1) & 0x7FF)];
        }
      }
      if (it.lit) {                                // ldr rd, [pc, #k]: k from the pool below
        const k = poolAt(it.lit.v) - ((base + off[i] + 4) & ~3);
        if (k > 1020) fail('the literal pool is out of reach (1 KB)');
        it.code = [0x4800 | (it.lit.rd << 8) | (k >> 2)];
      }
      rows.push({ no: it.ln.no, off: off[i], size: it.size });
      code.push(...it.code.map(h => h & 0xFFFF));
    } catch (e) {
      if (!(e instanceof AsmError)) throw e;
      errors.push({ no: it.ln.no, message: e.message });
    }
  });
  if (pool.length) {                               // aligned to 4, after the code
    if ((base + 2 * code.length) & 2) code.push(0x46C0);
    for (const v of pool) code.push(v & 0xFFFF, (v >>> 16) & 0xFFFF);
  }
  return { code, rows, errors };
}

// CODE blocks in ARM syntax: [{start, end, name, stack}] (line indexes from 0; end = the
// END-CODE line, or -1 if missing). A block whose first instruction is postfix
// (lib/thumb2/asm.fth's `tos tos 3 adds,`: lines ending in a comma) is not one of these.
function blocks(textLines) {
  const out = [];
  for (let i = 0; i < textLines.length; i++) {
    const m = /^\s*CODE\s+(\S+)\s*(\([^)]*\))?/i.exec(textLines[i]);
    if (!m || stripComment(textLines[i].slice(m[0].length)).trim()) continue;   // instructions on the CODE line: postfix
    let j = i + 1, postfix = false;                 // postfix lines end in a mnemonic with its comma
    while (j < textLines.length && !/^\s*END-CODE\b/i.test(textLines[j])) {
      if (/,$/.test(stripComment(textLines[j]).trim())) postfix = true;
      j++;
    }
    if (postfix) { i = j; continue; }
    out.push({ start: i, end: j < textLines.length ? j : -1, name: m[1], stack: m[2] || '' });
    i = j;
  }
  return out;
}

// The Forth lines that build the word from halfwords, without anything loaded:
// : leaves push {lr} (taken back), ; leaves pop {pc} (taken back).
function forthLines(name, code) {
  const out = [`: ${name} [ -2 ALLOT`];
  const cells = [];
  for (let i = 0; i + 1 < code.length; i += 2) cells.push(`$${((code[i] | (code[i + 1] << 16)) >>> 0).toString(16).toUpperCase()} ,`);
  for (let i = 0; i < cells.length; i += 8) out.push(cells.slice(i, i + 8).join(' '));
  if (code.length & 1) out.push(`$${code[code.length - 1].toString(16).toUpperCase()} HERE H! 2 ALLOT`);
  out.push('] ; -2 ALLOT');
  return out;
}

const MNEMONICS = [...Object.keys(T), 'b', 'bl', 'cbz', 'cbnz', 'it', 'itt', 'ite', 'ittt', 'itte', 'itet', 'itee', 'mov32'];
module.exports = { stripComment, parseLine, assemble, blocks, forthLines, isMnemonic, mnemonic, REGS, CONDS, SYSREGS, MNEMONICS, AsmError, mimm };

// thumbdis.js - a Thumb-2 decoder for the debugger's listing, so it needs no
// ARM toolchain. Covers the Armv7-M / Armv8-M Mainline instructions a C
// compiler and our code generator emit; its text is objdump's (raw-binary,
// force-thumb mode), checked against objdump on every instruction in our kernel
// images (test/thumbdis.test.js). Anything else shows as .short / .word.
'use strict';

const REG = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'sl', 'fp', 'ip', 'sp', 'lr', 'pc'];
const COND = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', '', ''];
const SHIFT = ['lsl', 'lsr', 'asr', 'ror'];
const SYSM = { 0: 'APSR', 1: 'IAPSR', 2: 'EAPSR', 3: 'PSR', 5: 'IPSR', 6: 'EPSR', 7: 'IEPSR', 8: 'MSP', 9: 'PSP',
  10: 'MSPLIM', 11: 'PSPLIM', 16: 'PRIMASK', 17: 'BASEPRI', 18: 'BASEPRI_MAX', 19: 'FAULTMASK', 20: 'CONTROL' };

const r = n => REG[n];
const hexa = v => '0x' + (v >>> 0).toString(16);
const bits = (x, hi, lo) => (x >>> lo) & ((1 << (hi - lo + 1)) - 1);
const sx = (v, n) => (v << (32 - n)) >> (32 - n);

// objdump's immediates: decimal, with the value in hex after @ when over 32
const imm = v => `#${v}${(v >>> 0) > 32 && v >= 0 ? ` @ 0x${(v >>> 0).toString(16)}` : ''}`;
const immNoNote = v => `#${v}`;
const note = v => ((v >>> 0) > 32 && v >= 0 ? ` @ 0x${(v >>> 0).toString(16)}` : '');
// [rn, #v] with objdump's note after the bracket
const memImm = (rn, v) => `[${rn}, #${v}]${note(v)}`;
const reglist = m => '{' + REG.filter((_, i) => m & (1 << i)).join(', ') + '}';

function thumbExpandImm(i12) {
  const top = i12 >> 10, mid = (i12 >> 8) & 3, b = i12 & 0xFF;
  if (top === 0) {
    if (mid === 0) return b;
    if (mid === 1) return (b << 16 | b) >>> 0;
    if (mid === 2) return (b << 24 | b << 8) >>> 0;
    return (b << 24 | b << 16 | b << 8 | b) >>> 0;
  }
  const v = 0x80 | (i12 & 0x7F), rot = i12 >> 7;
  return ((v >>> rot) | (v << (32 - rot))) >>> 0;
}

function shiftText(type, n) {
  if (type === 0 && n === 0) return '';
  if (type === 3 && n === 0) return ', rrx';
  if ((type === 1 || type === 2) && n === 0) n = 32;
  return `, ${SHIFT[type]} #${n}`;
}

// ---- 16-bit ----
// [name, operands, flagSetting]; name without condition
function t16(h, pc) {
  const lo3 = x => r(x & 7);
  if ((h >> 13) === 0) {                                     // shift imm, add/sub
    const op = (h >> 11) & 3, rd = h & 7, rm = (h >> 3) & 7;
    if (op < 3) {
      const n = (h >> 6) & 31;
      if (op === 0 && n === 0) return ['movs', `${r(rd)}, ${r(rm)}`, true];
      return [['lsls', 'lsrs', 'asrs'][op], `${r(rd)}, ${r(rm)}, #${op && !n ? 32 : n}`, true];
    }
    const sub = (h >> 9) & 1, isImm = (h >> 10) & 1, x = (h >> 6) & 7;
    return [sub ? 'subs' : 'adds', `${r(rd)}, ${r(rm)}, ${isImm ? '#' + x : r(x)}`, true];
  }
  if ((h >> 13) === 1) {                                     // mov/cmp/add/sub imm8
    const op = (h >> 11) & 3, rd = (h >> 8) & 7, v = h & 0xFF;
    return [['movs', 'cmp', 'adds', 'subs'][op], `${r(rd)}, ${imm(v)}`, op !== 1];
  }
  if ((h >> 10) === 0x10) {                                  // data processing (register)
    const op = (h >> 6) & 15, rdn = h & 7, rm = (h >> 3) & 7;
    const names = ['ands', 'eors', 'lsls', 'lsrs', 'asrs', 'adcs', 'sbcs', 'rors', 'tst', 'negs', 'cmp', 'cmn', 'orrs', 'muls', 'bics', 'mvns'];
    return [names[op], `${r(rdn)}, ${r(rm)}`, ![8, 10, 11].includes(op)];
  }
  if ((h >> 10) === 0x11) {                                  // special data, branch exchange
    const op = (h >> 8) & 3, rdn = (h & 7) | ((h >> 4) & 8), rm = (h >> 3) & 15;
    if (op === 0) return ['add', `${r(rdn)}, ${r(rm)}`];
    if (op === 1) return ['cmp', `${r(rdn)}, ${r(rm)}`];
    if (op === 2) return h === 0x46C0 ? ['nop', '', false, '(mov r8, r8)'] : ['mov', `${r(rdn)}, ${r(rm)}`];
    if (h & 3) return null;                                   // bits 1:0 must be 0
    return [((h >> 7) & 1 ? 'blx' : 'bx') + ((h >> 2) & 1 ? 'ns' : ''), r(rm)];
  }
  if ((h >> 11) === 9) {                                     // ldr literal
    const v = (h & 0xFF) * 4;
    return ['ldr', `${r((h >> 8) & 7)}, [pc, #${v}] @ (${hexa(((pc + 4) & ~3) + v)})`];
  }
  if ((h >> 12) === 5) {                                     // load/store register offset
    const op = (h >> 9) & 7;
    return [['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'][op], `${lo3(h)}, [${lo3(h >> 3)}, ${lo3(h >> 6)}]`];
  }
  if ((h >> 13) === 3) {                                     // ldr/str (byte) imm5
    const b = (h >> 12) & 1, l = (h >> 11) & 1, v = ((h >> 6) & 31) * (b ? 1 : 4);
    return [(l ? 'ldr' : 'str') + (b ? 'b' : ''), `${lo3(h)}, ${memImm(lo3(h >> 3), v)}`];
  }
  if ((h >> 12) === 8) {                                     // ldrh/strh imm5
    return [(h >> 11) & 1 ? 'ldrh' : 'strh', `${lo3(h)}, ${memImm(lo3(h >> 3), ((h >> 6) & 31) * 2)}`];
  }
  if ((h >> 12) === 9) {                                     // sp-relative
    return [(h >> 11) & 1 ? 'ldr' : 'str', `${r((h >> 8) & 7)}, ${memImm('sp', (h & 0xFF) * 4)}`];
  }
  if ((h >> 12) === 10) {                                    // adr, add sp
    const rd = (h >> 8) & 7, v = (h & 0xFF) * 4;
    if ((h >> 11) & 1) return ['add', `${r(rd)}, sp, ${imm(v)}`];
    return ['add', `${r(rd)}, pc, #${v}`, false, `(adr ${r(rd)}, ${hexa(((pc + 4) & ~3) + v)})`];
  }
  if ((h >> 12) === 11) {                                    // miscellaneous
    if ((h >> 8) === 0xB0) return [(h >> 7) & 1 ? 'sub' : 'add', `sp, ${imm((h & 0x7F) * 4)}`];
    if ((h & 0xF500) === 0xB100) {
      const off = (((h >> 9) & 1) << 6) | (((h >> 3) & 31) << 1);
      return [(h >> 11) & 1 ? 'cbnz' : 'cbz', `${lo3(h)}, ${hexa(pc + 4 + off)}`];
    }
    if ((h >> 8) === 0xB2) return [['sxth', 'sxtb', 'uxth', 'uxtb'][(h >> 6) & 3], `${lo3(h)}, ${lo3(h >> 3)}`];
    if ((h >> 9) === 0x5A) return ['push', reglist((h & 0xFF) | ((h >> 8) & 1) << 14)];
    if ((h >> 9) === 0x5E) return ['pop', reglist((h & 0xFF) | ((h >> 8) & 1) << 15)];
    if ((h & 0xFFE8) === 0xB660) return [`cps${(h >> 4) & 1 ? 'id' : 'ie'}`, ((h & 4) ? 'a' : '') + ((h & 2) ? 'i' : '') + ((h & 1) ? 'f' : '')];
    if ((h >> 8) === 0xBA) {
      const op = (h >> 6) & 3;
      if (op !== 2) return [['rev', 'rev16', '', 'revsh'][op], `${lo3(h)}, ${lo3(h >> 3)}`];
    }
    if ((h >> 8) === 0xBE) return ['bkpt', '0x' + (h & 0xFF).toString(16).padStart(4, '0')];
    if ((h >> 8) === 0xBF) {
      if (h & 0xF) return ['IT', h];                          // handled by the caller
      return [['nop', 'yield', 'wfe', 'wfi', 'sev'][(h >> 4) & 15] || null, ''];
    }
    return null;
  }
  if ((h >> 12) === 12) {                                    // ldm/stm
    const l = (h >> 11) & 1, rn = (h >> 8) & 7, list = h & 0xFF;
    return [l ? 'ldmia' : 'stmia', `${r(rn)}${l && (list >> rn) & 1 ? '' : '!'}, ${reglist(list)}`];
  }
  if ((h >> 12) === 13) {                                    // conditional branch, udf, svc
    const c = (h >> 8) & 15;
    if (c === 14) return ['udf', imm(h & 0xFF)];
    if (c === 15) return ['svc', `${h & 0xFF}${note(h & 0xFF)}`];
    return [`b${COND[c]}.n`, hexa(pc + 4 + sx(h & 0xFF, 8) * 2), false, null, true];
  }
  if ((h >> 11) === 0x1C) return ['b.n', hexa(pc + 4 + sx(h & 0x7FF, 11) * 2), false, null, true];
  return null;
}

// ---- 32-bit ----
// [name, operands, wide (".w" when it has a 16-bit form too), S flag]
function t32(h1, h2, pc) {
  const op1 = (h1 >> 11) & 3;
  // data processing, modified immediate
  if ((h1 & 0xFA00) === 0xF000 && !(h2 & 0x8000)) {
    const op = (h1 >> 5) & 15, s = (h1 >> 4) & 1, rn = h1 & 15, rd = (h2 >> 8) & 15;
    const v = thumbExpandImm(((h1 >> 10) & 1) << 11 | ((h2 >> 12) & 7) << 8 | (h2 & 0xFF));
    const i = imm(v);
    switch (op) {
      case 0: return rd === 15 && s ? ['tst', `${r(rn)}, ${i}`, true] : ['and', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 1: return ['bic', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 2: return rn === 15 ? ['mov', `${r(rd)}, ${i}`, true, s] : ['orr', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 3: return rn === 15 ? ['mvn', `${r(rd)}, ${i}`, true, s] : ['orn', `${r(rd)}, ${r(rn)}, ${i}`, false, s];
      case 4: return rd === 15 && s ? ['teq', `${r(rn)}, ${i}`, false] : ['eor', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 8: return rd === 15 && s ? ['cmn', `${r(rn)}, ${i}`, true] : ['add', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 10: return ['adc', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 11: return ['sbc', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 13: return rd === 15 && s ? ['cmp', `${r(rn)}, ${i}`, true] : ['sub', `${r(rd)}, ${r(rn)}, ${i}`, true, s];
      case 14: return ['rsb', `${r(rd)}, ${r(rn)}, ${i}`, false, s];
      default: return null;
    }
  }
  // data processing, plain binary immediate
  if ((h1 & 0xFA00) === 0xF200 && !(h2 & 0x8000)) {
    const op = (h1 >> 4) & 31, rn = h1 & 15, rd = (h2 >> 8) & 15;
    const i12 = ((h1 >> 10) & 1) << 11 | ((h2 >> 12) & 7) << 8 | (h2 & 0xFF);
    const i16 = (h1 & 15) << 12 | i12;
    const lsb = ((h2 >> 12) & 7) << 2 | ((h2 >> 6) & 3), wm1 = h2 & 31;
    switch (op) {
      case 0: return rn === 15 ? ['addw', `${r(rd)}, pc, ${imm(i12)}`, false] : ['addw', `${r(rd)}, ${r(rn)}, ${imm(i12)}`, false];
      case 4: return ['movw', `${r(rd)}, ${imm(i16)}`, false];
      case 10: return rn === 15 ? ['subw', `${r(rd)}, pc, ${imm(i12)}`, false] : ['subw', `${r(rd)}, ${r(rn)}, ${imm(i12)}`, false];
      case 12: return ['movt', `${r(rd)}, ${imm(i16)}`, false];
      case 20: case 22: case 28:
        if ((h1 >> 10) & 1 || (h2 >> 5) & 1) return null;
        if (op === 22 && wm1 < lsb) return null;
        break;
      default: break;
    }
    switch (op) {
      case 20: return ['sbfx', `${r(rd)}, ${r(rn)}, #${lsb}, #${wm1 + 1}`, false];
      case 22: return rn === 15 ? ['bfc', `${r(rd)}, #${lsb}, #${wm1 - lsb + 1}`, false] : ['bfi', `${r(rd)}, ${r(rn)}, #${lsb}, #${wm1 - lsb + 1}`, false];
      case 28: return ['ubfx', `${r(rd)}, ${r(rn)}, #${lsb}, #${wm1 + 1}`, false];
      default: return null;
    }
  }
  // branches and miscellaneous control
  if ((h1 & 0xF800) === 0xF000 && (h2 & 0x8000)) {
    const op = (h2 >> 12) & 5, s = (h1 >> 10) & 1, j1 = (h2 >> 13) & 1, j2 = (h2 >> 11) & 1;
    if (op === 5) {                                          // bl
      const i1 = 1 - (j1 ^ s), i2 = 1 - (j2 ^ s);
      const off = sx(s << 24 | i1 << 23 | i2 << 22 | (h1 & 0x3FF) << 12 | (h2 & 0x7FF) << 1, 25);
      return ['bl', hexa(pc + 4 + off), false, false, true];
    }
    if (op === 1) {                                          // b.w
      const i1 = 1 - (j1 ^ s), i2 = 1 - (j2 ^ s);
      const off = sx(s << 24 | i1 << 23 | i2 << 22 | (h1 & 0x3FF) << 12 | (h2 & 0x7FF) << 1, 25);
      return ['b.w', hexa(pc + 4 + off), false, false, true];
    }
    if (op === 0 && ((h1 >> 7) & 7) !== 7) {                 // b<cond>.w
      const off = sx(s << 20 | j2 << 19 | j1 << 18 | (h1 & 0x3F) << 12 | (h2 & 0x7FF) << 1, 21);
      return [`b${COND[(h1 >> 6) & 15]}.w`, hexa(pc + 4 + off), false, false, true];
    }
    if (op === 0) {
      const o = (h1 >> 4) & 0x7F;
      if (o === 0x38 && (h2 & 0xFF00) === 0x8800 && SYSM[h2 & 0xFF] && (h1 & 15) < 13) return ['msr', `${(h2 & 0xFF) ? SYSM[h2 & 0xFF] : 'CPSR_f'}, ${r(h1 & 15)}`, false];   // SYSm 0 as objdump prints it
      if (o === 0x3E && (h1 & 15) === 15 && (h2 & 0xF000) === 0x8000 && SYSM[h2 & 0xFF] && ((h2 >> 8) & 15) < 13) return ['mrs', `${r((h2 >> 8) & 15)}, ${(h2 & 0xFF) ? SYSM[h2 & 0xFF] : 'CPSR'}`, false];
      if (h1 === 0xF3AF && (h2 & 0xFF00) === 0x8000) return [['nop', 'yield', 'wfe', 'wfi', 'sev'][h2 & 0xFF] || null, '', true];
      if (h1 === 0xF3BF && (h2 & 0xFF00) === 0x8F00) {
        const bo = { 4: 'dsb', 5: 'dmb', 6: 'isb' }[(h2 >> 4) & 15], o4 = h2 & 15;
        if (!bo) return null;
        if (bo === 'dsb' && { 0: 1, 4: 1, 12: 1 }[o4]) return [{ 0: 'ssbb', 4: 'pssbb', 12: 'dfb' }[o4], '', false];
        const NAMES = { 15: 'sy', 14: 'st', 13: 'ld', 11: 'ish', 10: 'ishst', 9: 'ishld', 7: 'un', 6: 'unst', 5: 'nshld', 3: 'osh', 2: 'oshst', 1: 'oshld' };
        return [bo, bo === 'isb' ? (o4 === 15 ? 'sy' : `#${o4}`) : NAMES[o4] || `#${o4}`, false];
      }
      if (o === 0x7F && (h2 & 0xF000) === 0xA000) return ['udf', imm((h1 & 15) << 12 | (h2 & 0xFFF)), true];
    }
    return null;
  }
  // load/store multiple, dual, exclusive, table branch
  if ((h1 & 0xFE40) === 0xE800 || (h1 & 0xFE40) === 0xE900) {
    const op = (h1 >> 7) & 3, w = (h1 >> 5) & 1, l = (h1 >> 4) & 1, rn = h1 & 15;
    const list = reglist(h2);
    if (rn === 15 || (h2 & 0x2000)) return null;             // clrm, or sp in the list
    if (op === 1) return [l ? 'ldmia' : 'stmia', `${r(rn)}${w ? '!' : ''}, ${list}`, true];
    if (op === 2) return [l ? 'ldmdb' : 'stmdb', `${r(rn)}${w ? '!' : ''}, ${list}`, false];
    return null;
  }
  if ((h1 & 0xFE40) === 0xE840) {
    const p = (h1 >> 8) & 1, u = (h1 >> 7) & 1, w = (h1 >> 5) & 1, l = (h1 >> 4) & 1, rn = h1 & 15;
    const rt = (h2 >> 12) & 15, rt2 = (h2 >> 8) & 15;
    if (!p && !w) {
      if (!u) {                                              // ldrex/strex
        const v = (h2 & 0xFF) * 4;
        if (rn === 15 || rt === 15 || (!l && rt2 === 15) || (l && rt2 !== 15)) return null;
        return l ? ['ldrex', `${r(rt)}, [${r(rn)}${v ? `, #${v}` : ''}]${note(v)}`, false]
          : ['strex', `${r(rt2)}, ${r(rt)}, [${r(rn)}${v ? `, #${v}` : ''}]${note(v)}`, false];
      }
      const op3 = (h2 >> 4) & 15;
      if (((h2 >> 8) & 15) !== 15 && op3 < 2) return null;
      if (op3 < 2 && rt !== 15) return null;                   // tbb/tbh: 1111 0000 in h2's top
      if (op3 < 2 && ((h2 >> 8) & 15) !== 0) return null;
      if (op3 >= 4 && ((h2 >> 8) & 15) !== 15) return null;
      if (op3 >= 4 && l && (h2 & 15) !== 15) return null;
      if (op3 === 0 && l) return ['tbb', `[${r(rn)}, ${r(h2 & 15)}]`, false];
      if (op3 === 1 && l) return ['tbh', `[${r(rn)}, ${r(h2 & 15)}, lsl #1]`, false];
      if ((op3 === 4 || op3 === 5) && l) return [op3 === 4 ? 'ldrexb' : 'ldrexh', `${r(rt)}, [${r(rn)}]`, false];
      if (op3 === 4 || op3 === 5) return [op3 === 4 ? 'strexb' : 'strexh', `${r(h2 & 15)}, ${r(rt)}, [${r(rn)}]`, false];
      return null;
    }
    if (rn === 15 || (p && w && !(h2 & 0xFF))) return null;  // literal forms; [rn, #0]! (objdump drops the !)
    const v = (h2 & 0xFF) * 4, sv = u ? `${v}` : `-${v}`;
    const mem = !p ? `[${r(rn)}], #${sv}` : w ? `[${r(rn)}, #${sv}]!` : (v || !u ? `[${r(rn)}, #${sv}]` : `[${r(rn)}]`);
    return [l ? 'ldrd' : 'strd', `${r(rt)}, ${r(rt2)}, ${mem}${note(v)}`, false];
  }
  // data processing, shifted register
  if ((h1 & 0xFE00) === 0xEA00 && !(h2 & 0x8000)) {
    const op = (h1 >> 5) & 15, s = (h1 >> 4) & 1, rn = h1 & 15, rd = (h2 >> 8) & 15, rm = h2 & 15;
    const sh = shiftText((h2 >> 4) & 3, ((h2 >> 12) & 7) << 2 | ((h2 >> 6) & 3));
    const three = `${r(rd)}, ${r(rn)}, ${r(rm)}${sh}`;
    switch (op) {
      case 0: return rd === 15 && s ? ['tst', `${r(rn)}, ${r(rm)}${sh}`, true] : ['and', three, true, s];
      case 1: return ['bic', three, true, s];
      case 2: return rn === 15 ? ['mov', `${r(rd)}, ${r(rm)}${sh}`, true, s] : ['orr', three, true, s];
      case 3: return rn === 15 ? ['mvn', `${r(rd)}, ${r(rm)}${sh}`, true, s] : ['orn', three, false, s];
      case 4: return rd === 15 && s ? ['teq', `${r(rn)}, ${r(rm)}${sh}`, false] : ['eor', three, true, s];
      case 8: return rd === 15 && s ? ['cmn', `${r(rn)}, ${r(rm)}${sh}`, true] : ['add', three, true, s];
      case 10: return ['adc', three, true, s];
      case 11: return ['sbc', three, true, s];
      case 13: return rd === 15 && s ? ['cmp', `${r(rn)}, ${r(rm)}${sh}`, true] : ['sub', three, true, s];
      case 14: return ['rsb', three, false, s];
      default: return null;
    }
  }
  // register-controlled shifts, extends, misc (clz, rbit, rev)
  if ((h1 & 0xFF00) === 0xFA00 && (h2 & 0xF000) === 0xF000) {
    const op = (h1 >> 4) & 15, rn = h1 & 15, rd = (h2 >> 8) & 15, rm = h2 & 15, op2 = (h2 >> 4) & 15;
    if (op2 === 0 && op < 8) return [SHIFT[op >> 1], `${r(rd)}, ${r(rn)}, ${r(rm)}`, true, op & 1];
    if ((op2 & 0xC) === 8 && op < 6 && rn === 15) {
      const rot = (h2 >> 4) & 3;
      const nm = { 0: 'sxth', 1: 'uxth', 4: 'sxtb', 5: 'uxtb' }[op];
      if (nm) return [nm, `${r(rd)}, ${r(rm)}${rot ? `, ror #${rot * 8}` : ''}`, true];
    }
    if ((op === 9 || op === 11) && rn !== rm) return null;
    if (op2 === 8 && op === 9) return [['rev', 'rev16', 'rbit', 'revsh'][(h2 >> 4) & 3], `${r(rd)}, ${r(rm)}`, ((h2 >> 4) & 3) !== 2];
    if (op2 === 8 && op === 11) return ['clz', `${r(rd)}, ${r(rm)}`, false];
    return null;
  }
  // multiply, divide
  if ((h1 & 0xFF80) === 0xFB00) {
    const op = (h1 >> 4) & 7, rn = h1 & 15, ra = (h2 >> 12) & 15, rd = (h2 >> 8) & 15, op2 = (h2 >> 4) & 15, rm = h2 & 15;
    if (op === 0 && op2 === 0) return ra === 15 ? ['mul', `${r(rd)}, ${r(rn)}, ${r(rm)}`, true] : ['mla', `${r(rd)}, ${r(rn)}, ${r(rm)}, ${r(ra)}`, false];
    if (op === 0 && op2 === 1) return ['mls', `${r(rd)}, ${r(rn)}, ${r(rm)}, ${r(ra)}`, false];
    return null;
  }
  if ((h1 & 0xFF80) === 0xFB80) {
    const op = (h1 >> 4) & 7, rn = h1 & 15, rdlo = (h2 >> 12) & 15, rdhi = (h2 >> 8) & 15, op2 = (h2 >> 4) & 15, rm = h2 & 15;
    const nm = { '0,0': 'smull', '2,0': 'umull', '4,0': 'smlal', '6,0': 'umlal', '1,15': 'sdiv', '3,15': 'udiv' }[`${op},${op2}`];
    if (!nm || (nm.endsWith('div') && rdlo !== 15)) return null;
    return nm.endsWith('div') ? [nm, `${r(rdhi)}, ${r(rn)}, ${r(rm)}`, false] : [nm, `${r(rdlo)}, ${r(rdhi)}, ${r(rn)}, ${r(rm)}`, false];
  }
  // load/store single
  if ((h1 & 0xFE00) === 0xF800) {
    const sz = (h1 >> 5) & 3, sgn = (h1 >> 8) & 1, l = (h1 >> 4) & 1, up = (h1 >> 7) & 1, rn = h1 & 15, rt = (h2 >> 12) & 15;
    if (sz === 3 || (sgn && sz === 2)) return null;
    if (rt === 15 && sz !== 2) return null;                  // pld, pli: hints
    if (rn === 15 && !l) return null;
    const base = (l ? 'ldr' : 'str') + (sgn ? 's' : '') + ['b', 'h', ''][sz];
    if (!l && sgn) return null;
    if (rn === 15 && l) {                                    // literal
      const v = h2 & 0xFFF, a = ((pc + 4) & ~3) + (up ? v : -v);
      if (!up && v) return null;                             // never emitted by our tools
      return [base, `${r(rt)}, [pc${v ? `, #${v}` : ''}] @ ${hexa(a)}`, true];
    }
    if (up) return [base, `${r(rt)}, ${(h2 & 0xFFF) ? memImm(r(rn), h2 & 0xFFF) : `[${r(rn)}]`}`, true];
    if ((h2 & 0x0FC0) === 0) {                               // register
      const sh = (h2 >> 4) & 3;
      return [base, `${r(rt)}, [${r(rn)}, ${r(h2 & 15)}${sh ? `, lsl #${sh}` : ''}]`, true];
    }
    if ((h2 & 0x0800) === 0x0800) {                          // imm8, P U W
      const p = (h2 >> 10) & 1, u = (h2 >> 9) & 1, w = (h2 >> 8) & 1, v = h2 & 0xFF, sv = u ? v : -v;
      if (p && u && !w) return null;                         // ldrt and friends: unprivileged, not used
      if (!p && w) return [base, `${r(rt)}, [${r(rn)}], ${immNoNote(sv)}`, true];
      if (p && w) return [base, `${r(rt)}, [${r(rn)}${v ? `, ${immNoNote(sv)}` : ''}]!`, true];
      if (p) return [base, `${r(rt)}, [${r(rn)}${v ? `, ${immNoNote(sv)}` : ''}]`, true];
    }
    return null;
  }
  return null;
}

// Decode a run of code: [{addr, size, hex, text}]. IT blocks are followed: the
// instructions they make conditional get their condition, as objdump shows.
// ARMv6-M boards: a call to flash is bl call_bi then the
// target's xt less KBASE, and a literal is a word in the code after a branch
// over it. setFar({callBi, kbase, names}) when such a board is connected, null
// otherwise: bl call_bi is then shown as one row, bl to the target itself with
// the halfword after it, and the literal as .word.
let FAR = null;
function setFar(f) { FAR = f; }
function getFar() { return FAR; }

function disassemble(code, addr) {
  const out = [];
  let it = [];                                               // conditions still to apply
  let i = 0;
  const words = new Set();                                   // ARMv6-M literals met (addresses)
  while (i + 1 < code.length) {
    const pc = addr + i;
    if (FAR && words.has(pc) && i + 3 < code.length) {
      const w = code.readUInt32LE(i);
      out.push({ addr: pc, size: 4, hex: `${h4(w & 0xFFFF)} ${h4(w >>> 16)}`, text: `.word 0x${w.toString(16)}` });
      i += 4;
      continue;
    }
    const h1 = code.readUInt16LE(i);
    const wide = (h1 >> 11) >= 0x1D;
    if (wide && i + 3 >= code.length) { out.push({ addr: pc, size: 2, hex: h4(h1), text: `.short 0x${h4(h1)}` }); break; }
    const cond = it.length ? it.shift() : null;
    const lastInIt = cond !== null && it.length === 0;
    let text = null, size = 2, hex = h4(h1);
    if (wide) {
      const h2 = code.readUInt16LE(i + 2);
      size = 4; hex = `${h4(h1)} ${h4(h2)}`;
      const d = t32(h1, h2, pc);
      if (d && d[0] && !(cond !== null && d[4] && (!lastInIt || /^b[a-z]{2}\.w$/.test(d[0])))) {
        let [name, ops, w, s] = d;
        if (cond !== null && d[4]) name = name === 'bl' ? `bl${cond}` : `b${cond}.w`;
        else if (cond !== null) name = name + (s ? 's' : '') + cond + (w ? '.w' : '');
        else name = name + (s ? 's' : '') + (w ? '.w' : '');
        text = ops ? `${name} ${ops}` : name;
        if (FAR && name === 'bl' && i + 5 < code.length && blTarget(h1, h2, pc) === FAR.callBi) {
          const n = code.readUInt16LE(i + 4), t = ((FAR.kbase + n) & ~1) >>> 0;
          text = `bl 0x${t.toString(16)} @ call_bi`; size = 6; hex += ` ${h4(n)}`;
        }
      }
    } else {
      const d = t16(h1, pc);
      if (d && d[0] === 'IT') {
        const firstcond = (h1 >> 4) & 15, mask = h1 & 15;
        const n = mask & 1 ? 4 : mask & 2 ? 3 : mask & 4 ? 2 : 1;
        let pat = '';
        const conds = [COND[firstcond]];
        for (let k = 1; k < n; k++) {
          const t = ((mask >> (4 - k)) & 1) === (firstcond & 1);
          pat += t ? 't' : 'e';
          conds.push(COND[t ? firstcond : firstcond ^ 1]);
        }
        text = `it${pat} ${COND[firstcond]}`;
        out.push({ addr: pc, size: 2, hex, text });
        it = conds;
        i += 2;
        continue;
      }
      const itBranch = d && (d[4] || /^(bx|blx|bxns|blxns|cbn?z)$/.test(d[0]));
      if (cond !== null && d && /^cps/.test(d[0])) d[0] = null;      // not allowed in an IT block
      if (d && d[0] && !(cond !== null && itBranch && (!lastInIt || d[0] !== 'b.n' && !/^(bx|blx)$/.test(d[0])))) {
        let [name, ops, flags, note, branch] = d;
        if (cond !== null) {
          if (branch) name = `b${cond}.n`;
          else if (name !== 'bkpt') name = (flags ? name.replace(/s$/, '') : name) + cond;   // bkpt ignores IT
        }
        text = ops !== '' && ops !== undefined ? `${name} ${ops}` : name;
        if (note) text += ` @ ${note}`;
        if (FAR && (h1 & 0xF800) === 0x4800) {                // ldr rt, [pc, #k]: a literal ahead in this code
          const a = ((pc + 4) & ~3) + 4 * (h1 & 0xFF);
          if (a > pc && a + 4 <= addr + code.length) words.add(a);
        }
      }
    }
    if (text === null) text = size === 4 ? `.word 0x${hex.split(' ').reverse().join('')}` : `.short 0x${hex}`;
    out.push({ addr: pc, size, hex, text });
    i += size;
  }
  return out;
}

const h4 = v => v.toString(16).padStart(4, '0');
function blTarget(h1, h2, pc) {                              // the address a BL goes to
  const s = (h1 >> 10) & 1, j1 = (h2 >> 13) & 1, j2 = (h2 >> 11) & 1;
  const off = (s ? -(1 << 24) : 0) | ((~(j1 ^ s) & 1) << 23) | ((~(j2 ^ s) & 1) << 22) | ((h1 & 0x3FF) << 12) | ((h2 & 0x7FF) << 1);
  return (pc + 4 + off) >>> 0;
}

// Rows as thumb.js formats them: [[address, hex halfwords, instruction]]
function rows(code, addr) { return disassemble(code, addr).map(d => [d.addr, d.hex, d.text]); }

module.exports = { disassemble, rows, thumbExpandImm, setFar, getFar, blTarget };

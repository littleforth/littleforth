// thumb.js - machine code read the way it would be written by hand (port of
// ide/fide/thumb.py, contract A8): the Forth registers by name, what the
// compiler put where, a called word's name. Works on the decoder's rows
// (thumbdis.js) [[address, hex halfwords, instruction text]]; knows the
// compiler's sequences from src/cg_thumb.c.
'use strict';

const BUILTINS = require('../data/builtins.json');
const D = require('./thumbdis');

const RENAME = [[/\br6\b/g, 'tos'], [/\br5\b/g, 'psp'], [/\bsp\b/g, 'rsp']];
function rename(ins) { for (const [rx, a] of RENAME) ins = ins.replace(rx, a); return ins; }

// The part of a builtin the compiler copies inline: up to its bx lr, at most 12
// halfwords (as inline_copy in cg_thumb.c). null if not copyable.
function body(hw) {
  let n = 0;
  while (n < 12 && n < hw.length) {
    const x = hw[n];
    if (x === 0x4770) return hw.slice(0, n);
    n += (x >> 11) >= 0x1D ? 2 : 1;
  }
  return null;
}

const halfwords = code => { const o = []; for (let i = 0; i + 1 < code.length; i += 2) o.push(code.readUInt16LE(i)); return o; };
const imm16 = (h1, h2) => ((h1 & 0xF) << 12) | (((h1 >> 10) & 1) << 11) | (((h2 >> 12) & 7) << 8) | (h2 & 0xFF);
const signed = v => v | 0;
const matchSeq = (hw, i, seq) => seq.every((v, k) => hw[i + k] === v);

const T_DO = [0x4630, 0xF855, 0x1B04, 0xF855, 0x6B04, 0xB403];
const T_LOOP_HEAD = [0x9800, 0x3001, 0x9901, 0x9000, 0x4288];
const T_PLOOP_HEAD = [0x9800, 0x9901, 0x1A42, 0xF082, 0x4200, 0x1980, 0x9000, 0x1992, 0xF855, 0x6B04];
const PUSH_TOS = [0xF845, 0x6D04];
const POP_TOS = [0xF855, 0x6B04];
const isT3 = (h1, h2) => (h1 & 0xF800) === 0xF000 && (h2 & 0xD000) === 0x8000 && ((h1 >> 6) & 0xE) !== 0xE;   // b<cond>.w
const isT4 = (h1, h2) => (h1 & 0xF800) === 0xF000 && (h2 & 0xD000) === 0x9000;                                 // b.w
// ARMv6-M (Thumb-1): branches are BLs, a conditional one a short branch over a BL
const isBL = (h1, h2) => (h1 & 0xF800) === 0xF000 && (h2 & 0xD000) === 0xD000;
const PUSH1 = [0x3D04, 0x602E];
const POP1 = [0xCD40];
const T_DO1 = [0x4630, 0xCD02, 0xCD40, 0xB403];
const T_LOOP1 = [0x9800, 0x3001, 0x9901, 0x9000, 0x4288, 0xD001];
const T_PLOOP1 = [0x9800, 0x9901, 0x1A42, 0x2301, 0x07DB, 0x405A, 0x1980, 0x9000, 0x1992, 0xCD40, 0xD601];
const IF1 = [0x2E00, 0xCD40, 0xD101];

// {byte offset: comment} for the code of one of your words; a comment covers the
// instructions up to the next one. inline: {name: halfword array} of the
// builtins copied inline (see body()). base: where the code is (ARMv6-M: to
// tell bl call_bi, which a halfword follows).
function annotate(code, inline = {}, base = null) {
  const hw = halfwords(code);
  const byBody = new Map();
  for (const [name, b] of Object.entries(inline)) if (b && b.length) {
    const k = b.join(',');
    if (!byBody.has(k)) byBody.set(k, { b, names: [] });
    byBody.get(k).names.push(name);
  }
  const bodies = [...byBody.values()].sort((a, c) => c.b.length - a.b.length);
  const out = {};
  const n = hw.length;
  let i = 0;
  while (i < n) {
    const x = hw[i], nx = i + 1 < n ? hw[i + 1] : null;
    let step = 1, note = null;
    if (i === 0 && x === 0xB500) note = 'enter: save the return address on rsp';
    else if (x === 0xBD00) note = 'exit: return to the caller';
    else if (matchSeq(hw, i, PUSH_TOS) && i + 2 < n) {
      let j = i + 2, val = null;
      const h = hw[j];
      if ((h & 0xFF00) === 0x2600) { val = h & 0xFF; j += 1; }                                         // movs r6,#n
      else if (h === 0xF06F && j + 1 < n && (hw[j + 1] & 0xFF00) === 0x0600) { val = signed(~(hw[j + 1] & 0xFF)); j += 2; }   // mvn r6,#n
      else if ((h & 0xFBF0) === 0xF240 && j + 1 < n && (hw[j + 1] & 0x8F00) === 0x0600) {             // movw r6
        val = imm16(h, hw[j + 1]); j += 2;
        if (j + 1 < n && (hw[j] & 0xFBF0) === 0xF2C0 && (hw[j + 1] & 0x8F00) === 0x0600) { val = signed(val | (imm16(hw[j], hw[j + 1]) << 16)); j += 2; }   // movt r6
      }
      if (val !== null) {
        const shown = val > -256 && val < 256 ? String(val) : `${val} ($${(val >>> 0).toString(16).toUpperCase()})`;
        step = j - i; note = `literal ${shown}: push tos, then tos = it`;
      } else if (h === 0x9E00) { step = 3; note = 'I (or R@): push tos, then tos = the loop index from rsp'; }
      else if (h === 0x9E02) { step = 3; note = 'J: push tos, then tos = the outer loop index'; }
      else if (h === 0xBC40) { step = 3; note = 'R>: push tos, then pop tos from rsp'; }
    }
    else if (matchSeq(hw, i, PUSH1) && i + 2 < n) {                                       // ARMv6-M
      let j = i + 2, val = null;
      const h = hw[j];
      if ((h & 0xFF00) === 0x2600 && hw[j + 1] === 0x43F6) { val = signed(~(h & 0xFF)); j += 2; }   // movs; mvns
      else if ((h & 0xFF00) === 0x2600) { val = h & 0xFF; j += 1; }
      else if (h === 0x4E00 && hw[j + 1] === 0xE001 && j + 3 < n) { val = signed(hw[j + 2] | (hw[j + 3] << 16)); j += 4; }   // ldr r6,[pc]; b; .word
      else if (h === 0x4E01 && hw[j + 1] === 0xE002 && j + 4 < n) { val = signed(hw[j + 3] | (hw[j + 4] << 16)); j += 5; }
      if (val !== null) {
        const shown = val > -256 && val < 256 ? String(val) : `${val} ($${(val >>> 0).toString(16).toUpperCase()})`;
        step = j - i; note = `literal ${shown}: push tos, then tos = it`;
      } else if (h === 0x9E00) { step = 3; note = 'I (or R@): push tos, then tos = the loop index from rsp'; }
      else if (h === 0x9E02) { step = 3; note = 'J: push tos, then tos = the outer loop index'; }
      else if (h === 0xBC40) { step = 3; note = 'R>: push tos, then pop tos from rsp'; }
    }
    if (note === null && x === 0xB440 && matchSeq(hw, i + 1, POP_TOS)) { step = 3; note = '>R: push tos onto rsp, then drop it'; }
    if (note === null && x === 0xB440 && matchSeq(hw, i + 1, POP1)) { step = 2; note = '>R: push tos onto rsp, then drop it'; }
    if (note === null && matchSeq(hw, i, IF1) && i + 4 < n && isBL(hw[i + 3], hw[i + 4])) { step = 5; note = 'IF / WHILE / UNTIL: test tos, drop it, branch if it was 0'; }
    else if (note === null && matchSeq(hw, i, T_DO1)) { step = T_DO1.length; note = 'DO: move limit and index to rsp'; }
    else if (note === null && matchSeq(hw, i, T_LOOP1) && i + 7 < n && isBL(hw[i + 6], hw[i + 7])) { step = 8; note = 'LOOP: index + 1, back to the start until it reaches the limit'; }
    else if (note === null && matchSeq(hw, i, T_PLOOP1) && i + 12 < n && isBL(hw[i + 11], hw[i + 12])) { step = 13; note = '+LOOP: index + n, back until it crosses the limit'; }
    else if (note === null && nx !== null && isBL(x, nx)) {
      const B0 = base === null ? 0x10000000 : base, t = D.blTarget(x, nx, B0 + 2 * i), far = D.getFar();
      if (far && base !== null && t === far.callBi && i + 2 < n) step = 3;                // bl call_bi, halfword: formatRows names it
      else if (far && t > B0 && t < B0 + code.length) { step = 2; note = 'jump (ELSE, AGAIN, REPEAT or LEAVE)'; }   // not RECURSE (t = B0)
    }
    if (note === null && x === 0x2E00 && matchSeq(hw, i + 1, POP_TOS) && i + 4 < n && isT3(hw[i + 3], hw[i + 4])) { step = 5; note = 'IF / WHILE / UNTIL: test tos, drop it, branch if it was 0'; }
    else if (note === null && nx !== null && isT4(x, nx)) { step = 2; note = 'jump (ELSE, AGAIN, REPEAT or LEAVE)'; }
    else if (note === null && matchSeq(hw, i, T_DO)) { step = T_DO.length; note = 'DO: move limit and index to rsp'; }
    else if (note === null && matchSeq(hw, i, T_LOOP_HEAD) && i + 6 < n && isT3(hw[i + 5], hw[i + 6])) { step = 7; note = 'LOOP: index + 1, back to the start until it reaches the limit'; }
    else if (note === null && matchSeq(hw, i, T_PLOOP_HEAD) && i + 11 < n && isT3(hw[i + 10], hw[i + 11])) { step = 12; note = '+LOOP: index + n, back until it crosses the limit'; }
    else if (note === null && x === 0xB002) note = 'UNLOOP: drop limit and index from rsp';
    if (note === null) {
      for (const { b, names } of bodies) {
        if (matchSeq(hw, i, b)) {
          const eff = (BUILTINS[names[0]] || [''])[0];
          step = b.length;
          note = names.join(' / ') + (eff && names.length === 1 ? ` ${eff}` : '') + '  (copied inline)';
          break;
        }
      }
    }
    if (note === null && step === 1 && nx !== null && (x & 0xF800) === 0xF000 && (nx & 0xD000) === 0xD000) step = 2;   // bl: formatRows names it
    if (note) out[2 * i] = note;
    i += step;
  }
  return out;
}

// Lines for SEE and the debug listing: address, bytes, instruction (with
// tos/psp/rsp if named), a called word's name, the compiler's note.
function formatRows(rows, namesAt, start, named = true, notes = {}) {
  return rows.map(([a, hx, ins]) => {
    const t = /\bbl\s+0x([0-9a-f]+)/.exec(ins);
    const called = t ? namesAt.get(parseInt(t[1], 16)) : null;
    if (named) ins = rename(ins);
    let line = `${a.toString(16).padStart(8, '0')}:  ${hx.padEnd(10)} ${ins}`;
    if (called) line += `   ${called}`;
    const note = notes[a - start];
    if (note) line = `${line.padEnd(56)} @ ${note}`;
    return line;
  });
}

// Index after a C function's last instruction: the first return (bx lr,
// pop {..pc}, a tail branch out) that no earlier branch jumps past.
function functionEnd(rows, lo, hi) {
  let pending = 0;
  for (let i = 0; i < rows.length; i++) {
    const [a, , ins] = rows[i];
    const t = /\b(?:b[a-z.]*|cbn?z [a-z0-9]+,)\s*0x([0-9a-f]+)/.exec(ins);
    if (t && !ins.startsWith('bl')) { const tgt = parseInt(t[1], 16); if (tgt >= lo && tgt < hi) pending = Math.max(pending, tgt); }
    const ret = ins.startsWith('bx lr') || (ins.startsWith('pop') && ins.includes('pc'))
      || (/^b(\.w)? 0x/.test(ins) && t && !(parseInt(t[1], 16) >= lo && parseInt(t[1], 16) < hi));
    if (ret && a >= pending) return i + 1;
  }
  return rows.length;
}

module.exports = { rename, body, annotate, formatRows, functionEnd, halfwords };

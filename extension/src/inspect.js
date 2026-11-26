// inspect.js - a word as written and as it is on the board: its source, its code read back through the console and decompiled,
// and the memory it occupies. No debugger needed.
'use strict';
const fs = require('fs');
const B = require('./board');
const T = require('./thumb');
const { rows: decode } = require('./thumbdis');
const { tokens } = require('./model');

const INFO = require('../data/builtins.json');
const INLINE = Object.keys(INFO).filter(n => INFO[n][3]);
const CODE_MAX = 1024;                    // bytes of a word read at most
const BUILTIN_MAX = 256;
const u32 = v => v >>> 0;

// The definition's text: the `\` comment block above it, then its lines up to
// the `;` that ends it (one line for VARIABLE, CONSTANT, CREATE).
function sourceOf(def) {
  let text;
  try { text = fs.readFileSync(def.path, 'latin1'); } catch { return null; }
  const ls = text.replace(/\r\n/g, '\n').split('\n');
  let first = def.line;
  while (first > 0 && /^\s*\\\s/.test(ls[first - 1]) && !/^\s*\\\s+INCLUDE\b/.test(ls[first - 1])) first--;
  let last = def.line;
  const colon = tokens(ls[def.line]).some(t => t.text === ':');
  if (colon) {
    for (let i = def.line, open = false; i < ls.length; i++) {
      for (const t of tokens(ls[i])) {
        if (t.text === ':') open = true;
        else if (t.text === ';' && open) { last = i; i = ls.length; break; }
      }
    }
  }
  return { path: def.path, first, line: def.line, text: ls.slice(first, last + 1).join('\n') };
}

// The parts of the inline built-ins the compiler copies, read once per link.
async function inlineBodies(link) {
  if (!link.inlineBodies) {
    const addrs = await B.builtinAddrs(link);
    const out = {};
    for (const [a, n] of addrs) if (INLINE.includes(n)) out[n] = T.body(T.halfwords(await B.readMem(link, a, 24)));
    link.inlineBodies = out;
  }
  return link.inlineBodies;
}

// Register addresses to names (PERIPH.REG), for literals that are a register's address.
function regNames(ix) {
  const regs = new Map();
  for (const p of Object.values(ix.periphs)) for (const r of p.regs.values()) if (!regs.has(r.addr >>> 0)) regs.set(r.addr >>> 0, `${p.name}.${r.name}`);
  return regs;
}

// The compiler's note on an instruction, in short Forth terms.
function noteName(n, regs) {
  if (!n) return '';
  if (/copied inline/.test(n)) return n.replace(/\s+\(copied inline\)$/, '  (inline)');
  const lit = /^literal (-?\d+)/.exec(n);
  if (lit) { const v = parseInt(lit[1], 10) >>> 0; return v > 0xFFFF && regs.has(v) ? regs.get(v) : `literal ${lit[1] | 0}${v > 255 ? ' $' + v.toString(16).toUpperCase() : ''}`; }
  if (n.startsWith('enter')) return ': (enter)';
  if (n.startsWith('exit')) return '; (exit)';
  return n.split(':')[0];
}

// What we know of a word: {name, kind, stack, help, source, onBoard, why, header,
// lo, hi, rows: [{addr, hex, ins, forth, line}], dump: {addr, bytes, head}, calls}
// env: {link, index, board, lineMap}
async function inspect(name, env) {
  const ix = env.index;
  const c = ix.classify(name);
  const out = { name: name.toUpperCase(), kind: c.kind, stack: '', help: '', source: null, onBoard: false, why: '', rows: [], dump: null, calls: [] };
  if (c.kind === 'builtin') { out.name = c.name; out.stack = c.stack; out.help = c.help; out.group = c.group; out.inline = INLINE.includes(c.name); }
  else if (c.kind === 'word') { out.name = c.def.name; out.stack = c.def.stack; out.help = c.def.note; out.source = sourceOf(c.def); }
  const link = env.link;
  if (!link) { out.why = 'not connected: connect to read it from the board'; return out; }
  if (!link.interpreting) { out.why = 'the board is inside a definition: finish it (;) first'; return out; }
  const builtins = await B.builtinAddrs(link);
  const w = await B.userWords(link);
  if (link.native === undefined) {        // the word list's temporary word, still in memory: Thumb-2 starts push {lr}
    const fh = (w.here + 3) & ~3;
    link.native = (await B.readMem(link, (fh + 5 + '(FIDE-W)'.length + 3) & ~3, 2)).readUInt16LE(0) === 0xB500;
  }
  const token = !link.native;
  const alias = link.codeAlias || 0;
  const un = out.name.toUpperCase();
  const names = new Map(builtins);
  // your words, newest first: each one's code runs to the next newer header (or HERE)
  const mine = [];
  let newer = w.here;
  for (const [h, nm] of w.heads) { mine.push({ h, name: nm, lo: u32(((h + 5 + nm.length + 3) & ~3) + alias), hi: u32(newer + alias) }); newer = h; }
  for (const m of mine) names.set(m.lo, m.name);
  const m = mine.find(x => x.name.toUpperCase() === un);
  let code, lo, hi;
  if (m) {
    out.onBoard = true; out.kind = 'word';
    out.older = mine.filter(x => x.name.toUpperCase() === un).length - 1;
    out.header = m.h; lo = m.lo; hi = Math.min(m.hi, m.lo + CODE_MAX);
    const mem = await B.readMem(link, m.h, hi - alias - m.h);
    out.dump = { addr: m.h, bytes: mem, head: 5 + m.name.length };
    code = mem.subarray(lo - alias - m.h);
  } else {
    const at = [...builtins].find(([, nm]) => nm.toUpperCase() === un);
    if (!at) { out.why = c.kind === 'word' ? 'not on the board: send its file first' : 'no such word on the board'; return out; }
    out.onBoard = true; out.kind = 'builtin';
    lo = at[0];
    const later = [...builtins.keys()].filter(a => a > lo);
    hi = Math.min(later.length ? Math.min(...later) : lo + BUILTIN_MAX, lo + BUILTIN_MAX);
    code = await B.readMem(link, lo, hi - lo);
    if (!token) {
      const r = decode(code, lo);
      const n = T.functionEnd(r, lo, hi);
      if (r.length && n < r.length) { hi = r[n][0]; code = code.subarray(0, hi - lo); }
    }
    out.dump = { addr: lo, bytes: code, head: 0 };
  }
  out.lo = lo; out.hi = hi;
  if (token) { out.why = 'the host build runs token code, not Thumb-2: the memory is shown, not decompiled'; return out; }
  let rows = decode(code, lo);
  if (out.kind === 'word' && rows.length > 1) {          // the 2 bytes after the final pop {pc} pad to the next header
    const [a, , ins] = rows[rows.length - 2];
    if (/^pop/.test(ins) && ins.includes('pc') && rows[rows.length - 1][0] + 2 === lo + code.length) rows = rows.slice(0, -1);
    void a;
  }
  const notes = out.kind === 'word' ? T.annotate(code, await inlineBodies(link), lo) : {};
  const regs = regNames(ix);
  const short = n => noteName(n, regs);
  const map = env.lineMap || [];
  const calls = new Set();
  out.rows = rows.map(([a, hx, ins]) => {
    const t = /\bbl\s+0x([0-9a-f]+)/.exec(ins);
    const called = t ? names.get(parseInt(t[1], 16)) : null;
    if (called) calls.add(called);
    const src = map.find(e => u32(e.lo + alias) <= a && a < u32(e.hi + alias));
    return { addr: a, hex: hx, ins: T.rename(ins), forth: called || short(notes[a - lo]), line: src ? src.no : null };
  });
  out.calls = [...calls];
  return out;
}

module.exports = { inspect, sourceOf, inlineBodies, regNames, noteName };

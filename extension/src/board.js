// board.js - what we do with a link: send files, read the word list and the stack
// (port of ide/fide/source.py expand and ide/fide/board.py).
'use strict';
const fs = require('fs');
const path = require('path');
const { INCLUDE_RE, tokens } = require('./model');
const A = require('./thumb2asm');
const D = require('./thumbdis');
const { LINE_MAX, Stopped } = require('./link');

const INCLUDE_ANY = /^\s*\\\s+INCLUDE\b/;

class SourceError extends Error {
  constructor(file, line, msg) { super(`${file}:${line}: ${msg}`); this.file = file; this.line = line; this.msg = msg; }
}

function findInclude(name, from, roots) {
  for (const d of [path.dirname(path.resolve(from)), ...roots.map(r => path.resolve(r))]) {
    const p = path.normalize(path.join(d, name));
    try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Lines to send, in order: [{file, no, text}]; no from 1. `\ INCLUDE path` pulls in
// another file once; an include found in a skip folder (the board's register
// table) is left out and listed in ctx.skipped. Blank and comment-only lines are not sent.
// text: the file's contents if already in memory (an editor's unsaved copy).
function expand(file, roots = [], text = null, skip = [], ctx = null) {
  ctx = ctx || { stack: [], seen: new Set(), skipped: [], files: [] };
  file = path.resolve(file);
  if (ctx.stack.includes(file)) {
    const chain = [...ctx.stack, file].map(p => path.basename(p)).join(' -> ');
    throw new SourceError(ctx.stack[ctx.stack.length - 1], 0, `include loop: ${chain}`);
  }
  if (ctx.seen.has(file)) return [];
  ctx.seen.add(file);
  if (text === null) text = fs.readFileSync(file, 'latin1');
  ctx.stack.push(file);
  const out = [];
  const count = { file, lines: 0 };
  ctx.files.push(count);
  text.replace(/\r\n/g, '\n').split('\n').forEach((raw, i) => {
    const no = i + 1;
    const m = INCLUDE_RE.exec(raw);
    if (m) {
      const inc = findInclude(m[1], file, roots);
      if (!inc) throw new SourceError(file, no, `include file not found: ${m[1]}`);
      if (skip.some(d => same(path.dirname(inc), path.resolve(d)))) {
        if (!ctx.skipped.includes(inc)) ctx.skipped.push(inc);
        return;
      }
      try {
        out.push(...expand(inc, roots, null, skip, ctx));
      } catch (e) {
        if (e instanceof SourceError && e.line === 0) throw new SourceError(file, no, e.msg);   // the loop: report it here
        throw e;
      }
      return;
    }
    if (INCLUDE_ANY.test(raw)) throw new SourceError(file, no, 'include line not understood: \\ INCLUDE path  [\\ comment]');
    const s = raw.replace(/\t/g, ' ').replace(/\s+$/, '');
    const t = s.trim();
    if (!t || t === '\\' || t.startsWith('\\ ')) return;
    out.push({ file, no, text: s });
    count.lines++;
  });
  ctx.stack.pop();
  return out;
}

const THROW = {
  '-1': 'ABORT', '-2': 'ABORT"', '-3': 'stack overflow', '-4': 'stack underflow',
  '-8': 'dictionary overflow', '-13': 'undefined word', '-14': 'compile-only word',
  '-17': 'pictured output overflow', '-18': 'line too long', '-19': 'name too long',
  '-10': 'division by zero', '-24': 'invalid number',
};
function throwText(code) { return THROW[code] || 'error'; }

// HERE as the board has it, read in interpret or compile state alike (inside a
// definition it is where the next code goes). Nothing is left on the stack.
async function hereNow(link) {
  const line = link.interpreting ? 'BASE @ HEX HERE U. BASE !' : '[ BASE @ HEX HERE U. BASE ! ]';
  const r = await link.exchange(line, 15000);
  if (r.error !== null) throw new Error(`reading HERE: ${r.text}`);
  return parseInt(r.text.trim().split(/\s+/).pop(), 16);
}

// Send lines one at a time; stop at the first error, or when stop.stopped is set.
// onLine(index, line, reply) after each. map: an array that gets {file, no, col,
// end, lo, hi} for the code each word compiled (the addresses as stored), so the
// debugger can show and step the word that is running. Inside a definition each
// word is sent on its own with HERE read after it; elsewhere a line goes whole.
const PROBE = 'BASE @ HEX HERE U. BASE !';
const TAKES_NEXT = new Set([':', 'CHAR', '[CHAR]', "[']", "'", 'POSTPONE', '[COMPILE]', 'TO', 'IS', 'VARIABLE', 'CONSTANT', 'CREATE', 'VALUE']);

// A line cut into pieces to send: [{text, col, end, compiling}] where compiling is the
// state after the piece. One piece (the whole line) when nothing in it is compiled.
function pieces(text, compiling) {
  const ts = tokens(text);
  const whole = [{ text, col: 0, end: text.length, compiling: null }];
  if (!compiling && !ts.some(t => t.text === ':' || t.text.toUpperCase() === ':NONAME')) return whole;
  const out = [];
  let i = 0, state = compiling;
  while (i < ts.length) {
    const first = i;
    if (state) {                                       // one word (with the name it parses)
      const u = ts[i].text.toUpperCase();
      i += TAKES_NEXT.has(u) && i + 1 < ts.length ? 2 : 1;
      if (u === ';' || u === '[') state = false;
    } else {                                           // interpreting: up to and including the : or ]
      while (i < ts.length) {
        const u = ts[i].text.toUpperCase();
        if (u === ':' || u === ':NONAME') { state = true; i += u === ':' && i + 1 < ts.length ? 2 : 1; break; }
        i++;
        if (u === ']') { state = true; break; }
      }
    }
    const from = first === 0 ? 0 : ts[first].start;
    let piece = text.slice(from, i < ts.length ? ts[i].start : text.length);
    if (i >= ts.length) {                              // a \ comment ends the line: not before the probe
      const tail = piece.slice(ts[i - 1].start - from + ts[i - 1].text.length);
      const c = /(^|\s)\\(\s|$)/.exec(tail);
      if (c) piece = piece.slice(0, ts[i - 1].start - from + ts[i - 1].text.length + c.index);
    }
    out.push({ text: piece.trimEnd(), col: ts[first].start, end: ts[i - 1].start + ts[i - 1].text.length, compiling: state });
  }
  if (!out.length) return whole;
  for (const p of out) if (p.text.length + PROBE.length + 6 > LINE_MAX) return whole;
  return out;
}

// A CODE block in ARM syntax starting at lines[i]: {end} (the END-CODE line's index,
// -1 if there is none), or null (not one, or postfix: the board's assembler takes it).
function armBlock(lines, i) {
  const ln = lines[i];
  const m = /^\s*CODE\s+(\S+)\s*(\([^)]*\))?/i.exec(ln.text);
  if (!m || A.stripComment(ln.text.slice(m[0].length)).trim()) return null;
  let j = i + 1;
  for (; j < lines.length && lines[j].file === ln.file && !/^\s*END-CODE\b/i.test(lines[j].text); j++)
    if (/,$/.test(A.stripComment(lines[j].text).trim())) return null;
  return { name: m[1], end: j < lines.length && lines[j].file === ln.file ? j : -1 };
}

// Assemble a block and build the word from its halfwords: values of constants and
// the words it calls are read from the board first. -> {error: {line, code, text}} | {}
async function sendCode(link, lines, i, blk, { timeout, stop, map, asm = {} }) {
  const head = lines[i], body = lines.slice(i + 1, blk.end);
  if (blk.end < 0) return { error: { line: head, code: 'asm', text: `CODE ${blk.name} has no END-CODE` } };
  if (!link.interpreting) return { error: { line: head, code: 'asm', text: 'CODE inside an open definition' } };
  const at = new Map(body.map((l, k) => [k, l]));
  const rows = body.map((l, k) => ({ text: l.text, no: k }));
  const ask = async expr => {
    const r = await link.exchange(`BASE @ HEX ${expr} U. BASE !`, timeout, stop);
    return r.error === null ? parseInt(r.text.trim().split(/\s+/).pop(), 16) | 0 : null;
  };
  // the board's builtins tell an ARMv6-M board (call_bi) from a Thumb-2 one; read once per link
  if (!link.biAddrs) try { await builtinAddrs(link); } catch (e) {
    if (!(e instanceof TooDeep)) throw e;
    return { error: { line: head, code: 'asm', text: `CODE needs the board's builtins, and the stack is too deep to read them (${e.message}); clear it first` } };
  }
  const fromBoard = new Set(), calls = new Set();
  const consts = n => { const v = asm.consts ? asm.consts(n) : null; if (v !== null && v !== undefined) return v; if (asm.isConstant && asm.isConstant(n)) { fromBoard.add(n); return 0; } return null; };
  let r = A.assemble(rows, { ...farOpts(new Map()), consts, word: n => { calls.add(n); return undefined; } });
  if (r.errors.length) return { error: { line: at.get(r.errors[0].no), code: 'asm', text: r.errors[0].message } };
  const vals = new Map(), xts = new Map();
  for (const n of fromBoard) vals.set(n, await ask(n));
  for (const n of calls) xts.set(n, await ask(`' ${n}`));
  let x = await link.exchange(`: ${blk.name} [ -2 ALLOT`, timeout, stop);
  if (x.error !== null) return { error: { line: head, code: x.error, text: x.text } };
  const base = await hereNow(link);
  r = A.assemble(rows, { ...farOpts(xts), base, consts: n => (vals.has(n) ? vals.get(n) : consts(n)), word: n => xts.get(n) ?? null });
  const lines2 = r.errors.length ? [] : A.forthLines(blk.name, r.code).slice(1, -1);
  for (const t of lines2) {
    x = await link.exchange(t, timeout, stop);
    if (x.error !== null) break;
  }
  const end = await link.exchange('] ; -2 ALLOT', timeout, stop);
  if (r.errors.length) return { error: { line: at.get(r.errors[0].no), code: 'asm', text: r.errors[0].message } };
  if (x.error !== null) return { error: { line: head, code: x.error, text: x.text } };
  if (end.error !== null) return { error: { line: head, code: end.error, text: end.text } };
  if (map) for (const row of r.rows) { const l = at.get(row.no); map.push({ file: l.file, no: l.no, lo: base + row.off, hi: base + row.off + row.size }); }
  return {};
}

async function sendLines(link, lines, { onLine = null, stop = null, timeout = null, map = null, byWord = () => true, asm = {} } = {}) {
  const res = { total: lines.length, sent: 0, good: 0, error: null, stopped: false };
  let here = map ? await hereNow(link) : 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (stop && stop.stopped) { res.stopped = true; break; }
    const blk = armBlock(lines, i);
    if (blk) {                                         // ARM syntax: assembled here, sent as halfwords
      let out;
      try { out = await sendCode(link, lines, i, blk, { timeout, stop, map, asm }); } catch (e) { if (e instanceof Stopped) { res.stopped = true; break; } throw e; }
      const last = blk.end < 0 ? lines.length - 1 : blk.end;
      for (let k = i; k <= last && !out.error; k++) { res.sent++; res.good++; if (onLine) onLine(k, lines[k], { error: null, text: '' }); }
      if (out.error) { res.sent++; if (onLine) onLine(i, out.error.line, { error: out.error.code, text: '' }); res.error = out.error; break; }
      if (map) here = await hereNow(link);
      i = last;
      continue;
    }
    if (ln.text.length > LINE_MAX) { res.error = { line: ln, code: -18, text: `line longer than ${LINE_MAX} characters` }; break; }
    const ps = map && byWord(ln) ? pieces(ln.text, !link.interpreting) : [{ text: ln.text, compiling: null }];
    let r, texts = [];
    try {
      for (const p of ps) {
        if (p.compiling === null) {
          r = await link.exchange(p.text, timeout, stop);
          texts.push(r.text);
          if (r.error !== null || !map) break;
          const h = await hereNow(link);
          if (h !== here) map.push({ file: ln.file, no: ln.no, lo: here, hi: h });
          here = h;
          continue;
        }
        r = await link.exchange(`${p.text} ${p.compiling ? `[ ${PROBE} ]` : PROBE}`, timeout, stop);
        if (r.error !== null) { texts.push(r.text); break; }
        const said = r.text.trim().split(/\s+/);
        const h = parseInt(said.pop(), 16);
        texts.push(said.join(' '));
        if (h !== here) map.push({ file: ln.file, no: ln.no, col: p.col, end: p.end, lo: here, hi: h });
        here = h;
      }
    } catch (e) {
      if (e instanceof Stopped) { res.stopped = true; break; }
      throw e;
    }
    r = { ...r, text: texts.filter(t => t && t.trim()).join(' ') };
    res.sent++;
    if (onLine) onLine(i, ln, r);
    if (r.error !== null) { res.error = { line: ln, code: r.error, text: r.text }; break; }
    res.good++;
  }
  return res;
}

// ---- reading the board ----
// The word list needs a temporary word, compiled at HERE. Before it is defined we
// note BASE, HERE, LATEST and the depth (snapshot), check there is room in the
// dictionary and on the stack, and afterwards put HERE, LATEST and BASE back
// (restore), even after an error. The stack itself is read without any temporary word.

class Compiling extends Error { constructor() { super('a definition is open'); } }
class TooDeep extends Error {}
class DictFull extends Error {}

const TEMP_ROOM = 640;      // bytes the temporary words may take
const DEPTH_MAX = 52;       // deepest stack a temporary definition is compiled over
const HOST_END = 1 << 20;   // the host build's dictionary ends at its 1 MB memory
const DICT_GUARD = 256;     // the kernel keeps the dictionary's last 256 B as a margin (A10)

async function x(link, line, timeout = 15000) {
  const r = await link.exchange(line, timeout);
  if (r.error !== null) throw new Error(`${line.split(/\s+/).slice(0, 3).join(' ')}...: ${r.text}`);
  return r.text;
}

// BASE, HERE, STATE's address, depth and the dictionary's end, as the board has them.
async function snapshot(link) {
  if (!link.interpreting) throw new Compiling();
  // The kernel holds 63 items. Nothing reads the depth without pushing a cell,
  // so on a full stack DEPTH overflows; either error clears the stack and
  // resets BASE. So from a depth of 50 last time, take the top item off first,
  // print it, and put it back.
  let top = null;
  if ((link.depthSeen || 0) >= 50) {
    const r = await link.exchange('.', 15000);
    if (r.error === -4) await x(link, `#${link.baseSeen || 10} BASE !`);
    else if (r.error !== null) throw new Error(`reading the stack: ${r.text}`);
    else top = r.text.trim().split(/\s+/).pop();
  }
  const t = (await x(link, 'BASE @ 1- . HERE U. STATE U. DEPTH .')).trim().split(/\s+/);
  const base = parseInt(t[0], 36) + 1;           // `BASE @ 1- .` prints the base's largest digit
  const [here, state, depth0] = t.slice(1, 4).map(v => parseInt(v, base));
  let depth = depth0;
  if (top !== null) { await x(link, `#${parseInt(top, base)}`); depth++; }
  link.baseSeen = base; link.depthSeen = depth;
  // On every target the kernel's variables (STATE's block) follow the
  // dictionary, so STATE's address bounds it. The host build keeps them below.
  const end = (state > here ? state : HOST_END) - DICT_GUARD;
  return { base, here, state, depth, end, latest: null };
}

async function restore(link, s) {
  await x(link, `#${s.here} STATE #24 + !  #${s.latest} STATE #28 + !  #${s.base} BASE !`);
}

async function temporaries(link, s, run) {
  if (s.depth > DEPTH_MAX) throw new TooDeep(`${s.depth} items on the stack`);
  if (s.end - s.here < TEMP_ROOM) throw new DictFull(`${s.end - s.here} bytes left in the dictionary`);
  s.latest = parseInt((await x(link, 'STATE #28 + @ U.')).trim(), s.base);
  try { return await run(); } finally { await restore(link, s); }
}

const WORDS_DEFS = [
  ': (FIDE-W) STATE #28 + @ @ BEGIN ?DUP WHILE DUP #4 + C@ DUP $40 AND 0= IF',
  '$1F AND OVER U. OVER #5 + SWAP TYPE SPACE ELSE DROP THEN @ REPEAT ;',
];

// The library block's names: its name table, which the
// kernel keeps at STATE + 44 (struct sys's blktab; 0: no block). Records: len,
// name, 2 bytes of xt, flags; a 0 ends it. Read only on a board with a block
// area, and only when the pointer lies inside it: on firmware older than the
// blocks, STATE + 44 holds other data, and walking it can fault the board.
const blockArea = board => (require('../boards').get(board) || {}).blockArea;   // the board's file
const blockDef = ([lo, hi]) => [   // two lines: the board reads at most 128 characters a line
  `: (FIDE-B) STATE #44 + @ DUP $${lo.toString(16)} U< 0= OVER $${hi.toString(16)} U< AND IF`,
  'BEGIN DUP C@ ?DUP WHILE OVER 1+ OVER TYPE SPACE + #4 + REPEAT THEN DROP ;'];

// The words defined on the board, newest first, the library block's (board: its name,
// for the block area), and the dictionary's use.
// Throws Compiling, TooDeep or DictFull instead of risking the user's stack or dictionary.
function userWords(link, board) { return link.locked(() => userWordsHeld(link, board)); }   // nothing typed may land in the middle

async function userWordsHeld(link, board) {
  const s = await snapshot(link);
  let xt, block = [];
  const out = await temporaries(link, s, async () => {
    for (const l of WORDS_DEFS) await x(link, l);
    // the temporary's own xt gives where code runs relative to where it is stored
    xt = (await x(link, "BASE @ HEX ' (FIDE-W) U. BASE !")).trim().split(/\s+/)[0];
    const mine = await x(link, 'BASE @ HEX (FIDE-W) BASE !');
    if (blockArea(board)) {
      for (const l of blockDef(blockArea(board))) await x(link, l);
      block = (await x(link, '(FIDE-B)')).trim().split(/\s+/).filter(Boolean);
    }
    return mine;
  });
  const h = (s.here + 3) & ~3;                                       // (FIDE-W)'s header
  link.codeAlias = ((parseInt(xt, 16) & ~1) - ((h + 5 + '(FIDE-W)'.length + 3) & ~3)) | 0;
  link.stateAddr = s.state;
  const t = out.trim().split(/\s+/).filter(Boolean);
  const pairs = [];
  for (let i = 0; i + 1 < t.length; i += 2) pairs.push([parseInt(t[i], 16), t[i + 1]]);
  const first = pairs.length ? Math.min(...pairs.map(p => p[0])) : null;
  return { words: pairs.map(p => p[1]), heads: pairs, first, here: s.here, end: s.end, block };
}

// The cells at these addresses (any order, any gaps), read with @ through the
// console, 7 a line (under LINE_MAX, 128): an array of numbers.
async function readCells(link, addrs) {
  const cells = [];
  for (let i = 0; i < addrs.length; i += 7) {
    const batch = addrs.slice(i, i + 7);
    const t = (await x(link, 'BASE @ HEX ' + batch.map(a => `${(a >>> 0).toString(16).toUpperCase()} @ U.`).join(' ') + ' BASE !')).trim().split(/\s+/);
    if (t.length < batch.length) throw new Error('memory could not be read back');
    cells.push(...t.slice(-batch.length).map(v => parseInt(v, 16) >>> 0));
  }
  return cells;
}

// n bytes of the board's memory from addr (rounded out to whole cells), read
// with @ through the console: a Buffer. Nothing is left on the stack.
async function readMem(link, addr, n) {
  const lo = addr & ~3, hi = (addr + n + 3) & ~3;
  const addrs = [];
  for (let a = lo >>> 0; a < (hi >>> 0); a += 4) addrs.push(a >>> 0);
  const cells = await readCells(link, addrs);
  const buf = Buffer.alloc(cells.length * 4);
  cells.forEach((v, i) => buf.writeUInt32LE(v, 4 * i));
  return buf.subarray(addr - lo, addr - lo + n);
}

// The data stack, bottom first, as the board prints it in its BASE. No temporary
// word: the items are printed with `.` and typed back in as decimal literals.
function readStack(link) { return link.locked(() => readStackHeld(link)); }   // the stack is printed, then put back

async function readStackHeld(link) {
  const s = await snapshot(link);
  let items = [];
  if (s.depth) {
    const t = (await x(link, '. '.repeat(s.depth))).trim().split(/\s+/).slice(-s.depth);
    if (t.length !== s.depth) throw new Error('the stack could not be read back');
    items = t.reverse();
    let line = '';
    for (const v of items.map(v => parseInt(v, s.base))) {
      const w = `#${v}`;
      if (line.length + w.length + 1 > 120) { await x(link, line); line = ''; }
      line += w + ' ';
    }
    if (line) await x(link, line);
  }
  return { base: s.base, items, here: s.here, end: s.end };
}

// {code address: name} for the built-ins, asked once per link (the board's own
// kernel, so it always matches). No dictionary space is used.
const BI = require('../data/builtins.json');
const BUILTINS = Object.keys(BI);
// ARMv6-M boards call code in flash as bl call_bi, then the target's xt less
// KBASE: the decoder and the debugger are told where call_bi
// is and the board's KBASE; names: the builtins on the board.
function setFar(link, addrs) {
  const map = require('../boards').mapAt(link.stateAddr);
  if (!map || map.callBi === undefined || map.kbase === undefined) { D.setFar(null); return; }
  const at = new Set([...addrs].map(([, n]) => n));
  D.setFar({ callBi: map.callBi, kbase: map.kbase, names: BUILTINS.filter(n => at.has(n)) });
}
// for the assembler on such a board: arch, and bl to a word out of BL's reach
// (in flash, the code in RAM) through call_bi. xts: the board's ' WORD for
// each word called (a redefined builtin is in RAM, reached by BL).
function farOpts(xts) {
  const f = D.getFar();
  if (!f) return {};
  return { arch: 'v6m', far: n => {
    const xt = xts.get(n);
    if (xt === undefined || xt === null) return null;
    const d = (xt & ~1) - f.callBi, off = (xt | 1) - f.kbase;
    if (d >= -(1 << 24) + 8 && d < (1 << 24) - 8) return null;   // BL reaches it
    return off >= 0 && off <= 0xFFFF ? { callBi: f.callBi, off } : null;
  } };
}

async function builtinAddrs(link) {
  if (link.biAddrs) { setFar(link, link.biAddrs); return link.biAddrs; }
  const s = await snapshot(link);
  link.stateAddr = s.state;
  if (s.depth > 60) throw new TooDeep(`${s.depth} items on the stack`);
  const out = new Map();
  let batch = [];
  // a word some boards take from a Forth file (SAVE, EMPTY) may be missing: FIND gives 0 for it
  const q = n => (BI[n][4] ? `BL WORD ${n} FIND 0<> AND U.` : `' ${n} U.`);
  const flush = async () => {
    if (!batch.length) return;
    const t = (await x(link, 'BASE @ HEX ' + batch.map(q).join(' ') + ' BASE !')).trim().split(/\s+/);
    batch.forEach((n, i) => { const a = (parseInt(t[i], 16) & ~1) >>> 0; if (a) out.set(a, n); });
    batch = [];
  };
  for (const n of BUILTINS) {
    if ('BASE @ HEX  BASE !'.length + batch.reduce((a, b) => a + q(b).length + 1, 0) + q(n).length + 1 > 120) await flush();
    batch.push(n);
  }
  await flush();
  link.biAddrs = out;
  setFar(link, out);
  return out;
}

module.exports = { armBlock, sendCode, pieces,
  builtinAddrs, BUILTINS, hereNow, readMem, readCells,
  expand, findInclude, SourceError, sendLines, throwText, snapshot, userWords, readStack,
  Compiling, TooDeep, DictFull,
};

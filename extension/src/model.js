// model.js - what a Forth token is, with no VS Code in it (tested by test/model.test.js).
// Lookup order is the kernel's (src/interp.c interpret()): the dictionary
// (builtins, then your words), then the register table (a register, a
// peripheral's base, or INSTANCE.WORD calling TYPE.WORD), then a number.
'use strict';

const INCLUDE_RE = /^\s*\\\s+INCLUDE\s+(\S+)\s*(?:\\(?:\s.*)?)?$/;   // as ide/fide/source.py
const STRINGS = new Set(['."', 'S"', 'ABORT"', 'C"']);
const DEFINERS = new Set(['VARIABLE', 'CONSTANT', 'CREATE']);
const A = require('./thumb2asm');
const D = require('./thumbdis');
const NAME_NEXT = new Set(["'", "[']", 'POSTPONE']);                  // next token is a word's name
const CHAR_NEXT = new Set(['CHAR', '[CHAR]']);                         // next token is a character

// Tokens of one line, without comments and string bodies: [{text, start}].
function tokens(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === ' ' || line[i] === '\t')) i++;
    let j = i;
    while (j < n && line[j] !== ' ' && line[j] !== '\t') j++;
    const tok = line.slice(i, j);
    if (!tok) break;
    const u = tok.toUpperCase();
    if (tok === '\\') break;
    if (tok === '(' || tok === '.(') {
      const k = line.indexOf(')', j);
      i = k < 0 ? n : k + 1;
      continue;
    }
    if (STRINGS.has(u)) {
      const k = line.indexOf('"', j + 1);
      i = k < 0 ? n : k + 1;
      continue;
    }
    out.push({ text: tok, start: i });
    i = j;
  }
  return out;
}

// A path in a folder for a chip other than chip (lib/<chip>, examples/<chip>).
// Nothing is "other" while the chip isn't known.
const CHIPDIRS = new Set(require('../boards').chips);
function otherChip(p, chip) {
  return !!chip && p.split(/[\\/]/).some(s => { s = s.toLowerCase(); return CHIPDIRS.has(s) && s !== chip; });
}

function lines(text) { return text.replace(/\r\n/g, '\n').split('\n'); }

// The words a file defines: {NAME: {name, stack, note, path, line, col}}; line from 0.
// `: NAME ( stack )`, and VARIABLE, CONSTANT, CREATE outside a definition. The note
// is the block of `\` lines just above, else a `\` comment ending the line.
// A word whose definition uses :, CREATE, VARIABLE, CONSTANT or another such word
// is a defining word too (CODE, reg:): `CODE NAME ( stack )` defines NAME. Those
// this file makes are in out.definers; known: those other files make.
function definitions(text, path, known) {
  const out = {};
  const definers = new Set();
  const isDefiner = u => DEFINERS.has(u) || u === 'CODE' || definers.has(u) || (known ? known.has(u) : false);
  const ls = lines(text);
  let compiling = false, current = null, quoted = false;
  ls.forEach((raw, i) => {
    const toks = tokens(raw);
    const found = [];
    toks.forEach((t, k) => {
      const u = t.text.toUpperCase();
      if (quoted) { quoted = false; return; }
      if (compiling && NAME_NEXT.has(u)) {          // POSTPONE ; is not the end
        const next = toks[k + 1];
        if (current && next && (next.text === ':' || isDefiner(next.text.toUpperCase()))) definers.add(current);
        quoted = true; return;
      }
      if (u === ':' && !compiling && k + 1 < toks.length) {
        const nm = toks[k + 1];
        const m = /^\s*(\([^)]*\))/.exec(raw.slice(nm.start + nm.text.length));
        found.push([nm, m ? m[1] : '']);
        compiling = true; current = nm.text.toUpperCase();
      } else if (u === ';') {
        compiling = false; current = null;
      } else if (compiling) {
        if (current && (u === ':' || isDefiner(u))) definers.add(current);
      } else if (isDefiner(u) && k + 1 < toks.length) {
        const nm = toks[k + 1];
        let stack = u;
        if (!DEFINERS.has(u)) {
          const m = /^\s*(\([^)]*\))/.exec(raw.slice(nm.start + nm.text.length));
          if (m) stack = m[1];
        }
        found.push([nm, stack]);
      }
    });
    if (!found.length) return;
    const above = [];
    for (let j = i - 1; j >= 0 && ls[j].trimStart().startsWith('\\ ') && !/^\s*\\\s+INCLUDE\b/.test(ls[j]); j--)
      above.unshift(ls[j].trim().slice(2));
    const cut = raw.indexOf(' \\ ');
    const trailing = cut >= 0 ? raw.slice(cut + 3).trim() : '';
    for (const [nm, stack] of found) {
      let note = above.join(' ') || trailing;
      if (note.toUpperCase().startsWith(nm.text.toUpperCase() + ' '))
        note = note.replace(/^\S+\s+(\([^)]*\)\s*)?/, '');
      out[nm.text.toUpperCase()] = { name: nm.text, stack, note, path, line: i, col: nm.start };
    }
  });
  Object.defineProperty(out, 'definers', { value: definers, enumerable: false });
  return out;
}

// `\ INCLUDE path` lines: [{name, line}]
function includes(text) {
  const out = [];
  lines(text).forEach((l, i) => { const m = INCLUDE_RE.exec(l); if (m) out.push({ name: m[1], line: i }); });
  return out;
}

function digit(c) {
  const d = parseInt(c, 36);
  return Number.isNaN(d) ? 99 : d;
}

// The kernel's number(): 'c', #dec $hex %bin prefixes, a leading -. null if not a number.
function number(tok, base) {
  if (tok.length === 3 && tok[0] === "'" && tok[2] === "'") return tok.charCodeAt(1);
  let s = tok, b = base;
  if (s[0] === '#') { b = 10; s = s.slice(1); }
  else if (s[0] === '$') { b = 16; s = s.slice(1); }
  else if (s[0] === '%') { b = 2; s = s.slice(1); }
  const neg = s.length > 1 && s[0] === '-';
  if (neg) s = s.slice(1);
  if (!s.length) return null;
  let r = 0n;
  for (const c of s) { const d = digit(c); if (d >= b) return null; r = r * BigInt(b) + BigInt(d); }
  r &= 0xFFFFFFFFn;
  if (neg) r = (-r) & 0xFFFFFFFFn;
  return Number(r);
}

class Index {
  // builtins: {NAME: [stack, help, group]}; chip: {PERIPH: [base, [[MEMBER, addr, desc]]]}
  constructor(builtins, chip) {
    this.builtins = builtins || {};
    this.periphs = {};                              // NAME: {name, base, regs: Map MEMBER -> {name, addr, desc}}
    for (const [p, [base, regs, type]] of Object.entries(chip || {})) {
      const m = new Map();
      for (const [name, addr, desc] of regs) m.set(name.toUpperCase(), { name, addr, desc });
      // type: the register table's (GPIOA is GPIO, UART1 is UART)
      this.periphs[p.toUpperCase()] = { name: p, base, regs: m, type: (type || p.replace(/[0-9]+$/, '')).toUpperCase() };
    }
    this.files = new Map();                         // path -> {NAME: def}
    this.texts = new Map();
  }

  // Defining words the files make (CODE, reg:): a file that uses one is read again
  // when one appears or goes.
  definers() {
    const s = new Set();
    for (const d of this.files.values()) for (const x of d.definers || []) s.add(x);
    return s;
  }
  setFile(path, text) {
    const key = () => [...this.definers()].sort().join(' ');
    const before = key();
    this.texts.set(path, text);
    this.files.set(path, definitions(text, path, this.definers()));
    if (key() !== before) for (const [p, t] of this.texts) this.files.set(p, definitions(t, p, this.definers()));
  }
  removeFile(path) { this.files.delete(path); this.texts.delete(path); }

  word(name) {
    const u = name.toUpperCase();
    // the files sent to the board first, newest first: their words are the ones on it
    for (const p of this.prefer ? this.prefer() : [])
      for (const [k, defs] of this.files) if (defs[u] && k.toLowerCase() === p.toLowerCase()) return defs[u];
    // then files not in another chip's folder, then any
    for (const [k, defs] of this.files) if (defs[u] && !otherChip(k, this.chip)) return defs[u];
    for (const defs of this.files.values()) if (defs[u]) return defs[u];
    return null;
  }

  allWords() {
    const out = new Map();
    for (const defs of this.files.values()) for (const [k, d] of Object.entries(defs)) if (!out.has(k)) out.set(k, d);
    return out;
  }

  // What the board makes of tok: {kind, ...}. kind: builtin word register periph instance number unknown
  classify(tok, base = 10) {
    const u = tok.toUpperCase();
    if (this.builtins[u]) { const [stack, help, group] = this.builtins[u]; return { kind: 'builtin', name: u, stack, help, group }; }
    const w = this.word(u);
    if (w) return { kind: 'word', def: w };
    if (this.periphs[u]) return { kind: 'periph', periph: this.periphs[u] };
    const dot = u.indexOf('.');
    if (dot > 0) {
      const p = this.periphs[u.slice(0, dot)];
      if (p) {
        const member = u.slice(dot + 1);
        const r = p.regs.get(member);
        if (r) return { kind: 'register', periph: p, reg: r };
        const type = p.type;
        const tw = this.word(type + '.' + member);
        if (tw) return { kind: 'instance', periph: p, type, def: tw, stack: dropBase(tw.stack) };
      }
    }
    const v = number(tok, base);
    if (v !== null) return { kind: 'number', value: v };
    return { kind: 'unknown' };
  }

  // Completion candidates for a partly typed token: [{label, kind, detail, doc}]
  complete(prefix) {
    const u = prefix.toUpperCase();
    const out = [];
    const dot = u.lastIndexOf('.');
    const p = dot > 0 ? this.periphs[u.slice(0, dot)] : null;
    if (p) {
      const head = p.name + '.';
      const type = p.type + '.';
      for (const [k, d] of this.allWords())
        if (k.startsWith(type) && /\bbase\s+--/.test(d.stack)) out.push({ label: head + k.slice(type.length), kind: 'instance', detail: dropBase(d.stack), doc: d.note, def: d });
      for (const r of p.regs.values())
        out.push({ label: head + r.name, kind: 'register', detail: hex(r.addr), doc: r.desc });
      return out;
    }
    for (const [k, [stack, help]] of Object.entries(this.builtins)) out.push({ label: k, kind: 'builtin', detail: stack, doc: help });
    for (const [, d] of this.allWords()) out.push({ label: d.name, kind: 'word', detail: d.stack, doc: d.note, def: d });
    for (const q of Object.values(this.periphs)) out.push({ label: q.name, kind: 'periph', detail: hex(q.base), doc: `${q.regs.size} registers` });
    return out;
  }

  // Problems in one file: [{line, start, end, message}]. A word is reported if the board
  // would not know it, or if this file defines it only further down.
  check(text) {
    const out = [];
    const known = this.definers();
    const here = definitions(text, '', known);
    for (const d of here.definers) known.add(d);
    let base = 10, skip = null;
    const ls = lines(text), asm = new Set();
    for (const blk of A.blocks(ls)) {                  // CODE blocks in ARM syntax: the assembler checks them
      const end = blk.end < 0 ? ls.length : blk.end;
      for (let i = blk.start; i <= Math.min(end, ls.length - 1); i++) asm.add(i);   // CODE NAME, the lines, END-CODE
      if (blk.end < 0) out.push({ line: blk.start, start: 0, end: ls[blk.start].length, message: `CODE ${blk.name} has no END-CODE` });
      const r = A.assemble(ls.slice(blk.start + 1, end).map((t, k) => ({ text: t, no: blk.start + 1 + k })), {
        arch: D.getFar() ? 'v6m' : undefined,                 // an ARMv6-M board is connected
        far: n => (D.getFar() && D.getFar().names.includes(n.toUpperCase()) ? { callBi: 0, off: 0 } : null),
        consts: n => { const c = this.classify(n); return c.kind === 'register' ? c.reg.addr : c.kind === 'periph' ? c.periph.base : c.kind === 'word' && /CONSTANT/.test(c.def.stack) ? 0 : null; },
        word: n => { const c = this.classify(n); return c.kind === 'word' || c.kind === 'builtin' || here[n.toUpperCase()] ? undefined : null; },
      });
      for (const e of r.errors) {
        const t = ls[e.no], ind = t.length - t.trimStart().length;
        out.push({ line: e.no, start: ind, end: A.stripComment(t).trimEnd().length || t.length, message: e.message });
      }
    }
    ls.forEach((raw, i) => {
      if (asm.has(i)) return;
      for (const t of tokens(raw)) {
        const u = t.text.toUpperCase();
        if (skip === 'name' || skip === 'char') { skip = null; continue; }
        if (u === ':' || DEFINERS.has(u) || u === 'CODE' || known.has(u)) { skip = 'name'; continue; }
        if (CHAR_NEXT.has(u)) { skip = 'char'; continue; }
        if (u === 'HEX') base = 16; else if (u === 'DECIMAL') base = 10;
        const c = this.classify(t.text, base);
        const end = t.start + t.text.length;
        const d = here[u];
        if (d && (d.line > i || (d.line === i && d.col > t.start)) && c.kind !== 'builtin')
          out.push({ line: i, start: t.start, end, message: `${t.text} is used before its definition (line ${d.line + 1})` });
        else if (c.kind === 'unknown')
          out.push({ line: i, start: t.start, end, message: `${t.text} ? unknown word: not built in, defined, a register or a number` });
        if (NAME_NEXT.has(u)) skip = null;
      }
    });
    return out;
  }
}

function dropBase(stack) {                          // ( c base -- ) -> ( c -- ): an instance word supplies base
  return stack ? stack.replace(/\s+base(\s+--)/, '$1') : stack;
}

function hex(v) { return '$' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

module.exports = { tokens, definitions, includes, number, Index, dropBase, hex, INCLUDE_RE, otherChip };

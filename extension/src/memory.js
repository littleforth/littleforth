// memory.js - the Memory view: a map of the whole chip, then any
// range as Forth records, labelled cells, bytes or code. Cells that point at
// something known are links; the address box takes Forth names; the rows on
// screen refresh while the board is idle, changed cells flash, rows can be pinned
// and edited. Read through the console while the board runs, the probe while the
// debugger is paused, else the firmware file.
'use strict';
const path = require('path');
const B = require('./board');
const Img = require('./image');
const T = require('./thumb');
const I = require('./inspect');
const { rows: decode } = require('./thumbdis');
const { esc, nonce } = require('./views');
const MAPS = require('../boards').maps;

const u32 = v => v >>> 0;
const hex8 = v => u32(v).toString(16).toUpperCase().padStart(8, '0');
const hex = v => u32(v).toString(16).toUpperCase();
const CELLS = 128;            // bytes a page of cells (32 rows)
const BYTES = 256;            // bytes a page of bytes (16 rows)
const CODE = 128;             // bytes a page of code
const RECS = 40;              // words a page of the Forth lens
const LENS_FN = { forth: 'lensForth', cells: 'lensCells', bytes: 'lensBytes', code: 'lensCode' };

// ---- what memory holds (no board, no vscode: test/memory.test.js) ----

// The map of a board, as areas to draw: [{name, lo, hi, parts: [{lo, hi, name, gap}]}]
// (gaps: what the firmware doesn't use). Areas: Flash, RAM; Peripherals added.
function areas(board) {
  const m = MAPS[board];
  if (!m) return [];
  const regs = m.regions.map(([lo, hi, name]) => ({ lo, hi, name }));
  const area = (name, pick) => {
    const r = regs.filter(x => x.name.startsWith(pick)).sort((a, b) => a.lo - b.lo);
    if (!r.length) return null;
    // merge the regions that share a name (the receive buffer is three)
    const parts = [];
    for (const x of r) {
      const last = parts[parts.length - 1];
      if (last && last.name === x.name && last.hi >= x.lo - 1) { last.hi = Math.max(last.hi, x.hi); continue; }
      if (last && x.lo > last.hi) parts.push({ lo: last.hi, hi: x.lo, name: 'not used by the firmware', gap: true });
      parts.push({ ...x });
    }
    return { name, lo: parts[0].lo, hi: parts[parts.length - 1].hi, parts };
  };
  const out = [area('Flash', 'flash'), area('RAM', 'RAM')].filter(Boolean);
  out.push({ name: 'Peripherals', lo: 0x40000000, hi: 0x60000000, parts: [{ lo: 0x40000000, hi: 0x60000000, name: 'peripherals: the chip\'s registers' }] });
  return out;
}

// What region of the map an address is in: its name, or ''.
function regionOf(board, a) {
  const m = MAPS[board];
  a = u32(a);
  const r = m && m.regions.find(([lo, hi]) => lo <= a && a < hi);
  if (r) return r[2];
  if (a >= 0x40000000 && a < 0x60000000) return 'peripherals';
  if (a >= 0xE0000000) return "the CPU's own registers";
  return '';
}

// The board's kernel variables (STATE, BASE, HERE ...): Map addr -> name
function kernelCells(board) {
  const m = MAPS[board];
  return new Map(m ? Object.entries(m.cells).map(([a, n]) => [Number(a), n]) : []);
}

// Your words, oldest first: {h, name, lo, hi} as stored (h: header, lo: code,
// hi: the next newer header or HERE).
function records(heads, here) {
  const out = [];
  let newer = here;
  for (const [h, name] of heads || []) { out.push({ h, name, lo: (h + 5 + name.length + 3) & ~3, hi: newer }); newer = h; }
  return out.reverse();
}

// A CREATEd word (VARIABLE, CREATE, BUFFER:) keeps its body's address in its code
// (cg_create): [where the pointer is, where the body is], from the code's start:
// Thumb-2 (cg_thumb.c), ARMv6-M (Thumb-1), the host build's tokens (cg_token.c).
// cellAt(addr) -> number|undefined. -> the body's address, or null.
const BODY_AT = [[12, 16], [16, 20], [4, 16]];
function bodyOf(rec, cellAt) {
  for (const [k, b] of BODY_AT) {
    if (rec.lo + b > rec.hi) continue;
    if (cellAt(rec.lo + k) === u32(rec.lo + b)) return u32(rec.lo + b);
  }
  return null;
}

// What a 32-bit value points at, if anything known: {text, to} (to: the address to
// open) or null. ctx: {recs (with body), alias, builtins: Map addr -> name,
// regs: Map addr -> name, kcells: Map addr -> name, here, board}
function labelOf(v, ctx) {
  v = u32(v);
  const alias = ctx.alias || 0;
  for (const r of ctx.recs || []) {
    if (r.body !== null && r.body !== undefined && v >= r.body && v < r.hi)
      return { text: v === r.body ? `address of ${r.name}` : `${r.name} body +${v - r.body}`, to: v };
    if (v === u32(r.h)) return { text: `header of ${r.name}`, to: v };
    const c = u32(v - alias);
    if (c >= r.lo && c < r.hi) {
      const off = (c & ~1) - r.lo;
      if (v & 1 && off > 0) return { text: `return address into ${r.name}+${off}`, to: c & ~1 };
      return { text: off ? `code of ${r.name}+${off}` : `code of ${r.name}`, to: c & ~1 };
    }
  }
  if (ctx.kcells && ctx.kcells.has(v)) return { text: ctx.kcells.get(v), to: v };
  if (ctx.regs && ctx.regs.has(v)) return { text: ctx.regs.get(v), to: v };
  if (ctx.builtins && ctx.builtins.size) {
    const a = v & ~1;
    if (ctx.builtins.has(a)) return { text: `kernel word ${ctx.builtins.get(a)}`, to: a };
    let best = null;
    for (const [b, n] of ctx.builtins) if (b < a && a - b < 256 && (!best || b > best[0])) best = [b, n];
    if (best && v & 1) return { text: `return address into ${best[1]}+${a - best[0]}`, to: a };
  }
  if (ctx.here !== null && ctx.here !== undefined && v === u32(ctx.here)) return { text: 'HERE', to: v };
  // a guess: a value inside a region of the firmware's own map (RAM, flash) may be a
  // pointer there. Not for peripherals or the CPU's registers (only exact register
  // names count there): any data word lands in those ranges.
  const m = MAPS[ctx.board];
  const r = m && v !== 0xFFFFFFFF && m.regions.find(([lo, hi]) => lo <= v && v < hi);
  if (r) return { text: `→ ${shortName(r[2])}`, to: v, weak: true };
  return null;
}

// Which word or kernel cell an address belongs to: a short note, or ''.
function ownerOf(a, ctx) {
  a = u32(a);
  for (const r of ctx.recs || []) {
    if (a < r.h || a >= r.hi) continue;
    if (a < r.lo) return `${r.name}: header`;
    if (r.body !== null && r.body !== undefined && a >= r.body) return `${r.name}: body`;
    return `${r.name}: code`;
  }
  if (ctx.kcells && ctx.kcells.has(a)) return ctx.kcells.get(a);
  if (ctx.here !== null && ctx.here !== undefined && a >= ctx.here && ctx.dict && a < ctx.dict.hi) return 'free';
  if (ctx.regs && ctx.regs.has(a)) return ctx.regs.get(a);
  const r = regionOf(ctx.board, a);
  return r ? shortName(r) : '';
}

// The address box: Forth, worked out here (nothing runs on the board). Numbers
// ($hex, 0xhex, decimal), names (name(tok) -> number|null, tick(tok) -> xt|null),
// ' NAME, + - * . RPN, like Forth: HERE 64 -.
function evaluate(text, name, tick) {
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  if (!toks.length) throw new Error('type an address, a word, a register or HERE');
  const st = [];
  const pop = () => { if (!st.length) throw new Error('stack underflow'); return st.pop(); };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '+') { const b = pop(); st.push(u32(pop() + b)); continue; }
    if (t === '-') { const b = pop(); st.push(u32(pop() - b)); continue; }
    if (t === '*') { const b = pop(); st.push(u32(Math.imul(pop(), b))); continue; }
    if (t === "'" || t === "[']") {
      const n = toks[++i];
      if (!n) throw new Error("' needs a word after it");
      const x = tick(n);
      if (x === null || x === undefined) throw new Error(`${n}: no such word`);
      st.push(u32(x)); continue;
    }
    const m = /^(-)?(?:\$|0x)([0-9a-f]+)$/i.exec(t);
    if (m) { st.push(u32((m[1] ? -1 : 1) * parseInt(m[2], 16))); continue; }
    if (/^-?\d+$/.test(t)) { st.push(u32(parseInt(t, 10))); continue; }
    const v = name(t);
    if (v === null || v === undefined) throw new Error(`${t}: not a word, register or number`);
    st.push(u32(v));
  }
  if (st.length !== 1) throw new Error(`that leaves ${st.length} values; the address box wants one`);
  return st[0];
}

// The dictionary's use: {used, size, words: [{name, bytes, copies}], spare: bytes in
// older copies of a word (free once FORGET exists)}
function budget(recs, size) {
  const by = new Map();
  let used = 0;
  for (const r of recs) {
    const n = r.hi - r.h;
    used += n;
    const k = r.name.toUpperCase();
    const e = by.get(k) || { name: r.name, bytes: 0, copies: 0, last: 0 };
    e.bytes += n; e.copies++; e.last = n;
    by.set(k, e);
  }
  const words = [...by.values()].sort((a, b) => b.bytes - a.bytes);
  const spare = words.reduce((s, w) => s + (w.copies > 1 ? w.bytes - w.last : 0), 0);
  return { used, size, words, spare };
}

// A firmware file's bytes for an address: the kernel copied into RAM at boot is
// read from where it sits in flash. -> read(addr, n): bytes, null where unknown
function imageReader(file, board) {
  const parts = Img.load(file);
  const m = MAPS[board];
  let copy = null;
  if (m) {
    const fl = m.regions.find(r => /^flash: .*copied into RAM/.test(r[2]));
    const ram = m.regions.find(r => /^RAM: .*copied from flash/.test(r[2]));
    if (fl && ram) copy = { lo: ram[0], hi: ram[1], from: fl[0] };
  }
  return (addr, n) => {
    if (copy && addr >= copy.lo && addr + n <= copy.hi) return Img.read(parts, copy.from + (addr - copy.lo), n);
    return Img.read(parts, addr, n);
  };
}

// ---- the panel ----

class Memory {
  // firmware(): the firmware file for the board, or null
  constructor(vscode, forth, lang, firmware) {
    this.vscode = vscode; this.forth = forth; this.lang = lang; this.firmware = firmware;
    this.session = null;                  // the debugger's (debugview.js): set by extension.js
    this.panel = null;
    this.lens = 'forth';
    this.addr = null;                     // the page's first address (cells, bytes, code) or the record shown (forth)
    this.target = null;                   // what was asked for: highlighted
    this.text = 'HERE';
    this.back = [];                       // earlier {lens, addr, target, text}
    this.pins = [];                       // addresses of pinned cells
    this.prev = new Map();                // addr -> value last shown: changes flash
    this.live = true;
    this.busy = false;
    this.timer = null;
    this.bodyCache = new Map();           // 'header:end' -> body address or null
    forth.on('state', s => { if (s === 'off' || s === 'lost') this.bodyCache.clear(); });
  }

  // what: a word, register, address or phrase (string), a Words item ({word}), a
  // debugger variable ({variable: {memoryReference}}), a number; none: HERE.
  async open(what) {
    const vscode = this.vscode;
    let text = null;
    if (typeof what === 'number') text = '$' + hex(what);
    else if (typeof what === 'string') text = what;
    else if (what && what.word) text = what.word;
    else if (what && what.variable && what.variable.memoryReference) text = '$' + String(what.variable.memoryReference).replace(/^0x/i, '');
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('forth.memory', 'Memory', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = null; if (this.timer) clearInterval(this.timer); this.timer = null; });
      this.panel.webview.onDidReceiveMessage(m => this.message(m).catch(e => this.post({ status: e.message, bad: true })));
      this.panel.webview.html = pageHtml();
      this.timer = setInterval(() => this.tick(), 1000);
      if (this.timer.unref) this.timer.unref();
    } else this.panel.reveal();
    if (text) await this.go(text).catch(e => this.post({ status: e.message, bad: true }));
    else await this.draw();
  }

  post(m) { if (this.panel) this.panel.webview.postMessage(m); }

  // The debugger stopped: what is on screen may have changed.
  async stopped() { if (this.panel) await this.draw().catch(() => {}); }

  // ---- where the bytes come from ----
  source() {
    const ad = this.session && this.session.debug;
    if (ad && ad.halted && ad.d) {
      return {
        kind: 'probe', status: `paused${ad.where ? ' at ' + ad.where : ''} · read through the probe`,
        read: (a, n) => ad.d.g.mem(a, n),
        write: (a, v) => { const b = Buffer.alloc(4); b.writeUInt32LE(u32(v)); return ad.d.g.writeMem(a, b); },
      };
    }
    const f = this.forth, link = f.link;
    if (link && f.state === 'ready' && link.interpreting) {
      return {
        kind: 'console', status: `${f.board || 'board'} running · read through the console`,
        read: (a, n) => link.locked(() => B.readMem(link, a, n)),
        cells: addrs => link.locked(() => B.readCells(link, addrs)),
        write: async (a, v) => { const r = await link.locked(() => link.exchange(`$${hex(v)} $${hex(a)} !`, 5000)); if (r.error !== null) throw new Error(`! ? ${B.throwText(r.error)}`); },
      };
    }
    if (link) return { kind: 'busy', status: f.state === 'busy' ? 'the board is running a word: read when it is back at the prompt' : 'the board is inside a definition: finish it (;) to read memory' };
    const fw = this.firmware && this.firmware();
    if (fw) {
      const rd = imageReader(fw, this.board());
      return { kind: 'image', status: `no board · from the firmware file ${path.basename(fw)}`, read: async (a, n) => rd(a, n) };
    }
    return null;
  }

  board() { return this.forth.board && this.forth.board !== 'Host build' ? this.forth.board : (this.lang.board ? this.lang.board() : this.forth.board); }

  // Cells at these addresses: numbers (undefined where unknown)
  async cells(src, addrs) {
    if (!addrs.length) return [];
    if (src.cells) return src.cells(addrs.map(u32));
    const out = [];
    for (const a of addrs) {
      const b = await src.read(a, 4);
      out.push(b.length < 4 || [...b].some(x => x === null) ? undefined : u32(b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24));
    }
    return out;
  }

  // What the labels need: {recs, alias, builtins, regs, kcells, here, board, dict}
  async context(src) {
    const f = this.forth, board = this.board();
    const ad = this.session && this.session.debug;
    const link = f.link;
    let builtins = new Map();
    if (link && link.biAddrs) builtins = link.biAddrs;
    else if (src && src.kind === 'console') { try { builtins = await link.locked(() => B.builtinAddrs(link)); } catch { /* without them */ } }
    else if (ad && ad.d && ad.d.builtins) builtins = ad.d.builtins;
    const alias = (link && link.codeAlias) || (ad && ad.d && ad.d.alias) || 0;
    const live = src && (src.kind === 'console' || src.kind === 'probe');
    const recs = live ? records(f.heads, f.here) : [];
    const m = MAPS[board];
    const dr = m && m.regions.find(r => r[2] === 'RAM: the dictionary');
    return {
      recs, alias, builtins, board, here: live ? f.here : null,
      regs: I.regNames(this.lang.index()), kcells: kernelCells(board),
      dict: dr ? { lo: dr[0], hi: dr[1] } : null,
    };
  }

  // Each record's body (CREATE, VARIABLE): read the cells that would point at it.
  async bodies(src, ctx, recs) {
    for (const r of recs) { const k = `${r.h}:${r.hi}`; if (this.bodyCache.has(k)) r.body = this.bodyCache.get(k); }
    const want = [];
    for (const r of recs) if (r.body === undefined) for (const [k, bo] of BODY_AT) if (r.lo + bo <= r.hi) want.push(r.lo + k);
    const vals = await this.cells(src, [...new Set(want)]);
    const at = new Map([...new Set(want)].map((a, i) => [a, vals[i]]));
    for (const r of recs) if (r.body === undefined) { r.body = bodyOf(r, a => at.get(a)); this.bodyCache.set(`${r.h}:${r.hi}`, r.body); }
    // the same records in the context, for labels
    for (const r of ctx.recs) { const s = recs.find(x => x.h === r.h); if (s) r.body = s.body; }
  }

  // ---- the address box ----
  resolve(text, ctx) {
    const ix = this.lang.index();
    const ad = this.session && this.session.debug;
    const mine = n => ctx.recs.slice().reverse().find(r => r.name.toUpperCase() === n.toUpperCase());
    const name = t => {
      const u = t.toUpperCase();
      if (u === 'HERE') return ctx.here !== null ? ctx.here : null;
      if (ad && ad.halted && ad.regs) {
        const r = { TOS: 'r6', PSP: 'r5', RSP: 'sp', PC: 'pc', SP: 'sp' }[u] || t.toLowerCase();
        if (r in ad.regs) return u32(ad.regs[r]);
      }
      const w = mine(t);
      if (w) return w.body !== null && w.body !== undefined ? w.body : w.h;      // what it gives: a VARIABLE its body
      for (const [a, n] of ctx.kcells) if (n.split(' ')[0].toUpperCase() === u) return a;
      for (const [a, n] of ctx.builtins) if (n.toUpperCase() === u) return a;
      const c = ix.classify(t, 10);
      if (c.kind === 'register') return u32(c.reg.addr);
      if (c.kind === 'periph') return u32(c.periph.base);
      return null;
    };
    const tick = t => {
      const w = mine(t);
      if (w) return u32(w.lo + ctx.alias);
      for (const [a, n] of ctx.builtins) if (n.toUpperCase() === t.toUpperCase()) return a;
      return null;
    };
    return evaluate(text, name, tick);
  }

  async go(text) {
    const src = this.source();
    const ctx = await this.context(src);
    if (src && src.kind !== 'image' && ctx.recs.length) await this.bodies(src, ctx, ctx.recs);
    const a = this.resolve(text, ctx);
    if (this.addr !== null) this.back.push({ lens: this.lens, addr: this.addr, target: this.target, text: this.text });
    if (this.back.length > 50) this.back.shift();
    this.text = text; this.target = a; this.recPage = 0;
    // a word's record: the Forth lens; a register or anything outside your words: cells
    const inDict = ctx.recs.some(r => a >= r.h && a < r.hi);
    const ix = this.lang.index().classify(text.trim(), 10);
    if (ix.kind === 'register' || ix.kind === 'periph') this.lens = 'cells';
    else if (this.lens === 'forth' && !inDict) this.lens = 'cells';
    this.addr = this.pageOf(a);
    await this.draw();
  }

  pageOf(a) {
    if (this.lens === 'code') return u32(a & ~1);
    if (this.lens === 'bytes') return u32(a & ~15);
    if (this.lens === 'cells') return u32(a & ~3);
    return u32(a);
  }

  async message(m) {
    if (m.go !== undefined) return this.go(m.go);
    if (m.lens) {
      this.lens = m.lens;
      if (this.addr !== null) this.addr = this.pageOf(this.target !== null ? this.target : this.addr);
      if (m.quiet) return;
      return this.draw();
    }
    if (m.page) {
      const step = { cells: CELLS, bytes: BYTES, code: CODE }[this.lens];
      if (step && this.addr !== null) this.addr = u32(this.addr + m.page * step);
      if (this.lens === 'forth') this.recPage = (this.recPage || 0) + m.page;
      return this.draw();
    }
    if (m.goto !== undefined) return this.go('$' + hex(m.goto));
    if (m.back) {
      const b = this.back.pop();
      if (b) Object.assign(this, b);
      return this.draw();
    }
    if (m.pin !== undefined) { if (!this.pins.includes(m.pin)) this.pins.push(m.pin); return this.draw(); }
    if (m.unpin !== undefined) { this.pins = this.pins.filter(a => a !== m.unpin); return this.draw(); }
    if (m.live !== undefined) { this.live = m.live; return this.draw(); }
    if (m.inspect) return this.vscode.commands.executeCommand('forth.inspect', m.inspect);
    if (m.edit !== undefined) {
      const v = evaluate(m.value, () => null, () => null);
      const src = this.source();
      if (!src || !src.write) throw new Error('nothing to write to: connect the board');
      await src.write(m.edit, v);
      return this.draw();
    }
    if (m.draw) return this.draw();
  }

  // every second: the rows on screen again, when the board is idle and the panel shown
  async tick() {
    if (!this.panel || !this.live || this.busy || this.editing || this.panel.visible === false) return;
    const src = this.source();
    if (!src || src.kind !== 'console') return;
    await this.draw({ quiet: true }).catch(() => {});
  }

  // ---- drawing ----
  async draw({ quiet = false } = {}) {
    if (!this.panel) return;
    // drawing already: draw again after it, and resolve when that one is done
    if (this.busy) { this.again = true; return this.waiting || (this.waiting = new Promise(res => { this.wake = res; })); }
    this.busy = true;
    try {
      const src = this.source();
      const board = this.board();
      const ctx = await this.context(src);
      const top = { map: mapHtml(board, ctx, this.target, this.forth), budget: budgetHtml(ctx, this.forth), back: this.back.length > 0, lens: this.lens, live: this.live, text: this.text };
      if (!src || src.kind === 'busy') {
        this.post({ ...top, status: src ? src.status : 'not connected, and no firmware file for this board: connect a board', bad: !src, ...(src ? {} : { main: '', pins: '' }) });
        return;
      }
      if (ctx.recs.length && src.kind !== 'image') await this.bodies(src, ctx, ctx.recs);
      if (this.addr === null) this.addr = this.pageOf(this.target === null ? (ctx.here !== null ? ctx.here : (ctx.recs[0] ? ctx.recs[0].h : 0x20000000)) : this.target);
      const seen = new Map();
      const main = await this[LENS_FN[this.lens]](src, ctx, seen);
      const pins = await this.pinsHtml(src, ctx, seen);
      this.prev = new Map([...this.prev, ...seen]);
      this.panel.title = `Memory · ${this.text}`;
      if (this.prev.size > 4000) this.prev = new Map(seen);
      this.post({ ...top, status: src.status, main, pins, quiet });
    } finally {
      this.busy = false;
      if (this.again) {
        const wake = this.wake;
        this.again = false; this.waiting = null; this.wake = null;
        setTimeout(() => this.draw().catch(() => {}).then(wake), 0);
      }
    }
  }

  changed(a, v, seen) {
    const was = this.prev.get(a);
    seen.set(a, v);
    return was !== undefined && v !== undefined && was !== v;
  }

  cellRow(a, v, ctx, seen, { pinned = false } = {}) {
    const lab = v === undefined ? null : labelOf(v, ctx);
    const own = ownerOf(a, ctx);
    const chg = this.changed(a, v, seen) ? ' chg' : '';
    const hit = this.target !== null && a === this.target ? ' hit' : '';
    const val = v === undefined ? '<span class="meta">--------</span>' : `$${hex8(v)}`;
    const dec = v === undefined ? '' : String(v | 0);
    const link = lab ? `<a class="${lab.weak ? 'weak' : ''}" data-goto="${lab.to}">${esc(lab.text)}</a>` : '';
    return `<tr class="${hit}"><td class="a"><a data-goto="${a}">${hex8(a)}</a></td><td class="v${chg}" data-edit="${a}" title="Double-click to change">${val}</td><td class="d">${dec}</td><td>${link}</td><td class="meta">${esc(own)}</td>`
      + `<td class="pin"><a data-${pinned ? 'unpin' : 'pin'}="${a}" title="${pinned ? 'Unpin' : 'Pin: keep this cell in view'}">${pinned ? '✕' : '📌'}</a></td></tr>`;
  }

  async pinsHtml(src, ctx, seen) {
    if (!this.pins.length) return '';
    const vals = await this.cells(src, this.pins);
    return `<h3>Pinned</h3><table>${this.pins.map((a, i) => this.cellRow(a, vals[i], ctx, seen, { pinned: true })).join('')}</table>`;
  }

  // Forth: the dictionary as records
  async lensForth(src, ctx, seen) {
    const recs = ctx.recs;
    if (!recs.length) return `<p class="meta">${src.kind === 'image' ? 'The firmware file has no words of yours: connect the board to see them.' : 'No words of yours on the board yet. Send a file or define one.'}</p>`;
    // the page holding the target, else the newest words
    let at = this.target === null ? -1 : recs.findIndex(r => this.target >= r.h && this.target < r.hi);
    if (at < 0) at = recs.length - 1;
    const base = Math.max(0, Math.min(recs.length - RECS, at - Math.floor(RECS / 2)));
    const first = Math.max(0, Math.min(recs.length - 1, base + (this.recPage || 0) * RECS));
    const page = recs.slice(first, first + RECS);
    const want = [];
    for (const r of page) if (r.body !== null && r.body !== undefined) for (let a = r.body; a < Math.min(r.hi, r.body + 16); a += 4) want.push(a);
    const vals = await this.cells(src, want);
    const at4 = new Map(want.map((a, i) => [a, vals[i]]));
    const ix = this.lang.index();
    const rows = page.map(r => {
      const def = ix.word(r.name);
      const kind = r.body !== null ? (r.hi - r.body === 4 ? 'VARIABLE' : 'CREATE') : def && /CONSTANT/.test(def.stack) ? 'CONSTANT' : ':';
      let body = '';
      if (r.body !== null) {
        const n = (r.hi - r.body) >> 2;
        const cs = [];
        for (let a = r.body; a < Math.min(r.hi, r.body + 16); a += 4) {
          const v = at4.get(a);
          const chg = this.changed(a, v, seen) ? ' chg' : '';
          const lab = v === undefined ? null : labelOf(v, ctx);
          cs.push(`<span class="v${chg}" data-edit="${a}" title="${lab ? esc(lab.text) + ' · ' : ''}double-click to change">${v === undefined ? '?' : kind === 'VARIABLE' ? String(v | 0) + ` <span class="meta">$${hex(v)}</span>` : '$' + hex(v)}</span>`);
        }
        body = cs.join(' ') + (n > 4 ? ` <span class="meta">… ${n} cells</span>` : '');
      }
      const dup = recs.filter(x => x.name.toUpperCase() === r.name.toUpperCase());
      const older = dup.length > 1 && dup[dup.length - 1] !== r ? ' <span class="warn">older copy</span>' : '';
      const hit = this.target !== null && this.target >= r.h && this.target < r.hi ? ' hit' : '';
      return `<tr class="${hit}"><td class="a"><a data-goto="${r.h}" data-lens="cells">${hex8(r.h)}</a></td><td class="f"><a data-inspect="${esc(r.name)}">${esc(r.name)}</a>${older}</td>`
        + `<td class="meta">${kind}</td><td class="d">${r.lo - r.h} + ${(r.body !== null ? r.body : r.hi) - r.lo}${r.body !== null ? ' + ' + (r.hi - r.body) : ''}</td><td>${body}</td></tr>`;
    }).join('');
    const nav = `<div class="meta">words ${first + 1}–${first + page.length} of ${recs.length}, oldest first · sizes: header + code (+ body), bytes</div>`;
    return `${nav}<table><tr><th>Header</th><th>Word</th><th>Kind</th><th>Bytes</th><th>Body</th></tr>${rows}</table>`;
  }

  // Cells: 32-bit values, labelled
  async lensCells(src, ctx, seen) {
    const addrs = [];
    for (let a = this.addr; a < this.addr + CELLS; a += 4) addrs.push(u32(a));
    const vals = await this.cells(src, addrs);
    const heads = new Map(ctx.recs.map(r => [r.h, r]));
    const rows = addrs.map((a, i) => {
      const h = heads.get(a);
      const sep = h ? `<tr class="sep"><td colspan="6"><a data-inspect="${esc(h.name)}">${esc(h.name)}</a></td></tr>` : '';
      return sep + this.cellRow(a, vals[i], ctx, seen);
    }).join('');
    return `<table><tr><th>Address</th><th>Value</th><th>Decimal</th><th>Points at</th><th>Here is</th><th></th></tr>${rows}</table>`;
  }

  // Bytes: hex and ASCII
  async lensBytes(src, ctx, seen) {
    const raw = await src.read(this.addr, BYTES);
    const rows = [];
    for (let o = 0; o < BYTES; o += 16) {
      const a = u32(this.addr + o);
      const bs = [...raw].slice(o, o + 16);
      const cells = [];
      for (let k = 0; k < 16; k += 4) {
        const q = bs.slice(k, k + 4);
        const v = q.some(x => x === null || x === undefined) ? undefined : u32(q[0] | q[1] << 8 | q[2] << 16 | q[3] << 24);
        const chg = this.changed(a + k, v, seen) ? ' chg' : '';
        cells.push(`<span class="${chg}">${q.map(b => (b === null || b === undefined ? '--' : b.toString(16).toUpperCase().padStart(2, '0'))).join(' ')}</span>`);
      }
      const asc = bs.map(b => (b !== null && b !== undefined && b >= 0x20 && b < 0x7F ? esc(String.fromCharCode(b)) : '<span class="meta">.</span>')).join('');
      const hit = this.target !== null && this.target >= a && this.target < a + 16 ? ' hit' : '';
      rows.push(`<tr class="${hit}"><td class="a"><a data-goto="${a}" data-lens="cells">${hex8(a)}</a></td><td class="hx">${cells.join('  ')}</td><td class="asc">${asc}</td><td class="meta">${esc(ownerOf(a, ctx))}</td></tr>`);
    }
    return `<table><tr><th>Address</th><th>00 01 02 03  04 05 06 07  08 09 0A 0B  0C 0D 0E 0F</th><th>ASCII</th><th>Here is</th></tr>${rows.join('')}</table>`;
  }

  // Code: Thumb disassembly with Forth names
  async lensCode(src, ctx) {
    const raw = await src.read(this.addr, CODE);
    if ([...raw].some(b => b === null || b === undefined)) return '<p class="meta">Nothing known here to disassemble.</p>';
    if (this.forth.board === 'Host build') return '<p class="meta">The host build runs token code, not Thumb-2: use Cells or Bytes.</p>';
    const names = new Map(ctx.builtins);
    for (const r of ctx.recs) names.set(u32(r.lo + ctx.alias), r.name);
    const starts = new Map(ctx.recs.map(r => [u32(r.lo + ctx.alias), r.name]));
    const rows = decode(Buffer.from(raw), this.addr).map(([a, hx, ins]) => {
      const t = /\bbl\s+0x([0-9a-f]+)/.exec(ins);
      const to = t ? parseInt(t[1], 16) : null;
      const called = to !== null ? names.get(to) : null;
      const sep = starts.has(a) ? `<tr class="sep"><td colspan="4"><a data-inspect="${esc(starts.get(a))}">${esc(starts.get(a))}</a></td></tr>` : names.has(a) ? `<tr class="sep"><td colspan="4">kernel: ${esc(names.get(a))}</td></tr>` : '';
      const hit = this.target !== null && a === (this.target & ~1) ? ' hit' : '';
      return `${sep}<tr class="${hit}"><td class="a">${hex8(a)}</td><td class="meta">${esc(hx)}</td><td>${esc(T.rename(ins))}</td><td class="f">${called ? `<a data-inspect="${esc(called)}">${esc(called)}</a>` : to !== null ? `<a data-goto="${to}" data-lens="code">$${hex8(to)}</a>` : ''}</td></tr>`;
    }).join('');
    return `<table><tr><th>Address</th><th>Bytes</th><th>Instruction</th><th>Calls</th></tr>${rows}</table>`;
  }
}

// ---- the map and the budget (HTML) ----

function mapHtml(board, ctx, target, forth) {
  const as = areas(board);
  if (!as.length) return '<p class="meta">No memory map for this board.</p>';
  const marks = [];
  if (ctx.here !== null) marks.push({ a: ctx.here, name: 'HERE' });
  const m = MAPS[board];
  const top = m && Object.entries(m.cells).find(([, n]) => /^data stack: the top/.test(n));
  if (top && forth && forth.stack) marks.push({ a: Number(top[0]) - 4 * forth.stack.items.length, name: 'data stack' });
  if (target !== null && target !== undefined) marks.push({ a: target, name: 'shown', you: true });
  return as.map(ar => {
    const span = ar.hi - ar.lo;
    const segs = ar.parts.map(p => {
      const w = Math.max(0.6, (100 * (p.hi - p.lo)) / span);
      let fill = '';
      if (p.name === 'RAM: the dictionary' && ctx.here !== null && ctx.here >= p.lo && ctx.here <= p.hi && ctx.recs.length) {
        const used = (100 * (ctx.here - p.lo)) / (p.hi - p.lo);
        fill = `<i style="width:${used.toFixed(2)}%"></i>`;
      }
      return `<div class="seg ${p.gap ? 'gap' : kindOf(p.name)}" style="flex:${w.toFixed(3)} 0 0" data-goto="${p.lo}" title="${esc(shortName(p.name))}: ${esc(p.name)} · $${hex8(p.lo)}–$${hex8(p.hi - 1)} · ${size(p.hi - p.lo)}">${fill}</div>`;
    }).join('');
    const ms = marks.filter(k => k.a >= ar.lo && k.a < ar.hi).map(k => `<b class="mk${k.you ? ' you' : ''}${(k.a - ar.lo) / span > 0.8 ? ' r' : ''}" style="left:${((100 * (k.a - ar.lo)) / span).toFixed(3)}%" title="${esc(k.name)} $${hex8(k.a)}"></b>`).join('');
    return `<div class="area"><span class="an">${ar.name}</span><div class="bar">${segs}${ms}</div><span class="meta">${size(span)}</span></div>`;
  }).join('') + zoomHtml(as, target, marks)
    + `<div class="meta legend">${as.filter(a => a.name !== 'Peripherals').map(a => `<b>${a.name}</b> ${a.parts.filter(p => !p.gap).map(p => `<a data-goto="${p.lo}" title="${esc(p.name)}"><span class="sw ${kindOf(p.name)}"></span>${esc(shortName(p.name))}</a>`).join(' ')}`).join('<br>')}</div>`;
}

// The close-up: the region holding the address shown and three either side, each
// block named and sized inside it. Not to scale (a 4-byte cell beside 440 KB free
// would vanish): widths grow with the log of the size. Markers sit in their block.
function zoomHtml(as, target, marks) {
  if (target === null || target === undefined) return '';
  const ar = as.find(a => a.name !== 'Peripherals' && target >= a.lo && target < a.hi);
  if (!ar) return '';
  const i = ar.parts.findIndex(p => target >= p.lo && target < p.hi);
  if (i < 0) return '';
  const parts = ar.parts.slice(Math.max(0, i - 3), i + 4);
  const segs = parts.map(p => {
    const n = p.hi - p.lo;
    const w = Math.max(3, Math.log2(Math.max(4, n)));
    // markers: a line where each is; their names on a line of their own, below the size
    const inside = marks.filter(k => k.a >= p.lo && k.a < p.hi);
    const ms = inside.map(k => `<b class="mk${k.you ? ' you' : ''}" style="left:${((100 * (k.a - p.lo)) / n).toFixed(2)}%" title="${esc(k.name)} $${hex8(k.a)}"></b>`).join('');
    const names = inside.length ? `<em>▸ ${inside.map(k => esc(k.name)).join(' · ')}</em>` : '';
    const cur = p === ar.parts[i] ? ' cur' : '';
    return `<div class="zseg ${p.gap ? 'gap' : kindOf(p.name)}${cur}" style="flex:${w.toFixed(2)} 0 0" data-goto="${p.lo}" title="${esc(p.name)} · $${hex8(p.lo)}–$${hex8(p.hi - 1)}${inside.map(k => ` · ${esc(k.name)} $${hex8(k.a)}`).join('')}">`
      + `<span>${esc(p.gap ? 'unused' : shortName(p.name))}</span><small>${size(n)} · $${hex(p.lo)}</small>${names}${ms}</div>`;
  }).join('');
  return `<div class="area zoom"><span class="an">close-up</span><div class="zbar">${segs}</div><span class="meta">not to scale</span></div>`;
}

// A region's name in a word or two, for the legend (the full one is its tooltip).
const SHORT = [
  [/^flash: boot/, 'boot'], [/^flash: the kernel/, 'kernel'], [/register table/, 'register table'],
  [/SAVE area/, 'save area'], [/vector table/, 'vector table'], [/kernel's code and constants/, 'kernel (exe)'],
  [/last fault/, 'fault log'], [/^RAM: IPSR/, 'IPSR'], [/interrupt handlers/, 'interrupt handlers'],
  [/error recovery/, 'recovery point'], [/the dictionary$/, 'dictionary'], [/^RAM: kernel variables/, 'kernel: variables'],
  [/pointer to the kernel variables/, 'kernel: varpointer'], [/the data stack$/, 'data stack'],
  [/characters dropped/, 'previous input'], [/something printed/, 'current input'], [/receive buffer/, 'UART RX buffer'],
  [/free, then the return stack/, 'FREE'], [/call_bi/, 'call_bi'],
];
function shortName(name) {
  for (const [rx, s] of SHORT) if (rx.test(name)) return s;
  return name.replace(/^(flash|RAM): (the )?/, '').replace(/\s*[(,].*$/, '');
}

function kindOf(name) {
  if (/dictionary|SAVE/.test(name)) return 'dict';
  if (/^RAM: free/.test(name)) return 'free';           // "free, then the return stack": free first
  if (/stack/.test(name)) return 'stack';
  if (/kernel|boot|vector/.test(name)) return 'kern';
  if (/register table/.test(name)) return 'tab';
  if (/peripheral/.test(name)) return 'per';
  return 'other';
}

function size(n) {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(n % (1 << 20) ? 1 : 0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} KB`;
  return `${n} B`;
}

function budgetHtml(ctx, forth) {
  if (!ctx.recs.length) return '';
  const known = forth.dict ? forth.dict.size : ctx.dict ? ctx.dict.hi - ctx.dict.lo : null;
  const b = budget(ctx.recs, known === null ? ctx.recs.reduce((s, r) => s + r.hi - r.h, 0) : known);
  const segs = b.words.map((w, i) => `<div class="${w.copies > 1 ? 'dupw' : i % 2 ? 'w2' : 'w1'}" style="flex:${w.bytes} 0 0" data-inspect="${esc(w.name)}" title="${esc(w.name)}: ${w.bytes} B${w.copies > 1 ? `, ${w.copies} copies` : ''}"></div>`).join('');
  const dups = b.words.filter(w => w.copies > 1).map(w => `<a data-inspect="${esc(w.name)}">${esc(w.name)} ×${w.copies}</a> ${w.bytes - w.last} B`).join(', ');
  return `<div class="area"><span class="an">Dictionary</span><div class="bar budget">${segs}<div class="free" style="flex:${Math.max(0, b.size - b.used)} 0 0" title="free: ${size(b.size - b.used)}"></div></div><span class="meta">${size(b.used)}${known === null ? ' used' : ' of ' + size(b.size)}</span></div>`
    + `<div class="meta legend">${b.words.length} words${dups ? ` · older copies: ${dups} (freed by FORGET, not in the kernel yet)` : ''}</div>`;
}

function pageHtml() {
  const n = nonce();
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:8px 16px}
.meta{color:var(--vscode-descriptionForeground)}.warn{color:var(--vscode-editorWarning-foreground)}.bad{color:var(--vscode-errorForeground)}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin:14px 0 4px;color:var(--vscode-descriptionForeground)}
a{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none}a:hover{text-decoration:underline}a.weak{color:var(--vscode-descriptionForeground)}
.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border,transparent));font-family:var(--vscode-editor-font-family);padding:3px 6px}
#text{width:18em}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;padding:4px 10px;cursor:pointer;border-radius:2px}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}button:disabled{opacity:.4;cursor:default}
.tabs button.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.area{display:flex;align-items:center;gap:8px;margin:3px 0}.an{width:6.5em;font-size:11px;color:var(--vscode-descriptionForeground)}
.zbar{flex:1;display:flex;height:58px;gap:2px;margin:8px 0 4px}
.zseg{position:relative;overflow:hidden;cursor:pointer;border-radius:2px;padding:4px 6px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.zseg span,.zseg small{color:var(--vscode-editor-foreground);text-shadow:0 0 3px var(--vscode-editor-background),0 0 2px var(--vscode-editor-background);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zseg span{font-weight:600;font-size:12px}.zseg small{font-size:10px;font-family:var(--vscode-editor-font-family)}
.zseg.cur{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}.zseg:hover{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.zbar .mk{top:0;bottom:0}
.bar{flex:1;display:flex;height:24px;position:relative;background:var(--vscode-textCodeBlock-background);border-radius:2px;overflow:visible}
.seg{height:100%;cursor:pointer;position:relative;border-right:1px solid var(--vscode-editor-background);overflow:hidden}.seg:hover{outline:1px solid var(--vscode-focusBorder)}
.seg i{position:absolute;left:0;top:0;bottom:0;background:var(--vscode-terminal-ansiYellow)}
.gap{background:repeating-linear-gradient(45deg,transparent 0 3px,var(--vscode-widget-border,#8884) 3px 4px)}
.kern,.sw.kern{background:var(--vscode-terminal-ansiBlue)}.dict,.sw.dict{background:color-mix(in srgb,var(--vscode-terminal-ansiYellow) 35%,transparent)}
.stack,.sw.stack{background:var(--vscode-terminal-ansiMagenta)}.tab,.sw.tab{background:var(--vscode-terminal-ansiCyan)}
.free,.sw.free{background:color-mix(in srgb,var(--vscode-terminal-ansiGreen) 25%,transparent)}.per{background:var(--vscode-terminal-ansiCyan);opacity:.5}
.other,.sw.other{background:var(--vscode-descriptionForeground);opacity:.6}
.sw{display:inline-block;width:9px;height:9px;margin:0 3px 0 8px;border-radius:1px}
.mk{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--vscode-foreground);font-size:0}.mk.you{background:var(--vscode-focusBorder);width:3px}
.zseg em{font-style:normal;font-size:10px;color:var(--vscode-editor-foreground);text-shadow:0 0 3px var(--vscode-editor-background);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.legend{font-size:11px;margin:4px 0 2px 7.5em;line-height:1.8}
.budget .w1{background:var(--vscode-terminal-ansiYellow)}.budget .w2{background:color-mix(in srgb,var(--vscode-terminal-ansiYellow) 65%,transparent)}.budget .dupw{background:var(--vscode-editorWarning-foreground)}
.budget div{height:100%;cursor:pointer;border-right:1px solid var(--vscode-editor-background)}
#status{margin:8px 0 4px}#status.bad{color:var(--vscode-errorForeground)}
table{border-collapse:collapse;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}
td,th{padding:1px 12px 1px 0;text-align:left;vertical-align:top;white-space:nowrap}th{font-weight:600;color:var(--vscode-descriptionForeground)}
td.a a{color:var(--vscode-debugTokenExpression-number)}td.f,td.f a{color:var(--vscode-debugTokenExpression-name);font-weight:600}td.d{text-align:right}
td.v,span.v{cursor:text}tr.hit td{background:var(--vscode-editor-findMatchHighlightBackground)}
tr.sep td{padding-top:6px;font-weight:600;border-top:1px solid var(--vscode-widget-border,transparent)}
td.pin a{opacity:0;text-decoration:none}tr:hover td.pin a{opacity:.8}
.chg{animation:flash 1.6s ease-out}@keyframes flash{from{background:var(--vscode-terminal-ansiYellow);color:var(--vscode-editor-background)}to{background:transparent}}
.hx{letter-spacing:.02em}.asc{color:var(--vscode-descriptionForeground)}
</style></head><body>
<div class="top">
<button id="back" title="Back">◀</button>
<input id="text" placeholder="HERE, a word, ' WORD, a register, $2000 ..." title="An address in Forth: HITS, ' BLINK, SIO.GPIO_OUT, HERE 64 -, $20002140">
<button id="go">Go</button>
<span class="tabs"><button data-lens="forth">Forth</button><button data-lens="cells">Cells</button><button data-lens="bytes">Bytes</button><button data-lens="code">Code</button></span>
<button id="prev" title="Earlier">↑</button><button id="next" title="Later">↓</button>
<label class="meta"><input type="checkbox" id="live"> live</label>
</div>
<div id="map"></div><div id="budget"></div>
<div id="status" class="meta"></div>
<div id="pins"></div><div id="main"></div>
<script nonce="${n}">
const vs=acquireVsCodeApi();const $=id=>document.getElementById(id);let editing=null;const last={};
const send=m=>vs.postMessage(m);
$('go').onclick=()=>send({go:$('text').value});
$('text').onkeydown=e=>{if(e.key==='Enter')send({go:$('text').value});};
$('back').onclick=()=>send({back:true});$('prev').onclick=()=>send({page:-1});$('next').onclick=()=>send({page:1});
$('live').onchange=()=>send({live:$('live').checked});
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-goto],[data-lens],[data-inspect],[data-pin],[data-unpin]');if(!t)return;
  if(t.dataset.inspect!==undefined)return send({inspect:t.dataset.inspect});
  if(t.dataset.pin!==undefined)return send({pin:+t.dataset.pin});
  if(t.dataset.unpin!==undefined)return send({unpin:+t.dataset.unpin});
  if(t.dataset.goto!==undefined){if(t.dataset.lens)send({lens:t.dataset.lens,quiet:true});return send({goto:+t.dataset.goto});}
  if(t.dataset.lens)return send({lens:t.dataset.lens});
});
document.addEventListener('dblclick',e=>{
  const t=e.target.closest('[data-edit]');if(!t||editing)return;
  editing=t;const was=t.innerHTML;const i=document.createElement('input');i.value=t.textContent.trim().split(' ')[0];i.style.width='9em';
  t.innerHTML='';t.appendChild(i);i.focus();i.select();
  const done=ok=>{if(!editing)return;const v=i.value;editing=null;if(ok)send({edit:+t.dataset.edit,value:v});else t.innerHTML=was;};
  i.onkeydown=k=>{if(k.key==='Enter')done(true);if(k.key==='Escape')done(false);};i.onblur=()=>done(false);
});
window.addEventListener('message',e=>{const m=e.data;
  if(m.text!==undefined&&document.activeElement!==$('text'))$('text').value=m.text;
  if(m.lens)document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.lens===m.lens));
  if(m.back!==undefined)$('back').disabled=!m.back;
  if(m.live!==undefined)$('live').checked=m.live;
  const put=(id,h)=>{if(h!==undefined&&last[id]!==h){last[id]=h;$(id).innerHTML=h;}};
  put('map',m.map);put('budget',m.budget);
  if(m.status!==undefined){$('status').textContent=m.status;$('status').className=m.bad?'bad':'meta';}
  if(editing)return;
  put('pins',m.pins);put('main',m.main);
});
send({draw:true});
</script></body></html>`;
}

module.exports = { Memory, mapHtml, shortName, areas, regionOf, records, bodyOf, labelOf, ownerOf, evaluate, budget, imageReader, kernelCells };

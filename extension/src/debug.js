// debug.js - the debugger in Forth terms (port of ide/fide/debug.py, contract
// A6): the data and return stacks, names for code addresses, the SEE listing
// around pc, breakpoints on words. Built on gdb.js; set up through the console
// while the CPU still runs.
'use strict';
const { spawn } = require('child_process');
const B = require('./board');
const T = require('./thumb');
const { rows: decode } = require('./thumbdis');
const G = require('./gdb');
const L = require('./link');
const { Gdb, GdbError } = G;

const BUILTIN_MAX = 256;
const INFO = require('../data/builtins.json');
const INLINE = new Set(Object.keys(INFO).filter(n => INFO[n][3]));
const u32 = v => v >>> 0;

class Debugger {
  // link: the console, connected and idle. Before attaching, the console gives
  // the stack depth, the word list (code addresses) and the built-ins'
  // addresses; attaching halts the CPU, which pins down the stack's base.
  static async attach(host, port, link) {
    let st;
    try { st = await B.readStack(link); } catch (e) {
      // the console doesn't answer: the CPU may have been left halted (a debugger that
      // stopped without letting it run on). Let it run through the debug server, try again.
      if (!(e instanceof L.Timeout)) throw e;
      const g = await Gdb.connect(host, port);
      await g.close();
      st = await B.readStack(link);
    }
    await B.userWords(link);                          // sets link.codeAlias, link.stateAddr
    const d = new Debugger();
    d.builtins = await B.builtinAddrs(link);
    d.link = link;
    d.g = await Gdb.connect(host, port);
    try {
      d.dsTop = u32((await d.g.reg('r5')) + 4 * st.items.length);   // psp with an empty stack
      d.alias = link.codeAlias || 0;
      d.stateAddr = link.stateAddr;
      d.userRanges = [];
      d.extent = new Map();
      d.heads = [];
      await d.refreshWords();
    } catch (e) {
      await d.g.close(true);                          // don't leave the CPU halted
      throw e;
    }
    return d;
  }

  // ---- names ----
  // Code ranges of your words, from the header chain in memory. Only headers
  // newer than the last read are fetched; a chain that no longer reaches them
  // (EMPTY) is read whole.
  async refreshWords() {
    const here = await this.g.word(this.stateAddr + 24);
    let h = await this.g.word(this.stateAddr + 28);
    let known = this.heads;
    let knownAt = new Map(known.map((k, i) => [k[0], i]));
    const fresh = [];
    while (h) {
      if (knownAt.has(h)) {
        const [, name, fl] = known[knownAt.get(h)];
        const raw = await this.g.mem(h, 5 + name.length);
        const nxt = knownAt.get(h) + 1 < known.length ? known[knownAt.get(h) + 1][0] : 0;
        if (raw[4] === fl && raw.subarray(5).toString('latin1') === name && raw.readUInt32LE(0) === nxt) break;
        known = []; knownAt = new Map();              // reused after EMPTY: read the rest whole
      }
      const fl = (await this.g.mem(h + 4, 1))[0];
      const name = (await this.g.mem(h + 5, fl & 0x1F)).toString('latin1');
      fresh.push([h, name, fl]);
      h = await this.g.word(h);
    }
    const heads = fresh.concat(h ? known.slice(knownAt.get(h)) : []);
    this.heads = heads;
    const ranges = [];
    let newer = here;
    for (const [hh, name, fl] of heads) {
      const start = u32(((hh + 5 + name.length + 3) & ~3) + this.alias);
      if (!(fl & 0x40)) ranges.push([start, u32(newer + this.alias), name]);
      newer = hh;
    }
    this.userRanges = ranges;
  }

  // End of the built-in starting at b: its last return (measured once).
  async builtinEnd(b) {
    if (!this.extent.has(b)) {
      const later = [...this.builtins.keys()].filter(x => x > b);
      const hi = Math.min(later.length ? Math.min(...later) : b + BUILTIN_MAX, b + BUILTIN_MAX);
      let end = hi;
      let rows = decode(await this.g.mem(b, hi - b), b);
      rows = rows.slice(0, T.functionEnd(rows, b, hi));
      if (rows.length) { const [a, hx] = rows[rows.length - 1]; end = a + hx.replace(/ /g, '').length / 2; }
      this.extent.set(b, end);
    }
    return this.extent.get(b);
  }

  // [start, end, name] of the word or built-in whose code holds addr, or null
  // (the kernel's own C code, which the board has no names for).
  async rangeOf(addr) {
    const a = u32(addr & ~1);
    for (const r of this.userRanges) if (r[0] <= a && a < r[1]) return r;
    const below = [...this.builtins.keys()].filter(b => b <= a && a < b + BUILTIN_MAX);
    if (below.length) {
      const b = Math.max(...below);
      const end = await this.builtinEnd(b);
      if (a < end) return [b, end, this.builtins.get(b)];
    }
    return null;
  }

  async nameAt(addr) {
    const r = await this.rangeOf(addr);
    return r ? [r[2], u32(addr & ~1) - r[0]] : null;
  }

  // ---- stacks ----
  // Items bottom first, as signed numbers: memory from r5 up, then r6 (TOS).
  // null when r5 is not the data stack (inside an interrupt handler).
  async dataStack() {
    const r5 = await this.g.reg('r5'), r6 = await this.g.reg('r6');
    const depth = (this.dsTop - r5) / 4;
    if (depth <= 0) return [];
    if (depth > 64 || !Number.isInteger(depth)) return null;
    const cells = await this.g.mem(r5, 4 * (depth - 1));
    const below = [];
    for (let i = 0; i < cells.length; i += 4) below.push(cells.readInt32LE(i));
    return below.reverse().concat([r6 | 0]);
  }

  // The Forth return stack from sp up: [[address, value, name or null, kind]], kind
  // 'call' (a return into your word or a kernel word, named WORD+offset) or 'data' (a
  // DO loop's index and limit, or >R). The walk ends at the first return into the
  // kernel's own C code: the interpreter that ran the line; the rest is the kernel's.
  // Paused in the kernel's own code (waiting for a key): no Forth word is running, the
  // list is empty and .note says so.
  async returnStack(n = 32) {
    const out = [];
    const pc = await this.g.reg('pc');
    const map = this.memmap();
    const kernelC = a => map && map.code.some(([lo, hi]) => lo <= a && a < hi) && !map.regions.some(([lo, hi, nm]) => nm === 'RAM: the dictionary' && lo <= a && a < hi);
    const at = await this.nameAt(pc);
    if (!at) {
      out.note = 'Paused in the kernel\'s own code (the interpreter, or waiting for a key): no Forth word is running, so there is no Forth return stack.';
      return out;
    }
    // at a word's first instruction its caller isn't pushed yet: it is in lr
    if (at[1] === 0) {
      const lr = await this.g.reg('lr');
      const nm = lr & 1 ? await this.nameAt(u32(lr & ~1) - 2) : null;   // named by the call, as in the Call Stack
      if (nm) out.push([null, lr, `${nm[0]}+${nm[1]}`, 'call']);
      else if (lr & 1) { out.ends = await this.g.reg('sp'); return out; }
    }
    const sp = await this.g.reg('sp');
    const top = map ? (map.regions.find(r => /return stack/.test(r[2])) || [0, 0x100000000])[1] : 0x100000000;
    const cnt = Math.max(0, Math.min(n, (top - sp) / 4));
    const raw = await this.g.mem(sp, 4 * cnt);
    for (let i = 0; i < cnt; i++) {
      const v = raw.readUInt32LE(4 * i);
      const nm = v & 1 ? await this.nameAt(u32(v & ~1) - 2) : null;
      if (nm) { out.push([sp + 4 * i, v, `${nm[0]}+${nm[1]}`, 'call']); continue; }
      if (v & 1 && (kernelC(u32(v & ~1)) || !map)) { out.ends = sp + 4 * i; break; }   // back into the interpreter: the end
      out.push([sp + 4 * i, v, null, 'data']);
    }
    return out;
  }

  // The firmware's memory map (data/memmap/): the one whose kernel variables are here.
  memmap() {
    if (this.map === undefined) {
      this.map = require('../boards').mapAt(this.stateAddr);
    }
    return this.map;
  }

  // ---- the listing where the CPU stopped ----
  async inlineBodies() {
    if (!this.inline) {
      this.inline = {};
      for (const [a, n] of this.builtins) if (INLINE.has(n)) this.inline[n] = T.body(T.halfwords(await this.g.mem(a, 24)));
    }
    return this.inline;
  }

  // {name, rows: [[addr, text]], cur: index of pc or -1}
  async listing(pc = null, named = true) {
    if (pc === null) pc = await this.g.reg('pc');
    const rng = await this.rangeOf(pc);
    const [lo, hi, name] = rng || [u32(pc & ~1), u32(pc & ~1) + 32, '?'];
    const code = await this.g.mem(lo, hi - lo);
    const rows = decode(code, lo);
    // your word's last 2 bytes after its final pop {pc} are padding to the next header
    const mine = rng && this.userRanges.includes(rng);
    if (mine && rows.length > 1 && rows[rows.length - 2][2].includes('pop') && rows[rows.length - 2][2].includes('pc') && rows[rows.length - 1][0] + 2 === hi) rows.pop();
    const names = new Map(this.builtins);
    for (const [l, , nm] of this.userRanges) names.set(l, nm);
    const notes = rng && this.userRanges.includes(rng) ? T.annotate(code, await this.inlineBodies(), lo) : {};
    const text = T.formatRows(rows, names, lo, named, notes);
    const cur = rows.findIndex(r => r[0] === u32(pc & ~1));
    return { name, rows: rows.map((r, i) => [r[0], text[i]]), cur };
  }

  // ---- running ----
  async breakOn(name) {
    const un = name.toUpperCase();
    for (const [lo, , nm] of this.userRanges) {        // newest first: the definition a new line calls
      if (nm.toUpperCase() === un) { await this.g.breakAt(lo); return lo; }
    }
    for (const [a, nm] of this.builtins) {
      if (nm.toUpperCase() === un) {
        if (INLINE.has(nm)) throw new Error(`${nm} is copied inline into your words, so its own code only runs through EXECUTE: break on the word that uses it`);
        await this.g.breakAt(a);
        return a;
      }
    }
    throw new Error(`${name}: no such word on the board`);
  }

  // How many earlier definitions of name are still in the dictionary.
  olderDefinitions(name) {
    return Math.max(0, this.userRanges.filter(r => r[2].toUpperCase() === name.toUpperCase()).length - 1);
  }

  // Of a Map address -> name, the breakpoints no longer at the start of that word
  // (EMPTY, FORGET, the space reused): cleared, and returned.
  async checkBreaks(breaks) {
    const gone = [];
    for (const [a, nm] of breaks) {
      const r = await this.rangeOf(a);
      if (!r || r[0] !== u32(a & ~1) || r[2].toUpperCase() !== nm.toUpperCase()) {
        try { await this.g.unbreak(a); } catch (e) { if (!(e instanceof GdbError)) throw e; }
        gone.push([a, nm]);
      }
    }
    return gone;
  }

  close() { return this.g.close(true); }
}

// Run a GDB server (OpenOCD) from its argument list and wait until it says it
// listens for GDB ("Listening on port 3333 for gdb connections"). It is not
// probed by connecting: OpenOCD halts the CPU for every GDB connection.
// OpenOCD stopped: its last lines, and what to do when the cause is known.
function serverError(code, lines) {
  const said = lines.filter(Boolean).slice(-3).join(' / ');
  const all = lines.join('\n');
  let hint = '';
  if (/CMSIS-DAP command \S+ failed|unable to find a matching CMSIS-DAP device/i.test(all)) hint = ' · The Debug Probe is not answering: unplug its USB cable and plug it back in (the probe, not the board).';
  else if (/Error connecting DP|Failed to connect/i.test(all)) hint = ' · The probe can\'t reach the chip: check the 3 debug wires (SWCLK, SWDIO, GND) and that the board is powered.';
  return new Error(`OpenOCD stopped${code === undefined ? '' : ` (${code})`}: ${said}${hint}`);
}

function startServer(argv, wait = 10000) {
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0], argv.slice(1), { windowsHide: true });
    const lines = [];
    let buf = '', done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); if (err) { p.kill(); reject(err); } else { p.output = lines; resolve(p); } };
    const read = d => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (lines.length < 200) lines.push(ln);
        if (ln) G.trace('[server] ' + ln);
        if (/gdb connection/i.test(ln)) setTimeout(() => finish(p.exitCode === null ? null : serverError(p.exitCode, lines)), 300);
      }
    };
    G.trace('started: ' + argv.map(a => /\s/.test(a) ? `"${a}"` : a).join(' '));
    p.stdout.on('data', read); p.stderr.on('data', read);
    p.on('exit', code => G.trace(`[server] exited (${code})`));
    p.on('error', e => finish(new Error(e.code === 'ENOENT' ? `${argv[0]} not found` : e.message)));
    p.on('exit', code => finish(serverError(code, lines)));
    const timer = setTimeout(() => finish(serverError(undefined, [...lines, `never said it listens for GDB (after ${wait / 1000} s)`])), wait);
  });
}

module.exports = { Debugger, startServer, serverError, BUILTIN_MAX, INLINE };

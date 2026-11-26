// gdb.js - a GDB remote-protocol client (port of ide/fide/gdb.py, contract A6).
//
// One protocol for every target: OpenOCD (through the Debug Probe or another
// probe), Segger's J-Link GDB server, and QEMU's GDB stub
// for the tests. Only what the debugger needs: registers, memory, continue,
// halt, step, breakpoints. No gdb program is involved.
//
// Breakpoints are hardware ones (Z1), except on an ARMv6-M core (Cortex-M0,
// M0+), whose breakpoint unit only reaches below 0x20000000: code in RAM gets
// software ones there (Z0, a BKPT written over the instruction). Memory read
// back shows the instruction, not the BKPT. On ARMv6-M boards a call to a
// builtin is bl call_bi then its xt less KBASE (thumbdis.setFar): stepping
// over it stops past that halfword, stepping into it stops at the builtin.
//
// Register numbers come from the target's own description (target.xml and the
// files it includes), because servers number them differently (QEMU puts xPSR
// at 25, OpenOCD after pc).
'use strict';
// The debug log (the Forth debug output): every packet both ways, cut short.
let tracer = null;
// A line repeated many times in a row is written once a second with its count.
let last = '', repeats = 0, lastAt = 0;
function trace(t) {
  if (!tracer) return;
  t = t.length > 160 ? t.slice(0, 160) + ' ...' : t;
  if (t === last && Date.now() - lastAt < 1000) { repeats++; return; }
  if (repeats) tracer(`(the line above ${repeats} more times)`);
  last = t; repeats = 0; lastAt = Date.now();
  tracer(t);
}
function setTrace(f) { tracer = f; }
const net = require('net');
const D = require('./thumbdis');

class GdbError extends Error {}

const CORE = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc', 'xpsr'];

const sum = b => { let s = 0; for (const c of b) s = (s + c) & 0xFF; return s; };
const hex2 = n => n.toString(16).padStart(2, '0');

// Undo '}' escapes and '*' run-length encoding.
function decode(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === 0x7D && i + 1 < body.length) { out.push(body[++i] ^ 0x20); }
    else if (c === 0x2A && out.length && i + 1 < body.length) { const r = body[++i] - 29; const last = out[out.length - 1]; for (let k = 0; k < r; k++) out.push(last); }
    else out.push(c);
  }
  return Buffer.from(out);
}

class Gdb {
  static async connect(host, port, timeout = 5000) {
    const g = new Gdb();
    g.s = await new Promise((res, rej) => {
      const s = net.connect(port, host, () => res(s));
      s.setTimeout(timeout, () => { s.destroy(); rej(new GdbError(`no GDB server on ${host}:${port} (no answer)`)); });
      s.once('error', e => rej(new GdbError(`no GDB server on ${host}:${port} (${e.message})`)));
    });
    g.s.setTimeout(0);
    g.s.setNoDelay(true);
    g.s.on('data', b => { g.buf = Buffer.concat([g.buf, b]); g.wake(); });
    g.s.on('close', () => { g.closed = true; g.wake(); });
    g.s.on('error', () => {});
    await g.request('qSupported:hwbreak+;swbreak+');
    g.regnum = await g.registerNumbers();
    g.stopReply = await g.request('?');          // attaching halts the CPU (QEMU, OpenOCD)
    return g;
  }

  constructor() {
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.running = false;
    this.stopReply = null;
    this.onStop = null;          // (reply) when the target stops by itself
    this.bps = new Set();        // breakpoints (addresses, bit 0 clear)
    this.under = new Map();      // software breakpoint address: the 2 bytes it covers
    this.tempBp = null;          // step over's breakpoint after the call
    this.waiters = new Set();
    this.queue = Promise.resolve();
  }

  wake() { for (const w of this.waiters) w(); }

  send(data) {
    trace('-> ' + data);
    const b = Buffer.from(data, 'latin1');
    this.s.write(Buffer.concat([Buffer.from('$'), b, Buffer.from('#' + hex2(sum(b)))]));
  }

  // The next packet's body; acknowledges it (a bad checksum is NAKed and resent).
  packet(timeout) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = (f, v) => { this.waiters.delete(check); clearTimeout(timer); f(v); };
      const check = () => {
        for (;;) {
          while (this.buf.length && (this.buf[0] === 0x2B || this.buf[0] === 0x2D)) this.buf = this.buf.subarray(1);
          if (!this.buf.length) break;
          if (this.buf[0] !== 0x24) { this.buf = this.buf.subarray(1); continue; }     // noise between packets
          const h = this.buf.indexOf(0x23);
          if (h < 0 || this.buf.length < h + 3) break;
          const body = this.buf.subarray(1, h), cs = parseInt(this.buf.subarray(h + 1, h + 3).toString('latin1'), 16);
          this.buf = this.buf.subarray(h + 3);
          if (sum(body) !== cs) { this.s.write('-'); continue; }
          this.s.write('+');
          const text = decode(body).toString('latin1');
          trace('<- ' + text);
          return done(resolve, text);
        }
        if (this.closed) { trace('<- (connection closed)'); done(reject, new GdbError('the GDB server closed the connection')); }
      };
      this.waiters.add(check);
      if (timeout != null) timer = setTimeout(() => done(reject, new GdbError('no answer from the GDB server')), timeout);
      check();
    });
  }

  // One request at a time; not while the CPU runs.
  request(data, timeout = 5000) {
    const run = this.queue.then(async () => {
      if (this.running) throw new GdbError('the CPU is running: halt it first');
      this.send(data);
      const r = await this.packet(timeout);
      if (r.length === 3 && r[0] === 'E') throw new GdbError(`${data.split(',')[0].slice(0, 12)}: error ${r}`);
      return r;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  // ---- target description ----
  async xfer(annex) {
    let out = '', off = 0;
    for (;;) {
      const r = await this.request(`qXfer:features:read:${annex}:${off.toString(16)},fff`);
      if (!r || !'lm'.includes(r[0])) return null;
      out += r.slice(1);
      off += r.length - 1;
      if (r[0] === 'l') return out;
    }
  }

  async registerNumbers() {
    let nums = {};
    let n = 0;
    const walk = async annex => {
      const xml = await this.xfer(annex);
      if (xml === null) return;
      for (const m of xml.matchAll(/<xi:include href="([^"]+)"\/>|<reg\s([^>]*)>/g)) {
        if (m[1]) { await walk(m[1]); continue; }
        const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
        if (attrs.regnum !== undefined) n = Number(attrs.regnum);
        const name = (attrs.name || '').toLowerCase();
        if (!(name in nums)) nums[name] = n;
        n++;
      }
    };
    try { await walk('target.xml'); } catch (e) { if (!(e instanceof GdbError)) throw e; }
    if (!('pc' in nums)) { nums = Object.fromEntries(CORE.slice(0, 16).map((r, i) => [r, i])); nums.xpsr = 25; }
    if (!('xpsr' in nums) && 'cpsr' in nums) nums.xpsr = nums.cpsr;
    return nums;
  }

  // ---- registers and memory ----
  async reg(name) {
    const r = await this.request('p' + this.regnum[name].toString(16));
    if (!/^[0-9a-fA-F]{8}/.test(r)) throw new GdbError(`the CPU's ${name} can't be read now (is the board being reset?)`);
    return Buffer.from(r.slice(0, 8), 'hex').readUInt32LE(0);
  }

  async regs() {
    const out = {};
    for (const n of CORE) if (n in this.regnum) out[n] = await this.reg(n);
    return out;
  }

  async mem(addr, n) {
    const parts = [], start = addr >>> 0, len = n;
    while (n > 0) {
      const k = Math.min(n, 512);
      parts.push(Buffer.from(await this.request(`m${(addr >>> 0).toString(16)},${k.toString(16)}`), 'hex'));
      addr += k; n -= k;
    }
    const out = Buffer.concat(parts);
    for (const [a, orig] of this.under) {          // what a software breakpoint covers, where the BKPT shows
      const k = a - start;
      if (k >= 0 && k + 1 < out.length && out[k + 1] === 0xBE) { out[k] = orig[0]; out[k + 1] = orig[1]; }
    }
    return out;
  }
  async raw(addr, n) { return Buffer.from(await this.request(`m${(addr >>> 0).toString(16)},${n.toString(16)}`), 'hex'); }

  // A software breakpoint whose code was compiled again (EMPTY, FORGET, then
  // new words) is gone with that code: taken out without the server writing
  // the old halfword back over the new one. Before running on.
  async dropOverwritten() {
    for (const [a, orig] of [...this.under]) {
      const now = await this.raw(a, 2);
      if (now.equals(orig) || now[1] === 0xBE) continue;
      try { await this.request(`z0,${a.toString(16)},2`); } catch { /* gone */ }
      await this.writeMem(a, now);
      this.under.delete(a);
      this.bps.delete(a);
      if (this.onLost) this.onLost(a);
    }
  }

  // ---- breakpoints: Z1, or Z0 for RAM on ARMv6-M (see the top) ----
  async v6m() {                                   // reads CPUID once: Cortex-M0, M0+, M1
    if (this.softFrom === undefined) {
      let part = 0;
      try { part = ((await this.word(0xE000ED00)) >>> 4) & 0xFFF; } catch { /* not readable */ }
      this.softFrom = [0xC20, 0xC60, 0xC21].includes(part) ? 0x20000000 : null;
    }
    return this.softFrom !== null;
  }
  async setBp(a) {
    a >>>= 0;
    if ((await this.v6m()) && a >= this.softFrom) {
      if (this.under.has(a)) return this.request(`Z0,${a.toString(16)},2`);
      this.under.set(a, await this.raw(a, 2));
      const r = await this.request(`Z0,${a.toString(16)},2`);
      if (r !== 'OK') this.under.delete(a);
      return r;
    }
    return this.request(`Z1,${a.toString(16)},2`);
  }
  async clearBp(a, timeout) {
    a >>>= 0;
    if (this.under.has(a)) {
      try { return await this.request(`z0,${a.toString(16)},2`, timeout); } finally { this.under.delete(a); }
    }
    return this.request(`z1,${a.toString(16)},2`, timeout);
  }
  // a BL at pc: [target, length (4, or 6 with call_bi's halfword), the code it reaches] or null
  async blAt(pc) {
    const hw = await this.mem(pc, 6);
    const h1 = hw.readUInt16LE(0), h2 = hw.readUInt16LE(2);
    if (!((h1 & 0xF800) === 0xF000 && (h2 & 0xD000) === 0xD000)) return null;
    const t = D.blTarget(h1, h2, pc), far = D.getFar();
    if (far && t === far.callBi) return [t, 6, ((far.kbase + hw.readUInt16LE(4)) & ~1) >>> 0];   // the xt less KBASE
    return [t, 4, t];
  }

  async word(addr) { return (await this.mem(addr, 4)).readUInt32LE(0); }

  async writeMem(addr, buf) {
    const r = await this.request(`M${(addr >>> 0).toString(16)},${buf.length.toString(16)}:${buf.toString('hex')}`);
    if (r !== 'OK') throw new GdbError(`memory at $${(addr >>> 0).toString(16)} not written (${r})`);
  }

  // ---- running ----
  async waitStop() {
    let r;
    try {
      for (;;) {
        r = await this.packet(null);
        if ('STWX'.includes(r[0])) break;        // a stop; 'O' is console output, skipped
      }
    } catch { return; }
    this.running = false;
    this.stopReply = r;
    if (this.tempBp !== null) {                   // step over finished (or stopped elsewhere)
      const a = this.tempBp; this.tempBp = null;
      try { await this.clearBp(a); } catch { /* gone */ }
    }
    if (this.onStop) this.onStop(r);
  }

  // Run on. Stopped at a breakpoint, step off it first (with the breakpoint
  // out), or the CPU would stop on it again at once.
  async cont() {
    if (this.running) return;
    if (this.under.size) await this.dropOverwritten();
    const pc = (await this.reg('pc')) & ~1;
    if (this.bps.has(pc) || pc === this.tempBp) {
      await this.clearBp(pc);
      try { await this.request('s', 10000); } finally { await this.setBp(pc); }
    }
    await this.queue;
    if (this.running) return;
    this.send('c');
    this.running = true;
    this.waitStop();
  }

  async halt(timeout = 5000) {
    if (!this.running) return this.stopReply;
    trace('-> ^C (halt)');
    this.s.write(Buffer.from([3]));
    if (!(await this.waitHalted(timeout))) throw new GdbError('the CPU did not halt');
    return this.stopReply;
  }

  async waitHalted(timeout) {
    const end = Date.now() + timeout;
    while (this.running && Date.now() < end) await new Promise(r => setTimeout(r, 10));
    return !this.running;
  }

  // One instruction (with a breakpoint at pc taken out for it).
  async step() {
    if (this.under.size) await this.dropOverwritten();
    const pc = (await this.reg('pc')) & ~1;
    const bl = await this.blAt(pc);
    if (bl && bl[1] === 6 && bl[2] !== null) return this.runTo(bl[2], 30000);   // into a builtin: past call_bi
    if (!this.bps.has(pc)) return this.request('s', 10000);
    await this.clearBp(pc);
    try { return await this.request('s', 10000); } finally { await this.setBp(pc); }
  }

  // Run until addr (a temporary breakpoint there), as stepOver does.
  async runTo(addr, wait) {
    if (!this.bps.has(addr)) {
      await this.setBp(addr);
      this.tempBp = addr;                         // cleared by waitStop
    }
    await this.cont();
    if (wait === null) return null;
    if (!(await this.waitHalted(wait))) await this.halt();
    return this.stopReply;
  }

  // One instruction, or over a call: a BL runs to the instruction after it.
  // wait null returns at once with the CPU running; the stop arrives like any
  // other (onStop), and a call that never returns can be halted.
  async stepOver(wait = 30000) {
    const pc = (await this.reg('pc')) & ~1;
    const bl = await this.blAt(pc);
    if (!bl) return this.step();
    return this.runTo(pc + bl[1], wait);          // past the BL (and call_bi's halfword)
  }

  async breakAt(addr) {
    const a = addr & ~1;
    const r = await this.setBp(a);
    if (r !== 'OK') throw new GdbError(`breakpoint at 0x${a.toString(16)} refused (${r || 'not supported'})`);
    this.bps.add(a);
  }

  async unbreak(addr) {
    const a = addr & ~1;
    this.bps.delete(a);
    await this.clearBp(a);
  }

  // Detach. A running CPU is halted first so the breakpoints can be cleared;
  // otherwise one hit later would stop it with nobody attached.
  // A command for the GDB server itself ("monitor ..." in gdb): its output skipped.
  // false when the server doesn't know it (QEMU) or doesn't answer.
  async monitor(cmd, timeout = 3000) {
    const run = this.queue.then(async () => {
      if (this.running) return false;
      this.send('qRcmd,' + Buffer.from(cmd, 'latin1').toString('hex'));
      for (;;) {
        const r = await this.packet(timeout);
        if (r !== 'OK' && r.length > 1 && r[0] === 'O') continue;   // the server's console output
        return r === 'OK';
      }
    });
    this.queue = run.catch(() => {});
    return run.catch(() => false);
  }

  async close(resume = true) {
    this.onStop = null;
    try {
      if (resume && this.running && !this.closed) { try { await this.halt(); } catch { /* still running */ } }
      if (resume && !this.running && !this.closed) {
        for (const a of [...this.bps, ...(this.tempBp !== null ? [this.tempBp] : [])]) {
          try { await this.clearBp(a, 2000); } catch { /* gone */ }
        }
        this.bps.clear();
        // Let the CPU run on. QEMU resumes on detach; OpenOCD leaves it halted (found
        // on the Pico 2: the console then never answered), so ask OpenOCD first.
        await this.monitor('resume');
        try { await this.request('D', 2000); } catch { /* detached anyway */ }
      }
    } catch { /* the connection went */ }
    this.closed = true;
    this.s.destroy();
  }
}

// 'NZCV' with '-' for clear bits.
function flags(xpsr) {
  return [['N', 31], ['Z', 30], ['C', 29], ['V', 28]].map(([c, b]) => ((xpsr >>> b) & 1 ? c : '-')).join('');
}

module.exports = { setTrace, trace, Gdb, GdbError, CORE, flags, decode };

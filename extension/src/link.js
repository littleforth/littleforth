// link.js - talk to the Forth over serial, a subprocess or TCP (port of ide/fide/link.py).
//
// One protocol for all three. At connect we turn the board's echo off (we show
// what we send ourselves). After every line we send a marker line, `.( <RS>)`,
// RS being byte 0x1E. `.(` is immediate, so it prints in compile state too, and
// the board reads it only after the line before has finished. Everything the
// board printed before RS is the reply to that line.
//
// After a line the kernel prints a newline if the line printed anything, then
// `ok` and a newline if it is interpreting. So the reply ends in `ok` exactly
// when STATE is 0 after a line that ran to its end. If the reply has neither
// `ok` nor an error, a second marker (byte 0x1F) settles it: the first marker's
// own end (newline, and `ok` if interpreting) comes before it. That tells a
// line left inside a definition (`: FOO`) from an ABORT, which empties STATE
// without `ok`. The link always knows whether the board is interpreting.
//
// If a line never finishes (a word that reads KEY eats the marker), Stop or a
// timeout leaves the link unsure; the next exchange first resyncs with a third
// marker (byte 0x1D) and `[`, which ends any half-made definition.
//
// The kernel is not changed for any of this. The echo flag is the 11th cell of
// the kernel's system variables, at STATE + 40 (src/forth.h, struct sys).
'use strict';
const { spawn } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
const net = require('net');

const holder = new AsyncLocalStorage();               // the link whose lock this async call chain holds

const RS = '\x1e', PROBE = '\x1f', SYNC = '\x1d';
const MARKER = '.( ' + RS + ')';
const PROBE_LINE = '.( ' + PROBE + ')';
const ECHO_OFF = '[ 0 STATE #40 + !';             // [ first: ends a half-typed definition
const ECHO_ON = '[ 1 STATE #40 + !';
const ERROR_RE = / \?(-\d+) ?\n?$/;
const LINE_MAX = 128;                              // the kernel's TIB; a longer line is refused (?-18)

class LinkError extends Error {}
class Stopped extends LinkError { constructor() { super('stopped'); } }
// A line the board didn't finish in time; .line is the line.
class Timeout extends LinkError {
  constructor(line) {
    super(`the board didn't answer "${line.length > 40 ? line.slice(0, 40) + '...' : line}" (is it paused in the debugger, or still running a word?)`);
    this.line = line;
  }
}

// ---- transports: write(string), onData(fn), onClose(fn), close() ----

class SerialTransport {
  // serialport is loaded only for boards, so the rest works without it
  static async open(port, baud) {
    const { SerialPort } = require('serialport');
    const t = new SerialTransport();
    t.name = `${port}, ${baud}`;
    await new Promise((res, rej) => {
      t.s = new SerialPort({ path: port, baudRate: baud, autoOpen: false });
      t.s.open(e => (e ? rej(new LinkError(`${port}: ${e.message}`)) : res()));
    });
    // DTR on: the Debug Probe sends the board's output to the PC only while it is
    // (a terminal "connected"); without it replies arrive late or not at all.
    await new Promise(res => t.s.set({ dtr: true }, () => res()));
    // The Debug Probe applies the new line settings just after the port opens;
    // bytes sent at once can arrive corrupt. Let it settle, drop what came first.
    await sleep(250);
    await new Promise(res => t.s.flush(() => res()));
    return t;
  }
  write(s) { this.s.write(Buffer.from(s, 'latin1')); }
  onData(fn) { this.s.on('data', b => fn(b.toString('latin1'))); }
  onClose(fn) { this.s.on('close', fn); this.s.on('error', fn); }
  close() { try { this.s.close(); } catch { /* already closed */ } }
}

class ProcessTransport {               // the host build, or anything that talks on stdin/stdout
  static async open(argv) {
    const t = new ProcessTransport();
    t.name = argv.join(' ');
    t.p = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    await new Promise((res, rej) => { t.p.once('spawn', res); t.p.once('error', e => rej(new LinkError(`${argv[0]}: ${e.message}`))); });
    return t;
  }
  write(s) {
    if (!this.p.stdin.writable) throw new LinkError('the program has stopped');
    this.p.stdin.write(Buffer.from(s, 'latin1'));
  }
  onData(fn) { const f = b => fn(b.toString('latin1')); this.p.stdout.on('data', f); this.p.stderr.on('data', f); }
  onClose(fn) { this.p.on('exit', fn); this.p.stdin.on('error', () => {}); }
  close() { try { this.p.kill(); } catch { /* gone */ } }
}

class TcpTransport {                   // QEMU with -serial tcp:HOST:PORT,server=on
  static async open(host, port, wait = 10000) {
    const t = new TcpTransport();
    t.name = `${host}:${port}`;
    const t0 = Date.now();
    for (;;) {
      try {
        t.s = await new Promise((res, rej) => { const s = net.connect(port, host, () => res(s)); s.once('error', rej); });
        return t;
      } catch {
        if (Date.now() - t0 > wait) throw new LinkError(`no answer on ${host}:${port}`);
        await sleep(100);
      }
    }
  }
  write(s) { this.s.write(Buffer.from(s, 'latin1')); }
  onData(fn) { this.s.on('data', b => fn(b.toString('latin1'))); }
  onClose(fn) { this.s.on('close', fn); this.s.on('error', () => {}); }
  close() { this.s.destroy(); }
}

// spec: 'COM5' or '/dev/ttyACM0' (serial), 'tcp:HOST:PORT', or 'run:PROGRAM'
function openTransport(spec, baud = 115200) {
  if (spec.startsWith('tcp:')) {
    const [, host, port] = spec.split(':');
    return TcpTransport.open(host || '127.0.0.1', Number(port));
  }
  if (spec.startsWith('run:')) return ProcessTransport.open([spec.slice(4).trim().replace(/^"|"$/g, '')]);
  return SerialTransport.open(spec, baud);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- the link ----

class Reply {
  constructor(text, error, ok) {
    this.text = text;        // what the board printed, without the trailing ok
    this.error = error;      // throw code or null; -1 ABORT, -2 ABORT"
    this.ok = ok;            // the line ran to its end and the board is interpreting
    this.restarted = null;   // set when the board had been reset: what it printed then
  }
}

class Link {
  constructor(transport) {
    this.t = transport;
    this.buf = '';
    this.closed = false;
    this.interpreting = true;
    this.unsure = false;                 // a reply was not seen to its end: resync first
    this.waiters = new Set();
    this.queue = Promise.resolve();      // one exchange at a time
    this.busy = false;
    this.onOutput = null;                // output outside an exchange (interrupts, a reset)
    transport.onData(s => {
      this.buf += s.replace(/\r/g, '');
      this.wake();
      if (!this.busy && this.onOutput && this.buf) { const o = this.buf; this.buf = ''; this.onOutput(o); }
    });
    transport.onClose(() => { this.closed = true; this.wake(); if (this.onClose) this.onClose(); });
  }

  wake() { for (const w of this.waiters) w(); }

  write(s) { this.t.write(s); }

  // Wait until pred(buf) is not null; return it. null on timeout; throws Stopped
  // when stop.stopped is set, LinkError when the connection closes.
  waitFor(pred, timeout, stop) {
    return new Promise((resolve, reject) => {
      let timer = null, tick = null;
      const done = (f, v) => { this.waiters.delete(check); clearTimeout(timer); clearInterval(tick); f(v); };
      const check = () => {
        const r = pred(this.buf);
        if (r !== null && r !== undefined) return done(resolve, r);
        if (this.closed) return done(reject, new LinkError('connection closed'));
        if (stop && stop.stopped) return done(reject, new Stopped());
      };
      this.waiters.add(check);
      if (timeout != null) timer = setTimeout(() => done(resolve, null), timeout);
      if (stop) tick = setInterval(check, 50);
      check();
    });
  }

  // Text before the next ch; ch and the text are consumed.
  async takeUntil(ch, timeout, stop) {
    const r = await this.waitFor(b => { const i = b.indexOf(ch); return i >= 0 ? i : null; }, timeout, stop);
    if (r === null) return null;
    const text = this.buf.slice(0, r);
    this.buf = this.buf.slice(r + 1);
    return text;
  }

  // Consume s from the front of the buffer; anything else marks the link unsure.
  async takeExact(s, timeout = 2000) {
    const got = await this.waitFor(b => (b.startsWith(s) ? true : s.startsWith(b) ? null : false), timeout);
    if (got) this.buf = this.buf.slice(s.length);
    else this.unsure = true;
  }

  // End any half line and half definition, echo off, drain to a fresh marker.
  async resync(timeout = 5000) {
    this.write('\n' + ECHO_OFF + '\n.( ' + SYNC + ')\n');
    const text = await this.takeUntil(SYNC, timeout);
    if (text === null) {
      // Stop only stops our waiting: a word that never returns keeps the board busy
      if (this.busyWith) throw new LinkError(`the board is still running "${this.busyWith.slice(0, 40)}" (Stop doesn't stop the board): press its reset button, then try again`);
      throw new LinkError('the board did not answer (is it running, and is this the right port?)');
    }
    await this.takeExact('\nok\n');
    this.unsure = false;
    this.busyWith = null;
    this.interpreting = true;
    return text;
  }

  // Run fn with the link to itself (exchanges never interleave). Re-entrant: a job of
  // several lines (a temporary definition, reading the stack) holds the link for all of
  // them, and its own exchanges inside run at once; anyone else's wait until it ends.
  locked(fn) {
    if (holder.getStore() === this) return fn();
    const run = this.queue.then(() => holder.run(this, async () => { this.busy = true; try { return await fn(); } finally { this.busy = false; this.flushOutput(); } }));
    this.queue = run.catch(() => {});
    return run;
  }

  flushOutput() {
    if (this.onOutput && this.buf && !this.busy) { const o = this.buf; this.buf = ''; this.onOutput(o); }
  }

  // Start a session. Returns what the board printed before (a banner). If the
  // setup line comes back with an error (a byte corrupted as the port opened),
  // it is sent again.
  sync(timeout = 3000, tries = 3) {
    return this.locked(async () => {
      let banner = [];
      for (let i = 0; i < tries; i++) {
        const text = await this.resync(timeout);
        const bad = text.includes(' ?-');
        const lines = text.split('\n').filter(l => l.trim() && l.trim() !== 'ok' && !l.includes('STATE #40 + !') && !l.includes(RS) && !l.includes(' ?-'));
        if (i === 0) banner = lines;
        if (!bad) return banner.join('\n');
      }
      throw new LinkError("the board's replies are garbled (check the baud rate and wiring)");
    });
  }

  // Send one line; wait until the board has finished it. Resolves to a Reply.
  // Throws Timeout or Stopped if it does not finish (the link then resyncs
  // before the next line).
  exchange(line, timeout = null, stop = null) {
    line = line.replace(/\t/g, ' ').replace(/[\r\n]+$/, '');
    return this.locked(async () => {
      if (this.unsure) await this.resync();
      this.write(line + '\n' + MARKER + '\n');
      let text;
      try {
        text = await this.takeUntil(RS, timeout, stop);
      } catch (e) {
        if (e instanceof Stopped) { this.unsure = true; this.busyWith = line; }
        throw e;
      }
      if (text === null) { this.unsure = true; this.busyWith = line; throw new Timeout(line); }
      if (text.endsWith('.( ')) {
        const tail = ')\n' + RS;
        const echoed = await this.waitFor(b => (b.length >= 3 || !tail.startsWith(b) ? b.slice(0, 3) === tail : null), 2000);
        if (echoed) return this.afterReset(line, text);
      }
      let ok = text.endsWith('ok\n');
      if (ok) text = text.slice(0, -3);
      const m = ERROR_RE.exec(text);
      let err = m ? Number(m[1]) : null;
      let interp;
      if (ok || err !== null) {
        await this.takeExact('\nok\n');
        interp = true;
      } else {
        // neither: still compiling, or aborted. The marker's own end settles it.
        this.write(PROBE_LINE + '\n');
        const end = await this.takeUntil(PROBE, 5000);
        if (end === null) { this.unsure = true; throw new Timeout(line); }
        if (end === '\n' || end === '\nok\n') {   // the marker line's own end
          interp = end === '\nok\n';
          await this.takeExact(interp ? '\nok\n' : '\n');
          if (interp) err = text.trim() ? -2 : -1;   // STATE emptied without ok: ABORT or ABORT"
        } else {
          // The line read our marker line as its input (ACCEPT) and printed it:
          // the RS was its output. Its own end is in `end`.
          text = text + RS + end;
          ok = text.endsWith('ok\n');
          if (ok) text = text.slice(0, -3);
          interp = ok;
          await this.takeExact(interp ? '\nok\n' : '\n');
        }
      }
      this.interpreting = interp;
      return new Reply(text.replace(/\n+$/, ''), err, ok);
    });
  }

  async afterReset(line, text) {
    // The board echoed our marker line: echo is on again, so it was reset.
    this.buf = this.buf.slice(3);                // ) \n RS of the echo
    text = text.slice(0, -3);
    const i = text.indexOf(line + '\n');         // drop the echo of our line
    const printed = i >= 0 ? text.slice(0, i) : '';
    if (i >= 0) text = text.slice(i + line.length + 1);
    const ok = text.endsWith('ok\n');
    if (ok) text = text.slice(0, -3);
    const m = ERROR_RE.exec(text);
    await this.resync();
    const rep = new Reply(text.replace(/\n+$/, ''), m ? Number(m[1]) : null, ok);
    rep.restarted = printed;
    return rep;
  }

  async close(echoOn = true) {
    if (!this.closed && echoOn) {
      try { this.write(ECHO_ON + '\n'); await sleep(50); } catch { /* gone */ }
    }
    this.closed = true;
    this.t.close();
  }
}

async function connect(spec, baud) {
  const link = new Link(await openTransport(spec, baud));
  try {
    link.banner = await link.sync();
  } catch (e) {
    await link.close(false);
    throw e;
  }
  return link;
}

module.exports = { Link, Reply, LinkError, Stopped, Timeout, openTransport, connect, LINE_MAX, RS };

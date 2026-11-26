// forth.js - the one owner of the board. Everything that talks to the board goes
// through here: the console, sending files, the views. It knows the connection's
// state, the board, the stack and the words, and tells the rest when they change.
// No vscode in this file, so it runs under node for the tests.
'use strict';
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const L = require('./link');
const B = require('./board');

const BOARDS = require('../boards');

// The board from STATE's address: each build puts its kernel variables in one place.
const boardFromState = addr => BOARDS.fromState(addr);

// state: 'off' | 'connecting' | 'ready' | 'busy' | 'lost'
class Forth extends EventEmitter {
  constructor() {
    super();
    this.state = 'off';
    this.link = null;
    this.spec = null;           // the port spec: COM3, tcp:host:port, run:program
    this.port = '';             // its name for people
    this.board = null;          // a board's name (boards/); null until known
    this.stack = { items: [], base: 10 };
    this.words = [];            // the user's words on the board, newest first
    this.heads = [];            // [[header address, name]] newest first
    this.here = null;           // HERE when the words were last read
    this.blockWords = [];
    this.dict = null;           // {used, size}
    this.stop = null;
    this.retry = null;
    this.busyCount = 0;
    this.noBoard = true;        // with no board found, run the kernel here (WebAssembly)
    this.lineMap = [];          // [{file, no, col, end, lo, hi}]: the code each sent line made (the debugger's)
  }

  set(state) { if (this.state !== state) { this.state = state; this.emit('state', state); } }
  get connected() { return !!this.link; }
  chip() { return BOARDS.chipOf(this.board); }
  firmware() { const b = BOARDS.get(this.board); return b && b.firmware ? b.firmware[0] : null; }

  // ---- connecting ----
  // spec given: that port. Otherwise every likely serial port is tried in turn.
  // spec: a port to use. None: the project's port (this.preferred), then every likely
  // port; if none answers, Forth runs here in VS Code (only when no port was named).
  async connect(spec, baud = 115200) {
    if (this.link) return true;
    this.stopRetry();
    this.set('connecting');
    const named = !!spec;
    const tries = spec ? [spec] : [...new Set([...(this.preferred ? [this.preferred] : []), ...(await this.candidates())])];
    let last = null;
    for (const s of tries) {
      try {
        const link = s === 'wasm' ? await wasmLink() : await L.connect(s, baud);
        await this.attach(link, s, baud);
        return true;
      } catch (e) { last = e; }
    }
    // no board answered: Forth runs here, in VS Code, until one does
    if (!named && this.noBoard) {
      try {
        await this.attach(await wasmLink(), 'wasm', baud);
        this.emit('note', 'no board answered: Forth is running here in VS Code. Plug a board in and the console moves to it.');
        this.watchForBoard(baud);
        return true;
      } catch (e) { last = e; }
    }
    this.set('off');
    const why = !tries.length ? 'no serial port found: is the board plugged in?' : last ? last.message : 'no answer';
    this.emit('note', `not connected: ${why}`);
    return false;
  }

  async candidates() {
    const F = require('./flash');
    let all = [];
    for (const b of BOARDS.real) {
      try { all.push(...(await F.ports(b.name)).filter(p => p.likely).map(p => p.path)); } catch { /* no serialport */ }
    }
    if (!all.length) try { all = (await F.ports(null)).map(p => p.path); } catch { /* none */ }
    return [...new Set(all)];
  }

  async attach(link, spec, baud) {
    this.link = link;
    this.spec = spec;
    this.port = spec === 'wasm' ? 'no board' : /^(run|tcp):/.test(spec) ? path.basename(spec.slice(4)) : spec;
    link.onOutput = s => this.emit('output', s);
    link.onClose = () => {
      if (this.link !== link) return;
      this.link = null;
      this.set('lost');
      this.emit('note', `connection lost: ${this.port} went away`);
      this.reconnectLater(spec, baud);
    };
    if (link.banner) this.emit('output', link.banner + '\n');
    // which board: from where its kernel keeps STATE; failing that, the project's board
    let why = '';
    try {
      const s = await link.locked(() => B.snapshot(link));
      this.board = boardFromState(s.state) || (spec.startsWith('run:') || spec === 'wasm' ? 'Host build' : null);
      if (!this.board) why = `STATE at $${(s.state >>> 0).toString(16).toUpperCase()} is not a build this extension knows`;
    } catch (e) { this.board = null; why = `couldn't read it: ${e.message}`; }
    if (!this.board) {
      const p = this.projectBoard && this.projectBoard();
      this.board = p && BOARDS.chipOf(p) ? p : null;
      this.emit('note', `board not recognised (${why})${this.board ? `: taken as ${this.board}, the project's board` : ''}`);
    }
    this.set('ready');
    this.emit('note', `connected to ${this.board || 'the board'} on ${this.port}`);
    await this.refresh();
  }

  reconnectLater(spec, baud, every = 2000, tries = 60) {
    if (/^run:/.test(spec) || spec === 'wasm') { this.set('off'); return; }
    let n = 0, busy = false;
    this.retry = setInterval(async () => {
      if (busy) return;
      if (this.link || ++n > tries) {
        this.stopRetry();
        if (!this.link) { this.set('off'); this.emit('note', `${this.port} didn't come back`); }
        return;
      }
      busy = true;
      try {
        const lk = await L.connect(spec, baud);
        if (this.link || !this.retry) { await lk.close(); return; }
        this.stopRetry();
        await this.attach(lk, spec, baud);
      } catch { /* not back yet */ } finally { busy = false; }
    }, every);
  }

  // While on no board: look for one every few seconds and move to it.
  watchForBoard(baud) {
    clearInterval(this.watch);
    let busy = false;
    this.watch = setInterval(async () => {
      if (this.spec !== 'wasm') { clearInterval(this.watch); return; }
      if (busy || this.state !== 'ready') return;
      busy = true;
      try {
        for (const port of await this.candidates()) {
          let lk;
          try { lk = await L.connect(port, baud); } catch { continue; }   // nothing answers there
          if (this.spec !== 'wasm') { await lk.close(); return; }
          clearInterval(this.watch);
          const old = this.link;
          this.link = null;
          old.onOutput = null;
          await old.close(false);
          this.emit('note', `a board answered on ${port}: the console is on it now (words typed in VS Code stay there)`);
          await this.attach(lk, port, baud);
          return;
        }
      } finally { busy = false; }
    }, 3000);
    if (this.watch.unref) this.watch.unref();
  }

  stopRetry() { if (this.retry) { clearInterval(this.retry); this.retry = null; } }

  async disconnect() {
    this.stopRetry();
    clearInterval(this.watch);
    const lk = this.link;
    this.link = null;
    if (lk) { lk.onOutput = null; await lk.close(); }   // the board's reply to closing isn't the user's
    this.stack = { items: [], base: 10 };
    this.words = []; this.blockWords = []; this.dict = null; this.lineMap = []; this.heads = []; this.here = null;
    this.set('off');
    this.emit('note', 'disconnected');
    this.emit('changed');
  }

  // ---- doing things ----
  // Run f with the board marked busy; the views refresh when the last job ends.
  async job(f) {
    if (!this.link) throw new L.LinkError('not connected');
    this.busyCount++;
    this.set('busy');
    try { return await f(this.link); } finally {
      if (--this.busyCount === 0 && this.link) { this.set('ready'); }
    }
  }

  // One line typed at the console. -> Reply (text, error, ok)
  async run(line) {
    this.stop = { stopped: false };
    const stop = this.stop;
    const r = await this.job(link => link.exchange(line, null, stop));
    await this.refresh({ words: /(^|\s)(:|VARIABLE|CONSTANT|CREATE|VALUE|BUFFER:|2VARIABLE|EMPTY|FORGET|MARKER|CODE)(\s|$)/i.test(line) });
    return r;
  }

  interrupt() { if (this.stop) this.stop.stopped = true; }

  // Lines from B.expand; onLine(i, line, reply). -> the result of B.sendLines
  // byWord(line): inside definitions send that line a word at a time, so the debugger
  // can stop on each word (about three times the exchanges).
  async send(lines, onLine, byWord = () => true) {
    this.stop = { stopped: false };
    const stop = this.stop;
    const res = await this.job(link => B.sendLines(link, lines, { onLine, stop, map: this.lineMap, byWord }));
    await this.refresh({ words: true });
    return res;
  }

  // The stack (always) and the word list (when asked), read from the board.
  async refresh({ words = true } = {}) {
    const link = this.link;
    if (!link) return;
    if (!link.interpreting) { this.emit('changed'); return; }
    if (words) {
      try {
        const w = await B.userWords(link, this.board);
        this.words = w.words.filter(n => !n.startsWith('(FIDE-'));
        this.heads = w.heads.filter(([, n]) => !n.startsWith('(FIDE-'));   // [[header, name]] newest first (the Memory view's)
        this.here = w.here;
        this.blockWords = w.block;
        const size = (BOARDS.get(this.board) || {}).dictSize;
        this.dict = size ? { used: w.first === null ? 0 : w.here - w.first, size } : null;
      } catch { /* too deep or full: keep the last list */ }
    }
    try { const s = await B.readStack(link); this.stack = { items: s.items, base: s.base }; } catch { /* next time */ }
    this.emit('changed');
  }

  // The stack as the prompt shows it: ( 3 4 ) with at most n items.
  stackText(n = 6) {
    const it = this.stack.items;
    if (!it.length) return '';
    const shown = it.length > n ? ['…', ...it.slice(-n)] : it;
    return `( ${shown.join(' ')} ) `;
  }
}

// The kernel in WebAssembly, for working with no board
async function wasmLink() {
  const { WasmTransport } = require('./wasmlink');
  const link = new L.Link(await WasmTransport.open());
  try { link.banner = await link.sync(); } catch (e) { await link.close(false); throw e; }
  return link;
}

function findFirmware(name, dirs) {
  for (const d of dirs) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  return null;
}

module.exports = { Forth, boardFromState, findFirmware };

// dap.js - the debugger as a VS Code debug adapter (Debug Adapter Protocol),
// so VS Code's own debugger shows it: its toolbar, Variables, Watch, Call
// Stack, breakpoints in the margin, the Disassembly view and the Debug Console.
// The work is debug.js's; this file only answers the protocol. It has no
// VS Code API in it (tested by sending it requests, test/dap.test.js).
//
// env: {
//   link(): the console's Link, connected (attaching needs it)
//   index(): model.Index (names: words, registers)
//   lineMap(): [{file, no, lo, hi}] code addresses (as stored) per source line sent
//   definition(name): {path, line} of a word's newest definition in the sources
//   startServer(): resolves when a GDB server listens (or null), returns its process or null
//   onStopped(adapter) / onEnded(adapter): to refresh the sidebar
// }
'use strict';
const { Debugger, INLINE } = require('./debug');
const { CORE, flags } = require('./gdb');
const { disassemble } = require('./thumbdis');
const T = require('./thumb');
const PD = require('./periphdata');
const { sourceOf } = require('./inspect');

const THREAD = 1;
const REF = { STACK: 1, RSTACK: 2, CPU: 3, PERIPH: 4 };     // fixed variable references; lazy registers above 1000
const ALIAS = { r6: 'tos', r5: 'psp', sp: 'rsp' };
const hex8 = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const u32 = v => v >>> 0;

class ForthDebugAdapter {
  constructor(env) {
    this.env = env;
    this.seq = 1;
    this.out = [];                         // listeners: fn(message)
    this.d = null;
    this.server = null;
    this.bps = new Map();                  // address -> {kind: 'source'|'function'|'instruction', key}
    this.lazy = new Map();                 // variables reference -> register address
    this.stepping = null;                  // why the next stop happens: 'step' | 'pause' | null
    this.stopOnAttach = false;
    this.srcReq = new Map();               // source path -> its breakpoints as VS Code last sent them
    this.fnReq = [];                       // function breakpoints as last sent
    this.ids = new Map();                  // 'kind key line|name' -> id, kept while VS Code knows it
    this.nextId = 1;
  }

  idFor(k) { if (!this.ids.has(k)) this.ids.set(k, this.nextId++); return this.ids.get(k); }

  onDidSendMessage(fn) { this.out.push(fn); return { dispose: () => { this.out = this.out.filter(f => f !== fn); } }; }
  send(m) { m.seq = this.seq++; for (const f of this.out) f(m); }
  event(event, body = {}) { this.send({ type: 'event', event, body }); }

  async handleMessage(m) {
    if (m.type !== 'request') return;
    const f = this['r_' + m.command];
    try {
      const body = f ? await f.call(this, m.arguments || {}) : undefined;
      this.send({ type: 'response', request_seq: m.seq, command: m.command, success: !!f, body: body || {}, ...(f ? {} : { message: `not supported: ${m.command}` }) });
    } catch (e) {
      this.send({ type: 'response', request_seq: m.seq, command: m.command, success: false, message: e.message, body: { error: { id: 1, format: e.message, showUser: m.command === 'attach' } } });
    }
  }

  get halted() { return !!this.d && !this.d.g.running; }

  // ---- session ----
  r_initialize() {
    return {
      supportsConfigurationDoneRequest: true, supportsFunctionBreakpoints: true, supportsInstructionBreakpoints: true,
      supportsDisassembleRequest: true, supportsStepBack: true, supportsReadMemoryRequest: true, supportsSteppingGranularity: true,
      supportsEvaluateForHovers: true, supportsTerminateRequest: false, supportsLoadedSourcesRequest: false,
    };
  }

  async r_attach(args) {
    const link = this.env.link();
    if (!link) throw new Error('not connected to the board: connect first (Forth in the status bar)');
    this.stopOnAttach = !!args.stopOnAttach;
    const [host, port] = (args.gdb || 'localhost:3333').split(':');
    this.server = await this.env.startServer(host, Number(port), args);
    try {
      this.d = await Debugger.attach(host, Number(port), link);
    } catch (e) {
      if (this.server) { this.server.kill(); this.server = null; }
      require('./gdb').trace(`attach failed: ${e.message}`);
      if (this.env.note) this.env.note(`debugging didn't start: ${e.message}`);
      throw e;
    }
    this.d.g.onStop = () => this.stopped();
    this.event('initialized');                 // now VS Code sends the breakpoints, then configurationDone
  }

  async r_configurationDone() {
    if (this.stopOnAttach) { await this.refresh(); this.event('stopped', { reason: 'entry', threadId: THREAD, allThreadsStopped: true }); }
    else {                                      // attaching halted the CPU: let it run on
      try { await this.d.g.cont(); } catch (e) { this.say(`Attached, but the CPU doesn't run on: ${e.message}`); throw e; }
    }
    if (this.env.onStopped) this.env.onStopped(this);   // the panels: running, not paused
  }

  async r_disconnect() { await this.end(); }

  // VS Code calls this when the session goes (stop, restart, window closed).
  dispose() { this.end().catch(() => {}); this.out = []; }

  async end() {
    const d = this.d;
    this.d = null;
    if (d) { try { await d.close(); } catch { /* gone */ } }
    if (this.server) {                         // gone before a restart starts another on its port
      const p = this.server; this.server = null;
      const gone = p.exitCode !== null ? Promise.resolve() : new Promise(r => { p.once('exit', r); setTimeout(r, 3000); });
      p.kill(); await gone;
    }
    this.bps.clear();
    if (this.env.onEnded) this.env.onEnded(this);
  }

  r_threads() { return { threads: [{ id: THREAD, name: 'Cortex-M' }] }; }

  // ---- stops ----
  async refresh() {
    await this.d.refreshWords();
    const gone = await this.d.checkBreaks(new Map([...this.bps.keys()].map(a => [a, this.wordAt(a)]).filter(([, n]) => n)));
    for (const [a] of gone) this.bps.delete(a);
    this.regs = await this.d.g.regs();
    this.stack = await this.d.dataStack();
    this.rstack = await this.d.returnStack(32);
  }

  wordAt(a) { const r = this.d.userRanges.find(x => x[0] <= a && a < x[1]); return r ? r[2] : null; }

  async stopped() {
    if (!this.d || this.internal) return;           // our own steps inside a line step
    const asked = this.stepping;
    let pc = null;
    try { pc = u32((await this.d.g.reg('pc')) & ~1); } catch { /* registers not readable: in reset */ }
    // A halt nobody asked for, outside our code (the boot ROM, or registers not
    // readable): the board was reset. Run on; its words not SAVEd are gone.
    if (!asked && !(pc !== null && this.bps.has(pc)) && (pc === null || pc < this.codeStart())) return this.afterReset();
    try { await this.refresh(); } catch (e) {
      this.say(`Paused, but the board can't be read: ${e.message}`);
      return;
    }
    pc = u32(this.regs.pc & ~1);
    const nm = await this.d.nameAt(pc);
    this.where = nm ? (nm[1] ? `${nm[0]}+${nm[1]}` : nm[0]) : hex8(pc);
    // the history of stops, for stepping back: the CPU can't go back, so a step
    // back shows an earlier stop's registers and stacks as they were then
    this.history = this.history || [];
    this.history.push({ regs: this.regs, stack: this.stack, rstack: this.rstack, where: this.where });
    if (this.history.length > 500) this.history.shift();
    this.at = this.history.length - 1;
    const reason = this.bps.has(pc) ? 'breakpoint' : this.stepping || 'pause';
    this.stepping = null;
    this.event('stopped', { reason, threadId: THREAD, allThreadsStopped: true, ...(reason === 'breakpoint' ? { hitBreakpointIds: [pc] } : {}) });
    if (this.env.onStopped) this.env.onStopped(this);
  }

  codeStart() { let lo = Infinity; for (const a of this.d.builtins.keys()) if (a < lo) lo = a; return lo === Infinity ? 0 : lo; }

  say(text) { this.event('output', { category: 'console', output: text + '\n' }); if (this.env.note) this.env.note(text); }

  // After a reset the breakpoints' words are gone (unless SAVEd): take them out
  // and let the CPU run; the next file sent sets them again (resolveAgain).
  async afterReset() {
    this.stepping = null;
    // Halts that keep coming at once with no readable pc: not a reset but the probe has
    // lost the board (OpenOCD: "neither halted nor running"; USB gone, board unpowered).
    const now = Date.now();
    this.resets = (this.resets || []).filter(t => now - t < 3000).concat(now);
    if (this.resets.length > 3) {
      this.say('The debug probe has lost the board (the USB connection dropped, or the board lost power or was unplugged). Debugging stopped: once the board and probe are back, reconnect the console and start Debug again.');
      require('./gdb').trace('lost the board: ending the session');
      await this.end();
      this.event('terminated');
      return;
    }
    for (const a of [...this.bps.keys()]) { try { await this.d.g.unbreak(a); } catch { /* gone */ } }
    this.bps.clear();
    try { await this.d.g.cont(); } catch (e) { this.say(`The board was reset and doesn't run on: ${e.message}`); return; }
    this.say('The board was reset: it runs on. Words not SAVEd are gone; send your file again and its breakpoints are set again.');
    const pending = 'the board was reset: set again when the file is sent';
    for (const [path, req] of this.srcReq) for (const b of req) this.event('breakpoint', { reason: 'changed', breakpoint: { id: this.idFor(`source ${path} ${b.line}`), line: b.line, verified: false, message: pending } });
    for (const b of this.fnReq) this.event('breakpoint', { reason: 'changed', breakpoint: { id: this.idFor(`function ${b.name.trim().toUpperCase()}`), verified: false, message: pending } });
    if (this.env.onStopped) this.env.onStopped(this);
  }

  // ---- where code is: source lines ----
  // The source line of a code address: the line whose code holds it (sent with the
  // line map), else the definition line of the word it is in.
  async lineOf(addr) {
    const a = u32(addr & ~1) - this.d.alias;
    const hit = this.env.lineMap().filter(m => m.lo <= a && a < m.hi).pop();
    if (hit) return { path: hit.file, line: hit.no, col: hit.col, end: hit.end };
    const nm = await this.d.nameAt(addr);
    if (nm) { const def = this.env.definition(nm[0]); if (def) return { path: def.path, line: def.line + 1 }; }
    return null;
  }

  // The first code address of a source line (as run), or null
  addrOfLine(path, line) {
    const same = (x, y) => (process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y);
    const hits = this.env.lineMap().filter(m => same(m.file, path) && m.no === line);
    if (!hits.length) return null;
    const newest = Math.max(...hits.map(h => h.send || 0));     // the line's latest send; its first word
    const m = hits.filter(h => (h.send || 0) === newest).sort((x, y) => x.lo - y.lo)[0];
    const lo = u32(m.lo + this.d.alias);
    // a line that starts a definition: its code starts after the header, at the word's code field
    const r = this.d.userRanges.find(x => x[0] >= lo && x[0] < u32(m.hi + this.d.alias));
    return r ? r[0] : lo;
  }

  // ---- breakpoints ----
  async withHalted(f) {
    const wasRunning = this.d.g.running;
    if (wasRunning) { this.stepping = 'internal'; this.d.g.onStop = null; await this.d.g.halt(); this.d.g.onStop = () => this.stopped(); }
    try { return await f(); } finally { if (wasRunning) { this.stepping = null; await this.d.g.cont(); } }
  }

  // compute() -> [{addr|null, message, id, line}] in request order, worked out with the
  // CPU halted and the word list just read (words sent since the last stop count)
  async replace(kind, key, compute) {
    return this.withHalted(async () => {
      await this.d.refreshWords();
      const wanted = compute();
      for (const [a, b] of [...this.bps]) if (b.kind === kind && b.key === key && !wanted.some(w => w.addr === a)) { await this.d.g.unbreak(a); this.bps.delete(a); }
      const out = [];
      for (const w of wanted) {
        const at = { id: w.id, ...(w.line ? { line: w.line } : {}) };
        if (w.addr === null) { out.push({ ...at, verified: false, message: w.message }); continue; }
        if (!this.bps.has(w.addr)) {
          try { await this.d.g.breakAt(w.addr); } catch (e) { out.push({ ...at, verified: false, message: e.message }); continue; }
          this.bps.set(w.addr, { kind, key });
        }
        out.push({ ...at, verified: true, instructionReference: hex8(w.addr) });
      }
      return out;
    });
  }

  async r_setBreakpoints(args) {
    const path = args.source && args.source.path;
    this.srcReq.set(path, args.breakpoints || []);
    return { breakpoints: await this.applySource(path) };
  }

  applySource(path) {
    const req = this.srcReq.get(path) || [];
    return this.replace('source', path, () => {
      const defs = path ? this.env.definitionsIn(path) : {};
      return req.map(b => this.lineBreak(path, defs, b.line));
    });
  }

  // A margin breakpoint: on a definition's line, the word itself (its newest
  // code on the board); on any other line, the first code that line compiled.
  lineBreak(path, defs, line) {
    const at = { id: this.idFor(`source ${path} ${line}`), line };
    const def = Object.values(defs).find(d => d.line + 1 === line);
    if (def) {
      const r = this.d.userRanges.find(x => x[2].toUpperCase() === def.name.toUpperCase());
      return r ? { ...at, addr: r[0] } : { ...at, addr: null, message: `${def.name} is not on the board yet: it is set when the file is sent` };
    }
    const a = this.addrOfLine(path, line);
    return a !== null ? { ...at, addr: a } : { ...at, addr: null, message: 'no code from this line on the board yet: it is set when the file is sent' };
  }

  // After a send: breakpoints waiting for their code are worked out again, and
  // VS Code is told which are now set (or no longer).
  async resolveAgain() {
    if (!this.d) return;
    for (const p of this.srcReq.keys()) for (const bp of await this.applySource(p)) this.event('breakpoint', { reason: 'changed', breakpoint: bp });
    if (this.fnReq.length) for (const bp of await this.applyFunctions()) this.event('breakpoint', { reason: 'changed', breakpoint: bp });
  }

  async r_setFunctionBreakpoints(args) {
    this.fnReq = args.breakpoints || [];
    return { breakpoints: await this.applyFunctions() };
  }

  applyFunctions() {
    return this.replace('function', '', () => this.fnReq.map(b => ({ ...this.fnBreak(b), id: this.idFor(`function ${b.name.trim().toUpperCase()}`) })));
  }

  fnBreak(b) {
    const un = b.name.trim().toUpperCase();
    const r = this.d.userRanges.find(x => x[2].toUpperCase() === un);
    const bi = [...this.d.builtins].find(([, n]) => n.toUpperCase() === un);
    if (r) return { addr: r[0] };
    if (bi && INLINE.has(bi[1])) return { addr: null, message: `${bi[1]} is copied inline into your words: break on the word that uses it` };
    if (bi) return { addr: bi[0] };
    return { addr: null, message: `${b.name}: not on the board yet: it is set when it is sent` };
  }

  async r_setInstructionBreakpoints(args) {
    const wanted = (args.breakpoints || []).map(b => {
      const addr = u32((parseInt(b.instructionReference, 16) + (b.offset || 0)) & ~1);
      return { addr, id: this.idFor(`instruction ${addr}`) };
    });
    return { breakpoints: await this.replace('instruction', '', () => wanted) };
  }

  // ---- running ----
  // ---- stepping back through the stops recorded ----
  replaying() { return this.history && this.at < this.history.length - 1; }
  show(at, reason = 'step') {
    this.at = at;
    const h = this.history[at];
    Object.assign(this, { regs: h.regs, stack: h.stack, rstack: h.rstack, where: h.where });
    this.event('stopped', { reason, threadId: THREAD, allThreadsStopped: true, description: this.replaying() ? `recorded stop ${at + 1} of ${this.history.length}` : undefined });
    if (this.env.onStopped) this.env.onStopped(this);
  }
  async r_stepBack() { if (this.history && this.at > 0) this.show(this.at - 1); else throw new Error('no earlier stop recorded'); }
  async r_reverseContinue() { if (this.history && this.history.length) this.show(0); }

  async r_continue() {
    if (this.replaying()) { this.show(this.history.length - 1); return { allThreadsContinued: true }; }   // back to now first
    this.stepping = null; await this.d.g.cont(); if (this.env.onStopped) this.env.onStopped(this); return { allThreadsContinued: true }; }

  async r_pause() { this.stepping = 'pause'; await this.d.g.halt(); }

  // Step: one instruction (granularity "instruction", from the Disassembly view),
  // else to the next source line; over a call (next) or into it (stepIn).
  async r_next(args) { if (this.replaying()) return this.show(this.at + 1); await this.step(args.granularity === 'instruction', true); }
  async r_stepIn(args) { if (this.replaying()) return this.show(this.at + 1); await this.step(args.granularity === 'instruction', false); }

  async step(instruction, over) {
    const g = this.d.g;
    const one = async () => (over ? g.stepOver(30000) : g.step());
    this.stepping = 'step';
    this.internal = true;
    let start, moved = false;
    try {
      if (instruction) { await one(); moved = true; }
      else {
        start = await this.lineOf(await g.reg('pc'));
        for (let i = 0; i < 300 && !moved; i++) {
          await one();
          const now = await this.lineOf(await g.reg('pc'));
          if (!start || !now || now.path !== start.path || now.line !== start.line || now.col !== start.col) moved = true;
        }
      }
    } finally { this.internal = false; }
    if (moved) return this.stopped();
    // a long loop on one line: run to the next line's code, or back to the caller
    const ret = this.returnAddress();
    const next = this.env.lineMap().find(m => m.file === start.path && m.no > start.line);
    const targets = [next ? this.addrOfLine(next.file, next.no) : null, ret].filter(a => a !== null && !this.bps.has(a));
    for (const a of targets) await g.breakAt(a);
    this.stepping = 'step';
    const done = g.onStop;
    g.onStop = async () => { for (const a of targets) await g.unbreak(a); g.onStop = done; done(); };
    await g.cont();
  }

  // Where the current word returns to: the newest odd return-stack entry in other code
  returnAddress() {
    const here = this.wordAt(u32(this.regs.pc & ~1));
    for (const [, v, nm] of this.rstack || []) if (v & 1 && nm && nm.split('+')[0] !== here) return u32(v & ~1);
    return null;
  }

  async r_stepOut() {
    await this.refresh();
    const ret = this.returnAddress();
    if (ret === null) throw new Error("can't tell where this word returns to");
    const g = this.d.g;
    const set = !this.bps.has(ret);
    if (set) await g.breakAt(ret);
    this.stepping = 'step';
    const done = g.onStop;
    g.onStop = async () => { if (set) await g.unbreak(ret); g.onStop = done; done(); };
    await g.cont();
  }

  // ---- what VS Code shows ----
  async r_stackTrace() {
    const frames = [];
    const pc = u32(this.regs.pc & ~1);
    const add = async (id, addr) => {
      const nm = await this.d.nameAt(addr);
      const src = await this.lineOf(addr);
      frames.push({
        id, name: nm ? (nm[1] ? `${nm[0]}+${nm[1]}` : nm[0]) : 'kernel code', line: src ? src.line : 0, column: src ? (src.col !== undefined ? src.col + 1 : 1) : 0,
        ...(src && src.end !== undefined ? { endLine: src.line, endColumn: src.end + 1 } : {}),
        ...(src ? { source: { path: src.path, name: src.path.split(/[\\/]/).pop() } } : {}),
        instructionPointerReference: hex8(addr),
      });
    };
    await add(0, pc);
    let id = 1;
    // the return stack's calls (at a word's first instruction, the caller from lr first)
    for (const [, v, , kind] of this.rstack) if (kind === 'call') await add(id++, u32(v & ~1) - 2);
    return { stackFrames: frames, totalFrames: frames.length };
  }

  async r_scopes(args) {
    if (args.frameId !== 0) return { scopes: [] };
    const scopes = [
      { name: 'Data stack', variablesReference: REF.STACK, presentationHint: 'locals', expensive: false },
      { name: 'Return stack', variablesReference: REF.RSTACK, expensive: false },
      { name: 'CPU registers', variablesReference: REF.CPU, presentationHint: 'registers', expensive: false },
    ];
    const p = await this.peripheralOfLine();
    if (p) scopes.push({ name: `${p.name} (registers)`, variablesReference: REF.PERIPH, expensive: false });
    return { scopes };
  }

  // The peripheral the current source line names (SIO for SIO.GPIO_OUT_XOR)
  async peripheralOfLine() {
    const src = await this.lineOf(this.regs.pc);
    if (!src || !this.env.lineText) return null;
    const text = this.env.lineText(src.path, src.line) || '';
    for (const t of text.split(/\s+/)) {
      const c = this.env.index().classify(t, 10);
      if (c.kind === 'register' || c.kind === 'periph') return c.periph;
    }
    return null;
  }

  async r_variables(args) {
    const ref = args.variablesReference;
    const num = (name, v, extra = {}) => ({ name, value: String(v | 0), type: hex8(v), variablesReference: 0, ...extra });
    if (ref === REF.STACK) {
      if (!this.stack) return { variables: [{ name: '?', value: 'r5 is not the data stack here (an interrupt handler?)', variablesReference: 0 }] };
      const n = this.stack.length;
      return { variables: this.stack.slice().reverse().map((v, i) => num(i === 0 ? 'tos' : String(n - 1 - i), v, { value: `${v}   ${hex8(v)}` })) };
    }
    if (ref === REF.RSTACK) {
      const vars = [];
      for (const [a, v, nm, kind] of this.rstack) {
        let what = `${v | 0}   data: a DO loop's index or limit, or >R  (${hex8(v)})`;
        if (kind === 'call') { const src = await this.lineOf(u32(v & ~1) - 2); what = `→ ${nm}${src ? `, line ${src.line}` : ''}   (${hex8(v)})`; }
        vars.push({ name: a === null ? 'lr' : `rsp+${a - u32(this.regs.sp)}`, value: what, variablesReference: 0, ...(a === null ? {} : { memoryReference: hex8(a) }) });
      }
      if (this.rstack.note) vars.push({ name: '(none)', value: this.rstack.note, variablesReference: 0 });
      else if (this.rstack.ends !== undefined) vars.push({ name: `rsp+${this.rstack.ends - u32(this.regs.sp)}`, value: '→ the interpreter that ran the line (below: the kernel\'s own)', variablesReference: 0 });
      return { variables: vars };
    }
    if (ref === REF.CPU) {
      return { variables: CORE.filter(r => r in this.regs).map(r => ({
        name: r + (ALIAS[r] ? ` (${ALIAS[r]})` : ''), value: r === 'xpsr' ? `${hex8(this.regs[r])}  ${flags(this.regs[r])}` : hex8(this.regs[r]),
        variablesReference: 0, memoryReference: r === 'xpsr' ? undefined : hex8(this.regs[r]),
      })) };
    }
    if (ref === REF.PERIPH) {
      const p = await this.peripheralOfLine();
      if (!p) return { variables: [] };
      // Not read until clicked: reading some registers (FIFOs) changes them
      return { variables: [...p.regs.values()].map(r => {
        const id = 1000 + this.lazy.size;
        this.lazy.set(id, { addr: r.addr, periph: p.name });
        return { name: r.name, value: hex8(r.addr), variablesReference: id, presentationHint: { lazy: true }, memoryReference: hex8(r.addr) };
      }) };
    }
    if (this.lazy.has(ref)) {
      const { addr, periph } = this.lazy.get(ref);
      const v = await this.d.g.word(addr);
      const rows = [{ name: '', value: `${hex8(v)}   ${v | 0}`, variablesReference: 0 }];
      // its bit fields, decoded (from the chip's SVD)
      const chip = this.env.board ? PD.load(this.env.board()) : null;
      const per = chip && chip.byName.get(periph);
      const reg = per && per.regs.find(r => r.addr === addr);
      if (reg && (reg.fields.length > 1 || (reg.fields.length === 1 && reg.fields[0].width < 32))) {
        for (const f of reg.fields) rows.push({ name: `${f.name} ${PD.bitsText(f)}`, value: PD.readable(f.access) ? PD.fieldText(v, f) : '(write only)', variablesReference: 0 });
      }
      return { variables: rows };
    }
    return { variables: [] };
  }

  // Watch, hover and the Debug Console: a CPU register (pc, tos, psp…), a
  // peripheral register (its value, read from the chip), a word (its address),
  // a number or address (the cell there). "ADDR n" dumps n cells.
  async r_evaluate(args) {
    const expr = (args.expression || '').trim();
    const [what, count] = expr.split(/\s+/);
    const reg = { TOS: 'r6', PSP: 'r5', RSP: 'sp' }[what.toUpperCase()] || what.toLowerCase();
    // A Forth line (not "name" or "address count"): the board runs it, as in the Forth console
    const forthLine = expr.split(/\s+/).length > 2 || (count !== undefined && !/^(\d+|\$[0-9a-f]+)$/i.test(count));
    if (args.context === 'repl' && (!this.halted || forthLine))      // Forth goes to one place: the Forth console
      throw new Error(this.halted ? 'Forth lines go in the Forth console (the board runs them once you continue). Here, while paused: a register (pc, tos), a register name, a word, or an address (and a count)'
        : 'the board is running: type Forth in the Forth console. Here, once paused: a register, a word or an address');
    if (!this.halted) throw new Error('running: pause first');
    if (CORE.includes(reg)) { const v = this.regs[reg]; return { result: `${hex8(v)}   ${v | 0}`, variablesReference: 0 }; }
    const c = this.env.index().classify(what, 10);
    let addr = null;
    if (c.kind === 'register') {
      if (args.context === 'hover') return { result: `${c.periph.name}.${c.reg.name} at ${hex8(c.reg.addr)}`, variablesReference: 0 };
      addr = c.reg.addr;
    } else if (c.kind === 'periph') return { result: `base ${hex8(c.periph.base)}`, variablesReference: 0 };
    else if (c.kind === 'number') addr = c.value;
    else {
      const r = this.d.userRanges.find(x => x[2].toUpperCase() === what.toUpperCase());
      const bi = [...this.d.builtins].find(([, n]) => n.toUpperCase() === what.toUpperCase());
      if (r) return { result: `${r[2]}: code at ${hex8(r[0])}, ${r[1] - r[0]} bytes`, variablesReference: 0, memoryReference: hex8(r[0]) };
      if (bi) return { result: `${bi[1]} (built in): code at ${hex8(bi[0])}`, variablesReference: 0, memoryReference: hex8(bi[0]) };
      throw new Error(`${what}: not a register, word or number`);
    }
    if (args.context === 'hover') return { result: hex8(addr), variablesReference: 0 };
    const n = Math.min(Math.max(Number(count) || 1, 1), 64);
    const raw = await this.d.g.mem(u32(addr & ~3), 4 * n);
    const cells = [];
    for (let i = 0; i < n; i++) cells.push(hex8(raw.readUInt32LE(4 * i)).slice(2).toUpperCase());
    return { result: n === 1 ? `${hex8(raw.readUInt32LE(0))}   ${raw.readInt32LE(0)}` : `${hex8(addr).slice(2).toUpperCase()}:  ${cells.join(' ')}`, variablesReference: 0, memoryReference: hex8(addr) };
  }

  async r_readMemory(args) {
    const addr = u32(parseInt(args.memoryReference, 16) + (args.offset || 0));
    const n = Math.min(args.count || 0, 65536);
    const data = n ? await this.d.g.mem(addr, n) : Buffer.alloc(0);
    return { address: hex8(addr), data: data.toString('base64') };
  }

  // Disassembly: from the start of the code the address is in, so the decoder
  // starts on an instruction boundary; registers by their Forth names, calls named.
  // The first source line to show with a line's code: the \ comment lines just above it
  // (a definition's description, a note inside a word), so the Disassembly view shows them.
  // Instructions from lo to hi, a word's header (link, length, name) as one entry {addr, header}.
  async span(lo, hi) {
    const al = this.d.alias || 0;
    const heads = (this.d.heads || []).map(([h, n]) => ({ h: u32(h + al), cs: u32(((h + 5 + n.length + 3) & ~3) + al), name: n }));
    const out = [];
    let a = lo;
    while (a < hi) {
      const hd = heads.find(x => x.h <= a && a < x.cs);
      if (hd) { out.push({ addr: a, header: hd.name }); a = hd.cs; continue; }
      const next = Math.min(hi, ...heads.filter(x => x.h > a).map(x => x.h));
      const rows = disassemble(await this.d.g.mem(a, next - a), a);
      const pad = rows.length && heads.some(x => x.h === next) && rows[rows.length - 1].addr === next - 2 && /^\.short/.test(rows[rows.length - 1].text);
      if (pad) { rows.pop(); out.push(...rows, { addr: next - 2, header: heads.find(x => x.h === next).name }); a = heads.find(x => x.h === next).cs; continue; }
      out.push(...rows);
      a = next;
    }
    return out;
  }

  linesFrom(src) {
    const def = sourceOf({ path: src.path, line: src.line - 1 });
    return def ? def.first + 1 : src.line;
  }

  async r_disassemble(args) {
    const at = u32(parseInt(args.memoryReference, 16) + (args.offset || 0));
    const want = args.instructionCount || 50, off = args.instructionOffset || 0;
    const r = await this.d.rangeOf(at);
    let lo = r ? r[0] : u32((at - 4 * Math.max(0, -off) - 64) & ~1);
    const hi = u32(at + 4 * Math.max(want + off, 1) + 64);
    if (lo > at) lo = at;
    const code = await this.d.g.mem(lo, hi - lo);
    let ins = await this.span(lo, hi);
    let idx = ins.findIndex(x => x.addr >= at);
    if (idx < 0) idx = ins.length;
    // VS Code asks for instructions before the word: the code before it, from the start of
    // the word before (so decoding starts on an instruction), else from a guess
    let from = lo;
    for (let guard = 0; idx + off < 0 && guard < 8 && from > 0; guard++) {
      const prev = this.d.userRanges.map(x => x[0]).filter(x => x < from && from - x < 4096).sort((x, y) => y - x)[0];
      const lo2 = prev !== undefined ? prev : u32((from - 4 * (-(idx + off)) - 16) & ~1);
      let before;
      try { before = (await this.span(lo2, from)).filter(x => x.addr < from); } catch { break; }
      ins = before.concat(ins);
      idx += before.length;
      from = lo2;
    }
    const names = new Map(this.d.builtins);
    for (const [l, , nm] of this.d.userRanges) names.set(l, nm);
    const notes = r && this.d.userRanges.includes(r) ? T.annotate(code.subarray(0, r[1] - r[0]), await this.d.inlineBodies(), r[0]) : {};
    const out = [];
    let lastLine = null;
    for (let k = idx + off; k < idx + off + want; k++) {
      if (k < 0 || k >= ins.length) { out.push({ address: hex8(k < 0 ? from - 2 * (-k) : hi + 2 * (k - ins.length)), instruction: '', presentationHint: 'invalid' }); continue; }
      const x = ins[k];
      if (x.header) {                                  // a word's header: one row, its source lines above it
        const src = await this.lineOf(x.addr);
        const key = src ? `${src.path}:${src.line}` : null;
        out.push({ address: hex8(x.addr), instructionBytes: '', instruction: `; header of ${x.header} (link, length, name)`,
          ...(src && key !== lastLine ? { location: { path: src.path, name: src.path.split(/[\\/]/).pop() }, line: this.linesFrom(src), endLine: src.line } : {}) });
        lastLine = key;
        continue;
      }
      const t = /\bbl\s+0x([0-9a-f]+)/.exec(x.text);
      const called = t ? names.get(parseInt(t[1], 16)) : null;
      const note = r && x.addr >= r[0] && x.addr < r[1] ? notes[x.addr - lo] : undefined;
      const src = await this.lineOf(x.addr);
      const key = src ? `${src.path}:${src.line}` : null;
      out.push({
        address: hex8(x.addr), instructionBytes: x.hex, instruction: T.rename(x.text) + (called ? `   ; ${called}` : '') + (note ? `   ; ${note}` : ''),
        ...(names.has(x.addr) ? { symbol: names.get(x.addr) } : {}),
        ...(src && key !== lastLine ? { location: { path: src.path, name: src.path.split(/[\\/]/).pop() }, line: this.linesFrom(src), endLine: src.line } : {}),
      });
      lastLine = key;
    }
    return { instructions: out };
  }
}

module.exports = { ForthDebugAdapter, REF };

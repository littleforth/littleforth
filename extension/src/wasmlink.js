// wasmlink.js - the kernel built to WebAssembly (wasm/forth.wasm), run in a worker
// thread, as a transport for link.js: the console with no board plugged in.
// The kernel's KEY blocks: the worker waits on shared memory (Atomics.wait) for the
// bytes the extension writes. EMIT's bytes come back in batches.
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

const WASM = path.join(__dirname, '..', 'wasm', 'forth.wasm');
const RING = 1 << 16;

// The worker: runs the kernel; key() takes bytes from the ring, emit() batches.
const WORKER = `
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const ctl = new Int32Array(workerData.sab, 0, 2);          // [write position, read position]
const ring = new Uint8Array(workerData.sab, 8);
const N = ring.length;
let out = [];
const flush = () => { if (out.length) { parentPort.postMessage(Buffer.from(out).toString('latin1')); out = []; } };
class Unwind extends Error {}
const env = {
  js_emit: c => { out.push(c & 255); if (c === 10 || out.length > 512) flush(); },
  js_key: () => {
    flush();
    for (;;) {
      const w = Atomics.load(ctl, 0), r = Atomics.load(ctl, 1);
      if (w !== r) { const c = ring[r % N]; Atomics.store(ctl, 1, r + 1); return c; }
      Atomics.wait(ctl, 0, w);
    }
  },
  js_unwind: () => { throw new Unwind(); },
};
const mod = new WebAssembly.Module(fs.readFileSync(workerData.wasm));
const inst = new WebAssembly.Instance(mod, { env });
const sp = inst.exports.__stack_pointer.value;
let run = inst.exports.forth_start;
for (;;) {
  try { run(); break; } catch (e) {
    if (!(e instanceof Unwind)) { flush(); parentPort.postMessage({ error: String(e && e.stack || e) }); break; }
    inst.exports.__stack_pointer.value = sp;                   // the jump back into quit
    run = inst.exports.forth_quit;
  }
}
`;

class WasmTransport {
  static async open() {
    const t = new WasmTransport();
    t.name = 'no board (WebAssembly)';
    t.sab = new SharedArrayBuffer(8 + RING);
    t.ctl = new Int32Array(t.sab, 0, 2);
    t.ring = new Uint8Array(t.sab, 8);
    t.w = new Worker(WORKER, { eval: true, workerData: { sab: t.sab, wasm: WASM } });
    t.data = []; t.closers = [];
    t.w.on('message', m => { if (typeof m === 'string') for (const f of t.data) f(m); else if (m.error) { for (const f of t.data) f(`\n${m.error}\n`); } });
    t.w.on('exit', () => { for (const f of t.closers) f(); });
    t.w.on('error', () => {});
    return t;
  }
  write(s) {
    const b = Buffer.from(s, 'latin1');
    let w = Atomics.load(this.ctl, 0);
    for (const c of b) { this.ring[w % RING] = c; w++; }
    Atomics.store(this.ctl, 0, w);
    Atomics.notify(this.ctl, 0);
  }
  onData(fn) { this.data.push(fn); }
  onClose(fn) { this.closers.push(fn); }
  close() { this.w.terminate(); }
}

module.exports = { WasmTransport, WASM };

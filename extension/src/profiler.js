// profiler.js - where the time goes: while a phrase runs on the board, the CPU's
// program counter is sampled through the debug probe, and each sample is put down
// to the word, and the source line, it fell in. The result: a table of words by
// share of the time, and the source lines shaded by how hot they are.
//
// Two samplers. With OpenOCD (the Pico 2's Debug Probe), its Tcl port reads the
// core's PC sample register (DWT_PCSR) while the CPU runs: nothing is stopped.
// With any other GDB server (QEMU, a J-Link), the CPU is halted for a moment
// for each sample: slower and it disturbs timing, but it works everywhere.
'use strict';
const net = require('net');
const B = require('./board');
const { Gdb } = require('./gdb');
const { esc, nonce } = require('./views');

const DWT_PCSR = 0xE000101C;
const u32 = v => v >>> 0;

// OpenOCD's Tcl port: a command ends with byte 0x1A, and so does its answer
async function tclSampler(host = '127.0.0.1', port = 6666) {
  const s = await new Promise((res, rej) => { const c = net.connect(port, host, () => res(c)); c.once('error', rej); c.setTimeout(2000, () => { c.destroy(); rej(new Error('no answer')); }); });
  s.setTimeout(0);
  let buf = '', wait = null;
  s.on('data', d => { buf += d.toString('latin1'); if (wait && buf.includes('\x1a')) wait(); });
  const cmd = async c => {
    buf = '';
    s.write(c + '\x1a');
    await new Promise(r => { wait = r; if (buf.includes('\x1a')) r(); });
    wait = null;
    return buf.slice(0, buf.indexOf('\x1a'));
  };
  // is PC sampling there? a running CPU gives an address, a halted one 0xFFFFFFFF
  const probe = await cmd(`read_memory 0x${DWT_PCSR.toString(16)} 32 1`);
  if (!/^\s*0x[0-9a-f]+/i.test(probe)) { s.destroy(); throw new Error(`no PC sampling: ${probe.trim()}`); }
  return {
    kind: 'OpenOCD, DWT_PCSR (the CPU runs on)',
    async take(n = 100) {
      const r = await cmd(`set r {}; for {set i 0} {$i < ${n}} {incr i} {lappend r [read_memory 0x${DWT_PCSR.toString(16)} 32 1]}; return $r`);
      return r.split(/\s+/).map(x => parseInt(x, 16)).filter(v => !Number.isNaN(v) && v !== 0xFFFFFFFF).map(u32);
    },
    close() { s.destroy(); },
  };
}

async function gdbSampler(host, port) {
  const g = await Gdb.connect(host, port);
  await g.cont();                                 // connecting halted it
  return {
    kind: 'GDB server, halting for each sample',
    async take(n = 20) {
      const out = [];
      for (let i = 0; i < n; i++) {
        await g.halt();
        out.push(u32((await g.reg('pc')) & ~1));
        await g.cont();
        await new Promise(r => setTimeout(r, 2));
      }
      return out;
    },
    close() { return g.close(true); },
  };
}

// Word ranges on the board [{lo, hi, name}] (code addresses as run), from the
// word list (each word's code runs to the next newer header) and the builtins.
async function wordRanges(link) {
  const bi = await B.builtinAddrs(link);
  const w = await B.userWords(link);
  const alias = link.codeAlias || 0;
  const out = [];
  let newer = w.here;
  for (const [h, nm] of w.heads) { out.push({ lo: u32(((h + 5 + nm.length + 3) & ~3) + alias), hi: u32(newer + alias), name: nm }); newer = h; }
  const starts = [...bi.keys()].sort((a, b) => a - b);
  starts.forEach((a, i) => out.push({ lo: a, hi: i + 1 < starts.length ? Math.min(starts[i + 1], a + 512) : a + 512, name: bi.get(a), builtin: true }));
  return { ranges: out, alias };
}

// samples -> {words: [{name, n, builtin}], lines: Map 'file|no' -> n, total, idle}
function tally(samples, ranges, lineMap, alias) {
  const words = new Map(), lines = new Map();
  let idle = 0;
  for (const pc of samples) {
    const r = ranges.find(x => x.lo <= pc && pc < x.hi);
    if (!r) { idle++; continue; }
    const k = r.name;
    words.set(k, { name: k, n: (words.has(k) ? words.get(k).n : 0) + 1, builtin: !!r.builtin });
    const a = u32(pc - alias);
    const hit = lineMap.filter(m => m.lo <= a && a < m.hi).pop();
    if (hit) { const lk = `${hit.file}|${hit.no}`; lines.set(lk, (lines.get(lk) || 0) + 1); }
  }
  return { words: [...words.values()].sort((a, b) => b.n - a.n), lines, total: samples.length, idle };
}

function reportHtml(phrase, t, kind, ms) {
  const n = nonce();
  const pct = x => (t.total ? (100 * x) / t.total : 0);
  const rows = t.words.slice(0, 40).map(w => `<tr><td class="f"><a data-w="${esc(w.name)}">${esc(w.name)}</a>${w.builtin ? ' <span class="meta">built in</span>' : ''}</td>
<td class="a">${pct(w.n).toFixed(1)}%</td><td style="width:50%"><div class="bar" style="width:${pct(w.n).toFixed(1)}%"></div></td><td class="a meta">${w.n}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px 16px;max-width:900px}
h1{font-size:16px;font-weight:600}h1 code{font-family:var(--vscode-editor-font-family)}.meta{color:var(--vscode-descriptionForeground)}
table{border-collapse:collapse;width:100%;font-family:var(--vscode-editor-font-family);margin-top:10px}td{padding:3px 8px 3px 0}
td.a{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.f{white-space:nowrap}
.bar{height:10px;background:linear-gradient(90deg,#f5c542,#ff6b3d);border-radius:2px}a{color:var(--vscode-textLink-foreground);cursor:pointer}</style></head><body>
<h1>Profile of <code>${esc(phrase)}</code></h1>
<div class="meta">${t.total} samples in ${(ms / 1000).toFixed(1)} s · ${esc(kind)} · ${pct(t.idle).toFixed(0)}% outside any word (the kernel's own code)</div>
<table>${rows || '<tr><td class="meta">No samples fell in a word.</td></tr>'}</table>
<p class="meta">Hot source lines are shaded in the editor. Forth: Clear Profile removes the shading.</p>
<script nonce="${n}">const vs=acquireVsCodeApi();document.querySelectorAll('a[data-w]').forEach(a=>a.onclick=()=>vs.postMessage({inspect:a.dataset.w}));</script>
</body></html>`;
}

module.exports = { tclSampler, gdbSampler, wordRanges, tally, reportHtml, DWT_PCSR };

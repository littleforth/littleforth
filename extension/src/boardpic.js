// boardpic.js - a drawing of the board with every pin live: its function, and for a
// GPIO its level and direction. Click a pin driven by SIO to toggle it; any other
// pin opens its control register in the inspector. Pico 2 for now.
'use strict';
const B = require('./board');
const live = require('./live');
const PD = require('./periphdata');
const { esc, nonce } = require('./views');

// The Pico 2's 40 pins: left side 1-20 top to bottom, right side 40-21 top to bottom.
// A number is a GPIO; text is a power or control pin.
const PICO2 = {
  name: 'Pico 2',
  left: [0, 1, 'GND', 2, 3, 4, 5, 'GND', 6, 7, 8, 9, 'GND', 10, 11, 12, 13, 'GND', 14, 15],
  right: ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 28, 'AGND', 27, 26, 'RUN', 22, 'GND', 21, 20, 19, 18, 'GND', 17, 16],
};
const GPIOS = [...Array(30).keys()].filter(g => g !== 23 && g !== 24 && g !== 25 && g !== 29);   // the ones on the header

// -> {pins: Map gpio -> {func, level, oe, out}} or {why}
async function readPico2(link) {
  const d = PD.load('Pico 2');
  const io = d.byName.get('IO_BANK0'), sio = d.byName.get('SIO');
  const reg = (p, n) => p.regs.find(r => r.name === n);
  const ctrl = GPIOS.map(g => ({ periph: 'IO_BANK0', name: `GPIO${g}_CTRL`, addr: reg(io, `GPIO${g}_CTRL`).addr }));
  const s = ['GPIO_IN', 'GPIO_OUT', 'GPIO_OE'].map(n => ({ periph: 'SIO', name: n, addr: reg(sio, n).addr }));
  const vals = await live.readRegisters(link, 'Pico 2', [...ctrl, ...s]);
  if (!vals.has(ctrl[0].addr)) return { why: 'IO_BANK0 is held in reset: no pin has been set up yet' };
  const [inp, out, oe] = s.map(r => vals.get(r.addr) >>> 0);
  const pins = new Map();
  GPIOS.forEach((g, i) => {
    const fsel = reg(io, `GPIO${g}_CTRL`).fields.find(f => f.name === 'FUNCSEL').enums || {};   // each pin's own names
    const f = vals.get(ctrl[i].addr) & 0x1F;
    const func = f === 5 ? 'SIO' : f === 31 ? '' : (fsel[f] || String(f)).replace(/_\d+$/, '').replace(/^siob_proc$/, 'SIO').toUpperCase();
    // an output shows what SIO drives: a pad's input is off at reset, so GPIO_IN reads 0
    const o = (oe >>> g) & 1;
    pins.set(g, { func, level: o ? (out >>> g) & 1 : (inp >>> g) & 1, oe: o, out: (out >>> g) & 1 });
  });
  return { pins, sioXor: reg(sio, 'GPIO_OUT_XOR').addr };
}

function html(board, st, connected) {
  const n = nonce();
  const pin = (p, side, k) => {
    const num = side === 'l' ? k + 1 : 40 - k;
    if (typeof p !== 'number') return `<div class="pin ${side} pw"><span class="num">${num}</span><span class="lab">${esc(p)}</span></div>`;
    const s = st.pins && st.pins.get(p);
    const cls = !s ? '' : s.func === 'SIO' ? (s.oe ? (s.level ? 'hi out' : 'lo out') : (s.level ? 'hi in' : 'lo in')) : s.func ? 'fn' : '';
    const fn = !s ? '' : s.func === 'SIO' ? (s.oe ? 'out' : 'in') : s.func.toLowerCase();
    const tip = !s ? `GP${p}` : `GP${p}: ${s.func || 'no function'}${s.func === 'SIO' ? `, ${s.oe ? 'output' : 'input'}, ${s.level ? 'high' : 'low'}${s.oe ? ' (click to toggle)' : ''}` : ''}`;
    return `<div class="pin ${side} ${cls}" data-g="${p}" title="${esc(tip)}"><span class="num">${num}</span><span class="dot"></span><span class="lab">GP${p}</span><span class="fn">${esc(fn)}</span></div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px 16px}
h1{font-size:16px;font-weight:600;margin:0 0 4px}.meta{color:var(--vscode-descriptionForeground);margin-bottom:12px}
.board{display:grid;grid-template-columns:1fr 150px 1fr;gap:0;max-width:640px;font-family:var(--vscode-editor-font-family);font-size:12px}
.col{display:flex;flex-direction:column;gap:3px}
.pcb{background:#1f6b3a;border-radius:6px;position:relative;margin:0 4px;min-height:100%}
.pcb .usb{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:44px;height:22px;background:#b8bcc2;border-radius:3px}
.pcb .chip{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);width:58px;height:58px;background:#222;border-radius:3px;color:#aaa;font-size:9px;display:flex;align-items:center;justify-content:center;text-align:center}
.pin{display:flex;align-items:center;gap:6px;height:22px;padding:0 6px;border-radius:3px;cursor:default}
.pin.r{flex-direction:row-reverse;text-align:right}
.pin .num{width:18px;color:var(--vscode-descriptionForeground);font-size:10px;text-align:center}
.pin .dot{width:11px;height:11px;border-radius:50%;border:1.5px solid var(--vscode-descriptionForeground);flex:none}
.pin .lab{min-width:36px}.pin .fn{color:var(--vscode-descriptionForeground);font-size:11px}
.pin.pw .lab{color:var(--vscode-descriptionForeground)}
.pin.hi .dot{background:#f5c542;border-color:#f5c542;box-shadow:0 0 6px #f5c542}
.pin.lo .dot{background:transparent;border-color:#5a8fd8}
.pin.fn .dot{background:#9b7bd8;border-color:#9b7bd8}
.pin.out{cursor:pointer}.pin.out:hover,.pin[data-g]:hover{background:var(--vscode-list-hoverBackground)}
.pin[data-g]{cursor:pointer}
.key{display:flex;gap:16px;margin-top:14px;color:var(--vscode-descriptionForeground);font-size:12px;flex-wrap:wrap}
.key span::before{content:'';display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.k1::before{background:#f5c542}.k2::before{border:1.5px solid #5a8fd8}.k3::before{background:#9b7bd8}
</style></head><body>
<h1>${esc(board.name)}</h1>
<div class="meta">${!connected ? 'Not connected.' : st.why ? esc(st.why) : 'Live. Click an output to toggle it; click any GPIO to open its control register.'}</div>
<div class="board">
 <div class="col">${board.left.map((p, k) => pin(p, 'l', k)).join('')}</div>
 <div class="pcb"><div class="usb"></div><div class="chip">RP2350</div></div>
 <div class="col">${board.right.map((p, k) => pin(p, 'r', k)).join('')}</div>
</div>
<div class="key"><span class="k1">high</span><span class="k2">low</span><span class="k3">peripheral function</span></div>
<script nonce="${n}">const vs=acquireVsCodeApi();document.querySelectorAll('.pin[data-g]').forEach(e=>e.onclick=()=>vs.postMessage({g:+e.dataset.g,out:e.classList.contains('out')}));</script>
</body></html>`;
}

class BoardPicture {
  constructor(vscode, forth, inspector) {
    this.vscode = vscode; this.forth = forth; this.inspector = inspector;
    this.panel = null; this.timer = null; this.st = {}; this.last = '';
  }
  open() {
    const vscode = this.vscode;
    if (this.forth.board && this.forth.board !== 'Pico 2') { vscode.window.showInformationMessage(`Forth: the board picture is for the Pico 2 so far; this is a ${this.forth.board}`); return; }
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel('forth.boardpic', 'Pico 2', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.onDidDispose(() => { this.panel = null; clearInterval(this.timer); });
    this.panel.webview.onDidReceiveMessage(m => this.click(m));
    this.draw(true);
    this.timer = setInterval(() => this.poll(), 500);
    this.poll();
  }
  draw(force) {
    if (!this.panel) return;
    const key = JSON.stringify([this.forth.connected, this.st.why, this.st.pins ? [...this.st.pins] : null]);
    if (!force && key === this.last) return;
    this.last = key;
    this.panel.webview.html = html(PICO2, this.st, this.forth.connected);
  }
  async poll() {
    const f = this.forth;
    if (this.busy || !this.panel) return;
    if (!f.connected) { this.st = {}; this.draw(); return; }
    if (f.state !== 'ready' || !f.link.interpreting) return;
    this.busy = true;
    try { this.st = await f.link.locked(() => readPico2(f.link)); this.draw(); } catch { /* next time */ } finally { this.busy = false; }
  }
  async click(m) {
    const s = this.st.pins && this.st.pins.get(m.g);
    if (m.out && s && s.func === 'SIO' && s.oe && this.st.sioXor) {
      await this.forth.job(link => link.exchange(`$${(1 << m.g >>> 0).toString(16)} $${(this.st.sioXor >>> 0).toString(16)} !`, 5000));
      return this.poll();
    }
    return this.inspector.open(`IO_BANK0.GPIO${m.g}_CTRL`);
  }
}

module.exports = { BoardPicture, readPico2, html, PICO2 };

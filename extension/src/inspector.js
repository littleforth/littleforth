// inspector.js - one tab for anything with a name: a word (its source, the words
// that use it, its code read back from the board and decompiled, its memory) or a
// register (its live value and bit fields; click a field to change it).
'use strict';
const path = require('path');
const B = require('./board');
const I = require('./inspect');
const H = require('./hotreload');
const { esc, nonce } = require('./views');

const hex8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const PERIPH = {};
const periphData = chip => PERIPH[chip] || (PERIPH[chip] = (() => { try { return require(`../data/${chip}.periph.json`); } catch { return {}; } })());

// The words in the index's files that use name: [{name, path, line}]
function usedBy(ix, name) {
  const u = name.toUpperCase(), out = [];
  for (const [p, text] of ix.texts) {
    for (const c of H.chunks(text)) {
      if (!c.uses.has(u) || c.names.includes(u)) continue;
      for (const n of c.names) { const d = ix.word(n); out.push({ name: d ? d.name : n, path: p, line: c.from }); }
    }
  }
  return out;
}

const CSS = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:8px 16px;max-width:1100px}
h1{font-size:18px;font-weight:600;margin:4px 0}h1 small{font-weight:normal;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family)}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin:16px 0 6px;color:var(--vscode-descriptionForeground)}
.meta{color:var(--vscode-descriptionForeground);line-height:1.6}
pre{margin:0;padding:8px 10px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;overflow-x:auto}
table{border-collapse:collapse;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}
td,th{padding:2px 10px 2px 0;text-align:left;vertical-align:top}th{font-weight:600;color:var(--vscode-descriptionForeground)}
td.a{color:var(--vscode-debugTokenExpression-number)}td.f{color:var(--vscode-debugTokenExpression-name);font-weight:600}
.cols{display:flex;gap:24px;flex-wrap:wrap}.cols>div{flex:1;min-width:300px}
a{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none}a:hover{text-decoration:underline}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;padding:4px 10px;cursor:pointer;border-radius:2px}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.big{font-family:var(--vscode-editor-font-family);font-size:22px;letter-spacing:.02em}
.bits{display:grid;grid-template-columns:repeat(32,1fr);gap:1px;margin:6px 0;font-family:var(--vscode-editor-font-family);font-size:10px}
.bits div{text-align:center;padding:3px 0;background:var(--vscode-textCodeBlock-background)}.bits div.on{background:var(--vscode-terminal-ansiYellow);color:var(--vscode-editor-background)}
.bits.wr div[data-bit]{cursor:pointer}.bits.wr div[data-bit]:hover{outline:1px solid var(--vscode-focusBorder)}
.bits div.n{background:none;color:var(--vscode-descriptionForeground)}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);width:8em;font-family:var(--vscode-editor-font-family)}
.warn{color:var(--vscode-editorWarning-foreground)}`;

function page(body, script) {
  const n = nonce();
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>${CSS}</style></head><body>${body}
<script nonce="${n}">const vs=acquireVsCodeApi();
document.querySelectorAll('[data-msg]').forEach(e=>e.onclick=()=>vs.postMessage(JSON.parse(e.dataset.msg)));
${script || ''}</script></body></html>`;
}
const msg = m => `data-msg="${esc(JSON.stringify(m))}"`;

function wordHtml(w, uses) {
  const where = [];
  if (w.source) where.push(`<a ${msg({ cmd: 'open', path: w.source.path, line: w.source.line })}>${esc(path.basename(w.source.path))}:${w.source.line + 1}</a>`);
  if (w.kind === 'builtin') where.push(`built in${w.group ? ' · ' + esc(w.group) : ''}${w.inline ? ' · copied inline' : ''}`);
  if (w.lo !== undefined) where.push(`code $${hex8(w.lo)} · ${w.hi - w.lo} bytes`);
  if (w.onBoard) where.push(`<a ${msg({ cmd: 'memory', name: w.kind === 'builtin' ? "' " + w.name : w.name })}>Show in Memory</a>`);
  if (w.older) where.push(`<span class="warn">${w.older} older version${w.older > 1 ? 's' : ''} still on the board</span>`);
  const link = n => `<a ${msg({ cmd: 'inspect', name: n })}>${esc(n)}</a>`;
  const src = w.source ? `<pre>${esc(w.source.text)}</pre>` : `<p class="meta">${w.kind === 'builtin' ? 'Built into the kernel.' : 'No source in your files or libraries.'}</p>`;
  const dis = w.rows.length ? `<table><tr><th>Address</th><th>Code</th><th>Forth</th></tr>${w.rows.map(r =>
    `<tr><td class="a">${hex8(r.addr)}</td><td>${esc(r.ins)}</td><td class="f">${r.forth && /^[^\s]+$/.test(r.forth) && !r.forth.startsWith('$') ? link(r.forth) : esc(r.forth || '')}</td></tr>`).join('')}</table>`
    : `<p class="meta">${esc(w.why || 'Nothing to decompile.')}</p>`;
  return page(`
<h1>${esc(w.name)} <small>${esc(w.stack || '')}</small></h1>
<div class="meta">${where.join(' · ') || '&nbsp;'}</div>
${w.help ? `<p>${esc(w.help)}</p>` : ''}
<div class="cols">
 <div><h3>Source</h3>${src}
  <h3>Calls</h3><p>${w.calls.length ? w.calls.map(link).join(' ') : '<span class="meta">—</span>'}</p>
  <h3>Used by</h3><p>${uses.length ? uses.map(u => link(u.name)).join(' ') : '<span class="meta">nothing in your files</span>'}</p></div>
 <div><h3>On the board</h3>${dis}</div>
</div>
<p><button ${msg({ cmd: 'again' })}>Read again</button></p>`);
}

function registerHtml(r) {
  const v = r.value;
  // writable: the register says so, or one of its fields does
  const wr = v !== null && (/w/.test(r.access || '') || (!r.access && (r.fields || []).some(f => /w/.test(f[3]))));
  const bits = v === null ? '' : `<div class="bits${wr ? ' wr' : ''}">${[...Array(32)].map((_, i) => `<div class="n">${31 - i}</div>`).join('')}${[...Array(32)].map((_, i) => { const n = 31 - i, b = (v >>> n) & 1; return `<div class="${b ? 'on' : ''}"${wr ? ` data-bit="${n}" data-v="${b ^ 1}" title="click: set bit ${n} to ${b ^ 1}"` : ''}>${b}</div>`; }).join('')}</div>`;
  const whole = wr ? `<p><input id="whole" value="$${hex8(v)}"> <button id="wholew">Write</button> <span class="meta">the whole register: $hex or decimal</span></p>` : '';
  const fields = (r.fields || []).map(([name, lsb, width, acc, desc]) => {
    const fv = v === null ? null : width === 32 ? v >>> 0 : (v >>> lsb) & ((1 << width) - 1);
    const range = width === 1 ? `${lsb}` : `${lsb + width - 1}:${lsb}`;
    const edit = /w/.test(acc) && v !== null
      ? `<input id="f_${esc(name)}" value="${fv}"> <button data-f="${esc(name)}" data-lsb="${lsb}" data-w="${width}">Write</button>` : '';
    return `<tr><td class="f">${esc(name)}</td><td class="a">${range}</td><td>${esc(acc)}</td><td class="a">${fv === null ? '' : fv + (width > 1 ? ` <span class="meta">$${fv.toString(16).toUpperCase()}</span>` : '')}</td><td>${edit}</td><td class="meta">${esc(desc || '')}</td></tr>`;
  }).join('');
  return page(`
<h1>${esc(r.name)} <small>$${hex8(r.addr)}</small></h1>
<div class="meta">${esc(r.desc || '')} · <a ${msg({ cmd: 'memory', name: r.name })}>Show in Memory</a></div>
<h3>Value</h3>
<div class="big">${v === null ? `<span class="meta">${esc(r.why)}</span>` : `$${hex8(v)} <span class="meta" style="font-size:14px">${v >>> 0}</span>`}</div>
${bits}
${whole}
${fields ? `<h3>Fields</h3><table><tr><th>Field</th><th>Bits</th><th>Access</th><th>Value</th><th></th><th></th></tr>${fields}</table>` : ''}
<p><button ${msg({ cmd: 'again' })}>Read again</button></p>`,
  `document.querySelectorAll('button[data-f]').forEach(b=>b.onclick=()=>vs.postMessage({cmd:'field',lsb:+b.dataset.lsb,width:+b.dataset.w,value:document.getElementById('f_'+b.dataset.f).value}));
document.querySelectorAll('[data-bit]').forEach(e=>e.onclick=()=>vs.postMessage({cmd:'field',lsb:+e.dataset.bit,width:1,value:e.dataset.v}));
const w=document.getElementById('wholew');if(w){const go=()=>vs.postMessage({cmd:'field',lsb:0,width:32,value:document.getElementById('whole').value});w.onclick=go;document.getElementById('whole').onkeydown=e=>{if(e.key==='Enter')go();};}`);
}

class Inspector {
  constructor(vscode, forth, lang) {
    this.vscode = vscode; this.forth = forth; this.lang = lang;
    this.panels = new Map();
  }

  async open(name) {
    const vscode = this.vscode;
    if (!name) { name = await vscode.window.showInputBox({ prompt: 'Inspect a word or register' }); if (!name) return; }
    name = name.trim();
    const key = name.toUpperCase();
    let p = this.panels.get(key);
    if (p) p.reveal();
    else {
      p = vscode.window.createWebviewPanel('forth.inspect', key, vscode.ViewColumn.Active, { enableScripts: true });
      this.panels.set(key, p);
      p.onDidDispose(() => this.panels.delete(key));
      p.webview.onDidReceiveMessage(m => this.message(name, m));
    }
    await this.draw(name, p);
  }

  async message(name, m) {
    const vscode = this.vscode;
    if (m.cmd === 'again') return this.open(name);
    if (m.cmd === 'inspect') return this.open(m.name);
    if (m.cmd === 'memory') return vscode.commands.executeCommand('forth.memory', m.name);
    if (m.cmd === 'open') return vscode.window.showTextDocument(vscode.Uri.file(m.path), { selection: new vscode.Range(m.line, 0, m.line, 0) });
    if (m.cmd === 'field') {
      const c = this.lang.index().classify(name);
      const n = Number(String(m.value).trim().replace(/^\$/, '0x'));
      if (c.kind !== 'register' || Number.isNaN(n)) return;
      const cur = m.width === 32 ? 0 : await this.read(c.reg.addr);   // the whole register: no need to read it
      if (cur === null) return;
      const mask = m.width === 32 ? 0xFFFFFFFF : ((1 << m.width) - 1) << m.lsb;
      const v = ((cur & ~mask) | ((n << m.lsb) & mask)) >>> 0;
      await this.forth.job(link => link.exchange(`$${v.toString(16)} $${(c.reg.addr >>> 0).toString(16)} !`, 5000));
      return this.open(name);
    }
  }

  // a register's value, unless reading it would change it or its peripheral is in reset
  async read(addr, reg) {
    if (!this.forth.connected) return null;
    try {
      if (reg) { const m = await this.forth.job(link => require('./live').readRegisters(link, this.forth.board, [reg])); return m.has(addr >>> 0) ? m.get(addr >>> 0) : null; }
      return (await this.forth.job(link => B.readCells(link, [addr])))[0];
    } catch { return null; }
  }

  async draw(name, p) {
    const ix = this.lang.index();
    const c = ix.classify(name);
    if (c.kind === 'register') {
      const chip = this.forth.chip() || require('../boards').chipOf(this.lang.board());
      const pd = periphData(chip)[c.periph.name];
      const rd = pd && pd.regs.find(x => x.n === c.reg.name);
      const value = await this.read(c.reg.addr, { periph: c.periph.name, name: c.reg.name, addr: c.reg.addr >>> 0 });
      p.title = `${c.periph.name}.${c.reg.name}`;
      p.webview.html = registerHtml({ name: `${c.periph.name}.${c.reg.name}`, addr: c.reg.addr, desc: (rd && rd.d) || c.reg.desc, access: rd && rd.a, fields: rd && rd.f, value, why: this.forth.connected ? 'not read: reading it would change it, it is write-only, or its peripheral is held in reset' : 'not connected' });
      return;
    }
    let w;
    try {
      w = this.forth.connected
        ? await this.forth.job(link => I.inspect(name, { link, index: ix, board: this.forth.board }))
        : await I.inspect(name, { link: null, index: ix });
    } catch (e) {
      w = { name: name.toUpperCase(), kind: '', stack: '', rows: [], calls: [], why: `not read: ${e.message}` };
    }
    p.title = w.name;
    p.webview.html = wordHtml(w, usedBy(ix, w.name));
  }
}

module.exports = { Inspector, usedBy, wordHtml, registerHtml };

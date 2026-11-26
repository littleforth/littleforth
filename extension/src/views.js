// views.js - the Forth panel: Board, Stacks, Words. They only show what the Forth
// service knows and call commands; none of them talks to the board itself.
'use strict';
const crypto = require('crypto');

const BUILTINS = require('../data/builtins.json');
const { otherChip } = require('./model');
const kb = n => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Board ----
class BoardTree {
  constructor(vscode, forth) {
    this.vscode = vscode; this.forth = forth;
    this.ev = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.ev.event;
    forth.on('state', () => this.ev.fire());
    forth.on('changed', () => this.ev.fire());
  }
  item(label, icon, command, desc, tip) {
    const t = new this.vscode.TreeItem(label, 0);
    t.iconPath = new this.vscode.ThemeIcon(icon);
    if (command) t.command = { command, title: label };
    if (desc) t.description = desc;
    if (tip) t.tooltip = tip;
    return t;
  }
  getTreeItem(e) { return e; }
  getChildren(e) {
    if (e) return [];
    const f = this.forth, i = (...a) => this.item(...a);
    const state = {
      off: i('Not connected', 'debug-disconnect', 'forth.connect', 'click to connect'),
      connecting: i('Connecting…', 'sync~spin'),
      lost: i('Connection lost', 'warning', 'forth.connect', 'reconnecting…'),
    }[f.state] || i(f.board || 'Board', 'circle-filled', 'forth.disconnect', f.port, 'Connected. Click to disconnect.');
    const rows = [state];
    if (f.connected) {
      if (f.dict) rows.push(i('Dictionary', 'database', null, `${kb(f.dict.used)} of ${kb(f.dict.size)}`));
      if ((require('../boards').get(f.board) || {}).picture) rows.push(i('Show the board', 'circuit-board', 'forth.boardPicture', 'live pins'));
      rows.push(i('Scope', 'graph-line', 'forth.plot', 'plot a value'));
      rows.push(i('Debug the board', 'debug-alt', 'forth.debug', 'step with stacks', 'Breakpoints on words, step word by word, the stack beside each line (Debug Probe)'));
      rows.push(i('Profile', 'flame', 'forth.profile', 'where the time goes', 'Run some Forth and sample where the CPU spends its time; hot lines shaded (Debug Probe)'));
      rows.push(i('Memory', 'file-binary', 'forth.memory', 'map, words, cells', 'The chip\'s memory: a map, your words as records, cells with what they point at, bytes, code'));
      rows.push(i('New notebook', 'notebook', 'forth.newNotebook', '.fthnb'));
      rows.push(i('Save words to flash', 'save', 'forth.save', 'SAVE'));
      rows.push(i('Reset the board', 'debug-restart', 'forth.reset'));
    }
    rows.push(i('Flash firmware', 'zap', 'forth.flash', f.board ? f.board : ''));
    return rows;
  }
}

// ---- Stacks ----
function nonce() { return crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, ''); }

class StacksView {
  constructor(vscode, forth) {
    this.vscode = vscode; this.forth = forth; this.view = null; this.hex = false;
    forth.on('changed', () => this.draw());
    forth.on('state', () => this.draw());
  }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(m => {
      if (m.hex !== undefined) { this.hex = m.hex; this.draw(); }
      if (m.mem !== undefined) this.vscode.commands.executeCommand('forth.memory', m.mem >>> 0);
    });
    this.draw();
  }
  draw() {
    if (!this.view) return;
    const f = this.forth, n = nonce();
    const fmt = v => {
      const x = parseInt(v, f.stack.base);
      if (Number.isNaN(x)) return esc(v);
      return this.hex ? '$' + (x >>> 0).toString(16).toUpperCase() : String(x | 0);
    };
    const items = f.stack.items.slice().reverse();
    const rows = !f.connected ? '<p class="dim">Not connected.</p>'
      : !items.length ? '<p class="dim">Empty.</p>'
        : `<table>${items.map((v, k) => `<tr class="${k === 0 ? 'top' : ''}"><td class="i">${k === 0 ? 'TOS' : k}</td><td class="v" data-mem="${parseInt(v, f.stack.base) >>> 0}" title="Click: show this address in Memory">${fmt(v)}</td></tr>`).join('')}</table>`;
    this.view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
body{font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);color:var(--vscode-foreground);padding:4px 8px}
table{border-collapse:collapse;width:100%}td{padding:2px 6px;border-bottom:1px solid var(--vscode-widget-border,transparent)}
td.i{color:var(--vscode-descriptionForeground);width:3em}td.v{text-align:right;font-variant-numeric:tabular-nums;cursor:pointer}td.v:hover{text-decoration:underline}
tr.top td.v{color:var(--vscode-terminal-ansiYellow);font-weight:bold}
.dim{color:var(--vscode-descriptionForeground)}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
button{background:none;border:1px solid var(--vscode-button-border,var(--vscode-widget-border));color:var(--vscode-foreground);cursor:pointer;padding:1px 8px;border-radius:2px}
</style></head><body>
<div class="bar"><span class="dim">Data stack · ${f.stack.items.length}</span><button id="b">${this.hex ? 'hex' : 'dec'}</button></div>
${rows}
<script nonce="${n}">const vs=acquireVsCodeApi();document.getElementById('b').onclick=()=>vs.postMessage({hex:${!this.hex}});
document.querySelectorAll('[data-mem]').forEach(e=>e.onclick=()=>vs.postMessage({mem:+e.dataset.mem}));</script>
</body></html>`;
  }
}

// ---- Words ----
class WordsTree {
  constructor(vscode, forth, index) {
    this.vscode = vscode; this.forth = forth; this.index = index;   // index(): the model.Index
    this.ev = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.ev.event;
    forth.on('changed', () => this.ev.fire());
  }
  refresh() { this.ev.fire(); }
  group(label, kind, data, open) {
    const t = new this.vscode.TreeItem(label, open ? 2 : 1);
    t.kind = kind; t.data = data;
    return t;
  }
  word(name, desc, tip) {
    const t = new this.vscode.TreeItem(name, 0);
    t.description = desc || '';
    if (tip) t.tooltip = tip;
    t.contextValue = 'word';
    t.word = name;
    t.command = { command: 'forth.inspect', title: 'Inspect', arguments: [name] };
    return t;
  }
  // The words in the workspace's files, by folder then file, in the order each
  // file defines them. Left out: test folders, and other chips' folders
  // (lib/<chip>) once the board is known. -> {count, folders: Map}
  fileWords(ix) {
    const folders = new Map(), names = new Set();
    const shown = [...ix.files.entries()].filter(([p]) => {
      const segs = p.split(/[\\/]/).map(s => s.toLowerCase());
      if (segs.some(s => s === 'test' || s === 'tests')) return false;
      return !otherChip(p, ix.chip);
    });
    for (const [p, defs] of shown.sort(([a], [b]) => a.localeCompare(b))) {
      const list = Object.values(defs).sort((a, b) => a.line - b.line);
      if (!list.length) continue;
      const rel = this.vscode.workspace.asRelativePath(p, true).replace(/\\/g, '/');
      const cut = rel.lastIndexOf('/');
      const dir = cut < 0 ? '.' : rel.slice(0, cut);
      if (!folders.has(dir)) folders.set(dir, []);
      folders.get(dir).push({ name: rel.slice(cut + 1), defs: list });
      for (const d of list) names.add(d.name.toUpperCase());
    }
    // drop the leading folders every group shares (dev/littleFORTH/), keeping one at least
    const segs = [...folders.keys()].map(d => d.split('/'));
    let common = segs.length ? Math.min(...segs.map(s => s.length)) - 1 : 0;
    for (let i = 0; i < common; i++) if (segs.some(s => s[i] !== segs[0][i])) { common = i; break; }
    const short = new Map([...folders].map(([d, fs]) => [d.split('/').slice(common).join('/'), fs]));
    return { count: names.size, folders: short };
  }
  getTreeItem(e) { return e; }
  getChildren(e) {
    const ix = this.index();
    if (!e) {
      const g = [];
      if (this.forth.connected) g.push(this.group(`On the board (${this.forth.words.length})`, 'board', null, true));
      if (this.forth.blockWords.length) g.push(this.group(`Library block (${this.forth.blockWords.length})`, 'block'));
      const files = this.fileWords(ix);
      if (files.count) g.push(this.group(`In your files (${files.count})`, 'files', files));
      g.push(this.group('Built in', 'builtins'));
      if (Object.keys(ix.periphs).length) g.push(this.group('Registers', 'periphs'));
      return g;
    }
    const stackOf = n => { const d = ix.word(n); return d ? d.stack : ''; };
    switch (e.kind) {
      case 'board': return this.forth.words.map(n => this.word(n, stackOf(n)));
      case 'block': return this.forth.blockWords.map(n => this.word(n, stackOf(n)));
      case 'files': return [...e.data.folders].map(([dir, fs]) => this.group(`${dir} (${fs.reduce((n, f) => n + f.defs.length, 0)})`, 'folder', fs));
      case 'folder': return e.data.map(f => this.group(`${f.name} (${f.defs.length})`, 'file', f.defs));
      case 'file': return e.data.map(d => this.word(d.name, d.stack, d.note));
      case 'builtins': {
        const groups = {};
        for (const [k, v] of Object.entries(BUILTINS)) (groups[v[2]] = groups[v[2]] || []).push(k);
        return Object.entries(groups).map(([g, ws]) => this.group(g, 'bgroup', ws));
      }
      case 'bgroup': return e.data.map(n => this.word(n, BUILTINS[n][0], BUILTINS[n][1]));
      case 'periphs': return Object.values(ix.periphs).sort((a, b) => a.name.localeCompare(b.name)).map(p => this.group(p.name, 'periph', p));
      case 'periph': return [...e.data.regs.values()].map(r => this.word(`${e.data.name}.${r.name}`, '$' + (r.addr >>> 0).toString(16).toUpperCase(), r.desc));
      default: return [];
    }
  }
}

module.exports = { BoardTree, StacksView, WordsTree, esc, nonce, kb };

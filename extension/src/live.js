// live.js - live values in the editor: each register and VARIABLE a visible line
// names shows its value on the board at the end of the line, read about once a
// second while the board is idle. Registers that change when read (a FIFO, a data
// register), write-only ones, and peripherals held in reset are not read.
'use strict';
const B = require('./board');
const PD = require('./periphdata');
const { tokens } = require('./model');

// What may be read of these registers ([{periph, name, addr}]) on this board, and
// their values: Map addr -> value. Nothing from a peripheral in reset.
async function readRegisters(link, board, regs) {
  const d = PD.load(board);
  const out = new Map();
  if (!regs.length) return out;
  const ok = [];
  for (const r of regs) {
    const p = d && d.byName.get(r.periph);
    const info = p && p.regs.find(x => x.name === r.name);
    if (info && (info.changesOnRead || info.access === 'w')) continue;
    ok.push({ ...r, held: d && d.resets.get(r.periph) });
  }
  const held = ok.find(r => r.held);
  let resets = 0;
  if (held) resets = (await B.readCells(link, [held.held.addr]))[0];
  const now = ok.filter(r => !r.held || !((resets >>> r.held.bit) & 1));
  const addrs = [...new Set(now.map(r => r.addr >>> 0))];
  const vals = addrs.length ? await B.readCells(link, addrs) : [];
  addrs.forEach((a, i) => out.set(a, vals[i]));
  return out;
}

// VARIABLEs' values: Map NAME -> value
async function readVariables(link, names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 6) {
    const batch = names.slice(i, i + 6);
    const r = await link.exchange(`BASE @ HEX ${batch.map(n => `${n} @ U.`).join(' ')} BASE !`, 5000);
    if (r.error !== null) continue;
    const t = r.text.trim().split(/\s+/).slice(-batch.length);
    batch.forEach((n, k) => { const v = parseInt(t[k], 16); if (!Number.isNaN(v)) out.set(n, v >>> 0); });
  }
  return out;
}

const fmt = v => (v > 0xFFFF ? '$' + v.toString(16).toUpperCase() : String(v | 0));

function register(vscode, context, forth, lang) {
  const sub = x => context.subscriptions.push(x);
  const deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('debugTokenExpression.number'), margin: '0 0 0 1.5em' },
  });
  sub(deco);
  let busy = false, last = '';
  const on = () => vscode.workspace.getConfiguration('forth').get('liveValues', true);

  // per visible editor: [{line, names: [{key, label, kind, addr}]}]
  const wanted = ed => {
    const ix = lang.index(), rows = [];
    const onBoard = new Set(forth.words.map(w => w.toUpperCase()));
    for (const r of ed.visibleRanges) {
      for (let li = r.start.line; li <= Math.min(r.end.line, ed.document.lineCount - 1); li++) {
        const names = [], seen = new Set();
        for (const t of tokens(ed.document.lineAt(li).text)) {
          const u = t.text.toUpperCase();
          if (seen.has(u)) continue;
          let c = ix.classify(t.text);
          // the board looks up its own words before the builtins (src/interp.c find())
          if (c.kind === 'builtin' && onBoard.has(u)) { const w = ix.word(u); if (w) c = { kind: 'word', def: w }; }
          if (c.kind === 'register') { seen.add(u); names.push({ key: u, label: c.reg.name, kind: 'reg', addr: c.reg.addr >>> 0, periph: c.periph.name, name: c.reg.name }); }
          else if (c.kind === 'word' && c.def.stack === 'VARIABLE' && onBoard.has(u)) { seen.add(u); names.push({ key: u, label: c.def.name, kind: 'var' }); }
        }
        if (names.length) rows.push({ line: li, names });
      }
    }
    return rows;
  };

  const tick = async () => {
    const eds = (vscode.window.visibleTextEditors || []).filter(e => e.document.languageId === 'forth');
    if (busy || !on() || forth.state !== 'ready' || !forth.link || !forth.link.interpreting || !eds.length) return;
    busy = true;
    try {
      const per = eds.map(ed => ({ ed, rows: wanted(ed) }));
      const all = per.flatMap(p => p.rows.flatMap(r => r.names));
      if (!all.length) { for (const p of per) p.ed.setDecorations(deco, []); return; }
      const regs = [...new Map(all.filter(n => n.kind === 'reg').map(n => [n.addr, n])).values()];
      const vars = [...new Set(all.filter(n => n.kind === 'var').map(n => n.key))];
      const { r, v } = await forth.link.locked(async () => ({
        r: await readRegisters(forth.link, forth.board, regs),
        v: await readVariables(forth.link, vars),
      }));
      const key = JSON.stringify([...r, ...v]) + per.map(p => p.rows.map(x => x.line + ':' + x.names.map(n => n.key).join(',')).join()).join('|');
      if (key === last) return;
      last = key;
      for (const p of per) {
        p.ed.setDecorations(deco, p.rows.map(row => {
          const parts = row.names.map(n => {
            const val = n.kind === 'reg' ? r.get(n.addr) : v.get(n.key);
            return val === undefined ? null : `${n.label}=${fmt(val)}`;
          }).filter(Boolean);
          if (!parts.length) return null;
          const end = p.ed.document.lineAt(row.line).text.length;
          return { range: new vscode.Range(row.line, end, row.line, end), renderOptions: { after: { contentText: parts.join('  ') } } };
        }).filter(Boolean));
      }
    } catch { /* the board went busy or away: next tick */ } finally { busy = false; }
  };
  const timer = setInterval(tick, 1000);
  if (timer.unref) timer.unref();
  sub({ dispose: () => clearInterval(timer) });
  forth.on('state', s => {
    if (s === 'off' || s === 'lost') { last = ''; for (const e of vscode.window.visibleTextEditors || []) e.setDecorations(deco, []); }
  });
  return { tick };
}

module.exports = { register, readRegisters, readVariables };

// language.js - language support (kept from the first extension).
// Colouring, hover, completion, go to definition, outline, include links and
// problems, for our kernel's words and the board's register table. The rules
// live in model.js; this file connects them to VS Code.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const model = require('./model');
const A = require('./thumb2asm');
const H = require('./asmhelp');

const LANG = 'forth';
const EXTS = ['.fth', '.fr', '.4th'];
const BOARDS = require('../boards');
const BUILTINS = require('../data/builtins.json');

let ix, project, diags, timer, onRebuild = () => {}, connectedBoard = () => null, prefer = () => [];

// forth.json in a workspace folder: {board, libraries: [dirs], ...}
function readProject() {
  for (const f of vscode.workspace.workspaceFolders || []) {
    const p = path.join(f.uri.fsPath, 'forth.json');
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { file: p, dir: f.uri.fsPath, board: j.board, port: j.port, baud: j.baud, main: j.main, gdb: j.gdb, libraries: (j.libraries || []).map(d => path.resolve(f.uri.fsPath, d)) };
    } catch (e) {
      vscode.window.showWarningMessage(`forth.json: ${e.message}`);
    }
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return { file: null, dir: root, board: null, libraries: [] };
}

function board() {
  return connectedBoard() || project.board || vscode.workspace.getConfiguration(LANG).get('board') || (BOARDS.real.length ? BOARDS.real[0].name : null);
}

function forthFiles(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) forthFiles(p, out, depth + 1);
    else if (EXTS.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

// Everything the index knows: built-ins, the board's registers, and the words
// in the workspace and the project's libraries (open editors' unsaved text wins).
function rebuild() {
  project = readProject();
  const chip = BOARDS.chipOf(board());
  ix = new model.Index(BUILTINS, chip ? require(`../data/${chip}.json`) : {});
  ix.prefer = () => prefer();
  ix.chip = chip;                                             // the Words view shows only this chip's libraries
  const dirs = [...(vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath), ...project.libraries];
  // lib/<chip>/registers/*.fth: the register table covers them
  const regFile = f => path.basename(path.dirname(f)) === 'registers' && BOARDS.chips.includes(path.basename(path.dirname(path.dirname(f))));
  for (const d of dirs)
    for (const f of forthFiles(d))
      if (!regFile(f))                                        // lib/<chip>/*.fth: the register table covers them
        try { ix.setFile(f, fs.readFileSync(f, 'latin1')); } catch { /* unreadable: skip */ }
  for (const doc of vscode.workspace.textDocuments) if (doc.languageId === LANG) ix.setFile(doc.uri.fsPath, doc.getText());
  for (const doc of vscode.workspace.textDocuments) check(doc);
  onRebuild();
}

function check(doc) {
  if (doc.languageId !== LANG) return;
  if (!vscode.workspace.getConfiguration(LANG).get('unknownWords', true)) { diags.delete(doc.uri); return; }
  diags.set(doc.uri, ix.check(doc.getText()).map(p => {
    const d = new vscode.Diagnostic(new vscode.Range(p.line, p.start, p.line, p.end), p.message, vscode.DiagnosticSeverity.Warning);
    d.source = 'forth';
    return d;
  }));
}

// The token under the cursor (not inside a comment or string), and the number base there.
function tokenAt(doc, pos) {
  let base = 10;
  for (let i = 0; i <= pos.line; i++) {
    for (const t of model.tokens(doc.lineAt(i).text)) {
      const u = t.text.toUpperCase();
      if (i === pos.line && pos.character >= t.start && pos.character <= t.start + t.text.length)
        return { text: t.text, base, range: new vscode.Range(i, t.start, i, t.start + t.text.length) };
      if (u === 'HEX') base = 16; else if (u === 'DECIMAL') base = 10;
    }
  }
  return null;
}

// Inside a CODE block in ARM syntax: the instruction under the cursor explained, or
// the register's role in this Forth. null elsewhere (the Forth hover then answers).
function asmHover(doc, pos) {
  const all = [];
  for (let i = 0; i < doc.lineCount; i++) all.push(doc.lineAt(i).text);
  const b = A.blocks(all).find(k => k.start < pos.line && (k.end < 0 || pos.line < k.end));
  if (!b) return null;
  const line = all[pos.line];
  const code = A.stripComment(line);
  if (pos.character >= code.length) return null;
  const lm = /^(\s*)(?:([A-Za-z_.][\w.]*|\d+):\s*)?(\S+)(.*)$/.exec(code);
  if (!lm) return null;
  const at = code.length - lm[3].length - lm[4].length;
  if (pos.character >= at && pos.character <= at + lm[3].length) {
    const x = H.explain(`${lm[3]} ${lm[4].trim()}`);
    return x ? new vscode.Hover(new vscode.MarkdownString().appendMarkdown(H.markdown(x)), new vscode.Range(pos.line, at, pos.line, at + lm[3].length)) : null;
  }
  const re = /[A-Za-z]\w*/g;
  let m;
  while ((m = re.exec(code))) {
    if (pos.character < m.index || pos.character > m.index + m[0].length) continue;
    const role = H.role(m[0]);
    return role ? new vscode.Hover(new vscode.MarkdownString().appendMarkdown(role), new vscode.Range(pos.line, m.index, pos.line, m.index + m[0].length)) : null;
  }
  return null;
}

function where(def) {
  return `${path.basename(def.path)}:${def.line + 1}`;
}

function describe(c, tok) {
  const md = new vscode.MarkdownString();
  const code = s => md.appendCodeblock(s, LANG);
  switch (c.kind) {
    case 'builtin':
      code(`${c.name} ${c.stack}`);
      md.appendMarkdown(`${c.help}\n\n*Built in · ${c.group}*`);
      break;
    case 'word':
      code(`${c.def.name} ${c.def.stack}`);
      if (c.def.note) md.appendMarkdown(c.def.note + '\n\n');
      md.appendMarkdown(`*Defined in ${where(c.def)}*`);
      break;
    case 'register':
      code(`${c.periph.name}.${c.reg.name} = ${model.hex(c.reg.addr)}`);
      if (c.reg.desc) md.appendMarkdown(c.reg.desc + '\n\n');
      md.appendMarkdown(`*${c.periph.name} base ${model.hex(c.periph.base)} + $${(c.reg.addr - c.periph.base).toString(16).toUpperCase()} · in the board's register table, no dictionary space*`);
      break;
    case 'periph':
      code(`${c.periph.name} = ${model.hex(c.periph.base)}`);
      md.appendMarkdown(`*Peripheral base · ${c.periph.regs.size} registers in the board's table*`);
      break;
    case 'instance':
      code(`${tok.toUpperCase()} ${c.stack}`);
      md.appendMarkdown(`Calls **${c.def.name}** ${c.def.stack} with ${c.periph.name}'s base, ${model.hex(c.periph.base)}.\n\n`);
      if (c.def.note) md.appendMarkdown(c.def.note + '\n\n');
      md.appendMarkdown(`*Defined in ${where(c.def)}*`);
      break;
    case 'number': {
      const v = c.value >>> 0, s = v | 0;
      code(`${s}${s !== v ? `  (${v} unsigned)` : ''}   $${v.toString(16).toUpperCase()}   %${v.toString(2)}`);
      break;
    }
    default:
      return null;
  }
  return md;
}

const KIND = {
  builtin: vscode.CompletionItemKind.Keyword, word: vscode.CompletionItemKind.Function,
  register: vscode.CompletionItemKind.Constant, periph: vscode.CompletionItemKind.Module,
  instance: vscode.CompletionItemKind.Method,
};

// Semantic colouring: what the grammar can't know (your words, registers, instance words).
// Built-ins carry their group (the Flet IDE's colours); : and ; are 'define'.
const GROUP_MOD = { 'Stack': 'stack', 'Arithmetic': 'arith', 'Bitwise': 'bitwise', 'Comparison and flags': 'compare', 'Memory': 'memory', 'Control flow': 'control', 'Defining and compiling': 'defining', 'Input, output and text': 'io', 'System': 'system' };
const MODS = ['declaration', 'readonly', 'defaultLibrary', ...Object.values(GROUP_MOD), 'define'];
const legend = new vscode.SemanticTokensLegend(['function', 'variable', 'method', 'keyword', 'number'], MODS);
const mod = (...ms) => ms.reduce((a, m) => a | (1 << MODS.indexOf(m)), 0);

// A line of a CODE block in ARM syntax: mnemonic by kind (branches as control flow,
// loads and stores as memory, the rest arithmetic), registers, immediates, labels.
const ASM_CONTROL = /^(b|bl|bx|blx|cbn?z|it[te]{0,3}|svc|bkpt|cps[ie]d|wf[ie]|nop|sev|yield|[di]sb|dmb|mrs|msr)$/;
const ASM_MEMORY = /^(ldr|str|push|pop|ldm|stm)/;
function asmLine(b, i, text) {
  const body = A.stripComment(text);
  const re = /[^\s,\[\]{}!#=]+|#|=/g;
  let m, first = true, label = /^\s*([A-Za-z_.][\w.]*|\d+):/.exec(body);
  if (label) b.push(i, label.index + label[0].indexOf(label[1]), label[1].length, 0, 1);
  re.lastIndex = label ? label[0].length : 0;
  let imm = false;
  while ((m = re.exec(body))) {
    const t = m[0], l = t.toLowerCase();
    if (t === '#' || t === '=') { imm = true; continue; }
    if (first) {
      first = false;
      const mn = A.mnemonic(t);
      if (mn) { b.push(i, m.index, t.length, 0, mod('defaultLibrary', ASM_CONTROL.test(mn.base) ? 'control' : ASM_MEMORY.test(mn.base) ? 'memory' : 'arith')); continue; }
    }
    if (l in A.REGS) b.push(i, m.index, t.length, 1, 2);
    else if (/^[-+]?(0x[0-9a-f]+|\$[0-9a-f]+|%[01]+|\d+)$/i.test(t) || imm) {
      const c = ix.classify(t);
      if (c.kind === 'register' || c.kind === 'periph') b.push(i, m.index, t.length, 1, 2); else b.push(i, m.index, t.length, 4, 0);
    } else {
      const c = ix.classify(t);
      if (c.kind === 'register' || c.kind === 'periph') b.push(i, m.index, t.length, 1, 2);
      else if (c.kind === 'word') b.push(i, m.index, t.length, 0, 0);
    }
    imm = false;
  }
}

function semantic(doc) {
  const b = new vscode.SemanticTokensBuilder(legend);
  let base = 10, name = false, chr = false;
  const all = [];
  for (let i = 0; i < doc.lineCount; i++) all.push(doc.lineAt(i).text);
  const asm = new Map();                                 // line -> 'head' | 'body' | 'end'
  for (const k of A.blocks(all)) {
    asm.set(k.start, 'head');
    for (let i = k.start + 1; i < (k.end < 0 ? all.length : k.end); i++) asm.set(i, 'body');
    if (k.end >= 0) asm.set(k.end, 'end');
  }
  for (let i = 0; i < doc.lineCount; i++) {
    const kind = asm.get(i);
    if (kind === 'body') { asmLine(b, i, all[i]); continue; }
    if (kind) {                                          // CODE NAME / END-CODE: as : NAME and ;
      const ts = model.tokens(all[i]);
      if (ts[0]) b.push(i, ts[0].start, ts[0].text.length, 3, mod('define'));
      if (kind === 'head' && ts[1]) b.push(i, ts[1].start, ts[1].text.length, 0, 1);
      continue;
    }
    for (const t of model.tokens(doc.lineAt(i).text)) {
      const u = t.text.toUpperCase(), n = t.text.length;
      if (chr) { chr = false; continue; }
      if (name) { name = false; b.push(i, t.start, n, 0, 1); continue; }           // a new word's name
      if (u === ':' || u === 'VARIABLE' || u === 'CONSTANT' || u === 'CREATE') name = true;
      if (u === 'CHAR' || u === '[CHAR]') chr = true;
      if (u === 'HEX') base = 16; else if (u === 'DECIMAL') base = 10;
      const c = ix.classify(t.text, base);
      if (u === ':' || u === ';') b.push(i, t.start, n, 3, mod('define'));
      else if (c.kind === 'builtin') b.push(i, t.start, n, 0, GROUP_MOD[c.group] ? mod('defaultLibrary', GROUP_MOD[c.group]) : mod('defaultLibrary'));
      else if (c.kind === 'word') b.push(i, t.start, n, 0, 0);
      else if (c.kind === 'register' || c.kind === 'periph') b.push(i, t.start, n, 1, 2);
      else if (c.kind === 'instance') b.push(i, t.start, n, 2, 0);
      else if (c.kind === 'number') b.push(i, t.start, n, 4, 0);
    }
  }
  return b.build();
}

// [line, start, length] of each name being defined (after : VARIABLE CONSTANT CREATE)
function definedNames(doc) {
  const out = [];
  let name = false, chr = false;
  for (let i = 0; i < doc.lineCount; i++) {
    for (const t of model.tokens(doc.lineAt(i).text)) {
      const u = t.text.toUpperCase();
      if (chr) { chr = false; continue; }
      if (name) { name = false; out.push([i, t.start, t.text.length]); continue; }
      if (u === ':' || u === 'VARIABLE' || u === 'CONSTANT' || u === 'CREATE' || u === 'CODE') name = true;
      if (u === 'CHAR' || u === '[CHAR]') chr = true;
    }
  }
  return out;
}

// \ INCLUDE path: next to the file, then the project's libraries, then the workspace.
function resolveInclude(name, from) {
  const roots = [path.dirname(from), ...project.libraries, ...(project.dir ? [project.dir] : [])];
  for (const r of roots) {
    const p = path.normalize(path.join(r, name));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function register(context, onChange, boardNow) {
  if (onChange) onRebuild = onChange;
  if (boardNow) connectedBoard = boardNow;
  diags = vscode.languages.createDiagnosticCollection(LANG);
  rebuild();
  const sel = { language: LANG };
  const sub = x => context.subscriptions.push(x);
  sub(diags);

  sub(vscode.languages.registerHoverProvider(sel, {
    provideHover(doc, pos) {
      const h = asmHover(doc, pos);
      if (h) return h;
      const t = tokenAt(doc, pos);
      if (!t) return null;
      const md = describe(ix.classify(t.text, t.base), t.text);
      return md ? new vscode.Hover(md, t.range) : null;
    },
  }));

  sub(vscode.languages.registerCompletionItemProvider(sel, {
    provideCompletionItems(doc, pos) {
      const line = doc.lineAt(pos.line).text.slice(0, pos.character);
      const m = /(\S*)$/.exec(line);
      const prefix = m ? m[1] : '';
      const range = new vscode.Range(pos.line, pos.character - prefix.length, pos.line, pos.character);
      return ix.complete(prefix).map(c => {
        const it = new vscode.CompletionItem({ label: c.label, description: c.detail }, KIND[c.kind]);
        it.range = range;
        it.filterText = c.label;
        if (c.doc) it.documentation = c.doc;
        if (c.kind === 'instance') it.detail = `calls ${c.def.name}`;
        return it;
      });
    },
  }, '.'));

  sub(vscode.languages.registerDefinitionProvider(sel, {
    provideDefinition(doc, pos) {
      const t = tokenAt(doc, pos);
      if (!t) return null;
      const c = ix.classify(t.text, t.base);
      const def = c.def;
      return def && def.path ? new vscode.Location(vscode.Uri.file(def.path), new vscode.Position(def.line, def.col)) : null;
    },
  }));

  sub(vscode.languages.registerDocumentSymbolProvider(sel, {
    provideDocumentSymbols(doc) {
      return Object.values(model.definitions(doc.getText(), doc.uri.fsPath)).map(d => {
        const r = new vscode.Range(d.line, d.col, d.line, d.col + d.name.length);
        const kind = d.stack === 'VARIABLE' ? vscode.SymbolKind.Variable : d.stack === 'CONSTANT' ? vscode.SymbolKind.Constant : vscode.SymbolKind.Function;
        return new vscode.DocumentSymbol(d.name, d.stack.startsWith('(') ? d.stack : '', kind, doc.lineAt(d.line).range, r);
      });
    },
  }));

  sub(vscode.languages.registerDocumentLinkProvider(sel, {
    provideDocumentLinks(doc) {
      return model.includes(doc.getText()).flatMap(inc => {
        const p = resolveInclude(inc.name, doc.uri.fsPath);
        if (!p) return [];
        const col = doc.lineAt(inc.line).text.indexOf(inc.name);
        return [new vscode.DocumentLink(new vscode.Range(inc.line, col, inc.line, col + inc.name.length), vscode.Uri.file(p))];
      });
    },
  }));

  sub(vscode.languages.registerDocumentSemanticTokensProvider(sel, { provideDocumentSemanticTokens: semantic }, legend));

  // A new word's name on a dark gold ground, as in the Flet IDE (a theme can't give a word a background)
  const defBg = vscode.window.createTextEditorDecorationType({ dark: { backgroundColor: '#4A3B00' }, light: { backgroundColor: '#FFE9A0' }, borderRadius: '2px' });
  sub(defBg);
  const markNames = ed => {
    if (!ed || ed.document.languageId !== LANG) return;
    ed.setDecorations(defBg, definedNames(ed.document).map(([l, c, n]) => new vscode.Range(l, c, l, c + n)));
  };
  sub(vscode.window.onDidChangeActiveTextEditor(markNames));
  sub(vscode.window.onDidChangeVisibleTextEditors(eds => eds.forEach(markNames)));
  sub(vscode.workspace.onDidChangeTextDocument(e => { for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) markNames(ed); }));
  (vscode.window.visibleTextEditors || []).forEach(markNames);

  sub(vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document.languageId !== LANG) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      ix.setFile(e.document.uri.fsPath, e.document.getText());
      for (const d of vscode.workspace.textDocuments) check(d);
    }, 300);
  }));
  sub(vscode.workspace.onDidOpenTextDocument(doc => { if (doc.languageId === LANG) { ix.setFile(doc.uri.fsPath, doc.getText()); check(doc); } }));
  sub(vscode.workspace.onDidCloseTextDocument(doc => diags.delete(doc.uri)));

  const w = vscode.workspace.createFileSystemWatcher('**/*.{fth,fr,4th,json}');
  const changed = uri => {
    if (path.basename(uri.fsPath) === 'forth.json') return rebuild();
    if (!EXTS.includes(path.extname(uri.fsPath).toLowerCase())) return;
    try { ix.setFile(uri.fsPath, fs.readFileSync(uri.fsPath, 'latin1')); } catch { ix.removeFile(uri.fsPath); }
    for (const d of vscode.workspace.textDocuments) check(d);
  };
  w.onDidCreate(changed); w.onDidChange(changed);
  w.onDidDelete(uri => { if (path.basename(uri.fsPath) === 'forth.json') rebuild(); else { ix.removeFile(uri.fsPath); for (const d of vscode.workspace.textDocuments) check(d); } });
  sub(w);
  sub(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(LANG)) rebuild(); }));
  sub(vscode.commands.registerCommand('forth.reindex', rebuild));

  return { setPrefer: f => { prefer = f; }, index: () => ix, project: () => project, board, rebuild, tokenAt, describe };
}

module.exports = { register };

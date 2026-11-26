// extension.js - wires the pieces together. The Forth service owns the board;
// the console, the views and the editor only ask it to do things.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { Forth } = require('./forth');
const BOARDS = require('../boards');
const { Console } = require('./console');
const V = require('./views');
const B = require('./board');
const F = require('./flash');
const A = require('./thumb2asm');
const model = require('./model');
const language = require('./language');
const H = require('./hotreload');
const { findOpenocd, openocdArgs } = require('./openocd');

let forth, con, lang, diags, status;
const sent = new Map();          // file -> its text as last sent to the board
// The files sent, newest last; kept across connections and reloads (workspace state):
// their words are taken as the ones on the board when two files define the same name.
let sentOrder = [], keep = () => {};
function wasSent(file) {
  sentOrder = [...sentOrder.filter(f => f.toLowerCase() !== file.toLowerCase()), file].slice(-50);
  keep(sentOrder);
}

// ---- the status bar: one item, the board's state ----
function showStatus() {
  const f = forth;
  const t = {
    off: ['$(debug-disconnect) Forth', 'Not connected. Click to connect.'],
    connecting: ['$(sync~spin) Forth', 'Connecting…'],
    lost: ['$(warning) Forth', 'Connection lost; reconnecting when the port is back. Click for options.'],
    busy: [`$(loading~spin) ${f.board || 'Forth'}`, 'Running. Click for options.'],
  }[f.state] || [`$(circle-filled) ${f.board || 'Forth'} · ${f.port}${f.dict ? ` · ${V.kb(f.dict.size - f.dict.used)} free` : ''}`, 'Connected. Click for options.'];
  status.text = t[0];
  status.tooltip = t[1];
  vscode.commands.executeCommand('setContext', 'forth.connected', f.connected);
}

async function menu() {
  const c = forth.connected;
  const items = [
    c ? { label: '$(debug-disconnect) Disconnect', cmd: 'forth.disconnect' } : { label: '$(plug) Connect', cmd: 'forth.connect' },
    { label: '$(terminal) Show the console', cmd: 'forth.console' },
    ...(c ? [{ label: '$(graph-line) Scope', cmd: 'forth.plot' }, { label: '$(flame) Profile…', cmd: 'forth.profile' }, { label: '$(debug-alt) Debug', cmd: 'forth.debug' },
      ...((BOARDS.get(forth.board) || {}).picture ? [{ label: '$(circuit-board) Show the board', cmd: 'forth.boardPicture' }] : []),
      { label: '$(save) Save words to flash', cmd: 'forth.save' }, { label: '$(debug-restart) Reset the board', cmd: 'forth.reset' }] : []),
    { label: '$(notebook) New notebook', cmd: 'forth.newNotebook' },
    { label: '$(zap) Flash firmware', cmd: 'forth.flash' },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: c ? `${forth.board || 'Board'} on ${forth.port}` : 'Forth: not connected' });
  if (pick) vscode.commands.executeCommand(pick.cmd);
}

// ---- project settings: forth.json, else the settings ----
function project() { return lang.project(); }
function roots() { const p = project(); return [...p.libraries, ...(p.dir ? [p.dir] : [])]; }
function boardName() { return forth.board || lang.board(); }

async function connect() {
  const p = project();
  const spec = null;          // forth.preferred holds the project's port
  con.show(true);
  const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Forth: connecting' },
    () => forth.connect(spec, p.baud || 115200));
  if (!ok) {
    const pick = await vscode.window.showWarningMessage('Forth: no board answered. Is it plugged in and running Forth?', 'Flash firmware', 'Choose port', 'Work without a board');
    if (pick === 'Flash firmware') return flash();
    if (pick === 'Choose port') return choosePort();
    if (pick === 'Work without a board') return forth.connect('wasm');
  }
  return ok;
}

async function choosePort() {
  let list = [];
  try { list = await F.ports(boardName()); } catch (e) { vscode.window.showErrorMessage(`Forth: can't list serial ports: ${e.message}`); return false; }
  if (!list.length) { vscode.window.showErrorMessage('Forth: no serial ports. Is the board plugged in?'); return false; }
  const pick = await vscode.window.showQuickPick(list.map(x => ({ label: x.path, description: x.label })), { placeHolder: 'Serial port' });
  return pick ? forth.connect(pick.label, project().baud || 115200) : false;
}

const ensure = async () => forth.connected || connect();

// ---- sending ----
function tableDirs() {
  const chip = BOARDS.chipOf(boardName());
  const p = project();
  if (!chip) return [];
  const dirs = [];
  if (p.dir) dirs.push(path.join(p.dir, 'lib', chip, 'registers'));
  for (const l of p.libraries) dirs.push(path.join(path.dirname(l), 'registers'), path.join(l, 'lib', chip, 'registers'));
  return dirs;
}

const lineRange = no => new vscode.Range(no - 1, 0, no - 1, 1000);

async function sendLines(lines, title, byWord) {
  diags.clear();
  con.show(true);
  const t0 = Date.now();
  let res;
  try {
    res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (prog, tok) => {
      tok.onCancellationRequested(() => forth.interrupt());
      let last = 0;
      return forth.send(lines, (i, ln, r) => {
        const pc = Math.floor((100 * (i + 1)) / lines.length);
        if (pc > last) { prog.report({ increment: pc - last }); last = pc; }
        if (r.text && r.error === null) con.out(r.text + '\n');
      }, byWord);
    });
  } catch (e) {
    con.out(`\x1b[31m${e.message}\x1b[0m\n`);
    return;
  }
  if (res.error) {
    const e = res.error, where = `${path.basename(e.line.file)}:${e.line.no}`;
    const msg = e.code === 'asm' ? e.text : `${(e.text || '').replace(/ \?-\d+ ?$/, '').trim()} ? ${B.throwText(e.code)} (${e.code})`;
    con.out(`\x1b[31m${where}: ${msg}\x1b[0m\n`);
    const d = new vscode.Diagnostic(lineRange(e.line.no), msg, vscode.DiagnosticSeverity.Error);
    d.source = 'board';
    diags.set(vscode.Uri.file(e.line.file), [d]);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(e.line.file));
    const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    ed.selection = new vscode.Selection(e.line.no - 1, 0, e.line.no - 1, 0);
    ed.revealRange(lineRange(e.line.no), vscode.TextEditorRevealType.InCenter);
  } else if (res.stopped) {
    con.out(`\x1b[33m▸ stopped after ${res.good} of ${res.total} lines\x1b[0m\n`);
  } else {
    con.out(`\x1b[32m▸ ${res.good} lines in ${((Date.now() - t0) / 1000).toFixed(1)} s\x1b[0m\n`);
  }
  return res;
}

async function sendFile(uri) {
  const ed = vscode.window.activeTextEditor;
  const doc = uri && uri.fsPath ? await vscode.workspace.openTextDocument(uri) : ed && ed.document;
  if (!doc || doc.languageId !== 'forth') { vscode.window.showWarningMessage('Forth: open a Forth file to send'); return; }
  if (!(await ensure())) return;
  const ctx = { stack: [], seen: new Set(), skipped: [], files: [] };
  let lines;
  try {
    lines = B.expand(doc.uri.fsPath, roots(), doc.getText(), tableDirs(), ctx);
  } catch (e) {
    if (e instanceof B.SourceError) {
      const d = new vscode.Diagnostic(lineRange(e.line || 1), e.msg, vscode.DiagnosticSeverity.Error);
      diags.set(vscode.Uri.file(e.file), [d]);
    }
    con.out(`\x1b[31mnot sent: ${e.message}\x1b[0m\n`);
    return;
  }
  const inc = ctx.files.length - 1;
  con.out(`\x1b[33m▸ send ${path.basename(doc.uri.fsPath)}${inc ? ` (+${inc} include${inc === 1 ? '' : 's'})` : ''}, ${lines.length} lines\x1b[0m\n`);
  const own = doc.uri.fsPath;      // the file itself a word at a time (the debugger steps it); its includes a line at a time
  const res = await sendLines(lines, `Forth: sending ${path.basename(own)}`, ln => ln.file === own);
  // what the board now has of each file: hot reload sends only what changes from here
  if (res && !res.error && !res.stopped)
    for (const f of ctx.files) { sent.set(f.file, f.file === doc.uri.fsPath ? doc.getText() : fs.readFileSync(f.file, 'latin1')); wasSent(f.file); }
  return res;
}

// Saved a file that was sent: send the words that changed, and the ones using them.
async function hotReload(doc) {
  if (doc.languageId !== 'forth' || !forth.connected || !sent.has(doc.uri.fsPath)) return;
  if (!vscode.workspace.getConfiguration('forth').get('hotReload', true)) return;
  if (forth.state === 'busy') return;
  const text = doc.getText();
  const p = H.plan(sent.get(doc.uri.fsPath), text);
  if (!p.send.length) return;
  const ls = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const c of p.send)
    for (let i = c.from; i <= c.to; i++) {
      const t = ls[i].replace(/\t/g, ' ').replace(/\s+$/, '');
      if (t.trim() && t.trim() !== '\\' && !t.trim().startsWith('\\ ')) lines.push({ file: doc.uri.fsPath, no: i + 1, text: t });
    }
  const names = p.send.flatMap(c => c.names);
  con.out(`\x1b[33m▸ hot reload ${path.basename(doc.uri.fsPath)}: ${names.join(' ')}\x1b[0m\n`);
  const res = await sendLines(lines, `Forth: reloading ${names.length} word${names.length === 1 ? '' : 's'}`);
  if (res && !res.error && !res.stopped) sent.set(doc.uri.fsPath, text);
}

// Shift+Enter: the selection, or the line at the cursor (then the cursor moves down).
async function sendLine() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !(await ensure())) return;
  const sel = ed.selection;
  let first = sel.start.line, last = sel.isEmpty ? first : sel.end.line - (sel.end.character === 0 && sel.end.line > first ? 1 : 0);
  const all = [];
  for (let i = 0; i < ed.document.lineCount; i++) all.push(ed.document.lineAt(i).text);
  for (const b of A.blocks(all)) {
    const end = b.end < 0 ? all.length - 1 : b.end;
    if (first <= end && last >= b.start) { first = Math.min(first, b.start); last = Math.max(last, end); }
  }
  const lines = [];
  for (let i = first; i <= last; i++) {
    const t = ed.document.lineAt(i).text.replace(/\s+$/, '');
    if (t.trim() && !model.INCLUDE_RE.test(t)) lines.push({ file: ed.document.uri.fsPath, no: i + 1, text: t });
  }
  for (const l of lines) con.out(`\x1b[2m${l.text}\x1b[0m\n`);
  if (lines.length) await sendLines(lines, 'Forth: sending');
  if (sel.isEmpty && last + 1 < ed.document.lineCount) {
    const p = new vscode.Position(last + 1, 0);
    ed.selection = new vscode.Selection(p, p);
  }
}

// ---- board actions ----
async function save() {
  if (!(await ensure())) return;
  const drv = (BOARDS.get(forth.board) || {}).flashDriver;   // SAVE in Forth
  if (drv && !forth.words.includes('SAVE') && !forth.blockWords.includes('SAVE')) {
    const f = roots().map(d => path.join(d, drv)).find(p => fs.existsSync(p));
    if (!f) { vscode.window.showErrorMessage(`Forth: SAVE is in ${drv} (lib/${BOARDS.chipOf(forth.board)}/drivers): add that folder to libraries in forth.json`); return; }
    const r = await sendFile(vscode.Uri.file(f));
    if (!r || r.error) return;
  }
  con.show(true);
  con.out('\x1b[2mSAVE\x1b[0m\n');
  const r = await forth.run('SAVE');
  con.out(r.error === null ? '\x1b[32m▸ saved to flash\x1b[0m\n' : `\x1b[31mSAVE ? ${B.throwText(r.error)} (${r.error})\x1b[0m\n`);
}

async function reset() {
  if (!forth.connected) return;
  con.show(true);
  con.out('\x1b[2mREBOOT\x1b[0m\n');
  try { await forth.run('REBOOT'); } catch { /* the board restarts mid-line */ }
}

function firmware(board = boardName()) {
  const b = BOARDS.get(board);
  const name = b && b.firmware ? b.firmware[0] : null;
  if (!name) return null;
  // the project's own build (a kernel being worked on) or the extension's copy: the
  // newer of the two, so an old build left in a project never replaces a newer kernel
  const p = project();
  const found = [p.dir && path.join(p.dir, 'build', name), path.join(__dirname, '..', 'firmware', name)]
    .filter(f => f && fs.existsSync(f)).map(f => ({ f, t: fs.statSync(f).mtimeMs }));
  found.sort((a, b) => b.t - a.t);
  return found.length ? found[0].f : null;
}

async function flash() {
  const board = await (async () => {
    if (forth.board && forth.board !== 'Host build') return forth.board;
    const pick = await vscode.window.showQuickPick(BOARDS.real.filter(b => b.flash).map(b => b.name), { placeHolder: 'Which board?' });
    return pick;
  })();
  if (!board) return;
  forth.board = forth.board || board;
  const fw = firmware(board);
  if (!fw) { vscode.window.showErrorMessage(`Forth: no firmware for the ${board}`); return; }
  const oc = findOpenocd();
  let how;
  try { how = BOARDS.get(board).flash(fw, { F, openocd: oc && openocdArgs(board, oc) }); }
  catch (e) { vscode.window.showErrorMessage(`Forth: ${e.message}`); return; }
  const was = forth.connected;
  if (was) await forth.disconnect();
  try {
    const msg = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Forth: flashing the ${board}` }, how);
    con.out(`\x1b[32m▸ ${msg}\x1b[0m\n\x1b[2m  from ${fw} (${new Date(fs.statSync(fw).mtimeMs).toLocaleString()})\x1b[0m\n`);
  } catch (e) {
    vscode.window.showErrorMessage(`Forth: ${e.message}`);
    return;
  }
  setTimeout(() => connect(), 2500);
}

// ---- activate ----
function activate(context) {
  const sub = x => context.subscriptions.push(x);
  forth = new Forth();
  Object.defineProperty(forth, 'preferred', { get: () => (lang && lang.project().port) || vscode.workspace.getConfiguration('forth').get('port') || null });
  forth.projectBoard = () => lang && lang.board();   // when the board can't be recognised
  con = new Console(vscode, forth);
  diags = vscode.languages.createDiagnosticCollection('forth-board');
  sub(diags);
  let words;
  lang = language.register(context, () => words && words.refresh(), () => forth.board);
  const ws = context.workspaceState;
  sentOrder = (ws && ws.get('forth.sent')) || [];
  keep = list => { if (ws) ws.update('forth.sent', list); };
  lang.setPrefer(() => [...sentOrder].reverse());   // the words of the files sent last are the ones on the board
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'forth.menu';
  status.show();
  sub(status);
  forth.on('state', showStatus);
  forth.on('changed', showStatus);
  forth.on('state', s => { if (s === 'ready') lang.rebuild(); });   // the board is known: its registers
  const lens = require('./lens').register(vscode, context, lang.index);
  forth.on('state', s => { if (s === 'ready') lens.redraw(); });
  require('./live').register(vscode, context, forth, lang);
  showStatus();

  words = new V.WordsTree(vscode, forth, lang.index);
  sub(vscode.window.registerTreeDataProvider('forth.board', new V.BoardTree(vscode, forth)));
  sub(vscode.window.registerWebviewViewProvider('forth.stacks', new V.StacksView(vscode, forth)));
  sub(vscode.window.registerTreeDataProvider('forth.words', words));

  const cmd = (n, f) => sub(vscode.commands.registerCommand(n, f));
  cmd('forth.menu', menu);
  cmd('forth.connect', connect);
  cmd('forth.disconnect', () => forth.disconnect());
  cmd('forth.choosePort', choosePort);
  cmd('forth.noBoard', async () => { if (forth.connected) await forth.disconnect(); con.show(true); return forth.connect('wasm'); });
  cmd('forth.console', () => con.show());
  cmd('forth.sendFile', sendFile);
  cmd('forth.sendLine', sendLine);
  cmd('forth.stop', () => forth.interrupt());
  cmd('forth.save', save);
  cmd('forth.reset', reset);
  cmd('forth.flash', flash);
  const inspector = new (require('./inspector').Inspector)(vscode, forth, lang);
  cmd('forth.inspect', x => inspector.open(x && x.word ? x.word : x));
  const pic = new (require('./boardpic').BoardPicture)(vscode, forth, inspector);
  cmd('forth.boardPicture', () => pic.open());
  if (vscode.debug) require('./profileview').register(vscode, context, forth, lang, ensure, n => inspector.open(n));
  if (vscode.notebooks) require('./notebook').register(vscode, context, forth, ensure);
  const memory = new (require('./memory').Memory)(vscode, forth, lang, () => firmware());
  cmd('forth.memory', x => memory.open(x));
  if (vscode.debug) memory.session = require('./debugview').register(vscode, context, forth, con, lang, ensure);
  if (memory.session) memory.session.memory = memory;
  const scope = new (require('./scope').Scope)(vscode, forth, lang);
  cmd('forth.plot', x => scope.open(x && x.word ? x.word : typeof x === 'string' ? x : undefined));
  cmd('forth.plotAtCursor', () => {
    const ed = vscode.window.activeTextEditor;
    const t = ed && lang.tokenAt(ed.document, ed.selection.active);
    scope.open(t ? t.text : undefined);
  });
  cmd('forth.inspectAtCursor', () => {
    const ed = vscode.window.activeTextEditor;
    const t = ed && lang.tokenAt(ed.document, ed.selection.active);
    return inspector.open(t ? t.text : undefined);
  });
  if (vscode.workspace.onDidSaveTextDocument) sub(vscode.workspace.onDidSaveTextDocument(hotReload));
  forth.on('state', st => { if (st === 'off' || st === 'lost') sent.clear(); });   // a new connection: the board may have lost them
  sub({ dispose: () => forth.disconnect() });
  // start at once: the board if one answers, else Forth here in VS Code
  setTimeout(() => { if (!forth.connected && forth.state === 'off') forth.connect().then(ok => { if (ok) con.show(true); }); }, 500);
}

function deactivate() { return forth ? forth.disconnect() : undefined; }

module.exports = { activate, deactivate, _forth: () => forth, _console: () => con };

'use strict';
// The extension under the vscode stub, talking to the host build through the console.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const stub = require('./vscode-stub');
const vscode = require('vscode');
const HOST = path.resolve(__dirname, '..', '..', 'build', process.platform === 'win32' ? 'host.exe' : 'host');
const skip = !fs.existsSync(HOST) && 'needs build/host';
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out: ' + f); await new Promise(r => setTimeout(r, 20)); } };
const plain = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
let saveHook = null, nbCtl = null;
// enough of the notebook API for the controller
class Item { constructor(data, mime) { this.data = data; this.mime = mime; } }
Item.text = (s, m = 'text/plain') => new Item(s, m); Item.stdout = s => new Item(s, 'stdout'); Item.stderr = s => new Item(s, 'stderr');
Object.assign(vscode, {
  NotebookCellOutputItem: Item, NotebookCellOutput: class { constructor(items) { this.items = items; } },
  NotebookData: class { constructor(cells) { this.cells = cells; } }, NotebookCellData: class { constructor(kind, value, lang) { Object.assign(this, { kind, value, lang }); } },
  NotebookCellKind: { Markup: 1, Code: 2 },
  notebooks: { createNotebookController: () => (nbCtl = { createNotebookCellExecution: () => { const x = { token: { onCancellationRequested() {} }, start() {}, end(ok) { x.ok = ok; }, replaceOutput(o) { x.out = o; } }; nbCtl.last = x; return x; }, dispose() {} }) },
});
vscode.workspace.registerNotebookSerializer = () => ({ dispose() {} });
vscode.workspace.onDidSaveTextDocument = f => { saveHook = f; return { dispose() {} }; };

test('console: prompt with the stack, lines run, errors shown', { skip }, async () => {
  const E = require('../src/extension');
  vscode.workspace.getConfiguration = () => ({ get: (k, d) => (k === 'port' ? 'run:' + HOST : d) });
  E.activate({ subscriptions: [], extensionPath: path.resolve(__dirname, '..') });
  const term = stub.term;
  await stub.commands['forth.connect']();
  await until(() => E._forth().state === 'ready');
  await until(() => /› $/.test(plain(term.out)));
  try {
  const type = async s => { const n = term.out.length; for (const c of s) term.pty.handleInput(c); term.pty.handleInput('\r'); await until(() => /› $/.test(plain(term.out.slice(n)))); return plain(term.out.slice(n)); };
  let o = await type('3 4');
  assert.match(o, /\( 3 4 \)\r\n› $/);
  o = await type('+ .');
  assert.match(o, /7 ok/);
  assert.match(o, /\n› $/);
  o = await type('FROB');
  assert.match(o, /FROB \? undefined word \(-13\)/);
  // output while waiting goes above the prompt, and the prompt comes back
  E._forth().emit('output', 'from the board\n');
  await until(() => /from the board\r\n[^]*› $/.test(plain(term.out)));
    // hot reload: send a file, change a word, save: the word and its caller are new
    const os = require('os');
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnext-')), 'sq.fth');
    fs.writeFileSync(f, ': SQ ( n -- n2 ) DUP * ;\n: CUBE ( n -- n3 ) DUP SQ * ;\n');
    await stub.commands['forth.sendFile'](vscode.Uri.file(f));
    o = await type('3 CUBE .');
    assert.match(o, /27 ok/);
    fs.writeFileSync(f, ': SQ ( n -- n2 ) DUP * 1+ ;\n: CUBE ( n -- n3 ) DUP SQ * ;\n');
    const n = term.out.length;
    await saveHook(stub.doc(f));
    assert.match(plain(term.out.slice(n)), /hot reload sq\.fth: SQ CUBE/);
    o = await type('3 CUBE .');
    assert.match(o, /30 ok/);
    // inspect: the source, who uses it, and the board's copy
    vscode.workspace.textDocuments = [stub.doc(f)];
    await stub.commands['forth.reindex']();
    await stub.commands['forth.inspect']('SQ');
    const html = stub.panels[stub.panels.length - 1].webview.html;
    assert.match(html, /DUP \* 1\+ ;/);
    assert.match(html, /Used by[^]*CUBE/);
    assert.match(html, /older version still on the board/);
    // live values: a VARIABLE on a visible line shows its value
    fs.writeFileSync(f, 'VARIABLE COUNTER\n: BUMP 1 COUNTER +! ;\n');
    await stub.commands['forth.sendFile'](vscode.Uri.file(f));
    await type('41 COUNTER ! BUMP');
    const d = stub.doc(f), shownDecos = [];
    vscode.workspace.textDocuments = [d];
    await stub.commands['forth.reindex']();
    vscode.window.visibleTextEditors = [{ document: d, visibleRanges: [new vscode.Range(0, 0, 1, 0)], setDecorations: (t, ds) => shownDecos.push(...ds) }];
    await until(() => shownDecos.some(x => x.renderOptions && /COUNTER=42/.test(x.renderOptions.after.contentText)), 5000);
    vscode.window.visibleTextEditors = [];
    // memory: COUNTER as a record with its value; the cells lens labels it; a cell edited
    await stub.commands['forth.memory']('COUNTER');
    const mp = stub.panels[stub.panels.length - 1];
    const lastMain = () => [...mp.posts].reverse().find(m => m.main !== undefined);
    await until(() => lastMain() && /COUNTER/.test(lastMain().main));
    assert.match(lastMain().main, /VARIABLE[^]*>42 </);
    assert.match(lastMain().status, /read through the console/);
    assert.ok(mp.posts.some(m => /Dictionary/.test(m.budget || '')), 'the dictionary budget');
    assert.ok(mp.posts.some(m => /RAM|No memory map/.test(m.map || '')), 'the map (the host build has none)');
    await mp.click({ lens: 'cells' });
    await until(() => /Points at/.test(lastMain().main));
    const body = Number(/<tr class=" hit"><td class="a"><a data-goto="(\d+)"/.exec(lastMain().main)[1]);
    assert.match(lastMain().main, /COUNTER: body/);
    await mp.click({ edit: body, value: '7' });
    o = await type('COUNTER @ .');
    assert.match(o, /7 ok/);
    await type('42 COUNTER !');                 // as the scope below expects
    await mp.click({ go: "HERE 16 -" });
    await until(() => /HERE/.test(mp.posts[mp.posts.length - 1].text || ''));
    await mp.click({ go: 'NOPE' });
    assert.ok(mp.posts.some(m => m.bad && /NOPE: not a word/.test(m.status)));
    mp.dispose();
    // scope: a VARIABLE plotted, and a phrase
    await stub.commands['forth.plot']('COUNTER');
    const sp = stub.panels[stub.panels.length - 1];
    sp.click({ add: 'COUNTER @ 2*' });
    await until(() => sp.posts.some(m => m.s && m.s.v[0] === 42 && m.s.v[1] === 84), 5000);
    sp.dispose();
    // notebook: a cell runs on the board; its output and the stack come back
    const cell = t => ({ document: { uri: { toString: () => 'nb#1' }, getText: () => t } });
    await nbCtl.executeHandler([cell(': TWICE ( n -- n2 ) 2* ;\n21 TWICE DUP .\n')]);
    const outs = nbCtl.last.out.map(o => o.items[0].data);
    assert.deepStrictEqual(outs, ['42\n', 'left ( 42 )']);
    assert.strictEqual(nbCtl.last.ok, true);
    await nbCtl.executeHandler([cell('DROP NOPE')]);
    assert.match(nbCtl.last.out[0].items[0].data, /line 1: NOPE \? undefined word \(-13\)/);
  } finally { await E._forth().disconnect(); }
});

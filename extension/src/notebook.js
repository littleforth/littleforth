// notebook.js - Forth notebooks (.fthnb): cells of Forth that run on the board,
// with what the board printed and what the cell left on the stack shown under each.
// Markdown cells for the words around them. The file is plain JSON.
'use strict';
const B = require('./board');

// What one cell did to the stack: what it left, then how many items from before
// are under it and how many of those it took. "left ( 49 )  · 3 from before"
function cellStack(before, after) {
  let keep = 0;
  while (keep < before.length && keep < after.length && before[keep] === after[keep]) keep++;
  const left = after.slice(keep);
  const notes = [];
  if (keep) notes.push(`${keep} from before underneath`);
  if (before.length > keep) notes.push(`took ${before.length - keep} from before`);
  return `left ( ${left.join(' ')}${left.length ? ' ' : ''})` + (notes.length ? `  · ${notes.join(', ')}` : '');
}

function register(vscode, context, forth, ensure) {
  const sub = x => context.subscriptions.push(x);
  const dec = new TextDecoder(), enc = new TextEncoder();

  sub(vscode.workspace.registerNotebookSerializer('forth-notebook', {
    deserializeNotebook(bytes) {
      let j = { cells: [] };
      try { const t = dec.decode(bytes); if (t.trim()) j = JSON.parse(t); } catch { /* a new or broken file: start empty */ }
      return new vscode.NotebookData((j.cells || []).map(c => new vscode.NotebookCellData(
        c.kind === 'markdown' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
        c.source || '', c.kind === 'markdown' ? 'markdown' : 'forth')));
    },
    serializeNotebook(data) {
      return enc.encode(JSON.stringify({ cells: data.cells.map(c => ({ kind: c.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'forth', source: c.value })) }, null, 1) + '\n');
    },
  }));

  const ctl = vscode.notebooks.createNotebookController('forth-board', 'forth-notebook', 'Forth board');
  ctl.supportedLanguages = ['forth'];
  ctl.supportsExecutionOrder = true;
  let order = 0;
  ctl.executeHandler = async cells => {
    for (const cell of cells) {
      const ex = ctl.createNotebookCellExecution(cell);
      ex.executionOrder = ++order;
      ex.start(Date.now());
      ex.token.onCancellationRequested(() => forth.interrupt());
      if (!(await ensure())) { ex.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr('not connected')])]); ex.end(false, Date.now()); return; }
      const lines = cell.document.getText().replace(/\r\n/g, '\n').split('\n')
        .map((text, i) => ({ file: cell.document.uri.toString(), no: i + 1, text: text.replace(/\s+$/, '') }))
        .filter(l => l.text.trim() && !/^\s*\\(\s|$)/.test(l.text));
      const said = [];
      const before = forth.stack.items.slice();
      let res;
      try {
        res = await forth.send(lines, (i, ln, r) => { if (r.text && r.text.trim() && r.error === null) said.push(r.text.trim()); });
      } catch (e) {
        ex.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(e.message)])]);
        ex.end(false, Date.now());
        continue;
      }
      const outs = [];
      if (said.length) outs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(said.join('\n') + '\n')]));
      if (res.error) {
        const e = res.error;
        const msg = e.code === 'asm' ? e.text : `${(e.text || '').replace(/ \?-\d+ ?$/, '').trim()} ? ${B.throwText(e.code)} (${e.code})`;
        outs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(`line ${e.line.no}: ${msg}\n`)]));
      }
      outs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(cellStack(before, forth.stack.items))]));
      ex.replaceOutput(outs);
      ex.end(!res.error && !res.stopped, Date.now());
      if (res.error || res.stopped) return;
    }
  };
  sub(ctl);

  sub(vscode.commands.registerCommand('forth.newNotebook', async () => {
    const data = new vscode.NotebookData([
      new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# A Forth notebook\nEach cell runs on the board. What it left on the stack is shown under it.', 'markdown'),
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, ': SQ ( n -- n2 ) DUP * ;\n7 SQ .', 'forth'),
    ]);
    const nb = await vscode.workspace.openNotebookDocument('forth-notebook', data);
    await vscode.window.showNotebookDocument(nb);
  }));
}

module.exports = { register, cellStack };

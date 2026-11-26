// debugview.js - the debugger in the editor: while paused, the line that is running
// shows the data stack after it, and the Stacks view shows the debugger's stacks.
// Also the bridge the debugger (debugglue.js, dap.js) expects to the rest.
'use strict';

function register(vscode, context, forth, con, lang, ensure) {
  const sub = x => context.subscriptions.push(x);
  const deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('debugTokenExpression.number'), margin: '0 0 0 2em', fontWeight: 'bold' },
    backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
    isWholeLine: true,
  });
  sub(deco);
  const clear = () => { for (const e of vscode.window.visibleTextEditors || []) e.setDecorations(deco, []); };

  const session = {
    get link() { return forth.link; },
    get lineMap() { return forth.lineMap; },
    board: () => forth.board || lang.board(),
    debug: null,
    ensure,
    note: s => con.out(`\x1b[33m▸ ${s}\x1b[0m\n`),
    echo: l => con.out(`\x1b[2m${l}\x1b[0m\n`),
    typed: l => forth.run(l),
    terminal: () => con.open(),
    show: () => {},
    // paused (ad) or ended (null): the stack beside the running line
    paused: async ad => {
      clear();
      if (!ad || !ad.halted || !ad.regs) { forth.emit('debugStack', null); return; }
      forth.emit('debugStack', ad.stack);
      let src = null;
      try { src = await ad.lineOf(ad.regs.pc); } catch { /* not in a line we sent */ }
      if (!src) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(src.path));
      const ed = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true });
      const items = ad.stack === null ? '?' : ad.stack.length ? ad.stack.join(' ') : '';
      const back = ad.replaying && ad.replaying() ? `   ⟲ ${ad.at + 1}/${ad.history.length}` : '';
      const li = src.line - 1, end = doc.lineAt(li).text.length;
      ed.setDecorations(deco, [{ range: new vscode.Range(li, 0, li, end), renderOptions: { after: { contentText: `▶ ${ad.where}  ( ${items} )${back}` } } }]);
    },
  };
  require('./debugglue').register(context, session, { project: lang.project, index: lang.index });
  return session;
}

module.exports = { register };

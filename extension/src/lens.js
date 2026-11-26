// lens.js - the stack lens in the editor: after each line of code, faded, the
// stack the line leaves; stack problems as warnings.
'use strict';
const S = require('./stacklens');

function register(vscode, context, index) {
  const sub = x => context.subscriptions.push(x);
  const deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2.5em', fontStyle: 'italic' },
    rangeBehavior: 1,
  });
  const diags = vscode.languages.createDiagnosticCollection('forth-stack');
  sub(deco); sub(diags);
  const on = () => vscode.workspace.getConfiguration('forth').get('stackLens', true);

  const draw = ed => {
    if (!ed || ed.document.languageId !== 'forth') return;
    if (!on()) { ed.setDecorations(deco, []); diags.delete(ed.document.uri); return; }
    const r = S.analyse(ed.document.getText(), index());
    const ds = [];
    for (const [li, v] of r.lines) {
      if (!v.sure) continue;
      const end = ed.document.lineAt(li).text.length;
      ds.push({ range: new vscode.Range(li, end, li, end), renderOptions: { after: { contentText: S.show(v.stack) } } });
    }
    ed.setDecorations(deco, ds);
    diags.set(ed.document.uri, r.problems.map(p => {
      const d = new vscode.Diagnostic(new vscode.Range(p.line, p.start, p.line, p.end), p.message, vscode.DiagnosticSeverity.Warning);
      d.source = 'stack';
      return d;
    }));
  };
  let timer = null;
  const later = ed => { clearTimeout(timer); timer = setTimeout(() => draw(ed), 150); };
  sub(vscode.window.onDidChangeActiveTextEditor(draw));
  sub(vscode.window.onDidChangeVisibleTextEditors(eds => eds.forEach(draw)));
  sub(vscode.workspace.onDidChangeTextDocument(e => { for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) later(ed); }));
  sub(vscode.workspace.onDidCloseTextDocument(d => diags.delete(d.uri)));
  sub(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('forth.stackLens')) (vscode.window.visibleTextEditors || []).forEach(draw); }));
  (vscode.window.visibleTextEditors || []).forEach(draw);
  return { redraw: () => (vscode.window.visibleTextEditors || []).forEach(draw) };
}

module.exports = { register };

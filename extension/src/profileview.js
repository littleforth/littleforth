// profileview.js - Forth: Profile in VS Code: asks for a phrase, runs it on the
// board while sampling, shows the report and shades the hot lines.
'use strict';
const P = require('./profiler');
const { findOpenocd, openocdArgs } = require('./openocd');

function register(vscode, context, forth, lang, ensure, inspect) {
  const sub = x => context.subscriptions.push(x);
  const levels = [0.08, 0.16, 0.26, 0.38, 0.5].map(a => vscode.window.createTextEditorDecorationType({
    backgroundColor: `rgba(255, 110, 40, ${a})`, isWholeLine: true,
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2em' },
  }));
  levels.forEach(sub);
  let heat = new Map();             // file -> [{line, share}]
  let server = null, panel = null;
  sub({ dispose: () => { if (server) server.kill(); } });

  const shade = ed => {
    if (!ed) return;
    const rows = heat.get(ed.document.uri.fsPath) || [];
    levels.forEach((d, i) => ed.setDecorations(d, rows.filter(r => Math.min(4, Math.floor(r.share * 10)) === i).map(r => {
      const end = ed.document.lineAt(r.line).text.length;
      return { range: new vscode.Range(r.line, 0, r.line, end), renderOptions: { after: { contentText: `${(100 * r.share).toFixed(1)}%` } } };
    })));
  };
  const shadeAll = () => (vscode.window.visibleTextEditors || []).forEach(shade);
  sub(vscode.window.onDidChangeVisibleTextEditors(shadeAll));

  async function sampler() {
    try { return await P.tclSampler(); } catch { /* no OpenOCD running */ }
    const proj = lang.project();
    const gdb = proj.gdb || vscode.workspace.getConfiguration('forth').get('gdbServer') || 'localhost:3333';
    const [host, port] = gdb.split(':');
    let why = null;                    // OpenOCD's own reason, if starting it failed
    if (!proj.gdb && forth.board && forth.board !== 'Host build') {
      const found = findOpenocd();
      const args = found && openocdArgs(forth.board, found);
      if (args) {
        try {
          server = await require('./debug').startServer(args);
          return await P.tclSampler();
        } catch (e) { why = e; /* fall back to a GDB server someone else runs */ }
      }
    }
    try { return await P.gdbSampler(host, Number(port)); } catch (e) { throw why || e; }
  }

  sub(vscode.commands.registerCommand('forth.profile', async phrase => {
    if (typeof phrase !== 'string') phrase = await vscode.window.showInputBox({ prompt: 'Profile: the Forth to run (make it run for a second or more)', placeHolder: '1000 BENCH' });
    if (!phrase || !(await ensure())) return;
    if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'forth') { vscode.window.showWarningMessage('Forth: stop debugging first: the profiler uses the probe'); return; }
    let s;
    try {
      const { ranges, alias } = await forth.job(link => P.wordRanges(link));
      s = await sampler();
      const samples = [];
      let done = false;
      const t0 = Date.now();
      const run = forth.run(phrase).finally(() => { done = true; });
      while (!done) samples.push(...(await s.take()));
      const r = await run;
      const ms = Date.now() - t0;
      const t = P.tally(samples, ranges, forth.lineMap, alias);
      heat = new Map();
      for (const [k, n] of t.lines) {
        const [file, no] = [k.slice(0, k.lastIndexOf('|')), Number(k.slice(k.lastIndexOf('|') + 1))];
        if (!heat.has(file)) heat.set(file, []);
        heat.get(file).push({ line: no - 1, share: n / t.total });
      }
      shadeAll();
      if (!panel) {
        panel = vscode.window.createWebviewPanel('forth.profile', 'Profile', vscode.ViewColumn.Beside, { enableScripts: true });
        panel.onDidDispose(() => { panel = null; });
        panel.webview.onDidReceiveMessage(m => { if (m.inspect) inspect(m.inspect); });
      }
      panel.webview.html = P.reportHtml(phrase, t, s.kind, ms);
      panel.reveal();
      if (r.error !== null) vscode.window.showWarningMessage(`Forth: ${phrase}: ${r.text}`);
      return t;
    } catch (e) {
      vscode.window.showErrorMessage(`Forth: profile: ${e.message}`);
    } finally { if (s) await s.close(); }
  }));
  sub(vscode.commands.registerCommand('forth.clearProfile', () => { heat = new Map(); shadeAll(); }));
}

module.exports = { register };

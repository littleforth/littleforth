// debugglue.js - puts the debug adapter (dap.js) into VS Code: the "forth"
// debug type, OpenOCD started for the board, the Debug button, the sidebar kept
// in step with the debugger, and Show memory (the board's, or the firmware image's).
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ForthDebugAdapter } = require('./dap');
const { startServer } = require('./debug');
const model = require('./model');

// Raspberry Pi's OpenOCD (it knows the RP2350) where the Pico SDK puts it, else one on PATH.
const { findOpenocd, openocdArgs } = require('./openocd');

const textOf = p => {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === p);
  return doc ? doc.getText() : fs.readFileSync(p, 'latin1');
};

function register(context, session, env) {
  const sub = x => context.subscriptions.push(x);
  const conf = () => vscode.workspace.getConfiguration('forth');
  // Forth debug: the GDB server's output and every packet, with times
  const log = vscode.window.createOutputChannel('Forth debug');
  sub(log);
  const t0 = Date.now();
  require('./gdb').setTrace(t => log.appendLine(`${((Date.now() - t0) / 1000).toFixed(3).padStart(9)}  ${t}`));

  // What VS Code starts when you press Debug (or F5 with no launch.json)
  sub(vscode.debug.registerDebugConfigurationProvider('forth', {
    provideDebugConfigurations() { return [{ type: 'forth', request: 'attach', name: 'Forth: debug the board', internalConsoleOptions: 'neverOpen' }]; },
    async resolveDebugConfiguration(folder, config) {
      if (!config.type) Object.assign(config, { type: 'forth', request: 'attach', name: 'Forth: debug the board' });
      if (!config.internalConsoleOptions) config.internalConsoleOptions = 'neverOpen';   // the Forth console is the one console
      config.gdb = config.gdb || env.project().gdb || conf().get('gdbServer') || 'localhost:3333';
      if (!(await session.ensure())) return undefined;            // the debugger reads the word list through the console
      return config;
    },
  }));

  // Listed in Run and Debug without a launch.json, so its Start button (and F5) just starts it
  sub(vscode.debug.registerDebugConfigurationProvider('forth', {
    provideDebugConfigurations() { return [{ type: 'forth', request: 'attach', name: 'Forth: debug the board', internalConsoleOptions: 'neverOpen' }]; },
  }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

  sub(vscode.debug.registerDebugAdapterDescriptorFactory('forth', {
    createDebugAdapterDescriptor() {
      const a = new ForthDebugAdapter({
        link: () => session.link,
        index: () => env.index(),
        board: () => session.board(),
        lineMap: () => session.lineMap,
        definition: n => env.index().word(n),
        definitionsIn: p => model.definitions(textOf(p), p),
        lineText: (p, n) => { try { return textOf(p).split(/\r?\n/)[n - 1]; } catch { return null; } },
        // Never probe the port: connecting to a GDB server halts the CPU. Start
        // OpenOCD when that's the setup; if the port is taken, a server is there.
        startServer: async (host, port) => {
          let cmd = conf().get('openocd');
          if (cmd && typeof cmd === 'string') cmd = cmd.match(/"[^"]*"|\S+/g).map(x => x.replace(/^"|"$/g, ''));
          // a gdb in forth.json is a server you run yourself (the Connection panel's 'already running')
          if (!cmd && !env.project().gdb && conf().get('startOpenocd', true) && /^(localhost|127\.0\.0\.1)$/.test(host) && port === 3333) {
            const found = findOpenocd();
            if (!found) throw new Error("OpenOCD not found: install the Pico SDK's (Raspberry Pi's build knows the RP2350), or start a GDB server yourself");
            cmd = openocdArgs(session.board(), found);
          }
          if (!cmd) return null;                                      // another server, set up by you
          try {
            const p = await startServer(cmd);
            session.note(`started ${path.basename(cmd[0])} for the debugger`);
            return p;
          } catch (e) {
            if (/bind|already in use|Address in use/i.test(e.message)) return null;   // one is running already
            throw new Error(`${path.basename(cmd[0])}: ${e.message}`);
          }
        },
        onStopped: ad => {
          if (ad.halted && !ad.toldConsole) { ad.toldConsole = true; session.note(`paused at ${ad.where}: type a register (pc, tos), a word or an address here to read it; F5 continues`); }
          session.debug = ad; session.show(); if (session.paused) session.paused(ad); if (session.memory) session.memory.stopped().catch(() => {}); if (session.periph) session.periph.stopped().catch(() => {});
        },
        note: s => session.note(s),
        forth: line => { session.echo(line); return session.typed(line); },
        onEnded: () => { session.debug = null; session.show(); if (session.paused) session.paused(null); },
      });
      session.debug = a;
      session.show();
      return new vscode.DebugAdapterInlineImplementation(a);
    },
  }));
  sub(vscode.debug.onDidTerminateDebugSession(s => { if (s.type === 'forth') { session.debug = null; session.show(); } }));
  sub(vscode.debug.onDidStartDebugSession(s => { if (s.type === 'forth') session.show(); }));

  sub(vscode.commands.registerCommand('forth.debug', async () => {
    if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'forth') return;
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    await vscode.debug.startDebugging(folder, { type: 'forth', request: 'attach', name: 'Forth: debug the board', internalConsoleOptions: 'neverOpen' });
    session.terminal().show(true);
  }));


}

module.exports = { register, findOpenocd, openocdArgs };

'use strict';
// The debugger on QEMU's Cortex-M33 (mps2-an505): a breakpoint in a word, steps,
// the stack beside the running line, and stepping back through recorded stops.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const S = require('./vscode-stub');
const vscode = require('vscode');

const ELF = path.resolve(__dirname, '..', '..', 'build', 'an505.elf');
let qemu = true;
try { execFileSync('qemu-system-arm', ['--version']); } catch { qemu = false; }
const skip = (!qemu || !fs.existsSync(ELF)) && 'needs qemu-system-arm and build/an505.elf';
const freeport = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const until = async (f, ms = 15000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out: ' + f); await new Promise(r => setTimeout(r, 20)); } };

test('break, step, stack beside the line, step back', { skip, timeout: 90000 }, async () => {
  const sp = await freeport(), gp = await freeport();
  const q = spawn('qemu-system-arm', ['-M', 'mps2-an505', '-nographic', '-monitor', 'none',
    '-serial', `tcp:127.0.0.1:${sp},server=on,wait=on`, '-gdb', `tcp:127.0.0.1:${gp}`, '-kernel', ELF], { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnext-'));
  fs.writeFileSync(path.join(dir, 'forth.json'), JSON.stringify({ board: 'Pico 2', port: `tcp:127.0.0.1:${sp}`, gdb: `127.0.0.1:${gp}` }));
  const file = path.join(dir, 'sq.fth');
  fs.writeFileSync(file, ': SQ ( n -- n*n )\n   DUP\n   * ;\n: T ( -- )\n   3 SQ . ;\n');
  S.vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  const decos = [];
  vscode.window.showTextDocument = async doc => ({ document: doc, setDecorations: (t, d) => decos.push(...d), revealRange() {} });
  vscode.window.visibleTextEditors = [];
  const ext = require('../src/extension');
  ext.activate({ subscriptions: [], extensionPath: path.join(__dirname, '..') });
  const C = S.commands;
  try {
    assert.ok(await C['forth.connect']());
    await C['forth.sendFile']({ fsPath: file });
    const cfg = await S.debugReg.config.resolveDebugConfiguration(undefined, {});
    const ad = S.debugReg.factory.createDebugAdapterDescriptor().implementation;
    let seq = 1;
    const waiting = new Map(), events = [];
    ad.onDidSendMessage(m => { if (m.type === 'response') waiting.get(m.request_seq)(m); else events.push(m); });
    const req = async (command, args = {}) => {
      const s = seq++; const p = new Promise(r => waiting.set(s, r));
      ad.handleMessage({ type: 'request', seq: s, command, arguments: args });
      const r = await p; if (!r.success) throw new Error(r.message); return r.body;
    };
    const stops = () => events.filter(e => e.event === 'stopped').length;
    const caps = await req('initialize');
    assert.ok(caps.supportsStepBack);
    await req('attach', cfg);
    await req('setBreakpoints', { source: { path: file }, breakpoints: [{ line: 2 }] });
    await req('configurationDone');
    await C['forth.console']();
    for (const k of 'T\r') S.term.pty.handleInput(k);
    await until(() => stops() === 1);
    const where = async () => (await req('stackTrace', { threadId: 1 })).stackFrames[0];
    assert.strictEqual((await where()).line, 2);
    // the running line shows the stack beside it
    await until(() => decos.some(d => /▶ SQ.*\( 3 \)/.test(d.renderOptions.after.contentText)));
    await req('setBreakpoints', { source: { path: file }, breakpoints: [] });
    await req('next', { threadId: 1 });
    await until(() => stops() === 2);
    assert.strictEqual((await where()).line, 3);
    await until(() => decos.some(d => /\( 3 3 \)/.test(d.renderOptions.after.contentText)));
    // back: line 2 again, its stack as it was, marked as a recorded stop
    await req('stepBack', { threadId: 1 });
    await until(() => stops() === 3);
    assert.strictEqual((await where()).line, 2);
    assert.match(events.filter(e => e.event === 'stopped').pop().body.description, /recorded stop 1 of 2/);
    await until(() => decos.some(d => /\( 3 \)\s+⟲ 1\/2/.test(d.renderOptions.after.contentText)));
    // forward replays the record, then the CPU runs on
    await req('next', { threadId: 1 });
    assert.strictEqual((await where()).line, 3);
    await req('continue', { threadId: 1 });
    await until(() => /(^|[^0-9])9 ok/.test(S.term.out.replace(/\[[0-9;]*m/g, '')));
    await req('disconnect');
    // profile: a word that spins; the samples land in it
    fs.writeFileSync(file, ': SPIN ( n -- ) 0 DO 100 0 DO I DROP LOOP LOOP ;\n: WORK ( -- ) 30000 SPIN ;\n');
    await C['forth.sendFile']({ fsPath: file });
    const t = await C['forth.profile']('WORK');
    assert.ok(t && t.total > 10, JSON.stringify(t && t.total));
    assert.strictEqual(t.words[0].name, 'SPIN', JSON.stringify(t.words.slice(0, 3)));
    assert.ok([...t.lines.keys()].some(k => k.endsWith('|1')));
    const rep = S.panels.find(p => p.id === 'forth.profile').webview.html;
    assert.match(rep, /Profile of <code>WORK<\/code>/);
  } finally {
    await C['forth.disconnect']();
    q.kill();
  }
});

// console.js - the Forth console: a terminal where each line typed runs on the board.
// The prompt always shows when it is waiting, with the stack in front: ( 3 4 ) ›
// Output that arrives while it waits (a reset banner, an interrupt's output) goes
// above the prompt, which is drawn again with what was typed so far.
'use strict';
const B = require('./board');

const DIM = s => `\x1b[2m${s}\x1b[0m`;
const RED = s => `\x1b[31m${s}\x1b[0m`;
const GOLD = s => `\x1b[33m${s}\x1b[0m`;

// forth: the Forth service. vscode: the API (passed in, so the tests can stub it).
class Console {
  constructor(vscode, forth) {
    this.vscode = vscode;
    this.forth = forth;
    this.history = [];
    this.term = null;
    this.closed = true;
    forth.on('output', s => this.out(s));
    forth.on('note', s => this.out(GOLD(`▸ ${s}`) + '\n'));
    forth.on('changed', () => this.redrawPrompt());
  }

  show(preserveFocus = false) { this.open().show(preserveFocus); }

  open() {
    if (this.term && !this.closed) return this.term;
    const vscode = this.vscode, forth = this.forth;
    const write = new vscode.EventEmitter();
    let line = '', hist = -1, ready = false, redraw = null, nl = true, two = false;
    const raw = s => write.fire(s.replace(/\r?\n/g, '\r\n'));
    // the stack (or "not connected") on its own line, the prompt on the next
    const promptText = () => {
      const top = forth.connected ? forth.stackText().trim() : '(not connected)';
      two = !!top;
      return (top ? DIM(top) + '\r\n' : '') + GOLD('› ');
    };
    const prompt = () => { clearTimeout(redraw); redraw = null; ready = true; write.fire(promptText()); };
    const clear = () => '\r\x1b[2K' + (two ? '\x1b[1A\x1b[2K' : '');   // rub out the prompt, both lines
    this.out = s => {
      if (!ready) { raw(s); return; }
      if (redraw) clearTimeout(redraw); else write.fire(clear());
      raw(s); nl = /\n$/.test(s);
      redraw = setTimeout(() => {
        redraw = null; if (!ready) return;
        write.fire(nl ? '\r\x1b[2K' : '\r\n'); prompt(); write.fire(line);
      }, 50);
    };
    // the stack changed while waiting (a view refreshed it): draw the prompt again
    this.redrawPrompt = () => { if (ready && !redraw) { write.fire(clear()); prompt(); write.fire(line); } };
    // typed: the cursor is still on the typed line, so a plain " ok" goes beside it
    const enter = async (l, typed) => {
      if (!l.trim()) { if (typed) write.fire('\r\n'); return; }
      this.history.unshift(l);
      if (!forth.connected) {
        if (typed) { write.fire('\r\n'); typed = false; }
        if (!(await forth.connect())) return;
      }
      try {
        const r = await forth.run(l);
        if (typed && r.ok && r.error === null && !r.restarted && !r.text.trim()) { raw(DIM(' ok') + '\n'); return; }
        if (typed) { write.fire('\r\n'); typed = false; }
        if (r.restarted) raw(GOLD('▸ the board restarted') + '\n');
        if (r.error !== null) raw(RED(`${r.text.replace(/ \?-\d+ ?$/, '')} ? ${B.throwText(r.error)} (${r.error})`) + '\n');
        else if (r.text.trim()) raw(r.text.replace(/\s+$/, '') + (r.ok ? DIM(' ok') : '') + '\n');
        else if (!r.ok) raw(DIM('compiling…') + '\n');
      } catch (e) {
        if (typed) write.fire('\r\n');
        raw(RED(e.message) + '\n');
      }
    };
    const pty = {
      onDidWrite: write.event,
      open: () => {
        if (this.pending) { raw(this.pending); this.pending = ''; }
        raw(DIM(forth.connected ? `connected to ${forth.board || 'the board'} on ${forth.port}` : 'not connected: type a line to connect, or click Forth in the status bar') + '\n');
        prompt();
      },
      close: () => { this.closed = true; },
      handleInput: data => {
        if (data === '\x03') { forth.interrupt(); return; }
        if (!ready) return;                                  // a line is running
        // pasted text: each line runs in turn
        if (/[\r\n]/.test(data) && data.length > 1) {
          const parts = (line + data).split(/\r\n|\r|\n/);
          const rest = parts.pop();
          line = '';
          write.fire('\r\n');
          ready = false;
          (async () => { for (const p of parts) await enter(p); line = rest; prompt(); write.fire(line); })();
          return;
        }
        if (data === '\r') {
          const l = line; line = ''; hist = -1; ready = false;
          enter(l, true).finally(prompt);
        } else if (data === '\x7f' || data === '\b') {
          if (line) { line = line.slice(0, -1); write.fire('\b \b'); }
        } else if (data === '\x1b[A' || data === '\x1b[B') {
          hist = Math.max(-1, Math.min(this.history.length - 1, hist + (data === '\x1b[A' ? 1 : -1)));
          write.fire('\b \b'.repeat(line.length));
          line = hist < 0 ? '' : this.history[hist];
          write.fire(line);
        } else if (!data.startsWith('\x1b')) {
          line += data; write.fire(data);
        }
      },
    };
    this.closed = false;
    this.term = vscode.window.createTerminal({ name: 'Forth', pty, isTransient: true, iconPath: new vscode.ThemeIcon('chip') });
    return this.term;
  }

  out(s) { this.pending = (this.pending || '') + s; }   // until the terminal is open
  redrawPrompt() { }
}

module.exports = { Console };

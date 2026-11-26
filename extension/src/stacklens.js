// stacklens.js - the stack after each line of source, worked out from stack effects
// without the board. A definition starts from the inputs its comment names
// ( a b -- c ); outside definitions the stack runs on from line to line.
// Problems: a definition that leaves other than its comment says, IF/ELSE branches
// that leave different stacks, a loop whose body changes the depth, underflow.
// No vscode here: analyse(text, ix) -> {lines: Map(line -> {stack, sure}), problems}
'use strict';
const { number } = require('./model');

// Tokens of a line without comments; a string word (S" ." ABORT" C") stays, its text goes.
const STRINGY = new Set(['."', 'S"', 'ABORT"', 'C"']);
function tokens(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === ' ' || line[i] === '\t')) i++;
    let j = i;
    while (j < n && line[j] !== ' ' && line[j] !== '\t') j++;
    const tok = line.slice(i, j);
    if (!tok || tok === '\\') break;
    if (tok === '(' || tok === '.(') { const k = line.indexOf(')', j); i = k < 0 ? n : k + 1; continue; }
    out.push({ text: tok, start: i });
    if (STRINGY.has(tok.toUpperCase())) { const k = line.indexOf('"', j + 1); i = k < 0 ? n : k + 1; continue; }
    i = j;
  }
  return out;
}

// "( a b -- c )" -> {ins: ['a','b'], outs: ['c']}; null when not one effect
// (alternatives with |, or no --). A double (d, ud) is two cells.
function effect(s) {
  if (!s) return null;
  const m = /^\(\s*([^)]*?)\s*--\s*([^)]*?)\s*\)/.exec(s.trim());
  if (!m || /\||\.\.\./.test(m[1] + m[2])) return null;     // alternatives, or any number of items
  // d and ud name doubles (two cells) only where a word uses them so: UM* ( u1 u2 -- ud )
  const dbl = /(^|\s)u?d\d*'?(\s|$)/.test(m[1] + ' ' + m[2]) && !/(^|\s)c(\s|$)/.test(m[1] + ' ' + m[2]);
  const names = t => t.split(/\s+/).filter(x => x && !/^".*"$/.test(x))
    .flatMap(x => (dbl && /^u?d\d*'?$/.test(x) ? [x + '.l', x + '.h'] : [x]));
  return { ins: names(m[1]), outs: names(m[2]) };
}

const PARSES = new Set(['CHAR', '[CHAR]', "'", "[']", 'POSTPONE', 'VARIABLE', 'CONSTANT', 'CREATE', 'VALUE', 'TO', 'IS', 'CODE', 'BUFFER:', '2VARIABLE', '2CONSTANT', 'MARKER', 'FORGET']);
const PUSH_NEXT = { CHAR: 'c', "'": 'xt', '[CHAR]': 'c', "[']": 'xt' };

function analyse(text, ix) {
  const out = new Map();
  const problems = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let stack = [], sure = true, base = 10;
  let def = null;                 // {name, want, line, start, end, ctl: []}
  let dead = false;               // after EXIT: this path has left the word
  let outer = null;               // the stack outside, kept while a definition is open
  const fail = () => { sure = false; };
  // the word ends here (; EXIT DOES>): does it leave what its comment says?
  const leaves = d => {
    if (!sure || !d.want || d.ctl.some(f => f.kind === 'DO' || f.kind === '?DO')) return;
    const got = stack.length, w = d.want.outs.length;
    if (got !== w) problems.push({ line: d.line, start: d.start, end: d.end, message: `${d.name} leaves ${got} item${got === 1 ? '' : 's'}; its comment says ${w}` });
  };
  const pop = (n, line, t) => {
    if (!sure) return;
    if (stack.length < n) {
      if (def) problems.push({ line, start: t.start, end: t.start + t.text.length, message: `${t.text} needs ${n} item${n === 1 ? '' : 's'}; ${stack.length} on the stack here` });
      sure = false;
      return;
    }
    stack.length -= n;
  };
  // the items keep their names through shuffles: 3 4 SWAP gives ( 4 3 )
  const apply = (e, line, t) => {
    if (!e) return fail();
    const got = sure && stack.length >= e.ins.length ? stack.slice(stack.length - e.ins.length) : null;
    pop(e.ins.length, line, t);
    if (!sure) return;
    const was = new Map();
    if (got) e.ins.forEach((n, i) => { if (!was.has(n)) was.set(n, got[i]); });
    stack.push(...e.outs.map(n => (was.has(n) ? was.get(n) : n)));
  };
  const lookup = u => {
    if (ix.builtins[u]) return effect(ix.builtins[u][0]);
    const d = ix.word(u);
    if (d) {
      if (d.stack === 'VARIABLE' || d.stack === 'CREATE') return { ins: [], outs: ['a'] };
      if (d.stack === 'CONSTANT') return { ins: [], outs: [d.name.toLowerCase()] };
      return effect(d.stack);
    }
    const c = ix.classify(u, base);
    if (c.kind === 'register' || c.kind === 'periph') return { ins: [], outs: [u.toLowerCase()] };
    if (c.kind === 'instance') return effect(c.stack);
    return null;
  };

  lines.forEach((raw, li) => {
    const ts = tokens(raw);
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k], u = t.text.toUpperCase();
      if (u === 'HEX') { base = 16; continue; }
      if (u === 'DECIMAL') { base = 10; continue; }
      if (u === ':' && !def) {
        const nm = ts[k + 1];
        if (!nm) continue;
        k++;
        const m = /^\s*(\([^)]*\))/.exec(raw.slice(nm.start + nm.text.length));
        const want = effect(m && m[1]);
        def = { name: nm.text, want, line: li, start: nm.start, end: nm.start + nm.text.length, ctl: [] };
        outer = { stack, sure };
        stack = want ? want.ins.slice() : [];
        sure = !!want;
        continue;
      }
      if (u === ';' && def) {
        if (!dead) leaves(def, li);
        ({ stack, sure } = outer);
        def = null; dead = false;
        continue;
      }
      if (def && u === '[') { def.interp = { stack, sure }; stack = []; sure = true; continue; }
      if (def && u === ']' && def.interp) { ({ stack, sure } = def.interp); def.interp = null; continue; }
      if (u === 'S"' || u === 'C"') { if (sure) stack.push(...(u === 'S"' ? ['a', 'u'] : ['a'])); continue; }
      if (u === '."') continue;
      if (u === 'ABORT"') { pop(1, li, t); continue; }
      // inside a definition only these take the next name as it compiles; the rest
      // (CREATE, CONSTANT, ', CHAR) take a name when the word runs, which the lens can't see
      if (def && !def.interp && (u === 'POSTPONE' || u === '[COMPILE]')) { k++; fail(); continue; }
      if (def && !def.interp && (u === "[']" || u === '[CHAR]' || u === 'TO' || u === 'IS')) {
        k++;
        if (u === 'TO' || u === 'IS') pop(1, li, t); else if (sure) stack.push(PUSH_NEXT[u]);
        continue;
      }
      if (def && !def.interp && PARSES.has(u)) {
        if (u === 'CONSTANT' || u === 'VALUE' || u === 'BUFFER:') pop(1, li, t);
        else if (u === "'" || u === 'CHAR') fail();
        continue;
      }
      if (PARSES.has(u)) {
        k++;
        if (u === 'CONSTANT' || u === 'VALUE' || u === 'BUFFER:' || u === 'TO' || u === 'IS') pop(1, li, t);
        else if (u === '2CONSTANT') pop(2, li, t);
        else if (PUSH_NEXT[u] && sure) stack.push(PUSH_NEXT[u]);
        continue;
      }
      if (def && !def.interp) {
        const c = def.ctl;
        const top = () => c[c.length - 1];
        if (u === 'IF' || u === 'WHILE') { pop(1, li, t); c.push({ kind: u, at: stack.slice(), sure, dead, t, li }); continue; }
        if (u === 'ELSE') {
          const f = top();
          if (f && f.kind === 'IF') { f.kind = 'ELSE'; f.then = { stack: stack.slice(), sure, dead }; stack = f.at.slice(); sure = f.sure; dead = f.dead; }
          continue;
        }
        if (u === 'THEN') {
          const f = c.pop();
          if (!f) continue;
          const other = f.kind === 'ELSE' ? f.then : { stack: f.at, sure: f.sure, dead: f.dead };
          if (other.dead) continue;                              // that branch left with EXIT: this one goes on
          if (dead) { stack = other.stack.slice(); sure = other.sure; dead = false; continue; }
          if (sure && other.sure && other.stack.length !== stack.length) {
            problems.push({ line: f.li, start: f.t.start, end: f.t.start + f.t.text.length, message: `the branches of this ${f.kind === 'ELSE' ? 'IF … ELSE' : 'IF'} leave ${other.stack.length} and ${stack.length} items` });
            sure = false;
          } else if (!other.sure) sure = false;
          continue;
        }
        if (u === 'BEGIN' || u === 'DO' || u === '?DO') {
          if (u !== 'BEGIN') pop(2, li, t);
          c.push({ kind: u, at: stack.slice(), sure, dead, t, li });
          continue;
        }
        if (u === 'UNTIL' || u === 'AGAIN' || u === 'REPEAT' || u === 'LOOP' || u === '+LOOP') {
          if (u === 'UNTIL' || u === '+LOOP') pop(1, li, t);
          let f = c.pop();
          let w = null;
          if (u === 'REPEAT' && f && f.kind === 'WHILE') { w = f; f = c.pop(); }
          if (!f) continue;
          if (!dead && sure && f.sure && stack.length !== f.at.length) {
            problems.push({ line: f.li, start: f.t.start, end: f.t.start + f.t.text.length, message: `this loop's body changes the depth by ${stack.length - f.at.length}` });
            sure = false;
          }
          if (u === 'AGAIN') dead = true;                       // leaves only by EXIT
          else if (w) { stack = w.at.slice(); sure = w.sure; dead = w.dead; }
          else if (dead) { stack = f.at.slice(); dead = false; }
          continue;
        }
        if (u === 'EXIT') { if (!dead && !c.some(f => f.kind === 'DO' || f.kind === '?DO')) leaves(def, li); dead = true; continue; }
        if (u === 'ABORT' || u === 'QUIT') { dead = true; continue; }
        if (u === 'RECURSE') { apply(def.want, li, t); continue; }
        if (u === 'I' || u === 'J') { if (sure) stack.push(u.toLowerCase()); continue; }
        if (u === 'LEAVE' || u === 'UNLOOP') continue;
        if (u === 'LITERAL') { if (sure) stack.push('n'); continue; }
        if (u === 'DOES>') { if (!dead) leaves(def, li); def.want = null; stack = ['a']; sure = false; dead = false; continue; }   // the caller's items lie beneath
      }
      const n = number(t.text, base);
      if (n !== null) { if (sure) stack.push(String(t.text)); continue; }
      apply(lookup(u), li, t);
    }
    if (ts.length) out.set(li, { stack: stack.slice(), sure, inDef: !!def });
  });
  return { lines: out, problems };
}

// ( a b c ) for showing; at most n items.
function show(stack, n = 8) {
  if (!stack.length) return '( )';
  const s = stack.length > n ? ['…', ...stack.slice(-n)] : stack;
  return `( ${s.join(' ')} )`;
}

module.exports = { analyse, effect, show };

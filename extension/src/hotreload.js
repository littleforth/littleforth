// hotreload.js - what to send again when a file that was sent is saved: the
// definitions that changed, and every definition after them that uses one of them
// (a word compiled earlier keeps calling the old version until it is sent again).
// Lines outside definitions that aren't definitions themselves (a call that sets the
// board up) are not run again. No vscode here.
'use strict';
const { tokens } = require('./model');

const DEFINERS = new Set(['VARIABLE', 'CONSTANT', 'CREATE', 'VALUE', 'BUFFER:', '2VARIABLE', '2CONSTANT', 'CODE']);

// The file in chunks: {from, to (lines, 0-based, inclusive), names: [defined], uses: Set, text}
function chunks(text) {
  const ls = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let cur = null;
  ls.forEach((raw, i) => {
    const ts = tokens(raw);
    for (let k = 0; k < ts.length; k++) {
      const u = ts[k].text.toUpperCase();
      if (!cur) {
        if (u === ':' || DEFINERS.has(u)) {
          cur = { from: i, to: i, names: [], uses: new Set(), lines: [], code: u === ':' || u === 'CODE' };
          if (ts[k + 1]) { cur.names.push(ts[k + 1].text.toUpperCase()); k++; }
          if (!cur.code) { out.push(cur); cur = null; }
        }
        continue;
      }
      if (u === ';' || u === 'END-CODE') { cur.to = i; out.push(cur); cur = null; continue; }
      cur.uses.add(u);
    }
    if (cur) cur.to = i;
  });
  if (cur) out.push(cur);
  for (const c of out) c.text = ls.slice(c.from, c.to + 1).join('\n').replace(/[ \t]+$/gm, '');
  // a chunk that is one line holding several definitions: one chunk for the line
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && last.to >= c.from) { last.names.push(...c.names); for (const u of c.uses) last.uses.add(u); last.to = Math.max(last.to, c.to); continue; }
    merged.push(c);
  }
  for (const c of merged) c.text = ls.slice(c.from, c.to + 1).join('\n').replace(/[ \t]+$/gm, '');
  return merged;
}

// -> {send: [chunks], changed: [names], removed: [names]}
function plan(before, after) {
  const old = new Map();
  for (const c of chunks(before)) for (const n of c.names) old.set(n, c.text);
  const now = chunks(after);
  const dirty = new Set();
  const send = [];
  for (const c of now) {
    const changed = c.names.some(n => old.get(n) !== c.text);
    const uses = [...c.uses].some(u => dirty.has(u));
    if (changed || uses) { send.push(c); for (const n of c.names) dirty.add(n); }
  }
  const have = new Set(now.flatMap(c => c.names));
  return {
    send,
    changed: send.filter(c => c.names.some(n => old.get(n) !== c.text)).flatMap(c => c.names),
    removed: [...old.keys()].filter(n => !have.has(n)),
  };
}

module.exports = { chunks, plan };

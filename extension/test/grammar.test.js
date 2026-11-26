// grammar.test.js - the TextMate grammar, through VS Code's own engine (dev dependencies).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let deps = true;
try { require.resolve('vscode-textmate'); } catch { deps = false; }

test('grammar scopes', { skip: !deps && 'run npm install in extension/ first' }, async () => {
  const tm = require('vscode-textmate'), onig = require('vscode-oniguruma');
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  await onig.loadWASM(wasm);
  const registry = new tm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: s => new onig.OnigScanner(s), createOnigString: s => new onig.OnigString(s) }),
    loadGrammar: async () => tm.parseRawGrammar(fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'forth.tmLanguage.json'), 'utf8'), 'x.json'),
  });
  const g = await registry.loadGrammar('source.forth');
  const scopes = line => {
    const r = g.tokenizeLine(line, tm.INITIAL);
    return r.tokens.map(t => [line.slice(t.startIndex, t.endIndex).trim(), t.scopes[t.scopes.length - 1]]).filter(([s]) => s);
  };
  const s = Object.fromEntries(scopes(': BLINK ( n -- ) 0 DO $FF I ." x y" LOOP ; \\ end'));
  assert.strictEqual(s.BLINK, 'entity.name.function.forth');
  assert.strictEqual(s['( n -- )'], 'comment.block.paren.stack.forth');          // a stack comment: its own colour
  assert.strictEqual(Object.fromEntries(scopes('X ( just a note ) Y'))['just a note'], 'comment.block.paren.forth');
  assert.strictEqual(s.DO, 'keyword.control.forth');
  assert.strictEqual(s.$FF, 'constant.numeric.forth');
  assert.strictEqual(s['\\ end'], 'comment.line.backslash.forth');
  assert.strictEqual(s['x y'], 'string.quoted.double.forth');
  const inc = Object.fromEntries(scopes('\\ INCLUDE uart.fth'));
  assert.strictEqual(inc['uart.fth'], 'string.unquoted.path.forth');
  assert.deepStrictEqual(scopes('2DUP I+ DOX \\X 1+').map(t => t[1]), ['source.forth']);   // not control words, not a comment
});

// vscode-stub.js - a stand-in for the VS Code API, enough for the extension's
// tests (VS Code itself can't be downloaded where they run). require() it
// before the extension: 'vscode' then resolves to it.
'use strict';
const fs = require('fs');
const Module = require('module');

class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { this.start = new Position(a, b); this.end = new Position(c, d); } }
const providers = {};
const commands = {};
const trees = {};
const shown = [];
class EventEmitter { constructor() { this.fns = []; this.event = f => { this.fns.push(f); return { dispose() {} }; }; } fire(v) { for (const f of this.fns) f(v); } }
const term = { out: '' };
const reg = kind => (sel, p) => { providers[kind] = p; return { dispose() {} }; };
const diagStore = new Map();
const contentProviders = {};
const answers = {};
const statusItems = [];
const debugReg = {};
const webviews = {};
const panels = [];
const vscode = {
  Position, Range,
  Location: class { constructor(uri, pos) { this.uri = uri; this.range = pos; } },
  Uri: { file: p => ({ fsPath: p, path: p, toString: () => 'file://' + p }), parse: s => ({ fsPath: s, path: s.replace(/^[a-z-]+:/, ''), toString: () => s }) },
  ThemeColor: class { constructor(id) { this.id = id; } },
  DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
  ViewColumn: { Beside: -2, Active: -1 },
  Hover: class { constructor(md, r) { this.contents = md; this.range = r; } },
  MarkdownString: class { constructor() { this.value = ''; } appendMarkdown(s) { this.value += s; return this; } appendCodeblock(s) { this.value += '```\n' + s + '\n```\n'; return this; } },
  CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind; } },
  CompletionItemKind: { Keyword: 1, Function: 2, Constant: 3, Module: 4, Method: 5 },
  SymbolKind: { Function: 1, Variable: 2, Constant: 3 },
  DocumentSymbol: class { constructor(name, detail, kind) { this.name = name; this.detail = detail; this.kind = kind; } },
  DocumentLink: class { constructor(r, target) { this.range = r; this.target = target; } },
  Diagnostic: class { constructor(r, msg, sev) { this.range = r; this.message = msg; this.severity = sev; } },
  DiagnosticSeverity: { Warning: 1 },
  SemanticTokensLegend: class { constructor(t, m) { this.tokenTypes = t; this.tokenModifiers = m; } },
  SemanticTokensBuilder: class { constructor() { this.rows = []; } push(...a) { this.rows.push(a); } build() { return this.rows; } },
  languages: {
    createDiagnosticCollection: () => ({ set: (u, d) => diagStore.set(u.fsPath, d), delete: u => diagStore.delete(u.fsPath), clear() {}, dispose() {} }),
    registerHoverProvider: reg('hover'), registerCompletionItemProvider: reg('complete'),
    registerDefinitionProvider: reg('definition'), registerDocumentSymbolProvider: reg('symbols'),
    registerDocumentLinkProvider: reg('links'), registerDocumentSemanticTokensProvider: reg('semantic'),
    setTextDocumentLanguage: async d => d,
  },
  workspace: {
    workspaceFolders: [], textDocuments: [],
    openTextDocument: async uri => (contentProviders[uri.toString().split(':')[0]] ? { uri, languageId: 'text', getText: () => contentProviders[uri.toString().split(':')[0]].provideTextDocumentContent(uri) } : doc(uri.fsPath)),
    registerTextDocumentContentProvider: (scheme, p) => { contentProviders[scheme] = p; return { dispose() {} }; },
    getConfiguration: () => ({ get: (k, d) => d }),
    onDidChangeTextDocument: () => ({}), onDidOpenTextDocument: () => ({}), onDidCloseTextDocument: () => ({}),
    onDidChangeConfiguration: () => ({}),
    createFileSystemWatcher: () => ({ onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} }),
  },
  EventEmitter,
  ThemeIcon: class { constructor(id) { this.id = id; } },
  TreeItem: class { constructor(label, state) { this.label = label; this.state = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  StatusBarAlignment: { Left: 1 },
  ProgressLocation: { Window: 1, Notification: 2 },
  Selection: class extends Range { constructor(a, b, c, d) { if (a instanceof Position) [a, b, c, d] = [a.line, a.character, b.line, b.character]; super(a, b, c, d); this.isEmpty = a === c && b === d; } },
  TextEditorRevealType: { InCenter: 1 },
  window: {
    showWarningMessage: async m => { throw new Error(m); },
    showErrorMessage: async m => { throw new Error(m); },
    showInformationMessage: async () => {},
    registerWebviewViewProvider: (id, p) => { webviews[id] = p; return { dispose() {} }; },
    createOutputChannel: name => ({ name, lines: [], appendLine(t) { this.lines.push(t); }, dispose() {} }),
    createWebviewPanel: (id, title) => {
      const p = { id, title, posts: [], webview: { html: '', onDidReceiveMessage: f => { p.click = f; }, postMessage: m => { p.posts.push(m); return Promise.resolve(true); } }, reveal() {}, onDidDispose: f => { p.dispose = f; } };
      panels.push(p); return p;
    },
    showOpenDialog: async () => answers.folder,
    createStatusBarItem: () => { const s = { show() { s.visible = true; }, hide() { s.visible = false; }, dispose() {} }; statusItems.push(s); return s; },
    registerTreeDataProvider: (id, p) => { trees[id] = p; return { dispose() {} }; },
    createTreeView: (id, o) => { trees[id] = o.treeDataProvider; const v = { title: '', expand: [], collapse: [], onDidExpandElement: f => v.expand.push(f), onDidCollapseElement: f => v.collapse.push(f), dispose() {} }; trees[id + ':view'] = v; return v; },
    withProgress: (o, f) => f({ report() {} }, { onCancellationRequested() {} }),
    createTerminal: o => { term.pty = o.pty; o.pty.onDidWrite(s => { term.out += s; }); o.pty.open(); return { show() {} }; },
    showTextDocument: async uri => { shown.push(uri.fsPath); return { selection: null, revealRange() {} }; },
    activeTextEditor: null,
    visibleTextEditors: [],
    onDidChangeVisibleTextEditors: () => ({}),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    createTextEditorDecorationType: () => ({ dispose() {} }),
    showQuickPick: async items => answers.pick ? answers.pick(items) : undefined,
    showInputBox: async () => answers.input,
  },
  debug: {
    registerDebugConfigurationProvider: (t, p, kind) => { if (kind === 2) debugReg.dynamic = p; else debugReg.config = p; return { dispose() {} }; },
    registerDebugAdapterDescriptorFactory: (t, f) => { debugReg.factory = f; return { dispose() {} }; },
    onDidTerminateDebugSession: f => { debugReg.terminated = f; return { dispose() {} }; },
    onDidStartDebugSession: () => ({ dispose() {} }),
    startDebugging: async () => true,
    activeDebugSession: undefined,
  },
  DebugAdapterInlineImplementation: class { constructor(a) { if (typeof a.dispose !== 'function') throw new Error('this.implementation.dispose is not a function'); this.implementation = a; } },
  commands: { registerCommand: (n, f) => { commands[n] = f; return {}; }, executeCommand: async () => {} },
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : resolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };

function doc(p) {
  const text = fs.readFileSync(p, 'latin1');
  const ls = text.split('\n');
  return {
    uri: { fsPath: p }, languageId: 'forth', lineCount: ls.length, getText: () => text,
    lineAt: i => ({ text: ls[i], range: new Range(i, 0, i, ls[i].length) }),
  };
}
module.exports = { panels, debugReg, webviews, vscode, providers, commands, trees, shown, term, diagStore, contentProviders, answers, statusItems, doc, Position, Range };

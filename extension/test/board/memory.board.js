'use strict';
// On-board check of the Memory view (V11), against a real Pico 2.
// Run it under VS Code's own runtime (plain Node can't read the Debug Probe's port):
//   ELECTRON_RUN_AS_NODE=1 "<VS Code>/Code.exe" test/board/memory.board.js COM3
// Disconnect in VS Code first: this takes the port. It defines two words on the
// board (MTEST, MBUMP: about 60 bytes) unless they are there already; a reset
// clears them.
const path = require('path');
const { Forth } = require('../../src/forth');
const model = require('../../src/model');
const { Memory } = require('../../src/memory');

const port = process.argv[2] || 'COM3';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`); };

// enough of vscode for the panel: its posts are what it would show
const posts = [];
let handler = null;
const vscode = {
  ViewColumn: { Active: 1 },
  window: { createWebviewPanel: () => ({ webview: { html: '', onDidReceiveMessage: f => { handler = f; }, postMessage: m => { posts.push(m); return Promise.resolve(true); } }, reveal() {}, onDidDispose() {}, visible: true }) },
  commands: { executeCommand: async () => {} },
};
const last = key => [...posts].reverse().find(m => m[key] !== undefined);
const send = m => handler(m);

(async () => {
  const f = new Forth();
  f.noBoard = false;
  if (!(await f.connect(port))) throw new Error(`no board on ${port}`);
  check('connected', f.board === 'Pico 2', `board: ${f.board}`);
  const ix = new model.Index(require('../../data/builtins.json'), require('../../data/rp2350.json'));
  const lang = { index: () => ix, board: () => 'Pico 2' };
  const fw = path.resolve(__dirname, '..', '..', 'firmware', 'pico2.uf2');
  const m = new Memory(vscode, f, lang, () => fw);

  await f.refresh({ words: true });
  const have = f.words.includes('MTEST') && f.words.includes('MBUMP');   // from an earlier run: no new copies
  for (const l of [...(have ? [] : ['VARIABLE MTEST', ': MBUMP ( -- ) 1 MTEST +! ;']), '41 MTEST !', 'MBUMP']) {
    const r = await f.run(l);
    if (r.error !== null) throw new Error(`${l}: ${r.text}`);
  }

  // Forth lens: the VARIABLE and its value
  await m.open('MTEST');
  const main1 = last('main').main;
  check('Forth lens: MTEST is a VARIABLE holding 42', /MTEST[^]*VARIABLE[^]*>42 </.test(main1));
  check('read through the console', /read through the console/.test(last('status').status), last('status').status);
  check('budget: of 64 KB', /of 64 KB/.test(last('budget').budget));
  check('map: HERE marker', /title="HERE \$/.test(last('map').map));

  // Cells: MTEST's body, edited and read back
  await send({ lens: 'cells' });
  const main2 = last('main').main;
  const body = Number((/<tr class=" hit"><td class="a"><a data-goto="(\d+)"/.exec(main2) || [])[1]);
  check('Cells: MTEST body found', body > 0x20000000 && /MTEST: body/.test(main2), body ? '$' + body.toString(16) : '');
  await send({ edit: body, value: '7' });
  const r = await f.run('MTEST @ .');
  check('edit in place: the board reads 7', /\b7\b/.test(r.text), r.text.trim());

  // a header's link cell points at the word before it
  await send({ go: 'MBUMP' });
  await send({ lens: 'cells' });
  check("Cells: MBUMP's link points at MTEST's header", /header of MTEST/.test(last('main').main));

  // Code: MBUMP disassembled
  await send({ go: "' MBUMP" });
  await send({ lens: 'code' });
  const code = last('main').main;
  const rows = (code.match(/<tr class="[^"]*"><td class="a">/g) || []).length;
  check('Code lens: MBUMP disassembled', rows > 3 && /Instruction/.test(code), `${rows} instructions`);

  // a register: labelled by name, region named
  await send({ go: 'SIO.GPIO_OUT' });
  const reg = last('main').main;
  check('register: SIO.GPIO_OUT opens in Cells, named in Here is', /Points at/.test(reg) && reg.includes('<td class="meta">SIO.GPIO_OUT</td>'));

  // the address box: arithmetic and a mistake
  await send({ go: 'HERE 16 -' });
  check('address box: HERE 16 -', !last('status').bad, last('status').status);
  await send({ go: 'NOPE' }).catch(e => posts.push({ status: e.message, bad: true }));
  check('address box: NOPE is refused', posts.some(p => p.bad && /NOPE: not a word/.test(p.status)));

  // Bytes: the page shows hex and ASCII
  await send({ go: 'MTEST' });
  await send({ lens: 'bytes' });
  check('Bytes lens: hex and ASCII', /ASCII/.test(last('main').main));

  // live: a change on the board flashes
  await send({ lens: 'forth' });
  await f.run('MBUMP');
  await m.draw();
  check('live: the changed value flashes', / chg/.test(last('main').main));

  if (m.timer) clearInterval(m.timer);
  await f.disconnect();
  const bad = results.filter(x => !x.ok);
  console.log(`\n${results.length - bad.length} of ${results.length} pass`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.log('ERROR ' + e.message); process.exit(2); });

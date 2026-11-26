'use strict';
// The Memory view's own parts, with no board: the map, records, bodies, labels,
// the address box, the budget, and reading the firmware file.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const M = require('../src/memory');

test('the map: flash and RAM of the Pico 2, gaps marked, the dictionary in RAM', () => {
  const as = M.areas('Pico 2');
  assert.deepStrictEqual(as.map(a => a.name), ['Flash', 'RAM', 'Peripherals']);
  const ram = as[1];
  assert.ok(ram.parts.some(p => p.name === 'RAM: the dictionary' && p.lo === 0x20002104));
  assert.ok(as[0].parts.some(p => p.gap), 'flash has space the firmware does not use');
  assert.strictEqual(M.regionOf('Pico 2', 0x20003000), 'RAM: the dictionary');
  assert.strictEqual(M.regionOf('Pico 2', 0x40028000), 'peripherals');
  assert.strictEqual(M.kernelCells('Pico 2').get(0x2001211C), 'HERE (dictionary pointer)');
});

// two words: LED-INIT (code) then HITS (VARIABLE, Thumb-2 layout)
const LED = 0x20002104, HITS = 0x20002140, HERE = 0x20002160;
const heads = [[HITS, 'HITS'], [LED, 'LED-INIT']];
const recs = () => M.records(heads, HERE);

test('records: oldest first, code after the header, up to the next one', () => {
  const r = recs();
  assert.deepStrictEqual(r.map(x => x.name), ['LED-INIT', 'HITS']);
  assert.strictEqual(r[0].lo, (LED + 5 + 8 + 3) & ~3);
  assert.strictEqual(r[0].hi, HITS);
  assert.strictEqual(r[1].hi, HERE);
});

test('bodies: CREATE points at its body (Thumb-2, ARMv6-M, host tokens)', () => {
  const [code, v] = recs();
  const thumb = new Map([[v.lo + 12, v.lo + 16]]);
  assert.strictEqual(M.bodyOf(v, a => thumb.get(a)), v.lo + 16);
  const tok = new Map([[v.lo + 4, v.lo + 16]]);
  assert.strictEqual(M.bodyOf(v, a => tok.get(a)), v.lo + 16);
  assert.strictEqual(M.bodyOf(code, () => 0x12345678), null);
});

test('labels: what a cell points at', () => {
  const r = recs();
  r[0].body = null; r[1].body = r[1].lo + 16;
  const ctx = { recs: r, alias: 0, builtins: new Map([[0x20000400, 'DUP']]), regs: new Map([[0xD0000010, 'SIO.GPIO_OUT']]),
    kcells: M.kernelCells('Pico 2'), here: HERE, board: 'Pico 2' };
  assert.strictEqual(M.labelOf(r[1].body, ctx).text, 'address of HITS');
  assert.strictEqual(M.labelOf(LED, ctx).text, 'header of LED-INIT');
  assert.strictEqual(M.labelOf(r[0].lo + 8, ctx).text, 'code of LED-INIT+8');
  assert.strictEqual(M.labelOf(r[0].lo + 9, ctx).text, 'return address into LED-INIT+8');
  assert.strictEqual(M.labelOf(0xD0000010, ctx).text, 'SIO.GPIO_OUT');
  assert.strictEqual(M.labelOf(0x20000400, ctx).text, 'kernel word DUP');
  assert.strictEqual(M.labelOf(0x20000411, ctx).text, 'return address into DUP+16');
  assert.strictEqual(M.labelOf(0x2001211C, ctx).text, 'HERE (dictionary pointer)');
  assert.strictEqual(M.labelOf(HERE, ctx).text, 'HERE');
  assert.strictEqual(M.labelOf(42, ctx), null);
  // data that only looks like an address: no guess outside the firmware's own map
  assert.strictEqual(M.labelOf(0xFFFFFFFF, ctx), null, 'erased flash');
  assert.strictEqual(M.labelOf(0x464F665B, ctx), null, 'data in the peripheral range');
  assert.strictEqual(M.labelOf(0xF000D306, ctx), null, 'an instruction in the CPU register range');
  assert.strictEqual(M.labelOf(0x20000110, ctx).text, '→ kernel (exe)');
  assert.strictEqual(M.ownerOf(0x103E0000, ctx), 'save area');
  assert.strictEqual(M.ownerOf(r[1].body, ctx), 'HITS: body');
  assert.strictEqual(M.ownerOf(LED + 2, ctx), 'LED-INIT: header');
});

test('the address box: Forth, worked out here', () => {
  const names = { HERE, HITS: 0x20002160 - 4, 'SIO.GPIO_OUT': 0xD0000010 };
  const name = t => names[t.toUpperCase()] ?? null;
  const tick = t => (t.toUpperCase() === 'BLINK' ? 0x20002201 : null);
  assert.strictEqual(M.evaluate('$20002140', name, tick), 0x20002140);
  assert.strictEqual(M.evaluate('HERE 64 -', name, tick), HERE - 64);
  assert.strictEqual(M.evaluate("' BLINK", name, tick), 0x20002201);
  assert.strictEqual(M.evaluate('sio.gpio_out', name, tick), 0xD0000010);
  assert.strictEqual(M.evaluate('0x10 2 *', name, tick), 32);
  assert.throws(() => M.evaluate('NOPE', name, tick), /NOPE: not a word/);
  assert.throws(() => M.evaluate('1 2', name, tick), /leaves 2 values/);
  assert.throws(() => M.evaluate("' NOPE", name, tick), /no such word/);
});

test('the budget: bytes by word, older copies counted', () => {
  const r = M.records([[0x2000, 'SQ'], [0x1F00, 'SQ'], [0x1E00, 'BLINK']], 0x2020);
  const b = M.budget(r, 65536);
  assert.strictEqual(b.used, 0x2020 - 0x1E00);
  const sq = b.words.find(w => w.name === 'SQ');
  assert.strictEqual(sq.copies, 2);
  assert.strictEqual(b.spare, 0x100, 'the older SQ');
});

const UF2 = path.resolve(__dirname, '..', 'firmware', 'pico2.uf2');
test('the firmware file: the kernel in RAM is read from its copy in flash', { skip: !fs.existsSync(UF2) && 'no firmware/pico2.uf2' }, () => {
  const rd = M.imageReader(UF2, 'Pico 2');
  const inRam = rd(0x20000110, 64), inFlash = rd(0x10000068, 64);
  assert.ok(inRam.every(b => b !== null));
  assert.deepStrictEqual(inRam, inFlash);
  assert.ok(rd(0x20003000, 4).every(b => b === null), 'the dictionary is not in the file');
});

test('the close-up: the region shown and its neighbours, named, HERE inside', () => {
  const ctx = { here: 0x20002200, recs: [{ h: 0x20002104, name: 'X', lo: 0x2000210C, hi: 0x20002200 }] };
  const html = M.mapHtml('Pico 2', ctx, 0x20002180, null);
  const zoom = html.slice(html.indexOf('close-up'));
  assert.match(zoom, /zseg dict cur[^]*<span>dictionary<\/span><small>64 KB/);
  assert.match(zoom, /recovery point/);
  assert.match(zoom, /kernel: variables/);
  assert.match(zoom, /title="HERE \$20002200"/);
  assert.match(zoom, /not to scale/);
  assert.strictEqual(M.mapHtml('Pico 2', ctx, 0xD0000010, null).includes('close-up'), false, 'none outside the map');
});

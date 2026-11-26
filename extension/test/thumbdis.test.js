// thumbdis.test.js - the built-in Thumb-2 decoder against arm-none-eabi-objdump.
// Without objdump, only the fixed cases run (real kernel code, objdump's text
// saved in thumbdis-fixed.json). With it: every instruction in our kernel
// images, every 16-bit encoding, random 32-bit ones and IT blocks. The rule for
// the random ones: the decoder gives objdump's text, or says it doesn't know
// (.short / .word); never a wrong instruction.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../src/thumbdis');

let objdump = true;
try { execFileSync('arm-none-eabi-objdump', ['--version']); } catch { objdump = false; }
const skip = !objdump && 'arm-none-eabi-objdump not installed';
const ROOT = path.resolve(__dirname, '..', '..');

// objdump's text for a buffer, by address
function reference(buf, addr = 0) {
  const f = path.join(os.tmpdir(), `thumbdis-${process.pid}.bin`);
  fs.writeFileSync(f, buf);
  const out = execFileSync('arm-none-eabi-objdump', ['-D', '-b', 'binary', '-m', 'arm', '-M', 'force-thumb', `--adjust-vma=0x${addr.toString(16)}`, f], { maxBuffer: 1 << 28 }).toString();
  fs.unlinkSync(f);
  const m = new Map();
  for (const l of out.split(/\r?\n/)) {   // CRLF from objdump on Windows
    const x = /^\s*([0-9a-f]+):\s+((?:[0-9a-f]{4} ?)+)\s+(.*)$/.exec(l);
    if (x) m.set(parseInt(x[1], 16), x[3].replace(/\s+/g, ' ').split(';')[0].trim());
  }
  return m;
}

// binutils 2.46 no longer notes #4294967295 as "@ 0xffffffff"; older ones do, as the decoder does
const same = (dec, ref) => dec === ref || dec === ref + ' @ 0xffffffff';

// decoder vs objdump over a buffer: [matches, unknown, wrong[]]
function compare(buf, addr = 0) {
  const ref = reference(buf, addr);
  let ok = 0, unk = 0;
  const wrong = [];
  for (const d of D.disassemble(buf, addr)) {
    const e = ref.get(d.addr);
    if (e === undefined) continue;
    if (d.text.startsWith('.short') || d.text.startsWith('.word')) unk++;
    else if (same(d.text, e) || (e.endsWith(' @ <UNPREDICTABLE>') && d.text === e.slice(0, -18))) ok++;
    else wrong.push(`${d.hex}: objdump "${e}", decoder "${d.text}"`);
  }
  return [ok, unk, wrong];
}

const pack = hs => { const b = Buffer.alloc(hs.length * 2); hs.forEach((h, i) => b.writeUInt16LE(h, 2 * i)); return b; };
const rnd = () => crypto.randomBytes(4).readUInt32LE(0);

test('real kernel code, objdump\'s text saved', () => {
  const runs = require('./thumbdis-fixed.json');
  let n = 0;
  for (const [addr, hex, want] of runs) {
    const got = new Map(D.disassemble(Buffer.from(hex, 'hex'), addr).map(d => [d.addr, d.text]));
    for (const [a, t] of want) { assert.strictEqual(got.get(a), t, `at 0x${a.toString(16)}`); n++; }
  }
  assert.ok(n > 100);
});

test('every instruction in our Thumb-2 kernel images', { skip }, () => {
  const out = path.join(os.tmpdir(), `thumbcorpus-${process.pid}.json`);
  execFileSync('python3', ['-I', path.join(__dirname, 'thumbcorpus.py'), out]);
  const runs = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  const bad = [];
  let n = 0;
  for (const [addr, hex, want] of runs) {
    const got = new Map(D.disassemble(Buffer.from(hex, 'hex'), addr).map(d => [d.addr, d.text]));
    for (const [a, t] of want) { n++; if (!same(got.get(a), t)) bad.push(`0x${a.toString(16)}: objdump "${t}", decoder "${got.get(a)}"`); }
  }
  assert.deepStrictEqual(bad.slice(0, 10), []);
  assert.ok(n > 6000, `${n} instructions`);   // every Thumb-2 kernel built
});

test('every 16-bit encoding: objdump\'s text, or unknown', { skip }, () => {
  const hs = [];
  for (let h = 0; h < 0xE800; h++) if (!((h & 0xFF00) === 0xBF00 && (h & 0xF))) hs.push(h);   // IT blocks: below
  const [ok, , wrong] = compare(pack(hs));
  assert.deepStrictEqual(wrong.slice(0, 10), []);
  assert.ok(ok > 55000);
});

test('random 32-bit encodings: objdump\'s text, or unknown', { skip }, () => {
  const hs = [];
  for (let k = 0; k < 200000; k++) hs.push(0xE800 + rnd() % 0x1800, rnd() & 0xFFFF);
  const [ok, , wrong] = compare(pack(hs));
  assert.deepStrictEqual(wrong.slice(0, 10), []);
  assert.ok(ok > 40000);
});

test('IT blocks with random instructions in them', { skip }, () => {
  const hs = [];
  for (let k = 0; k < 20000; k++) {
    hs.push(0xBF00 | (rnd() % 14) << 4 | (1 + rnd() % 15));
    for (let j = 0; j < 4; j++) {
      if (rnd() & 1) hs.push(0xE800 + rnd() % 0x1800, rnd() & 0xFFFF);
      else { let h; do h = rnd() & 0xFFFF; while (h >= 0xE800 || (h & 0xFF00) === 0xBF00); hs.push(h); }
    }
  }
  const [ok, , wrong] = compare(pack(hs));
  assert.deepStrictEqual(wrong.slice(0, 10), []);
  assert.ok(ok > 50000);
});

test('MRS and MSR with SYSm 0 as objdump prints them (found by the random test)', () => {
  const t = h => D.disassemble(Buffer.from(h.flatMap(x => [x & 255, x >> 8])), 0)[0].text;
  assert.strictEqual(t([0xF3EF, 0x8500]), 'mrs r5, CPSR');
  assert.strictEqual(t([0xF380, 0x8800]), 'msr CPSR_f, r0');
  assert.strictEqual(t([0xF380, 0x8801]), 'msr IAPSR, r0');
});

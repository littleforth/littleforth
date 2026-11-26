// periphdata.js - the chip's peripherals, registers and bit fields (from the
// SVD, data/<chip>.periph.json, made by tools/svd2json.py), and the arithmetic
// on them: a field's value, its text, a register with one field changed.
// No vscode here: the debug adapter and the tests use it too.
'use strict';
const fs = require('fs');
const path = require('path');

const BOARDS = require('../boards');
const cache = new Map();

// {chip, list: [periph], byName: Map, resets: Map periph -> bit} or null
function load(board, dataDir = path.join(__dirname, '..', 'data')) {
  const chip = BOARDS.chipOf(board);
  if (!chip) return null;
  const key = `${dataDir}|${chip}`;
  if (cache.has(key)) return cache.get(key);
  const file = path.join(dataDir, `${chip}.periph.json`);
  let d = null;
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Object.entries(raw).map(([name, p]) => ({
      name, base: p.base, desc: p.desc,
      regs: p.regs.map(r => ({
        name: r.n, addr: (p.base + r.o) >>> 0, desc: r.d, access: r.a, reset: r.r >>> 0, changesOnRead: !!r.ra,
        fields: r.f.map(([n, lsb, width, access, desc, enums, w1c]) => ({ name: n, lsb, width, access, desc, enums, w1c: !!w1c })),
      })),
    }));
    d = { chip, list, byName: new Map(list.map(p => [p.name, p])), resets: resetBits(list) };
  }
  cache.set(key, d);
  return d;
}

// Which RESETS.RESET bit holds each peripheral in reset (by the field's name)
function resetBits(list) {
  const m = new Map();
  const R = list.find(p => p.name === 'RESETS');
  const reg = R && R.regs.find(r => r.name === 'RESET');
  if (!reg) return m;
  const names = new Set(list.map(p => p.name));
  for (const f of reg.fields) {
    const targets = f.name === 'USBCTRL' ? ['USB', 'USB_DPRAM'] : [f.name];
    for (const t of targets) if (names.has(t)) m.set(t, { addr: reg.addr, bit: f.lsb });
  }
  return m;
}

const mask = f => (f.width >= 32 ? 0xFFFFFFFF : ((1 << f.width) - 1)) >>> 0;
const fieldValue = (v, f) => ((v >>> f.lsb) & mask(f)) >>> 0;
const bitsText = f => (f.width === 1 ? `[${f.lsb}]` : `[${f.lsb + f.width - 1}:${f.lsb}]`);
const hex = (v, digits) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');

// "3  ($3)  name" : decimal, hex for wide fields, the enumerated value's name
function fieldText(v, f) {
  const x = fieldValue(v, f);
  const e = f.enums && f.enums[String(x)];
  const h = f.width > 4 ? `  ${hex(x, Math.ceil(f.width / 4))}` : '';
  return `${x}${h}${e ? '  ' + e : ''}`;
}

// The value to write so that field f becomes val and nothing else changes: the
// other fields keep what was read, except write-1-to-clear ones, written 0.
function withField(old, reg, f, val) {
  let clear = 0;
  for (const g of reg.fields) if (g.w1c && g !== f) clear |= mask(g) << g.lsb;
  const m = (mask(f) << f.lsb) >>> 0;
  return (((old & ~m & ~clear) | ((val << f.lsb) & m)) >>> 0);
}

const writable = a => a !== 'r';
const readable = a => a !== 'w';

module.exports = { load, fieldValue, fieldText, withField, bitsText, mask, writable, readable };

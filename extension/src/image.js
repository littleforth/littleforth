// image.js - a firmware image's bytes by target address: UF2 (RP2350) or Intel
// HEX, for the memory view without a board. And the hex dump itself.
'use strict';
const fs = require('fs');

// [{addr, data}] sorted, adjacent pieces merged.
function load(file) {
  const raw = fs.readFileSync(file);
  const parts = /\.uf2$/i.test(file) ? uf2(raw) : ihex(raw.toString('latin1'));
  parts.sort((a, b) => a.addr - b.addr);
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.addr + last.data.length === p.addr) last.data = Buffer.concat([last.data, p.data]);
    else out.push({ addr: p.addr, data: p.data });
  }
  return out;
}

function uf2(raw) {
  const out = [];
  for (let o = 0; o + 512 <= raw.length; o += 512) {
    if (raw.readUInt32LE(o) !== 0x0A324655 || raw.readUInt32LE(o + 4) !== 0x9E5D5157) continue;
    if (raw.readUInt32LE(o + 8) & 1) continue;                    // "not main flash": skip
    const addr = raw.readUInt32LE(o + 12), n = raw.readUInt32LE(o + 16);
    out.push({ addr, data: raw.subarray(o + 32, o + 32 + n) });
  }
  return out;
}

function ihex(text) {
  const out = [];
  let upper = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const b = Buffer.from(line.slice(1), 'hex');
    const n = b[0], off = b.readUInt16BE(1), type = b[3];
    if (type === 0) out.push({ addr: (upper + off) >>> 0, data: b.subarray(4, 4 + n) });
    else if (type === 2) upper = b.readUInt16BE(4) * 16;
    else if (type === 4) upper = (b.readUInt16BE(4) << 16) >>> 0;
    else if (type === 1) break;
  }
  return out;
}

// n bytes at addr from an image, null where the image has nothing.
function read(parts, addr, n) {
  const out = new Array(n).fill(null);
  for (const p of parts) {
    const lo = Math.max(addr, p.addr), hi = Math.min(addr + n, p.addr + p.data.length);
    for (let a = lo; a < hi; a++) out[a - addr] = p.data[a - p.addr];
  }
  return out;
}

// Lines of a hex dump: address, 16 bytes, ascii. bytes: numbers or null (shown as --).
function dump(addr, bytes, marks = {}) {
  const lines = ['address    00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F   ascii'];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16);
    const hx = row.map(b => (b === null ? '--' : b.toString(16).padStart(2, '0'))).join(' ');
    const asc = row.map(b => (b !== null && b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.')).join('');
    let l = `${((addr + i) >>> 0).toString(16).toUpperCase().padStart(8, '0')}   ${hx.slice(0, 23)}  ${hx.slice(24)}`.padEnd(59) + `   ${asc}`;
    if (marks[i]) l += `   ${marks[i]}`;
    lines.push(l);
  }
  return lines;
}

module.exports = { load, read, dump, uf2, ihex };

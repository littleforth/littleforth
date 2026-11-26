// flash.js - putting the firmware on a board, and finding its serial port.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Mounted RP2350 boot drives (BOOTSEL held at power-up): their INFO_UF2.TXT names the chip.
function uf2Drives() {
  let cands = [];
  if (process.platform === 'win32') cands = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(d => d + ':\\');
  else for (const root of ['/media', '/run/media', '/Volumes']) {
    try {
      for (const a of fs.readdirSync(root)) {
        const p = path.join(root, a);
        cands.push(p);
        try { for (const b of fs.readdirSync(p)) cands.push(path.join(p, b)); } catch { /* not a folder */ }
      }
    } catch { /* no such root */ }
  }
  return cands.filter(d => {
    try { return fs.readFileSync(path.join(d, 'INFO_UF2.TXT'), 'latin1').includes('RP2350'); } catch { return false; }
  });
}

async function flashPico2(uf2) {
  const drives = uf2Drives();
  if (!drives.length) throw new Error('no RP2350 drive: hold BOOTSEL while plugging the Pico 2 in, then try again');
  fs.copyFileSync(uf2, path.join(drives[0], path.basename(uf2)));
  return `copied ${path.basename(uf2)} to ${drives[0]}; the Pico 2 restarts`;
}

// Without BOOTSEL: through the Debug Probe with OpenOCD (the same one the debugger
// uses). The UF2's pieces in main flash (the kernel, the register table) are written
// as they are, the RP2350-E10 workaround block (for the boot drive only) is not.
// base: OpenOCD's command line for the board (debugglue.openocdArgs).
function pico2Pieces(uf2) {
  const I = require('./image');
  return I.load(uf2).filter(p => p.addr >= 0x10000000 && p.addr + p.data.length <= 0x10000000 + 4 * 1024 * 1024 - 128 * 1024);
}

function flashPico2Swd(uf2, base, run = execFile) {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forth-flash-'));
  const cmds = ['init', 'reset init'];
  const files = pico2Pieces(uf2).map((p, i) => {
    const f = path.join(dir, `piece${i}.bin`).replace(/\\/g, '/');
    fs.writeFileSync(f, p.data);
    return [f, '0x' + p.addr.toString(16)];
  });
  for (const [f, a] of files) cmds.push(`flash write_image erase {${f}} ${a} bin`);
  for (const [f, a] of files) cmds.push(`verify_image {${f}} ${a} bin`);
  cmds.push('reset run', 'shutdown');
  const argv = [...base.slice(1), ...cmds.flatMap(c => ['-c', c])];
  return new Promise((resolve, reject) => {
    run(base[0], argv, { timeout: 120000 }, (e, out, err) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left in temp */ }
      const text = `${out || ''}${err || ''}`;
      if (e && !/verified \d+ bytes/i.test(text)) return reject(new Error(`OpenOCD: ${(text.split(/\r?\n/).filter(l => /Error/.test(l)).pop() || e.message).trim()}`));
      resolve(`written through the Debug Probe and verified (${files.map(([, a]) => a).join(', ')}); the Pico 2 restarts`);
    });
  });
}

// A board OpenOCD writes from a hex file (through the board's probe):
// programmed, verified, restarted. With a library block (block: {hex, hdr, save:
// [address, length] of the SAVE area}) the block is programmed too, its header's
// page last so a cut-short write leaves no valid block, and the SAVE
// area erased: an image saved over another block means nothing.
function flashOpenocd(hex, base, name, run = execFile, block = null) {
  const prog = f => `program {${f.replace(/\\/g, '/')}} verify`;
  const argv = !block ? [...base.slice(1), '-c', `${prog(hex)} reset exit`]
    : [...base.slice(1), '-c', prog(hex), '-c', prog(block.hex), '-c', prog(block.hdr),   // the block's header page last
      '-c', `flash erase_address 0x${block.save[0].toString(16)} ${block.save[1]}`, '-c', 'reset run', '-c', 'shutdown'];
  return new Promise((resolve, reject) => {
    run(base[0], argv, { timeout: 120000 }, (e, out, err) => {
      const text = `${out || ''}${err || ''}`;
      if (e || (text.match(/Verified OK/gi) || []).length < (block ? 3 : 1)) return reject(new Error(`OpenOCD: ${(text.split(/\r?\n/).filter(l => /Error/.test(l)).pop() || (e && e.message) || 'not verified').trim()}`));
      resolve(`written through the probe${block ? ' with the library block' : ''} and verified; the ${name} restarts`);
    });
  });
}


// [{path, label, likely}] for the serial ports, the board's likely ones first.
// On Linux serialport lists ports through udevadm, and without it the process
// crashes (an unhandled spawn error), so without udevadm we list /dev ourselves.
function hasUdevadm() {
  return (process.env.PATH || '').split(path.delimiter).some(d => fs.existsSync(path.join(d, 'udevadm')));
}

async function ports(board) {
  const { SerialPort } = require('serialport');
  const want = (require('../boards').get(board) || {}).probes || [];   // the USB IDs of the board's probe
  const list = process.platform === 'linux' && !hasUdevadm()
    ? fs.readdirSync('/dev').filter(n => /^tty(ACM|USB)\d+$/.test(n)).map(n => ({ path: '/dev/' + n }))
    : await SerialPort.list();
  return list.map(p => {
    const vid = (p.vendorId || '').toLowerCase(), pid = (p.productId || '').toLowerCase();
    const likely = want.some(([v, q]) => v === vid && (!q || q === pid));
    return { path: p.path, label: [p.manufacturer, p.friendlyName].filter(Boolean).join(' · ') || p.path, likely };
  }).sort((a, b) => b.likely - a.likely);
}

module.exports = { uf2Drives, flashPico2, flashPico2Swd, pico2Pieces, flashOpenocd, ports };

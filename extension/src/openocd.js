// openocd.js - find OpenOCD (the Pico SDK's copy first, then PATH) and its arguments per board.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function findOpenocd() {
  const exe = process.platform === 'win32' ? 'openocd.exe' : 'openocd';
  const sdk = path.join(os.homedir(), '.pico-sdk', 'openocd');
  try {
    for (const v of fs.readdirSync(sdk).sort().reverse()) {
      const p = path.join(sdk, v, exe);
      if (fs.existsSync(p)) return { exe: p, scripts: fs.existsSync(path.join(sdk, v, 'scripts')) ? path.join(sdk, v, 'scripts') : null };
    }
  } catch { /* no SDK */ }
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d && fs.existsSync(path.join(d, exe))) return { exe: path.join(d, exe), scripts: null };
  return null;
}

// [exe, args...] for the board (its file in boards/ gives the interface and target), or null
function openocdArgs(board, found) {
  const b = require('../boards').get(board);
  if (!b || !b.openocd) return null;
  return [found.exe, ...(found.scripts ? ['-s', found.scripts] : []), ...b.openocd];
}

module.exports = { findOpenocd, openocdArgs };

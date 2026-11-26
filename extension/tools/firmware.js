// firmware.js - copy the firmware images into the extension before packaging, so
// Flash works without the repository. The register data in data/ is generated from
// the same lib/ files as the images' tables (tools/vscode_data.py).
'use strict';
const fs = require('fs');
const path = require('path');
const build = path.join(__dirname, '..', '..', 'build');
const out = path.join(__dirname, '..', 'firmware');
fs.mkdirSync(out, { recursive: true });
for (const f of require('../boards').real.flatMap(b => b.firmware || [])) {   // each board's files (boards/)
  const src = path.join(build, f);
  if (!fs.existsSync(src)) { console.error(`${src} missing: run make in the repository first`); process.exit(1); }
  fs.copyFileSync(src, path.join(out, f));
  console.log(`firmware/${f}: ${fs.statSync(src).size} B`);
}

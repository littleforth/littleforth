// boards/index.js - the boards this extension knows: one file per board in this
// folder (and its memory map, data/memmap/<id>.json). Everything about a board is
// in its file; the rest of the extension names no board. A board whose file is
// left out does not exist here: not offered, not searched for, not recognised.
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const list = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'index.js')
  .map(f => require(path.join(__dirname, f)))
  .sort((a, b) => (a.order || 99) - (b.order || 99));

const byName = new Map(list.map(b => [b.name, b]));
const get = name => byName.get(name) || null;

// memory maps by board name, for the boards present
const maps = {};
for (const b of list) {
  const f = path.join(DATA, 'memmap', `${b.id}.json`);
  if (fs.existsSync(f)) maps[b.name] = JSON.parse(fs.readFileSync(f, 'utf8'));
}

module.exports = {
  list,
  get,
  maps,
  real: list.filter(b => !b.test),                              // boards a user can have
  chipOf: name => (get(name) || {}).chip || null,
  chips: [...new Set(list.map(b => b.chip).filter(Boolean))],
  fromState: addr => (Object.entries(maps).find(([, m]) => m.cells[String(addr >>> 0)] === 'STATE') || [])[0] || null,
  mapAt: addr => Object.values(maps).find(m => m.cells[String(addr >>> 0)] === 'STATE') || null,
};

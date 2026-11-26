#!/usr/bin/env python3
"""distcheck.py - dist/ (made by make dist, not in git) must match the source: the images and tables byte for byte
against build/, and the one .vsix (named for extension/package.json's version) against
extension/ and the firmware it ships. Run after the build gates."""
import json, os, subprocess, sys, zipfile

IMAGES = sorted(f for f in os.listdir('dist') if f != 'README.md' and not f.endswith('.vsix'))   # what make dist put there
# the firmware the extension packs: each board's files (extension/boards, extension/tools/firmware.js)
FIRMWARE = json.loads(subprocess.run(['node', '-e', "console.log(JSON.stringify(require('./extension/boards').real.flatMap(b => b.firmware || [])))"],
                                     capture_output=True, text=True, check=True).stdout)
bad = []
def read(p):
    with open(p, 'rb') as f: return f.read()

for f in IMAGES:
    if not os.path.exists('dist/' + f): bad.append(f'dist/{f} missing')
    elif read('dist/' + f) != read('build/' + f): bad.append(f'dist/{f} differs from build/{f}')

ver = json.load(open('extension/package.json'))['version']
want = f'littleforth-{ver}.vsix'
vsix = [f for f in os.listdir('dist') if f.endswith('.vsix')]
if vsix != [want]: bad.append(f'dist/ has {vsix or "no .vsix"}, want {want}')
else:
    z = zipfile.ZipFile('dist/' + want)
    got = {n[len('extension/'):]: n for n in z.namelist() if n.startswith('extension/')}
    tracked = subprocess.run(['git', 'ls-files', 'extension'], capture_output=True, text=True, check=True).stdout.split()
    src = {}
    for t in tracked:   # what .vscodeignore lets into the package
        r = t[len('extension/'):]
        if r.split('/')[0] in ('test', 'tools') or r.startswith('.') or r == 'package-lock.json': continue
        if r.startswith('wasm/') and r.rsplit('.', 1)[-1] in ('c', 'h', 'sh'): continue   # only forth.wasm ships
        src[{'README.md': 'readme.md', 'LICENSE': 'LICENSE.txt'}.get(r, r)] = t
    src.update({'firmware/' + f: 'build/' + f for f in FIRMWARE})
    src['wasm/forth.wasm'] = 'extension/wasm/forth.wasm'   # built by extension/wasm/build.sh
    for r, p in sorted(src.items()):
        if r not in got: bad.append(f'{want}: {r} missing')
        elif z.read(got[r]) != read(p): bad.append(f'{want}: {r} differs from {p}')
    for r in sorted(got):
        if r not in src and not r.startswith('node_modules/'): bad.append(f'{want}: {r} has no source')

for b in bad: print(b)
if bad: print('run make dist'); sys.exit(1)
print(f'dist/: {len(IMAGES)} images and {want} match the source')

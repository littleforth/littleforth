#!/bin/sh
# package-extension.sh - build the extension's .vsix into build/: the WebAssembly
# kernel, then the firmware images from build/ (extension/tools/firmware.js), then vsce.
# Run in MSYS2 MINGW64 after make.
cd "$(dirname "$0")/../extension" || exit 1
sh wasm/build.sh || exit 1
V=$(node -p "require('./package.json').version")
npx --yes @vscode/vsce@3.2.1 package -o ../build/littleforth-$V.vsix 2>&1 | tail -2
python3 -c "import sys, zipfile; [print(n) for n in zipfile.ZipFile(sys.argv[1]).namelist() if 'forth.wasm' in n or 'firmware/' in n or n.endswith(('LICENSE.txt', 'package.json'))]" ../build/littleforth-$V.vsix

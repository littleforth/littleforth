# Building from source

You only need this to change the kernel or the extension. To use littleFORTH,
take the firmware and the extension from a
[Release](https://github.com/littleforth/littleFORTH/releases), or flash from the
extension itself ([getting-started.md](getting-started.md)).

## Tools

| Job | Tools |
|---|---|
| `make`: the firmware and register table | GNU make, `arm-none-eabi-gcc`, Python 3, a host C compiler |
| `make check`: every test | the above, plus QEMU (`qemu-system-arm`) and Node |
| `make dist`: the release files | the above, plus Node (packages the extension) |

So far it is built and tested on Windows, in MSYS2. The tools are the usual
ones, so Linux and macOS should work from their package managers; reports welcome.

## Windows (MSYS2)

1. Install [MSYS2](https://www.msys2.org/) and open the **MSYS2 MINGW64** shell
   (not "MSYS2 MSYS").
2. Install the tools once:

   ```
   pacman -S make diffutils git mingw-w64-x86_64-python mingw-w64-x86_64-gcc mingw-w64-x86_64-arm-none-eabi-gcc mingw-w64-x86_64-qemu
   ```
3. For `make check` and `make dist` only: install the Node LTS from
   [nodejs.org](https://nodejs.org/), then in the shell

   ```
   export PATH="$PATH:/c/Program Files/nodejs"
   cd extension && npm ci && cd ..
   ```
4. Go to the project folder (Windows drives are `/c`, `/d` and so on) and run `make`.

## What `make` gives you

| File | What |
|---|---|
| `build/pico2.uf2` | the kernel and register table for the Pico 2 and Pico 2 W |
| `build/rp2350.tbl` | the register table alone |
| `build/host` | the kernel on your PC (a test build; type Forth at it) |

`make dist` copies the release files into `dist/` and packages the extension
as `dist/littleforth-<version>.vsix` (install it from the Extensions view: `...`,
*Install from VSIX...*).

## Tests

`make check` runs every test gate. Each prints one PASS or FAIL line, and the
full output goes to `build/check.log`. While working, run one part:

| Command | What it runs |
|---|---|
| `make check-quick` | the builds, the size limits, the core tests on the host build and under QEMU |
| `make check-kernel` | the builds and every Forth test, under QEMU on a Cortex-M4 and a Cortex-M33 (the RP2350's core) |
| `make check-vscode` | the extension's data and tests |

The kernel passes the Forth 2012 CORE tests (`test/core.fr`). The gates are
in `tools/gates/`.

## The extension

`extension/` is the VS Code extension. `cd extension && npm test` runs its
tests. After changing `lib/`, regenerate its data with
`python3 tools/vscode_data.py extension/data`. `sh tools/package-extension.sh`
builds the WebAssembly kernel (`extension/wasm/`) and the `.vsix` into `build/`.

## Layout

| Folder | What |
|---|---|
| `src/` | the kernel: interpreter, words, code generator |
| `board/` | each board's startup, linker script and build settings (`<board>.mk`) |
| `lib/` | Forth libraries: the RP2350's register files and drivers, the assembler, SAVE |
| `examples/` | example programs |
| `extension/` | the VS Code extension |
| `test/` | the Forth tests |
| `tools/` | the build's generators and the test gates |
| `docs/` | these pages |

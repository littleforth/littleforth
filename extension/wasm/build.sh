#!/bin/sh
# build.sh - the kernel as WebAssembly (forth.wasm), for the extension's console with no board.
# Run from anywhere; needs clang and wasm-ld (MSYS2: mingw-w64-x86_64-clang, -lld).
set -e
cd "$(dirname "$0")/../.."
STAMP=$(cat build/host.stamp 2>/dev/null || echo 0)
clang --target=wasm32 -O2 -std=gnu11 -nostdlib -ffreestanding -fno-builtin-memcpy \
  -DHOST -DECHO=0 -DFORTH_NAME='"littleFORTH"' -DSTAMP=${STAMP}u -Isrc \
  -include extension/wasm/sjlj.h -D__builtin_setjmp=wsetjmp -D__builtin_longjmp=wlongjmp \
  -Wl,--no-entry -Wl,--export=__stack_pointer -Wl,--initial-memory=4194304 \
  -o extension/wasm/forth.wasm \
  src/hw.c src/interp.c src/io.c src/words.c src/cg_token.c extension/wasm/board.c
ls -l extension/wasm/forth.wasm

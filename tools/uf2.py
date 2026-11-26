#!/usr/bin/env python3
"""uf2.py IMAGE.bin OUT.uf2 [FILE@ADDR ...] - Pico 2 drag-and-drop file from a
flash image, plus any further files at their own flash addresses (A12: the
register table at 0x10380000), so one copy programs them all.

The image is placed at 0x10000000, 256 bytes per 512-byte UF2 block, family
RP2350_ARM_S (0xE48BFF59). The first block is picotool's RP2350-E10
workaround: an "absolute family" block at 0x10FFFF00 that the boot ROM
ignores (flagged RP2_IGNORE_BLOCK); it matters on A2 silicon.
Constants: pico-sdk src/common/boot_uf2_headers/include/boot/uf2.h.
"""
import struct, sys

MAGIC0, MAGIC1, MAGIC_END = 0x0A324655, 0x9E5D5157, 0x0AB16F30
FAMILY_PRESENT, EXT_PRESENT = 0x00002000, 0x00008000
RP2350_ARM_S, ABSOLUTE = 0xE48BFF59, 0xE48BFF57
RP2_IGNORE_BLOCK = 0x9957E304
BASE, PAGE = 0x10000000, 256

def block(flags, addr, no, count, family, data):
    data = data.ljust(476, b"\0")
    return struct.pack("<8I", MAGIC0, MAGIC1, flags, addr, PAGE, no, count, family) + data + struct.pack("<I", MAGIC_END)

def main():
    parts = [(BASE, open(sys.argv[1], "rb").read())]
    for arg in sys.argv[3:]:
        f, a = arg.rsplit("@", 1)
        parts.append((int(a, 0), open(f, "rb").read()))
    pages = [(a + i, d[i:i + PAGE].ljust(PAGE, b"\0")) for a, d in parts for i in range(0, len(d), PAGE)]
    out = [block(FAMILY_PRESENT | EXT_PRESENT, 0x10FFFF00, 0, 2, ABSOLUTE,
                 b"\xef" * PAGE + struct.pack("<I", RP2_IGNORE_BLOCK))]
    out += [block(FAMILY_PRESENT, a, i, len(pages), RP2350_ARM_S, p) for i, (a, p) in enumerate(pages)]
    open(sys.argv[2], "wb").write(b"".join(out))
    print(f"uf2: {sum(len(d) for _, d in parts)} B -> {len(pages)} blocks + 1 E10 block, {sys.argv[2]}")

if __name__ == "__main__":
    main()

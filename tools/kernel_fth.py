#!/usr/bin/env python3
"""kernel_fth.py BOARD OUT - the kernel's addresses as Forth constants, for the
Forth that needs them (lib/save.fth): read from build/BOARD.elf and from the
compiler with the board's own flags (as tools/vscode_data.py does).

  kernel_fth.py pico2 lib/rp2350/drivers/kernel.fth   (kept in the repo; check.sh checks it is current)
  kernel_fth.py an505 build/an505-kernel.fth          (the M33 test board)
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vscode_data as v

def text(board):
    elf = os.path.join(v.ROOT, "build", board + ".elf")
    nm = subprocess.run(["arm-none-eabi-nm", elf], capture_output=True, text=True, check=True).stdout
    sym = {p[2]: int(p[0], 16) for p in (l.split() for l in nm.splitlines()) if len(p) == 3}
    nms = subprocess.run(["arm-none-eabi-nm", "-S", elf], capture_output=True, text=True, check=True).stdout
    size = {p[3]: int(p[1], 16) for p in (l.split() for l in nms.splitlines()) if len(p) == 4}
    k = v.probe(board, [("here", ""), ("latest", ""), ("blktab", "")])
    stamp = int(open(os.path.join(v.ROOT, "build", board + ".stamp")).read().strip(), 16)   # what the kernel was built with
    c = [("DICT0", sym["ram_dict"], "start of the dictionary"),
         ("SAVE-AREA", k["SAVE_AREA"], "where SAVE writes; the kernel reads it back at boot"),
         ("SAVE-SIZE", k["FLASH_AREA_SIZE"], "its size in bytes"),
         ("'HERE", sym["sysv"] + k["offsetof(struct sys, here)"], "the kernel's HERE"),
         ("'LATEST", sym["sysv"] + k["offsetof(struct sys, latest)"], "the newest word's header"),
         ("STAMP", stamp, "the kernel build's ID, in SAVE's magic"),
         ("BLOCKS", k["BLOCKS"], "the library block's header, 0: none"),
         ("'BLKTAB", sym["sysv"] + k["offsetof(struct sys, blktab)"], "the block's name table that find searches, 0: none"),
         ("KBASE", k["KBASE"], "a block's name table holds xt less KBASE"),
         ("'IRQS", sym.get("irq_xt", 0), "IRQ!'s table of xts"),
         ("#IRQS", size.get("irq_xt", 0) // 4, "its length in cells")]
    return (f"\\ kernel.fth - addresses in the {board} kernel, made by tools/kernel_fth.py\n"
            "\\ from the build. Do not edit: rebuild the kernel and run the tool again.\n" +
            "".join(f"${a:08X} CONSTANT {n:10} \\ {d}\n" for n, a, d in c))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    open(sys.argv[2], "w", newline="\n").write(text(sys.argv[1]))   # LF on Windows too

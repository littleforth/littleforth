#!/usr/bin/env python3
"""vscode_data.py OUTDIR - the VS Code extension's data, from our sources:
  builtins.json   {NAME: [stack, help, group, inline, forth]}  from tools/wordhelp.py
                  (inline: the compiler copies its code into your words; forth: a
                  Forth file supplies it on some boards, SAVEW in src/wordlist.h)
  memmap/<build>.json  one board's memory map (regions, kernel cells, code)
  <chip>.json     {PERIPH: [base, [[MEMBER, address, description], ...]]}
                  from lib/<chip>/registers/*.fth, names as the register table has them
                  (a name the generator shortened gets its PERIPH. prefix back)
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wordhelp                                # noqa: E402
from forthbuiltins import BUILTINS, INLINE     # noqa: E402

REG = re.compile(r"^\s*\$([0-9A-Fa-f]+)\s+CONSTANT\s+(\S+)\s*(?:\\\s*(.*))?$")


def chip(d):
    out = {}
    for p in sorted(glob.glob(os.path.join(d, "*.fth"))):
        inst = os.path.basename(p)[:-4]
        base, regs, typ = None, [], re.sub(r"\d+$", "", inst)
        for line in open(p, encoding="latin-1"):
            t = re.match(r"\\ type: (\S+)", line)
            if t:
                typ = t.group(1)
            m = REG.match(line)
            if not m:
                continue
            v, name, note = int(m.group(1), 16), m.group(2), (m.group(3) or "").strip()
            if name == inst:
                base = v
                continue
            member = name[len(inst) + 1:] if name.startswith(inst + ".") else name
            regs.append([member, v, note])
        if base is None:
            sys.exit(f"{p}: no base constant")
        out[inst] = [base, regs, typ]     # typ: as tools/regtable.py gives it
    return out


# The boards' memory maps for the Memory tab, all from the build: addresses and sizes
# from the firmware's symbols (arm-none-eabi-nm, objdump); REGTABLE, SAVE_AREA,
# FLASH_AREA_SIZE, the data stack's layout and struct sys's fields from the compiler
# itself (a probe compiled with each board's own flags from make -n); the words for
# each field and variable from the comments in the source.
# the boards: the extension's board files (extension/boards/), {name: (build, chip whose register table it carries)}
BOARDS = {b["name"]: (b["id"], b["table"]) for b in json.loads(subprocess.run(
    ["node", "-e", "console.log(JSON.stringify(require('./extension/boards').list.map(b => ({ id: b.id, name: b.name, table: b.table || b.chip }))))"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)}
# the chips: one folder of register files each (lib/<chip>/registers)
CHIPS = sorted(os.path.basename(os.path.dirname(d)) for d in glob.glob(os.path.join(ROOT, "lib", "*", "registers")))
# wording for the kernel's variables (a symbol not named here is described by the
# comment at its definition in the source)
WORDING = {"vtab": "the vector table", "ram_dict": "the dictionary",
           "irq_xt": "interrupt handlers (one xt per IRQ, IRQ!)", "jb": "the error recovery point (ABORT, THROW)",
           "sysv": "kernel variables (STATE BASE >IN SOURCE HERE LATEST, the input line, WORD, HOLD)",
           "S": "the pointer to the kernel variables", "dstack": "the data stack",
           "call_bi": "call_bi: calls from the dictionary into the kernel (ARMv6-M)",
           "crash": "the state at the last fault (pc, registers, the data stack)"}


def build_flags(elf):
    """The compiler command make would use for build/<elf>.elf: (flags, sources)."""
    out = subprocess.run(["make", "-n", "-B", f"build/{elf}.elf"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    cmd = next(ln for ln in out.splitlines() if ln.startswith("arm-none-eabi-gcc") and f"build/{elf}.elf" in ln)
    import shlex
    args = shlex.split(cmd)
    flags = [x for x in args if x.startswith(("-D", "-I", "-mcpu", "-mthumb", "-std", "-ffixed"))]
    srcs = [x for x in args if x.endswith(".c")]
    return flags, srcs


def sys_fields():
    """struct sys from src/forth.h: [(field, words for it)], from its declarations and their comments."""
    text = open(os.path.join(ROOT, "src", "forth.h")).read()
    body = re.search(r"struct sys \{(.*?)\};", text, re.S).group(1)
    out = []
    for ln in body.splitlines():
        m = re.match(r"\s*\w+\s+([^;]+);\s*(?:/\*\s*(.*?)\s*\*/)?", ln)
        if not m:
            continue
        names = [re.sub(r"\[.*", "", n).strip() for n in m.group(1).split(",")]
        c = (m.group(2) or "").strip()
        words = c.split() if len(c.split()) == len(names) and len(names) > 1 else \
            [x.strip() for x in c.split(",")] if len(c.split(",")) == len(names) and len(names) > 1 else [c] * len(names)
        for n, w in zip(names, words):
            out.append((n, w))
    return out


def probe(elf, fields):
    """Constants as the board's build sees them, read back from the compiler's assembly."""
    flags, srcs = build_flags(elf)
    board = next(x for x in srcs if x.startswith("board/") and not x.endswith("cortexm.c"))
    exprs = ["REGTABLE", "SAVE_AREA", "FLASH_AREA_SIZE", "DSTACK_GUARD", "DSTACK_CELLS", "sizeof(cell)", "KBASE", "BLOCKS"]
    for f, _ in fields:
        exprs += [f"offsetof(struct sys, {f})", f"sizeof(((struct sys *)0)->{f})"]
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        c = os.path.join(t, "probe.c")
        open(c, "w").write("#include <stddef.h>\n#include \"forth.h\"\n#ifndef KBASE\n#define KBASE 0\n#endif\n"
                           f"#include \"{os.path.join(ROOT, 'src', 'hw.c')}\"\n#include \"{os.path.join(ROOT, board)}\"\n"
                           "const unsigned memprobe[] = {" + ", ".join(f"(unsigned)({e})" for e in exprs) + "};\n")
        subprocess.run(["arm-none-eabi-gcc", *flags, "-I" + os.path.join(ROOT, "src"), "-S", "-o", os.path.join(t, "p.s"), c],
                       cwd=ROOT, check=True, capture_output=True)
        asm = open(os.path.join(t, "p.s")).read()
    vals = [int(v, 0) for v in re.findall(r"\.word\s+(-?\w+)", asm.split("memprobe:", 1)[1])][:len(exprs)]
    return dict(zip(exprs, [v & 0xFFFFFFFF for v in vals]))


def comment_of(sym):
    """The comment at a variable's definition in the source, if any."""
    for f in glob.glob(os.path.join(ROOT, "src", "*.c")) + glob.glob(os.path.join(ROOT, "board", "*.c")):
        for ln in open(f, encoding="latin1"):
            if re.search(rf"\b{re.escape(sym)}\b\s*(\[[^\]]*\])*\s*(__attribute__\S*\s*)?[;=,]", ln) and "/*" in ln and not ln.lstrip().startswith(("/*", "*", "#")):
                return re.search(r"/\*\s*(.*?)\s*\*/", ln).group(1)
    return None


def memmap():
    out = {}
    fields = sys_fields()
    for board, (elf, table) in BOARDS.items():
        f = os.path.join(ROOT, "build", elf + ".elf")
        if not os.path.exists(f):
            continue
        k = probe(elf, fields)
        nm = subprocess.run(["arm-none-eabi-nm", "-n", "-S", f], capture_output=True, text=True, check=True).stdout
        sym, data = {}, []
        for ln in nm.splitlines():
            p = ln.split()
            if len(p) == 4:
                sym[p[3]] = (int(p[0], 16), int(p[1], 16))
                if p[2] in "bBdD": data.append(p[3])
            elif len(p) == 3: sym[p[2]] = (int(p[0], 16), 0)
        hdr = subprocess.run(["arm-none-eabi-objdump", "-h", f], capture_output=True, text=True, check=True).stdout
        sec = {}
        for ln in hdr.splitlines():
            p = ln.split()
            if len(p) >= 6 and p[0].isdigit(): sec[p[1]] = (int(p[3], 16), int(p[4], 16), int(p[2], 16))   # vma, lma, size
        regions = []
        add = lambda lo, hi, name: regions.append([lo, hi, name]) if hi > lo else None
        if ".boot" in sec:
            b = sec[".boot"]; add(b[1], b[1] + b[2], "flash: boot (the vector pair, IMAGE_DEF, the copy into RAM)")
            r = sec[".ram_image"]; add(r[1], r[1] + r[2], "flash: the kernel, copied into RAM when the board starts")
            add(r[0], r[0] + r[2], "RAM: the kernel's code and constants (copied from flash)")
        else:
            t = sec[".text"]; add(t[0], t[0] + t[2], "flash: the kernel's code")
        tbl = os.path.join(ROOT, "build", table + ".tbl")
        add(k["REGTABLE"], k["REGTABLE"] + os.path.getsize(tbl), "flash: the register table (names of the chip's registers)")
        mem = "flash" if k["SAVE_AREA"] < 0x20000000 and not any(lo <= k["SAVE_AREA"] < hi for lo, hi, n in regions if n.startswith("RAM")) else "memory"
        add(k["SAVE_AREA"], k["SAVE_AREA"] + k["FLASH_AREA_SIZE"], f"{mem}: the SAVE area (the dictionary SAVE wrote, restored at boot)")
        for name in data:
            lo, size = sym[name]
            if size: add(lo, lo + size, "RAM: " + (WORDING.get(name) or comment_of(name) or name))
        if "_ebss" in sym and "_estack" in sym:
            add(sym["_ebss"][0], sym["_estack"][0], "RAM: free, then the return stack (rsp grows down from the top)")
        regions.sort()
        cells = {}
        if "sysv" in sym:
            for name, words in fields:
                off, size = k[f"offsetof(struct sys, {name})"], k[f"sizeof(((struct sys *)0)->{name})"]
                forth = name.upper() if name.upper() in BUILTINS else None          # a field the Forth word of its name reads
                if words and words.split()[0].isupper() and len(words.split()) == 1:
                    label = words if sum(w == words for _, w in fields) == 1 else f"{words} ({name})"
                else:
                    label = f"{forth or name}{' (' + words + ')' if words else ''}"
                if size != k['sizeof(cell)']: label += f", {size} bytes"
                cells[sym["sysv"][0] + off] = label
        if "dstack" in sym:
            d, c = sym["dstack"][0], k["sizeof(cell)"]
            g, n = k["DSTACK_GUARD"], k["DSTACK_CELLS"]
            cells[d] = f"data stack guard ({g} cells)"
            cells[d + g * c] = f"data stack: the deepest of {n} cells"
            cells[d + (g + n - 1) * c] = "data stack: the top (psp when empty)"
        out[board] = {"regions": regions, "cells": {str(a): v for a, v in sorted(cells.items())},
                      "code": [r[:2] for r in regions if "code" in r[2] or r[2] == "RAM: the dictionary"]}
        if "call_bi" in sym:                     # ARMv6-M: a call to flash is bl call_bi, then the xt less KBASE
            out[board]["callBi"] = sym["call_bi"][0]
            out[board]["kbase"] = k["KBASE"]
    return out


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    wl = open(os.path.join(ROOT, "src", "wordlist.h")).read()
    forth = set(re.findall(r'X\(\w+,"([^"]+)"', re.search(r"#define SAVEW\(X\) (.*)", wl).group(1)))
    b = {w: [*wordhelp.help_for(w), wordhelp.GROUP_OF[w][0], w in INLINE, w in forth] for w in BUILTINS}
    json.dump(b, open(os.path.join(out, "builtins.json"), "w", newline="\n"), separators=(",", ":"))   # LF on Windows too
    for c in CHIPS:
        data = chip(os.path.join(ROOT, "lib", c, "registers"))
        json.dump(data, open(os.path.join(out, c + ".json"), "w", newline="\n"), separators=(",", ":"))
        print(f"{c}.json: {len(data)} peripherals, {sum(len(v[1]) for v in data.values())} registers")
    print(f"builtins.json: {len(b)} words")
    mm = memmap()   # one file per board (memmap/<build>.json), so a board's files can be left out whole
    os.makedirs(os.path.join(out, "memmap"), exist_ok=True)
    for name, m in mm.items():
        json.dump(m, open(os.path.join(out, "memmap", BOARDS[name][0] + ".json"), "w", newline="\n"), indent=0, separators=(",", ":"))
    print("memmap/: " + ", ".join(f"{k} {len(v['regions'])} regions" for k, v in mm.items()))


if __name__ == "__main__":
    main()

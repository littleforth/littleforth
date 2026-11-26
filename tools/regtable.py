#!/usr/bin/env python3
r"""regtable.py DIR OUT - the register table (A12) from a chip's register files.

DIR holds one Forth file per peripheral (lib/<chip>/registers), as
svd2forth.py writes them: the base, then PERIPH.REGISTER constants. Names the
generator had to shorten for the 31-character dictionary limit get their
PERIPH. prefix back here: the table has no such limit.

Each instance has a type: the file's "\ type: NAME" line (svd2forth.py
writes the SVD's groupName, through derivedFrom), or else the instance's
name less trailing digits. INSTANCE.WORD that is no register finds the
library word TYPE.WORD (GPIOA.BASE is GPIO.BASE with GPIOA's base). Instances
of one type with the same registers (names and offsets) share one list, so
UART0 and UART1 store their 22 registers once.

Format, little-endian, byte-packed (the Cortex-M reads unaligned words):
  "RTB3"
  instances:  u8 len, name, u16 where its type starts, u32 base; then 0
  each type:  u8 len, type name; then u8 len, name, u24 offset per member; then 0
  three zero bytes of padding, so a word read at the last field stays inside
"""
import glob, os, re, struct, sys

def chip(dirname):
    """{instance: (base, {member: offset})}"""
    out = {}
    for p in sorted(glob.glob(os.path.join(dirname, "*.fth"))):
        inst = os.path.basename(p)[:-4]
        base, regs, typ = None, {}, re.sub(r"\d+$", "", inst)
        for line in open(p, encoding="latin-1"):
            t = re.match(r"\\ type: (\S+)", line)
            if t:
                typ = t.group(1)
            m = re.match(r"\s*(\$[0-9A-Fa-f]+|\d+)\s+CONSTANT\s+(\S+)", line)
            if not m:
                continue
            v, name = int(m.group(1).replace("$", "0x"), 0), m.group(2)
            if name == inst:
                base = v
            elif name.startswith(inst + "."):
                regs[name[len(inst) + 1:]] = v
            else:
                regs[name] = v                      # prefix dropped for length: give it back
        if base is None:
            sys.exit(f"{p}: no base constant {inst}")
        mem = {}
        for n, v in regs.items():
            off = v - base
            if not 0 <= off < 1 << 24:
                sys.exit(f"{inst}.{n}: offset {off:#x} out of range")
            mem[n] = off
        out[inst] = (base, mem, typ)
    return out

def build(insts):
    types, tindex = [], {}
    for name, (base, mem, typ) in insts.items():
        key = (typ, tuple(sorted(mem.items())))
        if key not in tindex:
            tindex[key] = len(types)
            types.append(key)
    head = 4 + sum(1 + len(n.encode()) + 6 for n in insts) + 1
    lists, where = bytearray(), []
    for typ, members in types:
        where.append(head + len(lists))
        tb = typ.encode()
        if not 0 < len(tb) < 32:
            sys.exit(f"{typ}: a type name is 1-31 characters (TYPE.WORD is a dictionary name)")
        lists += bytes([len(tb)]) + tb
        for n, off in members:
            nb = n.encode()
            if not 0 < len(nb) < 256:
                sys.exit(f"{n}: bad name length")
            lists += bytes([len(nb)]) + nb + struct.pack("<I", off)[:3]
        lists += b"\0"
    if where and where[-1] >= 1 << 16:
        sys.exit("table over 64 KB: type offsets need more than 16 bits")
    b = bytearray(b"RTB3")
    for name, (base, mem, typ) in insts.items():
        nb = name.encode()
        b += bytes([len(nb)]) + nb + struct.pack("<HI", where[tindex[(typ, tuple(sorted(mem.items())))]], base)
    b += b"\0"
    assert len(b) == head
    return bytes(b + lists + b"\0\0\0"), len(types)

def main():
    insts = chip(sys.argv[1])
    data, nt = build(insts)
    open(sys.argv[2], "wb").write(data)
    regs = sum(len(v[1]) for v in insts.values())
    print(f"{os.path.basename(sys.argv[2])}: {len(insts)} peripherals, {nt} types, {regs} registers, {len(data)} B")

if __name__ == "__main__":
    main()

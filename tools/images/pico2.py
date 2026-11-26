"""build/pico2.uf2: pico2.bin at 0x10000000 and rp2350.tbl at 0x10380000, every
RP2350 block numbered 0..n-1 of n, the E10 block first."""
import struct
def check(h, bad):
    u = h.rd("pico2.uf2"); mem, nos = {}, []
    for i in range(0, len(u), 512):
        m0, m1, fl, addr, sz, no, cnt, fam = struct.unpack("<8I", u[i:i + 32])
        if i == 0 and addr != 0x10FFFF00: bad.append("pico2.uf2: no E10 block first")
        if fam == 0xE48BFF59:
            nos.append((no, cnt))
            for k in range(sz): mem[addr + k] = u[i + 32 + k]
    if [n for n, _ in nos] != list(range(len(nos))) or any(c != len(nos) for _, c in nos):
        bad.append("pico2.uf2: block numbering")
    if not h.same(mem, 0x10000000, h.rd("pico2.bin")): bad.append("pico2.uf2: firmware differs")
    if not h.same(mem, 0x10380000, h.rd("rp2350.tbl")): bad.append("pico2.uf2: table differs")
    return f"pico2.uf2 ({len(nos)} blocks)"

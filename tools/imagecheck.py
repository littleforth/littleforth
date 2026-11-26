#!/usr/bin/env python3
"""imagecheck.py - gate E5 (A14): the files programmed into the boards carry
the firmware and the register table intact, at their addresses. One check per
board, in tools/images/<board>.py (its docstring says what it checks).
"""
import glob, os, sys
B = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")

def rd(n): return open(os.path.join(B, n), "rb").read()

def hexmem(text):
    mem, base, eof = {}, 0, 0
    for line in text.splitlines():
        r = bytes.fromhex(line[1:])
        n, a, t, d = r[0], r[1] << 8 | r[2], r[3], r[4:4 + r[0]]
        if t == 0:
            for i, b in enumerate(d): mem[base + a + i] = b
        elif t == 1: eof += 1
        elif t == 4: base = (d[0] << 8 | d[1]) << 16
        elif t == 2: base = (d[0] << 8 | d[1]) << 4
    return mem, eof

def same(mem, addr, data):
    return all(mem.get(addr + i) == b for i, b in enumerate(data))

def main():
    bad, done = [], []
    h = sys.modules[__name__]
    for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "images", "*.py"))):
        g = {}
        exec(compile(open(f).read(), f, "exec"), g)
        done.append(g["check"](h, bad))
    for b in bad: print(b)
    print("images:", "FAIL" if bad else "PASS  " + ", ".join(done))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""regcheck.py DIR TABLE - every constant in DIR's register files, looked up
through TABLE on the host build, must give the same value (gate E2).
A name the generator shortened is asked for with its PERIPH. prefix back."""
import glob, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    want = []
    for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.fth"))):
        inst = os.path.basename(p)[:-4]
        for line in open(p, encoding="latin-1"):
            m = re.match(r"\s*(\$[0-9A-Fa-f]+|\d+)\s+CONSTANT\s+(\S+)", line)
            if m:
                n = m.group(2)
                if n != inst and not n.startswith(inst + "."):
                    n = inst + "." + n
                want.append((n, int(m.group(1).replace("$", "0x"), 0)))
    src = "HEX\n" + "".join(f"{n} U.\n" for n, _ in want)
    env = dict(os.environ, FORTH_REGS=sys.argv[2])
    out = subprocess.run([os.path.join(ROOT, "build", "host")], input=src, capture_output=True,
                         text=True, env=env, timeout=120).stdout
    got = [t for t in out.split() if t != "ok"]
    bad = [(n, v, g) for (n, v), g in zip(want, got + ["?"] * len(want)) if g != f"{v:X}"]
    name = os.path.basename(sys.argv[2])
    if bad or len(got) != len(want):
        for n, v, g in bad[:5]:
            print(f"{name}: {n}: got {g}, want {v:X}")
        print(f"{name}: FAIL  {len(bad)} of {len(want)} wrong"); sys.exit(1)
    # a table in another format (an older build left in flash) is ignored, not misread
    old = sys.argv[2] + ".old"
    open(old, "wb").write(b"RTB2" + open(sys.argv[2], "rb").read()[4:])
    out = subprocess.run([os.path.join(ROOT, "build", "host")], input=f"{want[0][0]} U.\n",
                         capture_output=True, text=True, env=dict(env, FORTH_REGS=old), timeout=30).stdout
    os.remove(old)
    if f"{want[0][1]:X}" in out or "?" not in out:
        print(f"{name}: FAIL  an RTB2 table was read: {out.strip()!r}"); sys.exit(1)
    print(f"{name}: PASS  {len(want)} names, old format ignored")

if __name__ == "__main__":
    main()

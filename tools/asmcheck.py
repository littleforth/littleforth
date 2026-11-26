#!/usr/bin/env python3
"""asmcheck.py - lib/thumb2/asm.fth against arm-none-eabi-as.

  asmcheck.py encodings     every case below assembled by both, on the host
                            build: the bytes must be the same
  asmcheck.py run MODE      test/asm.fth (CODE words run) on MODE, against
                            test/asm.expect

A case is (Forth, GNU as). The Forth side runs between two HEREs and prints
the halfwords; the as side is one labelled block of a .s file.
"""
import json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import run_forth, expect
from forthsource import expand

ASM = os.path.join(ROOT, "lib", "thumb2", "asm.fth")

CASES = json.load(open(os.path.join(ROOT, "test", "asm-cases.json")))   # [Forth, GNU as], shared with extension/test/thumb2asm.test.js


def gnu(cases):
    src = ".syntax unified\n.cpu cortex-m33\n.thumb\n" + "".join(
        f".global c{i}\nc{i}:\n {g}\n" for i, (_, g) in enumerate(cases)) + f".global c{len(cases)}\nc{len(cases)}:\n nop\n"
    with tempfile.TemporaryDirectory() as t:
        s, o = os.path.join(t, "a.s"), os.path.join(t, "a.o")
        open(s, "w").write(src)
        r = subprocess.run(["arm-none-eabi-as", "-o", o, s], capture_output=True, text=True)
        if r.returncode:
            sys.exit("as: " + r.stderr)
        dump = subprocess.run(["arm-none-eabi-objdump", "-d", o], capture_output=True, text=True).stdout
    out, cur = {}, None
    for line in dump.split("\n"):
        m = re.match(r"^[0-9a-f]+ <c(\d+)>:", line)
        if m:
            cur = int(m.group(1)); out[cur] = []; continue
        m = re.match(r"^\s+[0-9a-f]+:\s+((?:[0-9a-f]{4} ?)+)\s", line)
        if m and cur is not None:
            out[cur] += [int(h, 16) for h in m.group(1).split()]
    return [out.get(i, []) for i in range(len(cases))]


def forth(cases):
    lines = [l.text for l in expand(ASM, roots=[ROOT])]
    lines.append(": .hw ( a n -- ) BASE @ >R HEX 0 DO DUP I + H@ U. 2 +LOOP DROP R> BASE ! ;")
    for i, (f, _) in enumerate(cases):
        lines.append(f"CR .( @{i}: ) HERE {f} HERE OVER - .hw")
    src = "\n".join(lines) + "\nCR .( " + run_forth.MARK + ") CR\n"
    cmd, limit = run_forth.command("host")
    out = run_forth.run(cmd, src, limit)
    errs = [l for l in out.split("\n") if "?-" in l or "asm:" in l]
    got = {}
    for m in re.finditer(r"@(\d+): ([^\n]*)", out):
        got[int(m.group(1))] = [int(h, 16) for h in re.findall(r"\b[0-9A-F]+\b", m.group(2).replace(" ok", ""))]
    return [got.get(i) for i in range(len(cases))], errs


def encodings():
    want = gnu(CASES)
    got, errs = forth(CASES)
    bad = 0
    for i, ((f, g), w, h) in enumerate(zip(CASES, want, got)):
        if h != w:
            bad += 1
            print(f"  {f:40} got {' '.join(f'{x:04x}' for x in h or [])}   as: {g.replace(chr(10), ';')} = {' '.join(f'{x:04x}' for x in w)}")
    for e in errs[:5]:
        print("  error:", e.strip())
    ok = bad == 0 and not errs
    print(f"asm encodings: {'PASS' if ok else 'FAIL'}  {len(CASES) - bad}/{len(CASES)} forms as arm-none-eabi-as")
    return ok


def run(mode):
    test = os.path.join(ROOT, "test", "asm.fth")
    src = "\n".join(l.text for l in expand(test, roots=[ROOT])) + "\nCR .( " + run_forth.MARK + ") CR\n"
    cmd, limit = run_forth.command(mode)
    got = expect.norm(run_forth.run(cmd, src, limit).split(run_forth.MARK)[0])
    want = expect.norm(open(test[:-4] + ".expect", encoding="latin-1").read())
    if got == want:
        print(f"{mode} asm: PASS  {len(want)} lines"); return True
    for i, (g, w) in enumerate(zip(got + [""] * len(want), want + [""] * len(got))):
        if g != w:
            print(f"{mode} asm: FAIL  line {i + 1}: got {g!r}, want {w!r}"); break
    return False


if __name__ == "__main__":
    if sys.argv[1:2] == ["encodings"]:
        sys.exit(0 if encodings() else 1)
    if sys.argv[1:2] == ["run"]:
        sys.exit(0 if run(sys.argv[2]) else 1)
    sys.exit(__doc__)

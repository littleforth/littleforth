#!/usr/bin/env python3
"""expect.py MODE FILE.fth - output regression: run FILE.fth, compare with FILE.expect.

For behaviour the tester cannot see (error messages, printed numbers).
Prompts (" ok") and blank lines are ignored; everything else must match line
for line. Uses the same runners as run_forth.py.
"""
import os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_forth

def norm(text):
    out = []
    for l in text.replace("\r", "").split("\n"):
        l = l[:-3] if l.endswith(" ok") else l
        if l.strip() and l.strip() != "ok":   # prompts are ignored
            out.append(l.rstrip())
    return out

def symbols(src, cmd):
    """{name} in the test becomes the address of the kernel's symbol name, in hex."""
    if "-kernel" not in cmd:
        return src
    nm = subprocess.run(["arm-none-eabi-nm", cmd[cmd.index("-kernel") + 1].replace(".bin", ".elf")], capture_output=True, text=True).stdout
    addr = {f[2]: f[0] for f in (l.split() for l in nm.split("\n")) if len(f) == 3}
    return re.sub(r"\{(\w+)\}", lambda m: "$" + addr[m.group(1)].upper(), src)

def in_block():
    """With FORTH_BLOCK_LIST set (a block.list file), the files it names are in
    the library block on the board: an INCLUDE of one is left out."""
    lst = os.environ.get("FORTH_BLOCK_LIST")
    if not lst:
        return set()
    lib = os.path.dirname(os.path.abspath(lst))
    return {os.path.normcase(os.path.normpath(os.path.join(lib, l.strip())))
            for l in open(lst) if l.strip() and not l.startswith("#")}

def includes(path, seen=None):
    """The file with each \\ INCLUDE line replaced by the file it names (relative
    to the including file). Under one top-level INCLUDE each file goes once, as
    the extension sends a file; a later top-level INCLUDE sends it again."""
    top = seen is None
    out = []
    for line in open(path, encoding="latin-1"):
        p = line.split()
        if p[:2] == ["\\", "INCLUDE"]:
            f = os.path.normpath(os.path.join(os.path.dirname(path), p[2]))
            if os.path.normcase(f) in in_block():
                continue
            if top:
                seen = set()
            if f not in seen:
                seen.add(f); out.append(includes(f, seen))
        else:
            out.append(line)
    return "".join(out)

def main():
    mode, src = sys.argv[1], sys.argv[2]
    cmd, limit = run_forth.command(mode)
    text = run_forth.run(cmd, symbols(includes(src), cmd) + "\nCR .( " + run_forth.MARK + ") CR\n", limit)
    got = norm(text.split(run_forth.MARK)[0])
    want = norm(open(src[:-4] + ".expect", encoding="latin-1").read())
    name = os.path.basename(src)[:-4]
    if got == want:
        print(f"{mode} {name}: PASS  {len(want)} lines"); sys.exit(0)
    for i, (g, w) in enumerate(zip(got + [""] * len(want), want + [""] * len(got))):
        if g != w:
            print(f"{mode} {name}: FAIL  line {i + 1}: got {g!r}, want {w!r}"); break
    sys.exit(1)

if __name__ == "__main__":
    main()

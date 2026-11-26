#!/usr/bin/env python3
"""libtest.py DIR TEST.fth - gate E4: load every library file in DIR
(lib/CHIP/drivers) on the host with CHIP's register table and a simulated memory (TEST's folder
mock.fth), run TEST.fth, compare with TEST.expect; and check that no word the
libraries define has the name of a register (it would hide the register)."""
import glob, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from forthsource import expand
import expect

def main():
    libdir, test = sys.argv[1], sys.argv[2]
    chip = os.path.basename(os.path.dirname(os.path.abspath(libdir)))
    regs = set()
    for p in glob.glob(os.path.join(ROOT, "lib", chip, "registers", "*.fth")):
        inst = os.path.basename(p)[:-4]
        for line in open(p, encoding="latin-1"):
            m = re.match(r"\s*\S+\s+CONSTANT\s+(\S+)", line)
            if m:
                n = m.group(1).upper()
                regs.add(n if n == inst or n.startswith(inst + ".") else inst + "." + n)
    lines, seen, clash = [], set(), []
    for f in sorted(glob.glob(os.path.join(libdir, "*.fth"))):
        if os.path.basename(f) == "flash.fth":      # SAVE: the Pico 2's calls its boot ROM as it loads; tested on QEMU (save-forth)
            continue
        for l in expand(f, roots=[ROOT], _seen=seen):
            lines.append(l.text)
            for m in re.finditer(r"(?:^|\s)(?::|CONSTANT|VARIABLE|CREATE)\s+(\S+)", l.text):
                if m.group(1).upper() in regs:
                    clash.append(f"{os.path.basename(l.path)}:{l.no}: {m.group(1)} hides a register")
    for c in clash:
        print(c)
    mock = open(os.path.join(os.path.dirname(test), "mock.fth"), encoding="latin-1").read()
    src = mock + "\n" + "\n".join(lines) + "\nCR .( === LOADED) CR\n" + open(test, encoding="latin-1").read() + "\nCR .( === END) CR\n"
    env = dict(os.environ, FORTH_REGS=os.path.join(ROOT, "build", chip + ".tbl"))
    out = subprocess.run([os.path.join(ROOT, "build", "host")], input=src, capture_output=True, text=True, env=env, timeout=120).stdout
    load, _, rest = out.partition("=== LOADED")
    errs = [l for l in load.split("\n") if re.search(r"\?-\d+", l)]
    for e in errs[:5]:
        print("load error:", e.strip())
    got = expect.norm(rest.partition("=== END")[0])
    if os.environ.get("LIBTEST_DUMP"):
        open(os.environ["LIBTEST_DUMP"], "w").write("\n".join(got) + "\n")
    want = expect.norm(open(test[:-4] + ".expect", encoding="latin-1").read())
    name = os.path.basename(test)[:-4]
    if got == want and not errs and not clash:
        print(f"host {name}: PASS  {len(lines)} library lines, {len(want)} result lines"); sys.exit(0)
    for i, (g, w) in enumerate(zip(got + [""] * len(want), want + [""] * len(got))):
        if g != w:
            print(f"host {name}: FAIL  line {i + 1}: got {g!r}, want {w!r}"); break
    else:
        print(f"host {name}: FAIL")
    sys.exit(1)

if __name__ == "__main__":
    main()

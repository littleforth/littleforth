#!/usr/bin/env python3
"""wordsdoc.py OUT.md - docs/words.md: every builtin word, its stack effect and
one line, from tools/wordhelp.py (the same text the extension shows on hover),
grouped as wordhelp.py's comments group them. make check compares the result
with docs/words.md, so edit wordhelp.py, not the page."""
import ast, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "wordhelp.py")
sys.path.insert(0, HERE)
import wordhelp

text = open(SRC, encoding="utf-8").read()
lines = text.splitlines()
tree = ast.parse(text)
hdict = next(n.value for n in tree.body if isinstance(n, ast.Assign) and n.targets[0].id == "H")
start, end = hdict.lineno, hdict.end_lineno
groups = [(i + 1, m.group(1)) for i, ln in enumerate(lines[start - 1:end], start - 1)
          if (m := re.match(r"\s+# (.+)", ln))]

def group_of(lineno):
    g = None
    for n, name in groups:
        if n <= lineno:
            g = name
    return g

out = {}
for k in hdict.keys:
    out.setdefault(group_of(k.lineno), []).append(k.value)

def cell(s):
    return s.replace("|", "\\|")

doc = wordhelp.__doc__.split("\n\n", 1)[0]
notation = re.search(r"Stack notation:.*", wordhelp.__doc__, re.S).group(0).replace("\n", " ").strip()
md = ["# Words", "",
      "Every word built into the kernel. The driver libraries add more: see",
      "[lib/rp2350/drivers/README.md](../lib/rp2350/drivers/README.md).", "",
      notation, "",
      "Numbers take Forth 2012 prefixes: `$FF` hex, `#10` decimal, `%101` binary, `'A'` a character.",
      "Register names (`UART0.UARTDR`, `IO_BANK0`) need nothing loaded: the board carries a",
      "table of them (see [architecture.md](architecture.md), section 8).", "",
      "On the Pico 2, `SAVE` and `EMPTY` are Forth, not built in: `\\ INCLUDE flash.fth`",
      "(in `lib/rp2350/drivers`) adds them.", "",
      "Made by `tools/wordsdoc.py` from `tools/wordhelp.py`; do not edit.", ""]
for g, words in out.items():
    md += [f"## {g[0].upper() + g[1:]}", "", "| Word | Stack | What it does |", "|---|---|---|"]
    for w in words:
        st, what = wordhelp.H[w]
        md.append(f"| `{cell(w)}` | `{cell(st)}` | {cell(what)} |")
    md.append("")
open(sys.argv[1], "w", encoding="utf-8", newline="\n").write("\n".join(md))

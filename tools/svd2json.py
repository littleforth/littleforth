#!/usr/bin/env python3
"""svd2json.py SVD OUT [REGDIR] - the chip's peripherals for the VS Code Peripherals view.
REGDIR (lib/CHIP/registers): only the peripherals with a file there, for a
family SVD that names more than the chip has.

Per peripheral: base, description, and its registers with their bit fields
(position, width, access, enumerated values) and whether reading changes them.
The register names are the ones svd2forth.py gives the register table, so the
view and the board agree; extension/test checks they do.

{"PERIPH": {"base": N, "desc": "...", "regs": [
   {"n": "REG", "o": offset, "d": "...", "a": "rw", "r": reset, "ra": 1 (reading changes it),
    "f": [[name, lsb, width, access, desc, {value: name}, w1c]]}]}}
access: r, w, rw, w1 (write once), "" when the SVD doesn't say.
"""
import json, os, re, sys, xml.etree.ElementTree as ET

ACC = {"read-only": "r", "write-only": "w", "read-write": "rw", "writeOnce": "w1", "read-writeOnce": "rw1"}
DESC = None                     # the whole description: the inspect tab shows it
# Reading changes these too, though the SVD has no readAction: said in the text,
# or a data register that pops a FIFO.
CHANGES = re.compile(r"read(ing)? (this register )?(to )?clear|clear(ed|s)? (on|by|upon) (a )?read"
                     r"|read.{0,40}pops|pop(s|ped)? .{0,30}read", re.I)
POPS = re.compile(r"DATA_CMD$|(^|_)DR$|FIFO", re.I)

def num(t):
    return int(t, 0) if t else 0

def text(el, tag):
    return re.sub(r"\s+", " ", el.findtext(tag) or "").strip()

def bits(f):
    r = f.findtext("bitRange")
    if r:
        hi, lo = map(int, r.strip("[]").split(":"))
        return lo, hi - lo + 1
    if f.findtext("lsb") is not None:
        lo = num(f.findtext("lsb"))
        return lo, num(f.findtext("msb")) - lo + 1
    return num(f.findtext("bitOffset")), num(f.findtext("bitWidth")) or 1

def fields(reg):
    out = []
    for f in reg.iter("field"):
        lo, w = bits(f)
        enums = {}
        for ev in f.iter("enumeratedValue"):
            v = ev.findtext("value")
            if v is not None and not ev.findtext("isDefault"):
                try:
                    enums[str(int(v.replace("#", "0b"), 0))] = ev.findtext("name")
                except ValueError:
                    pass
        w1c = (f.findtext("modifiedWriteValues") or "") in ("oneToClear", "zeroToClear", "clear")
        out.append([f.findtext("name"), lo, w, ACC.get(f.findtext("access") or "", ""),
                    text(f, "description")[:DESC], enums, 1 if w1c else 0])
    return sorted(out, key=lambda x: -x[1])

def main():
    svd, out = sys.argv[1], sys.argv[2]
    dev = ET.parse(svd).getroot()
    per = {p.findtext("name"): p for p in dev.iter("peripheral")}
    keep = {f[:-4] for f in os.listdir(sys.argv[3])} if len(sys.argv) > 3 else None
    res, nregs, nfields = {}, 0, 0
    for pname, p in sorted(per.items()):
        if keep is not None and pname not in keep:
            continue
        src = per[p.get("derivedFrom")] if p.get("derivedFrom") else p
        regs = []
        rnode = src.find("registers")
        for r in (rnode if rnode is not None else []):
            if r.tag != "register":
                continue
            f = fields(r)
            ra = r.findtext("readAction") or any(x.findtext("readAction") for x in r.iter("field"))
            whole = (r.findtext("description") or "") + " ".join(x.findtext("description") or "" for x in r.iter("field"))
            ra = ra or CHANGES.search(whole) or POPS.search(r.findtext("name"))
            e = {"n": re.sub(r"\[%s\]|%s", "", r.findtext("name")), "o": num(r.findtext("addressOffset")),
                 "d": text(r, "description")[:DESC], "a": ACC.get(r.findtext("access") or "", ""),
                 "r": num(r.findtext("resetValue")), "f": f}
            if ra:
                e["ra"] = 1
            regs.append(e)
            nregs += 1
            nfields += len(f)
        res[pname] = {"base": num(p.findtext("baseAddress")),
                      "desc": text(p, "description")[:DESC] or text(src, "description")[:DESC],
                      "regs": sorted(regs, key=lambda r: r["o"])}
    with open(out, "w", newline="\n") as fh:   # LF on Windows too
        json.dump(res, fh, separators=(",", ":"))
    print(f"svd2json: {len(res)} peripherals, {nregs} registers, {nfields} fields -> {out}")

if __name__ == "__main__":
    main()

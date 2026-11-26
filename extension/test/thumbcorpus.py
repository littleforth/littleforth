"""thumbcorpus.py OUT - the code in our kernel images as runs of consecutive
instructions (data in between left out), each with the text arm-none-eabi-objdump
gives it in raw-binary mode, as the debugger's listing used it. The built-in
decoder (src/thumbdis.js) must give the same text (test/thumbdis.test.js).
Out: [[address, hex bytes of the run, [[address, text], ...]], ...]"""
import glob, json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECTIONS = (".text", ".ram_image", ".boot")      # where each build keeps its code

def images():
    """(elf, section) for every Thumb-2 kernel in build/ (ARMv6-M ones left out)."""
    out = []
    for elf in sorted(glob.glob(os.path.join(ROOT, "build", "*.elf"))):
        arch = subprocess.run(["arm-none-eabi-readelf", "-A", elf], capture_output=True, text=True).stdout
        if "v6S-M" in arch or "v6-M" in arch: continue
        secs = subprocess.run(["arm-none-eabi-objdump", "-h", elf], capture_output=True, text=True).stdout.split()
        out += [(elf, s) for s in SECTIONS if s in secs]
    return out
ROW = re.compile(r"^\s*([0-9a-f]+):\s+((?:[0-9a-f]{4} ?)+)\s+(.*)$")

def rows(text):
    out = {}
    for l in text.splitlines():
        m = ROW.match(l)
        if m: out[int(m.group(1), 16)] = (m.group(2).replace(" ", ""), re.sub(r"\s+", " ", m.group(3)).strip())
    return out

def main():
    runs = []
    for elf, sec in images():
        lst = subprocess.run(["arm-none-eabi-objdump", "-D", "-j", sec, elf], capture_output=True, text=True).stdout
        vma = int(re.search(r"Disassembly of section %s:\s*\n\s*([0-9a-f]+)" % re.escape(sec), lst).group(1), 16)
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f: tmp = f.name
        subprocess.run(["arm-none-eabi-objcopy", "-O", "binary", "-j", sec, elf, tmp], check=True)
        data = open(tmp, "rb").read()
        raw = subprocess.run(["arm-none-eabi-objdump", "-D", "-b", "binary", "-m", "arm", "-M", "force-thumb", "--adjust-vma=%#x" % vma, tmp], capture_output=True, text=True).stdout
        os.unlink(tmp)
        code, binm = rows(lst), rows(raw)
        run = None
        for a, (hx, ins) in sorted(code.items()):
            good = not ins.startswith(".") and a in binm and binm[a][0] == hx
            if good and run and run[-1] == a:
                run[2].append([a, binm[a][1]]); run[-1] = a + len(hx) // 2
            elif good:
                run = [a, None, [[a, binm[a][1]]], a + len(hx) // 2]; runs.append(run)
            else:
                run = None
        for r in runs:
            if r[1] is None: r[1] = data[r[0] - vma:r[3] - vma].hex()
    out = [[r[0], r[1], r[2]] for r in runs]
    json.dump(out, open(sys.argv[1], "w"), separators=(",", ":"))
    print(f"{len(out)} runs, {sum(len(r[2]) for r in out)} instructions")

main()

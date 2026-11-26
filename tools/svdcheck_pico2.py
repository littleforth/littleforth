#!/usr/bin/env python3
"""svdcheck_pico2.py PICO_SDK - check board/pico2.c and tools/uf2.py against the
Raspberry Pi Pico SDK: register addresses, bit positions and values against
RP2350.svd; the IMAGE_DEF block, ROM function codes, alias offset, PLL
defaults and UF2 constants against the SDK headers. Exit 1 on any mismatch."""
import os, re, sys, xml.etree.ElementTree as ET

SDK = sys.argv[1]
svd = ET.parse(os.path.join(SDK, "src/rp2350/hardware_regs/RP2350.svd")).getroot()
per = {p.findtext("name"): p for p in svd.iter("peripheral")}
bad = 0

def say(ok, text):
    global bad
    bad += not ok
    print(("ok  " if ok else "BAD ") + text)

def num(t): return int(t, 0)
def reg(pn, rn):
    p = per[pn]; src = per[p.get("derivedFrom")] if p.get("derivedFrom") else p
    return num(p.findtext("baseAddress")), [r for r in src.iter("register") if r.findtext("name") == rn][0]
def field(r, fn):
    f = [f for f in r.iter("field") if f.findtext("name") == fn][0]
    br = f.findtext("bitRange")
    lsb = num(f.findtext("bitOffset")) if f.findtext("bitOffset") else int(br.strip("[]").split(":")[1])
    return f, lsb

ADDR = [  # (peripheral, register, address used)
    ("RESETS", "RESET", 0x40020000), ("RESETS", "RESET_DONE", 0x40020008),
    ("CLOCKS", "CLK_REF_CTRL", 0x40010030), ("CLOCKS", "CLK_REF_SELECTED", 0x40010038),
    ("CLOCKS", "CLK_SYS_CTRL", 0x4001003C), ("CLOCKS", "CLK_SYS_SELECTED", 0x40010044),
    ("CLOCKS", "CLK_PERI_CTRL", 0x40010048), ("CLOCKS", "CLK_REF_DIV", 0x40010034),
    ("PPB", "VTOR", 0xE000ED08), ("PPB", "AIRCR", 0xE000ED0C),
    ("PPB", "NVIC_ISER0", 0xE000E100), ("PPB", "NVIC_ICER0", 0xE000E180),
    ("XOSC", "CTRL", 0x40048000), ("XOSC", "STATUS", 0x40048004), ("XOSC", "STARTUP", 0x4004800C),
    ("PLL_SYS", "CS", 0x40050000), ("PLL_SYS", "PWR", 0x40050004), ("PLL_SYS", "FBDIV_INT", 0x40050008),
    ("PLL_SYS", "PRIM", 0x4005000C),
    ("IO_BANK0", "GPIO0_CTRL", 0x40028004), ("IO_BANK0", "GPIO1_CTRL", 0x4002800C),
    ("PADS_BANK0", "GPIO0", 0x40038004), ("PADS_BANK0", "GPIO1", 0x40038008),
    ("UART0", "UARTDR", 0x40070000), ("UART0", "UARTFR", 0x40070018), ("UART0", "UARTIBRD", 0x40070024),
    ("UART0", "UARTFBRD", 0x40070028), ("UART0", "UARTLCR_H", 0x4007002C), ("UART0", "UARTCR", 0x40070030),
    ("UART0", "UARTIMSC", 0x40070038), ("UART0", "UARTICR", 0x40070044),
]
BITS = [  # (peripheral, register, field, bit position used)
    ("RESETS", "RESET", "IO_BANK0", 6), ("RESETS", "RESET", "PADS_BANK0", 9),
    ("RESETS", "RESET", "PLL_SYS", 14), ("RESETS", "RESET", "UART0", 26),
    ("XOSC", "STATUS", "STABLE", 31), ("XOSC", "CTRL", "ENABLE", 12), ("XOSC", "CTRL", "FREQ_RANGE", 0),
    ("CLOCKS", "CLK_SYS_CTRL", "SRC", 0), ("CLOCKS", "CLK_SYS_CTRL", "AUXSRC", 5),
    ("CLOCKS", "CLK_REF_CTRL", "SRC", 0), ("CLOCKS", "CLK_REF_DIV", "INT", 16),
    ("CLOCKS", "CLK_PERI_CTRL", "ENABLE", 11), ("CLOCKS", "CLK_PERI_CTRL", "AUXSRC", 5),
    ("PLL_SYS", "CS", "LOCK", 31), ("PLL_SYS", "PWR", "PD", 0), ("PLL_SYS", "PWR", "VCOPD", 5),
    ("PLL_SYS", "PWR", "POSTDIVPD", 3), ("PLL_SYS", "PRIM", "POSTDIV1", 16), ("PLL_SYS", "PRIM", "POSTDIV2", 12),
    ("PLL_SYS", "FBDIV_INT", "FBDIV_INT", 0),
    ("PADS_BANK0", "GPIO0", "ISO", 8), ("PADS_BANK0", "GPIO0", "OD", 7), ("PADS_BANK0", "GPIO1", "IE", 6),
    ("PADS_BANK0", "GPIO1", "ISO", 8),
    ("UART0", "UARTFR", "RXFE", 4), ("UART0", "UARTFR", "TXFF", 5), ("UART0", "UARTLCR_H", "WLEN", 5),
    ("UART0", "UARTLCR_H", "FEN", 4), ("UART0", "UARTCR", "UARTEN", 0), ("UART0", "UARTCR", "TXE", 8),
    ("UART0", "UARTCR", "RXE", 9), ("UART0", "UARTIMSC", "RXIM", 4), ("UART0", "UARTIMSC", "RTIM", 6),
    ("UART0", "UARTICR", "RTIC", 6),
]
ENUMS = [  # (peripheral, register, field, enumerated value name, value used)
    ("XOSC", "CTRL", "FREQ_RANGE", "1_15MHZ", 0xAA0), ("XOSC", "CTRL", "ENABLE", "ENABLE", 0xFAB),
    ("CLOCKS", "CLK_REF_CTRL", "SRC", "xosc_clksrc", 2),
    ("CLOCKS", "CLK_SYS_CTRL", "SRC", "clk_ref", 0), ("CLOCKS", "CLK_SYS_CTRL", "SRC", "clksrc_clk_sys_aux", 1),
    ("CLOCKS", "CLK_SYS_CTRL", "AUXSRC", "clksrc_pll_sys", 0), ("CLOCKS", "CLK_PERI_CTRL", "AUXSRC", "clk_sys", 0),
    ("IO_BANK0", "GPIO0_CTRL", "FUNCSEL", "uart0_tx", 2), ("IO_BANK0", "GPIO1_CTRL", "FUNCSEL", "uart0_rx", 2),
]

for pn, rn, used in ADDR:
    b, r = reg(pn, rn); a = b + num(r.findtext("addressOffset"))
    say(a == used, f"{pn}.{rn:17} used 0x{used:08X}  svd 0x{a:08X}")
for pn, rn, fn, used in BITS:
    _, lsb = field(reg(pn, rn)[1], fn)
    say(lsb == used, f"{pn}.{rn}.{fn:12} bit used {used}  svd {lsb}")
for pn, rn, fn, en, used in ENUMS:
    f, _ = field(reg(pn, rn)[1], fn)
    v = [num(e.findtext("value")) for e in f.iter("enumeratedValue") if e.findtext("name") == en]
    say(v == [used], f"{pn}.{rn}.{fn} {en:20} used 0x{used:X}  svd {[hex(x) for x in v]}")
irqs = {i.findtext("name"): num(i.findtext("value")) for i in svd.iter("interrupt")}
say(irqs.get("UART0_IRQ") == 33, f"UART0_IRQ used 33  svd {irqs.get('UART0_IRQ')}")
say(max(irqs.values()) + 1 == 52, f"NIRQ used 52  svd {max(irqs.values()) + 1}")

def hdr(path):
    txt = open(os.path.join(SDK, path)).read()
    return {m.group(1): m.group(2) for m in re.finditer(r"#define\s+(\w+)\s+(.+?)\s*(?://.*)?$", txt, re.M)}
def ev(expr, d, depth=0):
    expr = re.sub(r"_u\(([^)]*)\)", r"(\1)", expr)
    for _ in range(10):
        new = re.sub(r"\b([A-Z_][A-Z0-9_]*)\b", lambda m: "(" + d[m.group(1)] + ")" if m.group(1) in d else m.group(1), expr)
        new = re.sub(r"_u\(([^)]*)\)", r"(\1)", new)
        if new == expr: break
        expr = new
    expr = re.sub(r"\b(0x[0-9a-fA-F]+|\d+)[uU][lL]*\b", r"\1", expr)
    return eval(expr, {"__builtins__": {}}, {})

pb = hdr("src/common/boot_picobin_headers/include/boot/picobin.h")
itype = ev("PICOBIN_IMAGE_TYPE_IMAGE_TYPE_EXE << PICOBIN_IMAGE_TYPE_IMAGE_TYPE_LSB | "
           "PICOBIN_IMAGE_TYPE_EXE_SECURITY_S << PICOBIN_IMAGE_TYPE_EXE_SECURITY_LSB | "
           "PICOBIN_IMAGE_TYPE_EXE_CPU_ARM << PICOBIN_IMAGE_TYPE_EXE_CPU_LSB | "
           "PICOBIN_IMAGE_TYPE_EXE_CHIP_RP2350 << PICOBIN_IMAGE_TYPE_EXE_CHIP_LSB", pb)
block = [ev("PICOBIN_BLOCK_MARKER_START", pb),
         ev("PICOBIN_BLOCK_ITEM_1BS_IMAGE_TYPE", pb) | 1 << 8 | itype << 16,
         ev("PICOBIN_BLOCK_ITEM_2BS_LAST", pb) | 1 << 8, 0, ev("PICOBIN_BLOCK_MARKER_END", pb)]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "board", "pico2.c")).read()
used = [num(x) for x in re.search(r"boot_block\[5\] =\s*\{([^}]*)\}", src).group(1).split(",")]
say(used == block, "IMAGE_DEF used " + " ".join(f"{x:08X}" for x in used) + "  sdk " + " ".join(f"{x:08X}" for x in block))

bc = hdr("src/rp2_common/boot_bootrom_headers/include/boot/bootrom_constants.h")
say(ev("BOOTROM_FUNC_TABLE_OFFSET", bc) + 2 == 0x16, "ROM table lookup pointer used 0x16  sdk 0x%X" % (ev("BOOTROM_FUNC_TABLE_OFFSET", bc) + 2))
say(ev("RT_FLAG_FUNC_ARM_SEC", bc) == 4, "RT_FLAG_FUNC_ARM_SEC used 0x4  sdk 0x%X" % ev("RT_FLAG_FUNC_ARM_SEC", bc))
for name, code in [("CONNECT_INTERNAL_FLASH", "IF"), ("FLASH_EXIT_XIP", "EX"), ("FLASH_RANGE_ERASE", "RE"),
                   ("FLASH_RANGE_PROGRAM", "RP"), ("FLASH_FLUSH_CACHE", "FC"), ("FLASH_ENTER_CMD_XIP", "CX")]:
    m = re.search(r"ROM_FUNC_%s\s+ROM_TABLE_CODE\('(.)', '(.)'\)" % name, open(os.path.join(SDK, "src/rp2_common/boot_bootrom_headers/include/boot/bootrom_constants.h")).read())
    say(m and m.group(1) + m.group(2) == code, f"ROM_FUNC_{name:22} used '{code}'  sdk '{m.group(1) + m.group(2) if m else '?'}'")
am = hdr("src/rp2350/hardware_regs/include/hardware/regs/addressmap.h")
say(ev("REG_ALIAS_CLR_BITS", am) == 0x3000, "REG_ALIAS_CLR_BITS used 0x3000  sdk 0x%X" % ev("REG_ALIAS_CLR_BITS", am))
cl = open(os.path.join(SDK, "src/rp2_common/hardware_clocks/include/hardware/clocks.h")).read()
say("(1500 * MHZ)" in cl and re.search(r"#else\s*\n#define PLL_SYS_POSTDIV1\s+5", cl) and re.search(r"#define PLL_SYS_POSTDIV2\s+2", cl),
    "PLL for 150 MHz used VCO 1500 MHz (12 MHz x 125), /5, /2  sdk the same")
u = hdr("src/common/boot_uf2_headers/include/boot/uf2.h")
uf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uf2.py")).read()
for sdk_name, ours in [("UF2_MAGIC_START0", "MAGIC0"), ("UF2_MAGIC_START1", "MAGIC1"), ("UF2_MAGIC_END", "MAGIC_END"),
                       ("UF2_FLAG_FAMILY_ID_PRESENT", "FAMILY_PRESENT"), ("UF2_FLAG_EXTENSION_FLAGS_PRESENT", "EXT_PRESENT"),
                       ("RP2350_ARM_S_FAMILY_ID", "RP2350_ARM_S"), ("ABSOLUTE_FAMILY_ID", "ABSOLUTE"),
                       ("UF2_EXTENSION_RP2_IGNORE_BLOCK", "RP2_IGNORE_BLOCK")]:
    names = re.findall(r"^([A-Z0-9_, ]+)=\s*(.+)$", uf, re.M)
    vals = {}
    for lhs, rhs in names:
        for n, v in zip([x.strip() for x in lhs.split(",")], [x.strip() for x in rhs.split(",")]):
            vals[n] = v
    say(num(vals[ours]) == ev(sdk_name, u), f"uf2.py {ours:16} 0x{num(vals[ours]):08X}  sdk {sdk_name} 0x{ev(sdk_name, u):08X}")
# values written by board/pico2.c that the SDK sets the same way (bug 8: the
# boot ROM leaves CLK_REF_DIV at 4, so it must be written)
xo = open(os.path.join(SDK, "src/rp2_common/hardware_xosc/xosc.c")).read() if os.path.exists(os.path.join(SDK, "src/rp2_common/hardware_xosc/xosc.c")) else ""
mult = re.search(r"#define PICO_XOSC_STARTUP_DELAY_MULTIPLIER\s+(\d+)", open(os.path.join(SDK, "src/rp2_common/hardware_xosc/include/hardware/xosc.h")).read())
sdk_startup = ((12000 + 128) // 256) * int(mult.group(1))
for pat, why in [(r"R\(XOSC \+ 0x0C\) = %d;" % sdk_startup, f"XOSC STARTUP = {sdk_startup} (SDK formula, multiplier {mult.group(1)})"),
                 (r"R\(CLOCKS \+ 0x34\) = 1u << 16;", "CLK_REF_DIV written to 1 (SDK clock_configure_undivided)")]:
    say(re.search(pat, src) is not None, "pico2.c writes " + why)
print("svdcheck_pico2:", "PASS" if not bad else f"FAIL ({bad})")
sys.exit(1 if bad else 0)

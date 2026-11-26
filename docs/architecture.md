# How it works

How littleFORTH is put together. For building it, see
[building.md](building.md).

## 1. The model

A native-code Forth. The kernel is C (under 8 KB of Thumb) plus a code
generator. Words you define are compiled to Thumb-2 machine code, not threaded.

- Top of stack in r6, data stack pointer in r5 (full descending), reserved
  for the whole program (`-ffixed-r6 -ffixed-r5`), so C words and compiled
  code share them with no glue (`src/forth.h`).
- The return stack is the hardware stack (sp). A colon definition is
  `push {lr} ... pop {pc}`; words call each other with `BL`.
- The code generator is `src/cg_thumb.c` (Thumb-2: Cortex-M4, M33).
  `src/cg_token.c` is the host build's stand-in, for testing on a PC.
- The host build runs the same kernel over an array `M`; `P()`/`A()` convert
  between Forth addresses and C pointers.

## 2. Memory map: Pico 2 (RP2350, 4 MB flash, 512 KB SRAM)

```
FLASH (XIP)                              SRAM
0x1040_0000 +--------------------+       0x2008_0000 +--------------------+ <- sp
            | SAVE area 128 KB   |                   | return stack       |
0x103E_0000 +--------------------+                   |  (grows down)      |
            | register table     |                   |   ...  free ...    |
0x1038_0000 +--------------------+       0x2001_24F8 +--------------------+
            |                    |                   | rx ring, data stack|
            | (free)             |       0x2001_2114 | struct sys         |
            |                    |                   +--------------------+
            +--------------------+                   | dictionary 64 KB   |
            | boot image: stub + |                   | HERE grows up ^    |
            | kernel to copy     |       0x2000_2114 +--------------------+
0x1000_0000 +--------------------+                   | kernel ~8 KB       |
                                         0x2000_0000 | copied from flash  |
                  stub copies kernel ------------>   | at boot            |
                                                     +--------------------+
```

At boot a stub copies the kernel into SRAM, and it runs from there: every
call, from your words to the kernel's, is a plain `BL`.

`lib/rp2350/drivers/kernel.fth` gives Forth these addresses (`DICT0`,
`SAVE-AREA`, `'HERE`, ...); it is generated from the build and checked by
`make check`.

## 3. Why words are compiled into RAM

The compiler writes code as you type: it lays down instructions, then patches
branch offsets when `THEN`/`REPEAT` arrive, drops literals into the code,
and `FORGET` or a redefinition just moves HERE. That needs memory written a
byte at a time. Flash is erased a page at a time, stalls the CPU while it
programs, and wears. So the dictionary is RAM, and `SAVE` copies it to flash.

## 4. A word in the dictionary

```
            +----------+-----------+---------------+-----+---------------------+
  header -> | link  4B | len|flags | name  len B   | pad | Thumb code ...      |
            +----------+-----------+---------------+-----+---------------------+
                 |        bit 7 IMMEDIATE                ^
                 |        bit 6 hidden                   xt = this address | 1
                 v        bits 0-4 length
            previous header ... -> 0          LATEST -> newest header
```

- link: the previous header; LATEST is the newest. Flags: 0x80 IMMEDIATE,
  0x40 hidden (being defined), low 5 bits the length (names 1-31 characters).
- The xt is the code's address with the Thumb bit set (`xt_of`).
- Headers and code are interleaved: one region, one pointer (HERE).

## 5. Calls

`BL` reaches ±16 MB. On the Pico 2 the kernel and the dictionary are both in
SRAM, so every call is a plain `BL`. Small builtins flagged inline in
`src/wordlist.h` are copied into the caller instead of called. A call out of
reach is refused with `?-21` (`cg_call`).

## 6. SAVE and boot

```
   SAVE                                   boot
 RAM dictionary ----copy----> SAVE area ----copy----> RAM dictionary
 (same addresses)            magic last              runs from RAM again
```

`SAVE` copies the whole RAM dictionary (plus HERE and LATEST) to the SAVE
area; the magic word is written last, so an interrupted SAVE leaves no
image. At boot the image is copied back to the same RAM addresses and the
code runs from RAM again: nothing is relocated. The magic includes the kernel
build's ID (a hash of what the build is made from), so a new kernel ignores an
image saved by another. On the Pico 2 the flash writing is Forth
(`lib/save.fth`, `lib/rp2350/drivers/flash.fth`).

A saved program costs its full size in RAM, always.

## 7. Looking up a token

```
 token --> RAM dictionary --> builtins --> register table --> number --> ?-13
           (newest first)                  UART0, UART0.UARTDR,
                                           UART1.EMIT -> UART.EMIT
```

`interpret` tries, in order:

1. The RAM dictionary (newest first), then the builtins (`find`).
2. The register table (`reg`).
3. A number.

So your words shadow builtins, and both shadow registers.

## 8. The register table

Generated on the PC from the chip's SVD file (`tools/svd2forth.py` →
`lib/rp2350/registers/*.fth` → `tools/regtable.py` → `build/rp2350.tbl`) and
flashed beside the kernel, at 0x1038_0000. 35 KB for the RP2350's 54
peripherals and 3,033 registers; it takes no dictionary space.

```
 "RTB3"
 instances                                    types
 +-------+--------+------+------------+       +------+--------+-----------------------+
 | len 5 | UART0  | type | 4007_0000  |--+--> | len 4| UART   | 6 UARTDR 000000 ...  0|
 | len 5 | UART1  | type | 4007_8000  |--+    +------+--------+-----------------------+
 +-------+--------+------+------------+       | len 3| SPI    | 6 SSPCR0 000000 ...  0|
 | len 4 | SPI0   | type | 4008_0000  |--+--> +------+--------+-----------------------+
 | len 4 | SPI1   | type | 4008_8000  |--+
 | 0                                  |
 +------------------------------------+
   u16 offset to the type                     member: len, name, u24 offset; 0 ends
```

- `UART0` gives the base; `UART0.UARTDR` gives base + offset.
- `UART1.WORD` with no such member: finds the dictionary word `UART.WORD`
  and calls it with UART1's base on the stack. This is how one driver serves
  every instance: `UART1.EMIT` runs `UART.EMIT`.
- Peripherals with the same layout share one type. A type is the SVD's
  groupName (through derivedFrom), else the instance name less trailing digits.
- A table whose version byte isn't '3' (erased flash, an old build) is ignored.

The register files in `lib/rp2350/registers/` can also be loaded, one per
peripheral: each register becomes a constant in the dictionary, found before
the table.

## 9. Testing

`make check` boots the real kernel under QEMU, on an MPS2 AN386 (Cortex-M4)
and an MPS2 AN505 (Cortex-M33, the RP2350's core), and runs the Forth test
files on each, the CORE tests among them. The host build runs them too.
QEMU does not emulate the RP2350, so the Pico 2 itself is tested on the board.

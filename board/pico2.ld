/* Raspberry Pi Pico 2 (RP2350): 4 MB external flash at 0x10000000, last
   128 KB kept for SAVE; 520 KB SRAM at 0x20000000. Only the boot part (vector
   pair, IMAGE_DEF block, copy stub) runs from flash; everything else is
   linked to run in SRAM and copied there by the stub. */
MEMORY {
    flash (rx)  : ORIGIN = 0x10000000, LENGTH = 4M - 128K
    ram   (rwx) : ORIGIN = 0x20000000, LENGTH = 512K
}
SECTIONS {
    .boot : { KEEP(*(.boot_vec)) KEEP(*(.boot_block)) *(.boot_text*) . = ALIGN(4); } > flash
    .vtab (NOLOAD) : { KEEP(*(.vtab)) . = ALIGN(4); } > ram
    .ram_image : { _ram_start = .; *(SORT_BY_ALIGNMENT(.text*)) *(SORT_BY_ALIGNMENT(.rodata*)) *(.data*) . = ALIGN(4); _ram_end = .; } > ram AT > flash
    _ram_lma = LOADADDR(.ram_image);
    .bss (NOLOAD) : { _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > ram
    _estack = ORIGIN(ram) + LENGTH(ram);
    ASSERT(ADDR(.boot) + SIZEOF(.boot) <= 0x10001000, "IMAGE_DEF must be in the first 4 KB")
    ASSERT(ADDR(.vtab) % 512 == 0, "vector table must be 512-byte aligned")
    /DISCARD/ : { *(.ARM.exidx*) *(.comment) }
}
INCLUDE pico2-bioff.ld

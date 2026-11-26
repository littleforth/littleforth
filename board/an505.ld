/* mps2-an505 under QEMU (Cortex-M33, secure): SSRAM1 at 0x10000000 stands in for
   flash; data starts 1 MB above it, inside BL range of the kernel. */
MEMORY {
    flash (rx)  : ORIGIN = 0x10000000, LENGTH = 1M
    ram   (rwx) : ORIGIN = 0x10100000, LENGTH = 2M
}
SECTIONS {
    .text : { KEEP(*(.vectors)) *(SORT_BY_ALIGNMENT(.text*)) *(SORT_BY_ALIGNMENT(.rodata*)) . = ALIGN(4); } > flash
    _sidata = LOADADDR(.data);
    .data : { _sdata = .; *(.data*) . = ALIGN(4); _edata = .; } > ram AT > flash
    .bss (NOLOAD) : { _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > ram
    _estack = ORIGIN(ram) + LENGTH(ram);
    /DISCARD/ : { *(.ARM.exidx*) *(.comment) }
}
INCLUDE an505-bioff.ld

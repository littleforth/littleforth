/* mps2-an386 under QEMU: 4 MB of RAM at 0 stands in for flash; the image is
   loaded there by -kernel. RAM for data starts at 1 MB, inside BL range. */
MEMORY {
    flash (rx)  : ORIGIN = 0x00000000, LENGTH = 1M
    ram   (rwx) : ORIGIN = 0x00100000, LENGTH = 3M
}
SECTIONS {
    .text : { KEEP(*(.vectors)) *(SORT_BY_ALIGNMENT(.text*)) *(SORT_BY_ALIGNMENT(.rodata*)) . = ALIGN(4); } > flash
    _sidata = LOADADDR(.data);
    .data : { _sdata = .; *(.data*) . = ALIGN(4); _edata = .; } > ram AT > flash
    .bss (NOLOAD) : { _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > ram
    _estack = ORIGIN(ram) + LENGTH(ram);
    /DISCARD/ : { *(.ARM.exidx*) *(.comment) }
}
INCLUDE mps2-bioff.ld

\ kernel.fth - addresses in the pico2 kernel, made by tools/kernel_fth.py
\ from the build. Do not edit: rebuild the kernel and run the tool again.
$20002104 CONSTANT DICT0      \ start of the dictionary
$103E0000 CONSTANT SAVE-AREA  \ where SAVE writes; the kernel reads it back at boot
$00020000 CONSTANT SAVE-SIZE  \ its size in bytes
$2001211C CONSTANT 'HERE      \ the kernel's HERE
$20012120 CONSTANT 'LATEST    \ the newest word's header
$36022F78 CONSTANT STAMP      \ the kernel build's ID, in SAVE's magic
$00000000 CONSTANT BLOCKS     \ the library block's header, 0: none
$20012130 CONSTANT 'BLKTAB    \ the block's name table that find searches, 0: none
$20000000 CONSTANT KBASE      \ a block's name table holds xt less KBASE
$20002020 CONSTANT 'IRQS      \ IRQ!'s table of xts
$00000034 CONSTANT #IRQS      \ its length in cells

# an505.mk - QEMU's MPS2 AN505 (Cortex-M33, the RP2350's core), the M33 test board.
BUILDS += build/an505.elf
SRC_an505 := src/cg_thumb.c board/cortexm.c board/an505.c board/an505.ld board/cmsdk.h board/an505.mk
KBASE_an505 := 0x10000000
BIOFF_an505 := -DFORTH_SAVE
FLAGS_an505 := -mcpu=cortex-m33 -DFORTH_SAVE -DECHO=0 -DNIRQ=64 -DREGTABLE=0x10080000u -DDICT_SIZE=65536
STAMP_an505 := $(call stampof,$(SRC_an505))

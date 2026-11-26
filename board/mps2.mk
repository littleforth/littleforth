# mps2.mk - QEMU's MPS2 AN386 (Cortex-M4), the Thumb-2 test board. It runs RAM
# code through QEMU's mirror of SSRAM1 at 0x00400000 (CODE_ALIAS) and has the
# interrupt shim, so those code paths are exercised under test.
BUILDS += build/mps2.bin
SRC_mps2 := src/cg_thumb.c board/cortexm.c board/mps2.c board/mps2.ld board/cmsdk.h board/mps2.mk
KBASE_mps2 := 0
FLAGS_mps2 := -DECHO=0 -DCODE_ALIAS=0x00400000u -DNIRQ=32 -DREGTABLE=0x00080000u
STAMP_mps2 := $(call stampof,$(SRC_mps2))

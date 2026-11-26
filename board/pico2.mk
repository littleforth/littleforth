# pico2.mk - the RP2350 (Cortex-M33) on the Raspberry Pi Pico 2 and Pico 2 W.
# Own startup (boot block, copy to SRAM), no cortexm.c. --param=min-pagesize=0:
# the boot ROM's table pointer is at address 0x16, which GCC otherwise takes for
# a null-pointer access.
BUILDS += build/pico2.uf2
DIST += build/pico2.uf2 build/rp2350.tbl
FIRMWARE += build/pico2.uf2
SRC_pico2 := src/cg_thumb.c board/pico2.c board/pico2.ld board/pico2.mk
KBASE_pico2 := 0x20000000
BIOFF_pico2 := -DFORTH_SAVE
FLAGS_pico2 := -mcpu=cortex-m33 -DFORTH_SAVE -DNIRQ=52 -DREGTABLE=0x10380000u -DDICT_SIZE=65536 -DFLASH_AREA_SIZE=131072 --param=min-pagesize=0
STAMP_pico2 := $(call stampof,$(SRC_pico2))

build/pico2.uf2: build/pico2.bin build/rp2350.tbl tools/uf2.py
	python3 -I tools/uf2.py $< $@ build/rp2350.tbl@0x10380000

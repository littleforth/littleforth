# The name is a variable; nothing else depends on it.
NAME   ?= littleFORTH
HOSTCC ?= gcc
ARM    ?= arm-none-eabi-

KSRC   := $(filter-out src/cg_%.c,$(wildcard src/*.c))
# STAMP: a kernel build's ID, one per build. A SAVE image (and a library block)
# carries it in its magic, so it is never used with a kernel it wasn't made for.
# A hash of what that build is made from: the shared kernel sources and headers,
# this Makefile, the build's own files (SRC_<id>, its board/<id>.mk among them)
# and the compiler. Same inputs, same stamp, whichever other boards are present.
# build/<id>.stamp changes only when the stamp does, and the build depends on it.
stampof = 0x$(shell { cat $(sort $(KSRC) $(wildcard src/*.h) board/bioff.ld.in $(1)) Makefile; $(ARM)gcc --version; } 2>/dev/null | sha256sum | cut -c1-8)
HDR    := $(wildcard src/*.h)
TFLAGS := -mcpu=cortex-m4 -mthumb -Os -std=gnu11 -ffreestanding -nostdlib -fno-builtin \
          -ffunction-sections -fdata-sections -ffixed-r6 -ffixed-r5 -fno-ipa-icf \
          -Wall -Wextra -DFORTH_NAME='"$(NAME)"' -Isrc
HFLAGS := -O2 -g -std=gnu11 -Wall -Wextra -DHOST -DECHO=0 -DFORTH_NAME='"$(NAME)"' -Isrc

.PHONY: all check check-kernel check-vscode check-quick clean
.SECONDARY:
.SECONDEXPANSION:
.DEFAULT_GOAL := all

# The boards: one board/<id>.mk each. A fragment adds its images to BUILDS, its
# release files to DIST and the extension's firmware to FIRMWARE, and sets for
# the generic rules below: SRC_<id> (its own files), FLAGS_<id>, KBASE_<id>,
# BIOFF_<id>, LIBS_<id>, STAMP_<id>.
BUILDS :=
DIST :=
FIRMWARE :=
include $(sort $(wildcard board/*.mk))

all: build/host $(BUILDS)

# the host build: the token code generator (reference and tests)
SRC_host := src/cg_token.c board/host.c
STAMP_host := $(call stampof,$(SRC_host))
build/host: $(KSRC) $(SRC_host) $(HDR) build/host.stamp | build
	$(HOSTCC) $(HFLAGS) -DSTAMP=$(STAMP_host)u -o $@ $(filter %.c,$^)

# a board's kernel: the shared sources, then its own (SRC_<id>)
build/%.elf: $(KSRC) $$(SRC_$$*) build/%-bioff.ld $(HDR) build/%.stamp | build
	$(ARM)gcc $(TFLAGS) $(FLAGS_$*) -DSTAMP=$(STAMP_$*)u -DKBASE=$(KBASE_$*) -T board/$*.ld -Lbuild -Wl,--gc-sections -Wl,-Map,build/$*.map -o $@ $(filter %.c,$^) $(LIBS_$*)

# each builtin's address as an offset from KBASE, where the board's kernel code is linked
build/%-bioff.ld: board/bioff.ld.in src/wordlist.h | build
	$(ARM)cpp -P -Isrc -DKBASE=$(KBASE_$*) $(BIOFF_$*) $< -o $@

# A12: a register table per chip, from its register files (lib/<chip>/registers)
build/%.tbl: tools/regtable.py $$(wildcard lib/$$*/registers/*.fth) | build
	python3 -I tools/regtable.py lib/$*/registers $@

build/%.bin: build/%.elf
	$(ARM)objcopy -O binary $< $@

build/%.hex: build/%.elf
	$(ARM)objcopy -O ihex $< $@

build:
	mkdir -p build

build/%.stamp: FORCE | build
	@echo '$(STAMP_$*)' | cmp -s - $@ || echo '$(STAMP_$*)' > $@
FORCE:
.PHONY: FORCE

check:
	@tools/check.sh all

check-kernel:
	@tools/check.sh kernel

check-vscode:
	@tools/check.sh vscode

check-quick:
	@tools/check.sh quick

clean:
	rm -rf build

# dist/: what goes on a board or into VS Code, for a release (not in git): each
# board's DIST, and the extension with every board's FIRMWARE (extension/tools/firmware.js).
VSIX = build/littleforth-$(shell node -p "require('./extension/package.json').version").vsix
dist: $(DIST) $(FIRMWARE)
	sh tools/package-extension.sh >/dev/null
	mkdir -p dist && rm -f dist/*.vsix
	cp $(DIST) $(VSIX) dist/
.PHONY: dist

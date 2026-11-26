#!/bin/sh
# sizegate.sh ELF BIN - T1 and T7 for one target image.
# T1: the flash image (BIN: vector table to the end of .data's load copy) < 8192 B (A11).
# T7: RAM = .data + .bss minus the dictionary arena (symbol ram_dict) < 2048 B.
ELF=$1; BIN=$2
[ -f "$ELF" ] && [ -f "$BIN" ] || { echo "size $(basename $ELF): FAIL  not built"; exit 1; }
FLASH=$(stat -c %s "$BIN")
RAM=$(arm-none-eabi-size -A "$ELF" | awk '$1==".data"||$1==".bss"||$1==".vtab"{s+=$2} END{print s+0}')
DICT=$(arm-none-eabi-nm -S "$ELF" | awk '$4=="ram_dict"{print $2}')
DICT=$((0x${DICT:-0}))
KRAM=$((RAM - ${DICT:-0}))
F=PASS; [ "$FLASH" -lt 8192 ] || F=FAIL
R=PASS; [ "$KRAM" -lt 2048 ] || R=FAIL
echo "size $(basename $ELF .elf): flash $FLASH B ($F, limit 8192)  kernel RAM $KRAM B ($R, limit 2048)  dictionary ${DICT:-0} B"
[ $F = PASS ] && [ $R = PASS ]

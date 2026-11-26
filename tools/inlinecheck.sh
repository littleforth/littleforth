#!/bin/sh
# inlinecheck.sh ELF - every builtin flagged L (inline) in src/wordlist.h must be
# straight-line code the code generator can copy: ends in its only `bx lr`,
# no branches out of it (a short branch inside it moves with it: ARMv6-M's
# conditionals), no PC-relative access, no stack frame, at most 11 halfwords.
ELF=$1; fail=0; n=0
[ -f "$ELF" ] || { echo "inline $(basename $ELF): FAIL  not built"; exit 1; }
for w in $(grep -o 'X([a-z0-9_]*,"[^"]*",L)' src/wordlist.h | sed 's/X(\([^,]*\),.*/\1/'); do
    n=$((n+1))
    body=$(arm-none-eabi-objdump -d --no-show-raw-insn "$ELF" --disassemble=w_$w | grep -E '^\s*[0-9a-f]+:' | sed 's/^[^:]*:\s*//')
    last=$(echo "$body" | tail -1)
    bad=$(echo "$body" | head -n -1 | grep -E '^(b|bl|bx|blx|cb|tb|push|pop)[a-z.]*\s|pc' | grep -vE "^b[a-z]*\.n\s+[0-9a-f]+ <w_$w\+0x")
    hw=$(arm-none-eabi-objdump -d "$ELF" --disassemble=w_$w | grep -E '^\s*[0-9a-f]+:' | head -n -1 | awk '{n += (length($2)==4 && $3 ~ /^[0-9a-f]{4}$/) ? 2 : 1} END{print n+0}')
    if [ "$last" != "bx	lr" ] || [ -n "$bad" ] || [ "$hw" -gt 11 ]; then
        echo "  w_$w is not copyable:"; echo "$body" | sed 's/^/    /'; fail=1
    fi
done
[ $fail = 0 ] && echo "inline $(basename $ELF .elf): PASS  $n words copyable" || echo "inline $(basename $ELF .elf): FAIL"
exit $fail

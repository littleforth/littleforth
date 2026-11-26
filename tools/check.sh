#!/bin/sh
# check.sh - every automated gate (tools/gates/*.sh). Exit status 0 only if all pass.
#   tools/check.sh [all|kernel|vscode|quick]   (make check, check-kernel, check-vscode, check-quick)
#   all     every gate; run before a delivery (the only group with D1, dist/ current)
#   kernel  builds, sizes, the Forth tests on every target, tables, libraries, assembler
#   vscode  the extension's data and tests
#   quick   builds and size gates, then regression, errors and core on host and QEMU M4
# Each gate prints one PASS/FAIL line; its output goes to build/check.log, and the
# last lines of it are shown only when the gate fails.
cd "$(dirname "$0")/.."
mode=${1:-all}
case $mode in
    all) want= ;; kernel) want=k ;; vscode) want=v ;; quick) want=q ;;
    *) echo "usage: tools/check.sh [all|kernel|vscode|quick]"; exit 2 ;;
esac
mkdir -p build
log=build/check.log
: >"$log"
out=$(mktemp)
fail=0; npass=0; nfail=0; start=$(date +%s)
# gate TAGS NAME CMD...   TAGS: k kernel, v vscode, q quick, d only in all
gate() {
    tags=$1; name=$2; shift 2
    if [ -n "$want" ]; then case $tags in *$want*) ;; *) return 0 ;; esac; fi
    "$@" >"$out" 2>&1; r=$?
    { echo "---- $name (exit $r)"; cat "$out"; } >>"$log"
    if [ $r = 0 ]; then
        npass=$((npass + 1)); echo "PASS  $name"
    else
        nfail=$((nfail + 1)); fail=1; echo "FAIL  $name"
        tail -n 20 "$out" | sed 's/^/      /'
    fi
}
kfth() {   # lib/CHIP/drivers/kernel.fth must match the board's build
    t=$(mktemp); python3 -I tools/kernel_fth.py $1 "$t" && diff -q "$t" lib/$2/drivers/kernel.fth; r=$?; rm -f "$t"; return $r
}
# the gates: tools/gates/*.sh in order, one file per board or chip (and the shared
# ones); a board whose file is left out is not checked
for f in tools/gates/*.sh; do . "$f"; done
rm -f "$out"
secs=$(( $(date +%s) - start ))
echo "----"
echo "check $mode: $npass passed, $nfail failed, ${secs}s (full output: $log)"
[ $fail = 0 ] && echo "make check: PASS" || echo "make check: FAIL"
exit $fail

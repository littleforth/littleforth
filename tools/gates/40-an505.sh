# QEMU's MPS2 AN505 (Cortex-M33, the RP2350's core)
gate kq "build an505"       make -s build/an505.elf
gate kq "inline an505"      tools/inlinecheck.sh build/an505.elf
gate k  "T3p core m33"      python3 -I tools/run_forth.py qemu33 test/tester.fr test/core.fr
gate k  "regression m33"    python3 -I tools/run_forth.py qemu33 test/tester.fr test/regress.fth
gate k  "errors m33"        python3 -I tools/expect.py qemu33 test/errors.fth
# in vscode too: the extension's M33 tests include build/an505-kernel.fth
gate kv "kernel.fth an505"  python3 -I tools/kernel_fth.py an505 build/an505-kernel.fth
gate k  "save m33 (Forth)"  python3 -I tools/expect.py qemu33 test/save-forth.fth
gate k  "fault m33"         python3 -I tools/expect.py qemu33 test/fault.fth
gate k  "stack limit m33"   python3 -I tools/expect.py qemu33 test/stack.fth
gate k  "fault status m33"  python3 -I tools/expect.py qemu33 test/fault-cfsr.fth
gate k  "irq m33"           python3 -I tools/expect.py qemu33 test/irq.fth
gate k  "irq above 31 m33"  python3 -I tools/expect.py qemu33 test/irqhigh.fth
gate k  "lib m33"           python3 -I tools/expect.py qemu33 test/lib.fth
gate k  "E1 full m33"       python3 -I tools/expect.py qemu33 test/full-m33.fth
gate k  "E3 regs m33"       python3 -I tools/expect.py qemu33 test/regs.fth
gate k  "X4 asm m33"        python3 -I tools/asmcheck.py run qemu33

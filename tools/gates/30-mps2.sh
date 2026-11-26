# QEMU's MPS2 AN386 (Cortex-M4): the Thumb-2 test board
gate kq "build mps2"        make -s build/mps2.bin
gate kq "T1/T7 mps2"        tools/sizegate.sh build/mps2.elf build/mps2.bin
gate kq "inline mps2"       tools/inlinecheck.sh build/mps2.elf
gate kq "regression qemu"   python3 -I tools/run_forth.py qemu test/tester.fr test/regress.fth
gate kq "errors qemu"       python3 -I tools/expect.py qemu test/errors.fth
gate k  "save qemu"         python3 -I tools/expect.py qemu test/save.fth
gate k  "irq qemu"          python3 -I tools/expect.py qemu test/irq.fth
gate k  "lib qemu"          python3 -I tools/expect.py qemu test/lib.fth
gate kq "T3 core qemu"      python3 -I tools/run_forth.py qemu test/tester.fr test/core.fr
gate k  "fault qemu"        python3 -I tools/expect.py qemu test/fault.fth
gate k  "fault status qemu" python3 -I tools/expect.py qemu test/fault-cfsr.fth
gate k  "E1 full qemu"      python3 -I tools/expect.py qemu test/full.fth
gate k  "E3 regs qemu"      python3 -I tools/expect.py qemu test/regs.fth

# the host build (token code generator)
gate kq "build host"        make -s build/host
gate kq "regression host"   python3 -I tools/run_forth.py host test/tester.fr test/regress.fth
gate kq "errors host"       python3 -I tools/expect.py host test/errors.fth
gate kq "T2 core host"      python3 -I tools/run_forth.py host test/tester.fr test/core.fr
gate k  "save host"         python3 -I tools/expect.py host test/save.fth
gate k  "lib host"          python3 -I tools/expect.py host test/lib.fth
gate k  "E1 full host"      python3 -I tools/expect.py host test/full.fth
gate k  "E3 regs host"      python3 -I tools/expect.py host test/regs.fth

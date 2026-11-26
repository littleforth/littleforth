# the RP2350: its register table and drivers
gate kq "build table rp2350" make -s build/rp2350.tbl
gate k  "lib rp2350 host"   python3 -I tools/run_forth.py host lib/rp2350/registers/*.fth
gate k  "E2 table rp2350"   python3 -I tools/regcheck.py lib/rp2350/registers build/rp2350.tbl
gate k  "E4 rp2350 libs"    python3 -I tools/libtest.py lib/rp2350/drivers test/rp2350lib/calls.fth

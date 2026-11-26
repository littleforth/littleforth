# the release files (make dist) match the source
gate d  "D1 dist"           sh -c 'make -s dist >/dev/null && python3 -I tools/distcheck.py'

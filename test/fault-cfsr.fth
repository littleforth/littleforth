\ fault-cfsr.fth - the fault status (CFSR) kept in `crash` (ARMv7-M and
\ ARMv8-M; ARMv6-M has none): 0 EXECUTE is UFSR.INVSTATE.
: CRASH {crash} + @ ;                      ( offset -- cell )
0 EXECUTE
32 CRASH $20000 AND 0<> .

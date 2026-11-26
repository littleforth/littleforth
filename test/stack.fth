\ stack.fth - return stack overflow (Cortex-M33: MSPLIM) is reported, not
\ written over the kernel's variables; the board answers after it.
\ INCLUDE trigger.fth
: DEEP RECURSE ;
DEEP
1 2 + .
\ the same inside an interrupt handler (independent check, 2026-11-17): the
\ fault's own frame could not be stacked, and the handler runs again after
VARIABLE HITS
: DEEP2 RECURSE ;
: H3 1 HITS +! DEEP2 ;
' H3 5 IRQ!
5 TRIGGER
HITS @ .
5 TRIGGER
HITS @ .
0 5 IRQ!
1 2 + .

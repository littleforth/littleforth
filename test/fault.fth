\ fault.fth - faults and errors in interrupt handlers (target only; compare
\ fault.expect). The board reports the error, keeps the state in `crash`
\ (the stacked r0-r3 r12 lr pc xpsr, CFSR, r5, r6, then 8 data stack cells)
\ and answers again. {crash} is the block's address, from the ELF.
\ INCLUDE trigger.fth
: CRASH {crash} + @ ;                      ( offset -- cell )
: IN? ( a xt -- f ) - DUP 0< 0= SWAP 64 < AND ;
\ 1. a bad address in a word: ?-9, the PC is in BAD, the stack is kept
: BAD 11 22 33 $A0000000 @ ;
BAD
24 CRASH ' BAD IN? .
44 CRASH . 48 CRASH .
DEPTH . 1 2 + .
\ 2. a bad xt
0 EXECUTE
24 CRASH .
\ 3. the same fault inside an interrupt handler; the handler runs again after
VARIABLE HITS
: HANDLER 1 HITS +! $A0000000 @ ;
' HANDLER 5 IRQ!
5 TRIGGER
24 CRASH ' HANDLER IN? .
HITS @ .
5 TRIGGER
HITS @ .
\ 4. THROW inside a handler: ?-10, and the handler runs again after
: H2 1 HITS +! 1 0 / ;
' H2 5 IRQ!
5 TRIGGER
HITS @ .
5 TRIGGER
HITS @ .
0 5 IRQ!
1 2 + .
\ 5. a fault with r5 not pointing at the data stack (movs r5,#1; udf):
\ reported, not a lockup (independent check, 2026-11-17)
: BADR5 [ -2 ALLOT $DE002501 , ] ;
BADR5
1 2 + .
\ 6. a handler at a lower priority, preempted by another that returns, then
\ faults: back out through the right level (independent check, 2026-11-17)
: INNER 1 HITS +! ;
: OUTER 6 TRIGGER $A0000000 @ ;
' INNER 6 IRQ!  ' OUTER 5 IRQ!  $8000 $E000E404 !
5 TRIGGER
HITS @ .
5 TRIGGER
HITS @ .
0 5 IRQ!  0 6 IRQ!  0 $E000E404 !
1 2 + .

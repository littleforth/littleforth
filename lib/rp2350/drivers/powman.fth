\ powman.fth - power manager: scratch registers, wake pins, sleep.
\ $DEADBEEF 0 POWMAN.KEEP   0 POWMAN.KEPT U.
\ 28 POWMAN.WAKE-FALL POWMAN.WAKE   POWMAN.SLEEP
\ POWMAN.SLEEP is EXPERIMENTAL (not yet run on the board): the switched core
\ powers down once the processors wait in WFI (6.2.3.1), and not while a
\ debugger is attached. Waking reboots the chip; POWMAN.KEPT survives it.

\ INCLUDE core.fth

: POWMAN.WRITE ( value a -- )  SWAP $FFFF AND $5AFE0000 OR SWAP ! ;   \ with the password
: POWMAN.KEEP ( x n -- )  4 * POWMAN.SCRATCH0 + ! ;   \ n 0..7: kept through sleep
: POWMAN.KEPT ( n -- x )  4 * POWMAN.SCRATCH0 + @ ;
0 CONSTANT POWMAN.WAKE-LOW    1 CONSTANT POWMAN.WAKE-HIGH
2 CONSTANT POWMAN.WAKE-FALL   3 CONSTANT POWMAN.WAKE-RISE
: POWMAN.WAKE ( gpio how -- )        \ PWRUP0: SOURCE 5:0, ENABLE 6, DIRECTION 7, MODE 8
   DUP 2 AND IF $100 ELSE 0 THEN  SWAP 1 AND IF $80 OR THEN  OR
   POWMAN.PWRUP0 2DUP POWMAN.WRITE
   OVER $200 OR OVER POWMAN.WRITE          \ STATUS: clear an edge latched before
   SWAP $40 OR SWAP POWMAN.WRITE ;
: POWMAN.REQUEST ( domains -- )  4 LSHIFT POWMAN.STATE POWMAN.WRITE ;   \ bit 3 SWCORE ... 1 = off
: POWMAN.NOW ( -- u )  POWMAN.STATE @ ;  \ 3:0 current, 7:4 request, $100 ignored, $1000 waiting
: WFI ( -- )  [ -2 ALLOT $4770BF30 , ] ; -2 ALLOT   \ wfi; bx lr
: POWMAN.SLEEP ( -- )  $8 POWMAN.REQUEST  BEGIN WFI AGAIN ;   \ P0.0 to P1.0
: POWMAN.SLEEP-UNTIL ( gpio -- )  POWMAN.WAKE-FALL POWMAN.WAKE POWMAN.SLEEP ;

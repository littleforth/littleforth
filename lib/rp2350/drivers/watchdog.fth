\ watchdog.fth - the watchdog, counting in microseconds.
\ 8000 WATCHDOG.START   WATCHDOG.KICK   WATCHDOG.STOP   WATCHDOG.WHY .
\ Longest timeout about 16.7 s. LOAD reads 0, so the timeout is kept here.

\ INCLUDE core.fth

VARIABLE WATCHDOG.US
: WATCHDOG.START ( ms -- )
   12 TICKS.WATCHDOG_CYCLES !  1 TICKS.WATCHDOG_CTRL !   \ 1 us ticks
   0 WATCHDOG.CTRL !
   $01FFFFF3 PSM.WDSEL !            \ reset everything but the oscillators (as the SDK)
   1000 * $FFFFFF MIN DUP WATCHDOG.US !  WATCHDOG.LOAD !
   $47000000 WATCHDOG.CTRL ! ;      \ ENABLE, paused while debugging
: WATCHDOG.KICK  ( -- )  WATCHDOG.US @ WATCHDOG.LOAD ! ;
: WATCHDOG.STOP  ( -- )  0 WATCHDOG.CTRL ! ;
: WATCHDOG.FORCE ( -- )  WATCHDOG.CTRL @ $80000000 OR WATCHDOG.CTRL ! ;
: WATCHDOG.LEFT  ( -- us )  WATCHDOG.CTRL @ $FFFFFF AND ;
: WATCHDOG.WHY   ( -- n )   WATCHDOG.REASON @ ;   \ 1 timed out, 2 forced, 0 neither

\ timer.fth - TIMER0 and TIMER1: microsecond time, delays, alarms.
\ TIMER0.INIT                      \ once: US MS MICROS use TIMER0
\ 250 MS   50 US   MICROS U.
\ : BLINK 28 GPIO.TOGGLE ;
\ ' BLINK 1 TIMER0.HANDLER!        \ alarm 1 of TIMER0 calls BLINK
\ 250000 1 TIMER0.ALARM-EVERY      \ every 250 ms, without drift
\ 1 TIMER0.ALARM-OFF
\ Four alarms per timer (0..3); TIMER0's are IRQ 0..3, TIMER1's 4..7.
\ A handler is a plain word ( -- ): the interrupt is cleared for it.

\ INCLUDE core.fth

: TIMER.N     ( base -- 0|1 )  TIMER0 - $8000 / ;
: TIMER.RESET ( base -- )      TIMER.N 23 + 1 SWAP LSHIFT UNRESET ;
: TIMER.NOW   ( base -- u )    [ TIMER0.TIMERAWL TIMER0 - ] LITERAL + @ ;
: TIMER.INIT  ( base -- )      \ out of reset, 1 us ticks from the 12 MHz clk_ref
   DUP TIMER.RESET
   TIMER.N 12 * TICKS.TIMER0_CTRL +  12 OVER 4 + !  1 SWAP ! ;

: MICROS ( -- u )  TIMER0.NOW ;
: US ( n -- )      MICROS +  BEGIN DUP MICROS - 0< UNTIL DROP ;   \ n < 2^31
: MS ( n -- )      ?DUP IF 0 DO 1000 US LOOP THEN ;

\ Alarms, by index i = 4 * timer + alarm (which is also the alarm's IRQ)
CREATE T.XT  8 CELLS ALLOT   T.XT  8 CELLS 0 FILL   \ handler
CREATE T.P   8 CELLS ALLOT   T.P   8 CELLS 0 FILL   \ period, 0 = once
CREATE T.T   8 CELLS ALLOT                          \ time last set for
: T.I    ( alarm base -- i )  TIMER.N 4 * + ;
: T.REG  ( i off -- a )       SWAP 2 RSHIFT $8000 * TIMER0 + + ;
: T.BIT  ( i -- mask )        3 AND 1 SWAP LSHIFT ;
\ offsets: ALARM0 $10, ARMED $20, INTR $3C, INTE $40, INTF $44
: T.CANCEL ( i -- )       DUP T.BIT SWAP $20 T.REG ! ;
: T.ARMED? ( i -- flag )  DUP T.BIT SWAP $20 T.REG @ AND 0<> ;
: T.CLEAR  ( i -- )       DUP T.BIT OVER $3C T.REG !  DUP T.BIT SWAP $44 T.REG $3000 + ! ;
: T.AT ( t i -- )         \ arm; a time already past fires at once (as the SDK)
   2DUP CELLS T.T + !
   2DUP DUP 3 AND CELLS $10 + T.REG !
   SWAP OVER 0 T.REG TIMER.NOW - 0 > IF DROP EXIT THEN
   DUP T.ARMED? IF DUP T.CANCEL DUP T.BIT SWAP $44 T.REG $2000 + ! ELSE DROP THEN ;
: T.RUN ( i -- )          \ the common interrupt handler
   DUP T.CLEAR
   DUP CELLS T.P + @ ?DUP IF OVER CELLS T.T + @ + OVER T.AT THEN
   CELLS T.XT + @ ?DUP IF EXECUTE THEN ;
: TA0 0 T.RUN ;  : TA1 1 T.RUN ;  : TA2 2 T.RUN ;  : TA3 3 T.RUN ;
: TA4 4 T.RUN ;  : TA5 5 T.RUN ;  : TA6 6 T.RUN ;  : TA7 7 T.RUN ;
CREATE T.ISR  ' TA0 , ' TA1 , ' TA2 , ' TA3 , ' TA4 , ' TA5 , ' TA6 , ' TA7 ,

: TIMER.IRQ ( alarm base -- irq )  T.I ;
: TIMER.ALARM-AT ( t alarm base -- )  T.I T.AT ;
: TIMER.ALARM-IN ( us alarm base -- )             \ once
   T.I  0 OVER CELLS T.P + !  SWAP OVER 0 T.REG TIMER.NOW + SWAP T.AT ;
: TIMER.ALARM-EVERY ( us alarm base -- )          \ repeatedly, from the last target
   T.I  2DUP CELLS T.P + !  SWAP OVER 0 T.REG TIMER.NOW + SWAP T.AT ;
: TIMER.ALARM-CANCEL ( alarm base -- )  T.I T.CANCEL ;
: TIMER.ALARM? ( alarm base -- flag )   T.I T.ARMED? ;
: TIMER.FIRED? ( alarm base -- flag )   T.I DUP T.BIT SWAP $3C T.REG @ AND 0<> ;
: TIMER.CLEAR  ( alarm base -- )        T.I T.CLEAR ;
: TIMER.HANDLER! ( xt alarm base -- )   \ install and enable the interrupt
   T.I  TUCK CELLS T.XT + !  DUP T.CLEAR
   DUP T.BIT OVER $40 T.REG $2000 + !
   DUP CELLS T.ISR + @ SWAP IRQ! ;
: TIMER.ALARM-OFF ( alarm base -- )     \ stop, disable, remove the handler
   T.I  0 OVER CELLS T.P + !  DUP T.CANCEL
   DUP T.BIT OVER $40 T.REG $3000 + !  DUP T.CLEAR
   0 OVER CELLS T.XT + !  0 SWAP IRQ! ;

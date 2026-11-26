\ mock.fth - simulated memory for the RP2350 library test (gate E4): hardware
\ writes print as [address <- value]; reads of a few status registers are
\ faked so waits end (RESET_DONE, ADC READY, the timer, SPI, I2C, UART1).
\ simulated memory for hardware addresses: 512 address/value pairs, writes
\ printed; RAM goes to real memory (A14: the library state is tested too)
CREATE MA 512 CELLS ALLOT  CREATE MV 512 CELLS ALLOT  VARIABLE MN  0 MN !
VARIABLE TCK  0 TCK !
: MSLOT ( a -- i|-1 )
   MN @ 0= IF DROP -1 EXIT THEN
   -1 SWAP  MN @ 0 DO  DUP MA I CELLS + @ = IF NIP I SWAP LEAVE THEN  LOOP DROP ;
: HW? ( a -- f ) $40000000 U< 0= ;
: !  ( x a -- )
   DUP HW? 0= IF ! EXIT THEN
   ." [" BASE @ >R HEX DUP U. ." <- " OVER U. R> BASE ! ." ] "
   DUP MSLOT DUP 0< IF DROP MN @ DUP 1+ MN ! 2DUP CELLS MA + ! THEN NIP
   CELLS MV + ! ;
: @  ( a -- x )
   DUP HW? 0= IF @ EXIT THEN
   DUP $400B0028 = IF DROP 7 TCK +! TCK @ EXIT THEN    \ TIMER0.TIMERAWL ticks
   DUP $40020008 = IF DROP -1 EXIT THEN                \ RESET_DONE: all done
   DUP $400F0110 = IF DROP 1 EXIT THEN                 \ TRNG_VALID: 192 bits ready
   DUP $40058000 = IF DROP $40058008 MSLOT 0< 0= $80000000 AND EXIT THEN   \ PLL_USB locks once FBDIV is set
   DUP $400A0000 = IF DROP $400A0000 MSLOT DUP 0< IF DROP 0 ELSE CELLS MV + @ THEN $100 OR EXIT THEN
   DUP MSLOT DUP 0< IF 2DROP 0 EXIT THEN NIP CELLS MV + @
   ;
VARIABLE RXP 0 RXP !   VARIABLE NACK 0 NACK !
VARIABLE HOOK 0 HOOK !   \ run once at the next read of I2C0's RAW_INTR: an interrupt
: !  ( x a -- )  DUP $40080008 = IF -1 RXP ! THEN  ! ;
: @  ( a -- x )
   DUP $4008000C = IF DROP RXP @ IF 7 ELSE 3 THEN EXIT THEN
   DUP $40080008 = IF DROP 0 RXP ! $A5 EXIT THEN
   DUP $40090034 = IF DROP HOOK @ ?DUP IF 0 HOOK ! EXECUTE THEN NACK @ IF $250 ELSE $210 THEN EXIT THEN
   DUP $40090080 = IF DROP NACK @ IF 1 ELSE 0 THEN EXIT THEN
   DUP $40090078 = IF DROP NACK @ 0= 1 AND EXIT THEN
   DUP $40090070 = IF DROP 2 EXIT THEN
   DUP $40090010 = IF DROP $15A EXIT THEN
   @ ;
VARIABLE ULB  0 ULB !  VARIABLE ULBV
: !  ( x a -- )  DUP $40078000 = IF OVER ULBV ! -1 ULB ! THEN  ! ;
: @  ( a -- x )
   DUP $40078018 = IF DROP ULB @ IF 0 ELSE $10 THEN EXIT THEN
   DUP $40078000 = IF DROP 0 ULB ! ULBV @ EXIT THEN
   @ ;

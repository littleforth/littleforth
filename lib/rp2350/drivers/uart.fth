\ uart.fth - UART (PL011). UART0 is the console, so in practice UART1.
\ 9600 UART1.INIT .          \ 8N1; prints the rate set
\ 4 5 UART1.PINS             \ TX RX
\ $41 UART1.EMIT   S" hi" UART1.TYPE   UART1.KEY? .   UART1.KEY EMIT
\ 100000 UART1.KEY-WAIT .    \ wait up to 100 ms: the byte, or -1
\ UART1.BUFFER               \ receive by interrupt into a 64-byte ring
\ 7 2 1 UART1.FORMAT         \ 7 bits, even parity, 1 stop
\ Loopback: wire GP4 to GP5, then $41 UART1.EMIT UART1.KEY .   \ 65
\ Pins: TX on 4 8 20 24 (function 2) or 6 10 22 26 (function 11), RX the next.

\ INCLUDE gpio.fth
\ INCLUDE timer.fth

150000000 CONSTANT UART.CLK
: UART.N     ( base -- 0|1 )  UART0 - $8000 / ;
: UART.RESET ( base -- )      UART.N 26 + 1 SWAP LSHIFT DUP HOLD-RESET UNRESET ;
: UART.IRQ   ( base -- n )    UART.N 33 + ;
\ offsets: DR 0, FR $18, IBRD $24, FBRD $28, LCR_H $2C, CR $30, IMSC $38, ICR $44

: UART.BAUD ( baud base -- actual )      \ as the SDK: 8*clk/baud+1 in 1/128ths
   >R  UART.CLK 8 * SWAP / 1+  DUP 7 RSHIFT
   DUP 0= IF 2DROP 1 0 ELSE
   DUP 65535 < 0= IF 2DROP 65535 0 ELSE  SWAP $7F AND 1 RSHIFT  THEN THEN
   2DUP R@ $28 + ! R@ $24 + !
   R@ $2C + @ R> $2C + !                 \ the divisors take effect on an LCR_H write
   SWAP 64 * +  UART.CLK 4 * SWAP / ;
: UART.FLUSH ( base -- )  $18 + BEGIN DUP @ 8 AND 0= UNTIL DROP ;   \ until sent
: UART.FORMAT ( bits parity stop base -- )   \ parity 0 none, 1 odd, 2 even
   >R  1- 3 LSHIFT >R
   DUP IF 2 SWAP 2 = IF 4 OR THEN ELSE DROP 0 THEN
   SWAP 5 - 5 LSHIFT OR  R> OR  $10 OR    \ + FIFOs on
   R@ UART.FLUSH
   R@ $30 + @  0 R@ $30 + !  SWAP R@ $2C + !  R> $30 + ! ;
: UART.INIT ( baud base -- actual )
   DUP UART0 = ABORT" UART0 is the console"
   TIMER0.INIT
   DUP UART.RESET  TUCK UART.BAUD
   SWAP  $70 OVER $2C + !               \ 8N1, FIFOs on
   $301 SWAP $30 + ! ;                    \ UARTEN, TXE, RXE

: UART.PIN ( gpio n -- )
   OVER 4 + 3 RSHIFT 1 AND <> ABORT" pin belongs to the other UART"
   DUP DUP 3 AND 2 < IF GPIO.F-UART ELSE 11 THEN GPIO.FUNC
   DUP 1 AND IF PAD.PUE PAD.PDE PAD.BITS ELSE DROP THEN ;
\ RX (the odd pin) gets a pull-up: pads reset with a pull-down, and an RX
\ held low is a break, which the UART receives as 0 bytes.
: UART.PINS ( tx rx base -- )
   OVER 1 AND 0= ABORT" RX must be an odd GPIO"
   >R OVER 1 AND ABORT" TX must be an even GPIO"
   R@ UART.N UART.PIN  R> UART.N UART.PIN ;

: UART.EMIT ( c base -- )  BEGIN DUP $18 + @ $20 AND 0= UNTIL ! ;   \ FR.TXFF
: UART.TYPE ( addr n base -- )
   SWAP ?DUP IF 0 DO  OVER I + C@ OVER UART.EMIT  LOOP THEN 2DROP ;

\ receive by interrupt, one instance at a time, into a 64-byte ring
CREATE URX 64 ALLOT
VARIABLE URX.HEAD  VARIABLE URX.TAIL  VARIABLE UART.LOST
VARIABLE URX.BASE  0 URX.BASE !
: URX-PUT ( c -- )
   URX.HEAD @ 1+ 63 AND  DUP URX.TAIL @ = IF 2DROP 1 UART.LOST +! EXIT THEN
   SWAP URX.HEAD @ URX + C!  URX.HEAD ! ;
: URX-ISR ( -- )
   URX.BASE @  BEGIN DUP $18 + @ $10 AND 0= WHILE DUP @ $FF AND URX-PUT REPEAT
   $50 SWAP $44 + ! ;                     \ clear receive and receive timeout
: UART.BUFFER ( base -- )
   0 URX.HEAD !  0 URX.TAIL !  0 UART.LOST !  DUP URX.BASE !
   ['] URX-ISR OVER UART.IRQ IRQ!
   $50 SWAP $38 + ! ;
: UART.UNBUFFER ( base -- )
   DUP 0 SWAP $38 + !  0 SWAP UART.IRQ IRQ!  0 URX.BASE ! ;

: UART.KEY? ( base -- flag )
   DUP URX.BASE @ = IF DROP URX.HEAD @ URX.TAIL @ <> ELSE $18 + @ $10 AND 0= THEN ;
: UART.KEY ( base -- c )
   BEGIN DUP UART.KEY? UNTIL
   DUP URX.BASE @ = IF DROP URX.TAIL @ DUP URX + C@ SWAP 1+ 63 AND URX.TAIL !
   ELSE @ $FF AND THEN ;
: UART.KEY-WAIT ( us base -- c | -1 )
   SWAP MICROS +
   BEGIN  OVER UART.KEY? IF DROP UART.KEY EXIT THEN  DUP MICROS - 0<  UNTIL
   2DROP -1 ;

\ spi.fth - SPI0 and SPI1 (PL022), controller, Motorola format.
\ 1000000 SPI0.INIT .          \ 8-bit, mode 0; prints the rate set
\ 18 19 16 SPI0.PINS           \ SCK TX RX (-1: not used)
\ 17 SPI0.CS                   \ chip select is an ordinary GPIO
\ SPI0.SELECT $9F SPI0.SEND SPI0.RECV . SPI0.DESELECT
\ 16 3 SPI0.FORMAT             \ 4..16 bits, mode 0..3
\ Pins (function 1): GPIO 0..7 and 16..23 are SPI0, 8..15 and 24..29 SPI1;
\ in each group of four: RX, CSn, SCK, TX. Rate: 150 MHz / (2..254 x 1..256).

\ INCLUDE gpio.fth

150000000 CONSTANT SPI.CLK
: SPI.N     ( base -- 0|1 )  SPI0 - $8000 / ;
: SPI.RESET ( base -- )      SPI.N 18 + 1 SWAP LSHIFT DUP HOLD-RESET UNRESET ;
: SPI.IRQ   ( base -- n )    SPI.N 31 + ;
\ offsets: CR0 0, CR1 4, DR 8, SR $C, CPSR $10, ICR $20
: SPI.OFF ( base -- )  4 + DUP @ 2 INVERT AND SWAP ! ;
: SPI.ON  ( base -- )  4 + DUP @ 2 OR SWAP ! ;

VARIABLE SPI.PRE   VARIABLE SPI.WANT
: SPI.POSTDIV ( -- pd )        \ largest 1..256 keeping the rate at or below the wanted
   256 BEGIN DUP 1 > WHILE
      DUP 1- SPI.PRE @ * SPI.CLK SWAP / SPI.WANT @ > IF EXIT THEN 1-
   REPEAT ;
: SPI.BAUD ( baud base -- actual )   \ prescale: smallest even 2..254, as the SDK
   >R DUP SPI.WANT !
   SPI.CLK SWAP / 256 / 1+  DUP 1 AND +  2 MAX 254 MIN SPI.PRE !
   R@ 4 + @ 2 AND  R@ SPI.OFF
   SPI.PRE @ R@ $10 + !
   SPI.POSTDIV  DUP 1- 8 LSHIFT  R@ @ $FFFF00FF AND OR  R@ !
   SWAP IF R@ SPI.ON THEN  R> DROP
   SPI.PRE @ * SPI.CLK SWAP / ;
: SPI.FORMAT ( bits mode base -- )
   >R
   DUP 2 AND IF $40 ELSE 0 THEN  SWAP 1 AND IF $80 OR THEN  SWAP 1- $F AND OR
   R@ 4 + @ 2 AND  R@ SPI.OFF
   SWAP R@ @ $FFFFFF00 AND OR R@ !
   IF R@ SPI.ON THEN  R> DROP ;
: SPI.INIT ( baud base -- actual )
   DUP SPI.RESET  TUCK SPI.BAUD  SWAP >R  8 0 R@ SPI.FORMAT  R> SPI.ON ;

: SPI.PIN ( gpio n role -- )      \ role: 0 RX, 2 SCK, 3 TX (the GPIO mod 4)
   >R  OVER 0< IF R> DROP 2DROP EXIT THEN
   OVER 3 RSHIFT 1 AND <> ABORT" pin belongs to the other SPI"
   DUP 3 AND R> <> ABORT" pin can't do that: SCK is GPIO 4n+2, TX 4n+3, RX 4n"
   GPIO.F-SPI GPIO.FUNC ;
: SPI.PINS ( sck tx rx base -- )
   SPI.N >R  R@ 0 SPI.PIN  R@ 3 SPI.PIN  R> 2 SPI.PIN ;

CREATE SPI.CSPIN  2 CELLS ALLOT
: SPI.CS       ( gpio base -- )  SPI.N CELLS SPI.CSPIN + OVER SWAP !  DUP GPIO.HIGH GPIO.OUT ;
: SPI.SELECT   ( base -- )       SPI.N CELLS SPI.CSPIN + @ GPIO.LOW ;
: SPI.DESELECT ( base -- )       SPI.N CELLS SPI.CSPIN + @ GPIO.HIGH ;

: SPI.WAIT  ( bit base -- )  $C + BEGIN 2DUP @ AND UNTIL 2DROP ;   \ SR: 2 TNF, 4 RNE
: SPI.DRAIN ( base -- )      BEGIN DUP $C + @ 4 AND WHILE DUP 8 + @ DROP REPEAT DROP ;
: SPI.XFER  ( tx base -- rx )  2 OVER SPI.WAIT  TUCK 8 + !  4 OVER SPI.WAIT  8 + @ ;
: SPI.SEND  ( x base -- )    SPI.XFER DROP ;
: SPI.RECV  ( base -- x )    0 SWAP SPI.XFER ;       \ sends 0 ($FF: $FF base SPI.XFER)
: SPI.WRITE ( addr n base -- )                     \ fill the FIFO, then clean up
   SWAP ?DUP IF 0 DO  2 OVER SPI.WAIT  OVER I + C@ OVER 8 + !  LOOP THEN  NIP
   DUP SPI.DRAIN  BEGIN DUP $C + @ $10 AND 0= UNTIL  DUP SPI.DRAIN
   1 SWAP $20 + ! ;                                \ clear receive overrun
: SPI.READ ( addr n base -- )
   ROT ROT ?DUP IF 0 DO  OVER SPI.RECV OVER I + C!  LOOP THEN 2DROP ;
: SPI.EXCHANGE ( addr n base -- )                  \ each byte replaced by the reply
   ROT ROT ?DUP IF 0 DO  OVER OVER I + C@ SWAP SPI.XFER OVER I + C!  LOOP THEN 2DROP ;

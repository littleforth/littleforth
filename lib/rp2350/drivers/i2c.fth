\ i2c.fth - I2C0 and I2C1 (DW_apb_i2c), controller, 7-bit addresses.
\ 100000 I2C0.INIT .         \ prints the rate set (100k, 400k, 1M)
\ 4 5 I2C0.PINS              \ SDA SCL; internal pull-ups on (fit 4.7k for real use)
\ I2C0.SCAN                  \ addresses that answer
\ $75 $68 I2C0.REG@ .        \ register $75 of device $68 (-1 if it failed)
\ 0 $6B $68 I2C0.REG! .      \ write 0 to register $6B (true = ok)
\ CREATE BUF 8 ALLOT   BUF 6 $68 I2C0.READ .   BUF 2 $68 I2C0.WRITE .
\ Pins (function 3): SDA even, SCL odd; GPIO 0,1 I2C0, 2,3 I2C1, 4,5 I2C0 ...
\ Every wait times out after I2C.TIMEOUT us (needs TIMER0.INIT, done by
\ I2C.INIT). After a failure I2C0.ERROR @ is 1 no answer to the address, 8 a
\ byte refused, -1 timed out, else the raw IC_TX_ABRT_SOURCE bits.

\ INCLUDE gpio.fth
\ INCLUDE timer.fth

150000000 CONSTANT I2C.CLK
: I2C.N     ( base -- 0|1 )  I2C0 - $8000 / ;
: I2C.RESET ( base -- )      I2C.N 4 + 1 SWAP LSHIFT DUP HOLD-RESET UNRESET ;
: I2C.IRQ   ( base -- n )    I2C.N 36 + ;

\ The instance being worked on. Each public word sets it on entry and puts
\ the previous one back on exit, and all transfer state is per instance, so
\ a handler may use the other I2C (not the same one) mid-transfer.
VARIABLE I2C.CUR   I2C0 I2C.CUR !
: IC ( off -- a )  I2C.CUR @ + ;
\ offsets: CON 0, TAR 4, DATA_CMD $10, FS_HCNT $1C, FS_LCNT $20, RAW_INTR $34,
\ RX_TL $38, TX_TL $3C, CLR_TX_ABRT $54, CLR_STOP $60, ENABLE $6C, STATUS $70,
\ RXFLR $78, SDA_HOLD $7C, TX_ABRT_SOURCE $80, FS_SPKLEN $A0

VARIABLE I2C.TIMEOUT  10000 I2C.TIMEOUT !
\ per instance, 6 cells each: error, ok, stop, length, restart, a 4-byte buffer
CREATE I2C.STATE  12 CELLS ALLOT   I2C.STATE 12 CELLS 0 FILL
: I2C.ERROR ( base -- a )  I2C.N 6 * CELLS I2C.STATE + ;
: IC-VAR ( n -- a )  CELLS I2C.CUR @ I2C.ERROR + ;
: IC-ERR ( -- a ) 0 IC-VAR ;   : IC-OK  ( -- a ) 1 IC-VAR ;   : IC-STOP ( -- a ) 2 IC-VAR ;
: IC-LEN ( -- a ) 3 IC-VAR ;   : I2C.RS ( -- a ) 4 IC-VAR ;    \ 5: the buffer

: IC-BAUD ( baud -- actual )             \ SCL 40% high, 60% low, as the SDK
   DUP 2/ I2C.CLK + SWAP /               \ period in clk_sys cycles
   0 $6C IC !
   $00 IC @ 6 INVERT AND 4 OR $00 IC !   \ SPEED fast
   DUP 3 * 5 /  2DUP - $1C IC !  DUP $20 IC !
   DUP 16 < IF DROP 1 ELSE 16 / THEN $A0 IC !
   I2C.CLK 3 *  OVER I2C.CLK SWAP / 1000000 < IF 10000000 ELSE 25000000 THEN / 1+
   $7C IC @ $FFFF0000 AND OR $7C IC !
   1 $6C IC !
   I2C.CLK SWAP / ;
: I2C.BAUD ( baud base -- actual )  I2C.CUR @ >R I2C.CUR !  IC-BAUD  R> I2C.CUR ! ;
: I2C.INIT ( baud base -- actual )
   I2C.CUR @ >R I2C.CUR !
   TIMER0.INIT  I2C.CUR @ I2C.RESET  0 I2C.RS !
   0 $6C IC !  $165 $00 IC !             \ controller, fast, target off, restarts, TX_EMPTY per byte
   0 $3C IC !  0 $38 IC !
   IC-BAUD  R> I2C.CUR ! ;

: I2C.PIN ( gpio n -- )
   OVER 1 RSHIFT 1 AND <> ABORT" pin belongs to the other I2C"
   DUP GPIO.F-I2C GPIO.FUNC  PAD.PUE PAD.PDE PAD.BITS ;
: I2C.PINS ( sda scl base -- )
   OVER 1 AND 0= ABORT" SCL must be an odd GPIO"
   >R OVER 1 AND ABORT" SDA must be an even GPIO"
   R@ I2C.N I2C.PIN  R> I2C.N I2C.PIN ;

: IC-FAIL ( reason -- )  IC-ERR !  FALSE IC-OK ! ;
: IC-UNTIL ( mask off -- flag )          \ wait for a bit; false on timeout
   IC  MICROS I2C.TIMEOUT @ + >R
   BEGIN  2DUP @ AND IF 2DROP R> DROP TRUE EXIT THEN  R@ MICROS - 0<  UNTIL
   2DROP R> DROP FALSE ;
: IC-ABRT? ( -- flag )
   $34 IC @ $40 AND IF $80 IC @ IC-FAIL  $54 IC @ DROP TRUE ELSE FALSE THEN ;
: IC-STOPPED ( -- )
   $200 $34 IC-UNTIL IF $60 IC @ DROP ELSE IC-OK @ IF -1 IC-FAIL THEN THEN ;
: IC-BITS ( i -- bits )                  \ STOP on the last byte, RESTART on the first
   DUP IC-LEN @ 1- = IC-STOP @ AND $200 AND
   SWAP 0= I2C.RS @ AND $400 AND OR ;
: IC-START ( n addr stop? -- )
   IC-STOP !  0 $6C IC !  $7F AND $04 IC !  1 $6C IC !
   $60 IC @ DROP  $54 IC @ DROP
   IC-LEN !  TRUE IC-OK !  0 IC-ERR ! ;
: IC-END ( -- ok? )  IC-STOP @ 0= IC-OK @ AND I2C.RS !  IC-OK @ ;
: IC-SEND ( buf n addr stop? -- ok? )
   IC-START
   IC-LEN @ 0= IF DROP 0 IC-FAIL FALSE EXIT THEN
   IC-LEN @ 0 DO
      DUP I + C@ I IC-BITS OR $10 IC !
      $10 $34 IC-UNTIL 0= IF -1 IC-FAIL LEAVE THEN
      IC-ABRT? IF IC-STOPPED LEAVE THEN
      I 1+ IC-LEN @ = IC-STOP @ AND IF IC-STOPPED THEN
   LOOP DROP IC-END ;
: IC-RXWAIT ( -- flag )
   MICROS I2C.TIMEOUT @ + >R
   BEGIN
      IC-ABRT? IF R> DROP FALSE EXIT THEN
      $78 IC @ IF R> DROP TRUE EXIT THEN
      R@ MICROS - 0<
   UNTIL R> DROP -1 IC-FAIL FALSE ;
: IC-RECV ( buf n addr stop? -- ok? )
   IC-START
   IC-LEN @ 0= IF DROP 0 IC-FAIL FALSE EXIT THEN
   IC-LEN @ 0 DO
      2 $70 IC-UNTIL 0= IF -1 IC-FAIL LEAVE THEN      \ room to send the read
      I IC-BITS $100 OR $10 IC !
      IC-RXWAIT 0= IF LEAVE THEN
      $10 IC @ $FF AND OVER I + C!
   LOOP DROP IC-END ;

: I2C.WRITE        ( buf n addr base -- ok? )  I2C.CUR @ >R I2C.CUR ! TRUE  IC-SEND R> I2C.CUR ! ;
: I2C.WRITE-NOSTOP ( buf n addr base -- ok? )  I2C.CUR @ >R I2C.CUR ! FALSE IC-SEND R> I2C.CUR ! ;
: I2C.READ         ( buf n addr base -- ok? )  I2C.CUR @ >R I2C.CUR ! TRUE  IC-RECV R> I2C.CUR ! ;
: I2C.READ-NOSTOP  ( buf n addr base -- ok? )  I2C.CUR @ >R I2C.CUR ! FALSE IC-RECV R> I2C.CUR ! ;

: I2C.REG! ( value reg addr base -- ok? )
   DUP I2C.N 6 * 5 + CELLS I2C.STATE + >R            \ that instance's buffer
   2SWAP R@ C! R@ 1+ C!  R> 2 2SWAP I2C.WRITE ;
: I2C.REG@ ( reg addr base -- value | -1 )      \ register number, restart, read
   DUP I2C.N 6 * 5 + CELLS I2C.STATE + >R
   ROT R@ C!
   2DUP R@ 1 2SWAP I2C.WRITE-NOSTOP 0= IF 2DROP R> DROP -1 EXIT THEN
   R@ 1 2SWAP I2C.READ IF R> C@ ELSE R> DROP -1 THEN ;
: I2C.PROBE ( addr base -- flag )  DUP I2C.N 6 * 5 + CELLS I2C.STATE + 1 2SWAP I2C.READ ;
: I2C.SCAN ( base -- )                          \ $08..$77, in hex
   BASE @ >R HEX
   0 SWAP  $78 8 DO  I OVER I2C.PROBE IF I . SWAP 1+ SWAP THEN  LOOP  DROP
   0= IF ." none" THEN CR
   R> BASE ! ;

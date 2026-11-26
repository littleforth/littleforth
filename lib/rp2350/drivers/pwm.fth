\ pwm.fth - PWM, 12 slices; channel A on even GPIOs, B on odd.
\ PWM.RESET   25 1000 40 PWM.START   25 75 PWM.DUTY   25 500 PWM.FREQ
\ 25 1000 40 PWM.START-PC          \ phase-correct, same frequency
\ 0 1 20000 50 PWM.PAIR            \ complementary on one slice
\ clk_sys is 150 MHz: about 9 Hz to a few MHz.

\ INCLUDE gpio.fth

150000000 CONSTANT PWM.CLK
1 CONSTANT PWM.CSR-EN   2 CONSTANT PWM.PH-CORRECT   4 CONSTANT PWM.A-INV   8 CONSTANT PWM.B-INV

: PWM.RESET ( -- )  1 16 LSHIFT UNRESET ;
: PWM.SLICE ( gpio -- slice )
   DUP 32 < IF 1 RSHIFT 7 AND ELSE 1 RSHIFT 3 AND 8 + THEN ;
: PWM.CHAN  ( gpio -- 0|1 )  1 AND ;
\ slice registers, 20 bytes apart: CSR DIV CTR CC TOP
: PWM.CSR ( slice -- a )  20 * PWM.CH0_CSR + ;
: PWM.DIV ( slice -- a )  20 * PWM.CH0_DIV + ;
: PWM.CC  ( slice -- a )  20 * PWM.CH0_CC + ;
: PWM.TOP ( slice -- a )  20 * PWM.CH0_TOP + ;

: PWM.CALC ( hz -- top div )   \ smallest divider (1..255) that fits 16 bits
   PWM.CLK SWAP /  DUP 65535 + 65536 /  1 MAX 255 MIN
   TUCK /  1- 65535 MIN 1 MAX  SWAP ;
: PWM.TOP-DIV! ( slice top div -- )  >R OVER PWM.TOP !  R> 4 LSHIFT SWAP PWM.DIV ! ;
: PWM.LEVEL ( slice duty% -- level )  SWAP PWM.TOP @ 1+ * 100 /  65535 MIN ;
: PWM.LEVEL! ( gpio level -- )       \ one channel, the other kept
   SWAP DUP PWM.SLICE PWM.CC  SWAP PWM.CHAN
   IF SWAP 16 LSHIFT OVER @ $FFFF AND OR ELSE DUP @ $FFFF0000 AND ROT OR THEN
   SWAP ! ;
: PWM.DUTY ( gpio duty% -- )  OVER PWM.SLICE SWAP PWM.LEVEL PWM.LEVEL! ;

VARIABLE PWM.OPTS
: PWM.SET ( gpio hz duty% opts -- )  \ opts: PWM.PH-CORRECT PWM.A-INV PWM.B-INV
   PWM.OPTS !  >R
   PWM.OPTS @ PWM.PH-CORRECT AND IF 2* THEN      \ up and down: twice the rate
   OVER GPIO.F-PWM GPIO.FUNC
   OVER PWM.SLICE SWAP PWM.CALC PWM.TOP-DIV!
   DUP R> PWM.DUTY
   PWM.SLICE PWM.CSR  PWM.OPTS @ PWM.CSR-EN OR  SWAP ! ;
: PWM.START    ( gpio hz duty% -- )  0 PWM.SET ;
: PWM.START-PC ( gpio hz duty% -- )  PWM.PH-CORRECT PWM.SET ;

VARIABLE PWM.OLD   VARIABLE PWM.NEW
: PWM.SCALE ( level -- level' )  PWM.NEW @ PWM.OLD @ */  65535 MIN ;
: PWM.FREQ ( gpio hz -- )            \ both channels keep their duty
   SWAP PWM.SLICE SWAP
   OVER PWM.CSR @ PWM.PH-CORRECT AND IF 2* THEN
   OVER PWM.TOP @ 1+ PWM.OLD !
   OVER SWAP PWM.CALC PWM.TOP-DIV!
   DUP PWM.TOP @ 1+ PWM.NEW !
   PWM.CC DUP @  DUP $FFFF AND PWM.SCALE  SWAP 16 RSHIFT PWM.SCALE 16 LSHIFT OR  SWAP ! ;

: PWM.ON    ( gpio -- )   PWM.SLICE PWM.CSR DUP @ PWM.CSR-EN OR SWAP ! ;
: PWM.OFF   ( gpio -- )   PWM.SLICE PWM.CSR DUP @ PWM.CSR-EN INVERT AND SWAP ! ;
: PWM.INV-A ( slice -- )  PWM.CSR DUP @ PWM.A-INV OR SWAP ! ;
: PWM.INV-B ( slice -- )  PWM.CSR DUP @ PWM.B-INV OR SWAP ! ;
: PWM.PAIR ( gpioA gpioB hz duty% -- )   \ B is A inverted
   2SWAP
   OVER PWM.CHAN ABORT" first pin must be channel A (an even GPIO)"
   OVER PWM.SLICE OVER PWM.SLICE <> ABORT" pins must be on the same slice"
   GPIO.F-PWM GPIO.FUNC
   DUP >R ROT ROT PWM.B-INV PWM.SET
   R> PWM.SLICE PWM.CC DUP @ $FFFF AND DUP 16 LSHIFT OR SWAP ! ;

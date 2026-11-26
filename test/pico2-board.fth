\ pico2-board.fth - the RP2350 libraries on a real Pico 2. Send with F5.
\ Each test prints PASS or FAIL; the last line stops the send if any failed.
\ Written for a Cytron Maker Pi Pico base: change the pins below for another.
\ Needs nothing wired. The UART test runs only with a wire from GP4 to GP5.

\ INCLUDE ../lib/rp2350/drivers/uart.fth
\ INCLUDE ../lib/rp2350/drivers/gpio-irq.fth
\ INCLUDE ../lib/rp2350/drivers/pwm.fth
\ INCLUDE ../lib/rp2350/drivers/adc.fth
\ INCLUDE ../lib/rp2350/drivers/trng.fth

27 CONSTANT LED        \ an LED (Maker Pi Pico: every GPIO has one; not GP28,
                       \ which also drives the RGB LED: PWM on it lights that up)
18 CONSTANT BUZZER     \ Maker Pi Pico piezo (its mute switch must be off)
20 CONSTANT BUTTON     \ Maker Pi Pico GP20 button, pulls the pin low

VARIABLE FAILS   0 FAILS !
: RESULT ( flag -- )  IF ."  PASS" ELSE ."  FAIL" 1 FAILS +! THEN CR ;

\ TIMER0 counts microseconds: 100 MS should take 100000 us, give or take
: T-TIMER ( -- )
   TIMER0.INIT  MICROS 100 MS MICROS SWAP -
   ." timer: 100 ms took " DUP . ." us"
   DUP 99900 > SWAP 100500 < AND RESULT ;

\ an alarm interrupt every 10 ms for 105 ms: about 10 calls
VARIABLE ALARMS
: TICK ( -- )  1 ALARMS +! ;
: T-ALARM ( -- )
   0 ALARMS !  ['] TICK 1 TIMER0.HANDLER!  10000 1 TIMER0.ALARM-EVERY
   105 MS  1 TIMER0.ALARM-OFF
   ." alarm: " ALARMS @ DUP . ." interrupts in 105 ms"
   DUP 9 > SWAP 12 < AND RESULT ;

\ drive the LED pin and read it back through its input
: T-GPIO ( -- )
   LED GPIO.OUT  LED GPIO.HIGH  LED GPIO.READ
   LED GPIO.LOW  LED GPIO.READ 0=  AND
   ." gpio: GP" LED . ." reads back high and low" RESULT ;

\ the on-chip temperature sensor: room temperature, roughly
: T-ADC ( -- )
   ADC.INIT  ADC.TEMP  ." adc: chip at " DUP . ." C"
   DUP 5 > SWAP 50 < AND RESULT ;

\ four random numbers: all different, none 0
CREATE RN  4 CELLS ALLOT
: RN@ ( i -- u )  CELLS RN + @ ;
: T-TRNG ( -- )
   TRNG.INIT  4 0 DO  TRNG.RANDOM  I CELLS RN + !  LOOP
   ." trng: "  4 0 DO  I RN@ U.  LOOP
   TRUE  4 0 DO  I RN@ 0<> AND  LOOP
   3 0 DO  4 I 1+ DO  I RN@ J RN@ <> AND  LOOP  LOOP
   RESULT ;

\ PWM: two beeps on the buzzer, then the LED fades up. Not self-checking.
: T-PWM ( -- )
   PWM.RESET
   BUZZER 2000 50 PWM.START  200 MS  BUZZER 1000 PWM.FREQ  200 MS  BUZZER PWM.OFF
   LED 1000 0 PWM.START
   101 0 DO  LED I PWM.DUTY  10 MS  LOOP
   LED PWM.OFF  LED GPIO.OUT  LED GPIO.LOW
   ." pwm: you should have heard two beeps, high then low, and seen GP" LED . ." fade up" CR ;

\ GPIO interrupt: count presses of the button for 10 seconds
VARIABLE PRESSES
: PRESSED ( -- )  BUTTON GPIO.IRQ? IF BUTTON GPIO.IRQ-CLEAR 1 PRESSES +! THEN ;
: T-BUTTON ( -- )
   0 PRESSES !  BUTTON GPIO.IN-PULLUP  BUTTON GPIO.IRQ-CLEAR  BUTTON GPIO.FALL
   ['] PRESSED GPIO.IRQ IRQ!  10000 MS  0 GPIO.IRQ IRQ!  BUTTON GPIO.EDGE-LOW GPIO.IRQ-OFF
   ." button: " PRESSES @ DUP . ." presses counted"
   3 < 0= RESULT ;          \ bounce can count a press twice: 3 or more passes

\ UART1 loopback, GP4 TX to GP5 RX: skipped without the wire
: T-UART ( -- )
   115200 UART1.INIT DROP  4 5 UART1.PINS  2 MS      \ let the line settle, then empty the FIFO
   BEGIN UART1.KEY? WHILE UART1.KEY DROP REPEAT
   $41 UART1.EMIT  100000 UART1.KEY-WAIT
   DUP -1 = IF DROP ." uart: nothing back: no wire from GP4 to GP5, skipped" CR EXIT THEN
   ." uart: sent 65, got " DUP . 65 = RESULT ;

: SUMMARY ( -- )  FAILS @ . ." test(s) failed" CR  FAILS @ ABORT" a library test failed" ;

\ ------------------------------------------------------------
\ The tests, one line each, so the console shows each as it ends
\ ------------------------------------------------------------
DECIMAL
T-TIMER
T-ALARM
T-GPIO
T-ADC
T-TRNG
T-PWM
.( press the GP20 button three times in the next 10 seconds) CR
T-BUTTON
T-UART
SUMMARY

\ gpio-cookbook.fth - Pico 2: GPIO patterns with gpio.fth.
\ Sending this file only defines words: no pin changes until you run one.
\ Pins: LED 28 (as in blink.fth), BIG-LED 16,
\ BTN 20 (to ground), BTN2 15 (to 3V3), OD-PIN 18, FAST-PIN 17.
\ Quick reference (gpio.fth):
\   output            gpio GPIO.OUT           gpio GPIO.HIGH  GPIO.LOW  GPIO.TOGGLE
\   input             gpio GPIO.IN            gpio GPIO.READ ( -- flag )
\   pull-up / -down   gpio GPIO.IN-PULLUP     gpio GPIO.IN-PULLDOWN
\   open drain        gpio GPIO.OD            gpio GPIO.OD-LOW  GPIO.OD-RELEASE
\   drive strength    gpio GPIO.2MA ( 4MA 8MA 12MA ) GPIO.DRIVE
\   pin function      gpio GPIO.F-UART ( F-SPI F-I2C F-PWM F-SIO ) GPIO.FUNC

\ INCLUDE gpio.fth
\ INCLUDE timer.fth

\ 1. An LED: push-pull output, 8 mA.
28 CONSTANT LED
: LED-SETUP ( -- )  LED GPIO.OUT  LED GPIO.8MA GPIO.DRIVE ;

\ BLINK ( n -- )  flash it n times, 200 ms on, 200 ms off.
: BLINK ( n -- )  TIMER0 TIMER.INIT  LED-SETUP  2* ?DUP IF 0 DO  LED GPIO.TOGGLE  200 MS  LOOP THEN ;

\ 2. A bigger load: 12 mA, the most a pad gives.
16 CONSTANT BIG-LED
: BIG-LED-SETUP ( -- )  BIG-LED GPIO.OUT  BIG-LED GPIO.12MA GPIO.DRIVE ;

\ 3. A button to ground, internal pull-up: pressed reads low.
20 CONSTANT BTN
: BTN-SETUP ( -- )  BTN GPIO.IN-PULLUP ;
: BUTTON-PRESSED? ( -- flag )  BTN GPIO.READ 0= ;

\ 4. A button to 3V3, internal pull-down: pressed reads high.
15 CONSTANT BTN2
: BTN2-SETUP ( -- )  BTN2 GPIO.IN-PULLDOWN ;
: BUTTON2-PRESSED? ( -- flag )  BTN2 GPIO.READ ;

\ 5. Open drain (a shared line with a pull-up): low, or let go.
18 CONSTANT OD-PIN
: OD-SETUP ( -- )  OD-PIN GPIO.OD  OD-PIN GPIO.4MA GPIO.DRIVE ;
: OD-PULL-LOW ( -- )  OD-PIN GPIO.OD-LOW ;
: OD-RELEASE ( -- )  OD-PIN GPIO.OD-RELEASE ;

\ 6. Drive strength changed later.
: LED-QUIET ( -- )  LED GPIO.2MA GPIO.DRIVE ;
: LED-LOUD ( -- )   LED GPIO.12MA GPIO.DRIVE ;

\ 7. Pins for peripherals: UART0 TX on GP0, PWM on GP16, PIO0 on GP2.
: PERIPH-PINS ( -- )  0 GPIO.F-UART GPIO.FUNC  16 GPIO.F-PWM GPIO.FUNC  2 6 GPIO.FUNC ;   \ 6: PIO0

\ 8. A fast edge: higher drive and the fast slew rate (pad bit 0).
17 CONSTANT FAST-PIN
: FAST-SETUP ( -- )  FAST-PIN GPIO.OUT  FAST-PIN GPIO.8MA GPIO.DRIVE  FAST-PIN 1 0 PAD.BITS ;

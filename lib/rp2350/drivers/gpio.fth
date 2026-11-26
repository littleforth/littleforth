\ gpio.fth - GPIO pins (SIO), pads and pin functions.
\ 28 GPIO.OUT  28 GPIO.HIGH  28 GPIO.TOGGLE
\ 15 GPIO.IN-PULLUP  15 GPIO.READ .        \ -1 high, 0 low
\ 4 GPIO.OD  4 GPIO.OD-LOW  4 GPIO.OD-RELEASE   \ open drain, needs a pull-up
\ 28 GPIO.12MA GPIO.DRIVE

\ INCLUDE core.fth

1  CONSTANT GPIO.F-SPI           \ FUNCSEL values
2  CONSTANT GPIO.F-UART
3  CONSTANT GPIO.F-I2C
4  CONSTANT GPIO.F-PWM
5  CONSTANT GPIO.F-SIO
31 CONSTANT GPIO.F-NULL          \ disconnected

$02  CONSTANT PAD.SCHMITT        \ pad register bits
$04  CONSTANT PAD.PDE            \ pull-down
$08  CONSTANT PAD.PUE            \ pull-up
$30  CONSTANT PAD.DRIVE          \ drive strength, bits 5:4
$40  CONSTANT PAD.IE             \ input enable
$80  CONSTANT PAD.OD             \ output disable (driver off)
$100 CONSTANT PAD.ISO            \ isolation, set after reset

0 CONSTANT GPIO.2MA   1 CONSTANT GPIO.4MA   2 CONSTANT GPIO.8MA   3 CONSTANT GPIO.12MA

: GPIO.PIN   ( gpio -- mask )  1 SWAP LSHIFT ;
: PAD.ADDR   ( gpio -- a )     4 * PADS_BANK0 + 4 + ;
: PAD.BITS   ( gpio set clear -- )      \ set some bits, clear others
   ROT PAD.ADDR >R  R@ @ SWAP INVERT AND OR  R> ! ;
: GPIO.CTRL! ( gpio func -- )  SWAP 8 * IO_BANK0 + 4 + ! ;

\ Connect a pin to a function as the Pico SDK does: input on, driver on,
\ FUNCSEL, then isolation off.
: GPIO.FUNC  ( gpio func -- )
   OVER PAD.IE PAD.OD PAD.BITS
   OVER SWAP GPIO.CTRL!
   PAD.ISO SWAP PAD.ADDR $3000 + ! ;
: GPIO.DRIVE ( gpio drive -- )  4 LSHIFT PAD.DRIVE PAD.BITS ;

: GPIO.HIGH    ( gpio -- )  GPIO.PIN SIO.GPIO_OUT_SET ! ;
: GPIO.LOW     ( gpio -- )  GPIO.PIN SIO.GPIO_OUT_CLR ! ;
: GPIO.TOGGLE  ( gpio -- )  GPIO.PIN SIO.GPIO_OUT_XOR ! ;
: GPIO.OE-ON   ( gpio -- )  GPIO.PIN SIO.GPIO_OE_SET ! ;
: GPIO.OE-OFF  ( gpio -- )  GPIO.PIN SIO.GPIO_OE_CLR ! ;
: GPIO.READ    ( gpio -- flag )  \ input on just for the read if it was off (E9)
   DUP PAD.ADDR @ PAD.IE AND IF GPIO.PIN SIO.GPIO_IN @ AND 0<> EXIT THEN
   DUP PAD.IE 0 PAD.BITS  SIO.GPIO_IN @ DROP
   DUP GPIO.PIN SIO.GPIO_IN @ AND 0<>  SWAP 0 PAD.IE PAD.BITS ;

: GPIO.OUT ( gpio -- )  DUP GPIO.F-SIO GPIO.FUNC  GPIO.OE-ON ;
: GPIO.IN-PULLS ( gpio set clear -- )   \ an input with these pull bits
   >R >R DUP GPIO.F-SIO GPIO.FUNC  DUP R> R> PAD.BITS  GPIO.OE-OFF ;
: GPIO.IN          ( gpio -- )  0 PAD.PUE PAD.PDE OR GPIO.IN-PULLS ;
: GPIO.IN-PULLUP   ( gpio -- )  PAD.PUE PAD.PDE GPIO.IN-PULLS ;
: GPIO.IN-PULLDOWN ( gpio -- )  \ input off between reads: RP2350-E9 (A2 chips)
   DUP PAD.PDE PAD.PUE GPIO.IN-PULLS  0 PAD.IE PAD.BITS ;

\ Open drain: output held low; enabling the driver pulls the line low,
\ disabling it lets the pull-up take it high.
: GPIO.OD ( gpio -- )  DUP GPIO.F-SIO GPIO.FUNC  DUP GPIO.LOW  GPIO.OE-OFF ;
: GPIO.OD-LOW     ( gpio -- )  GPIO.OE-ON ;
: GPIO.OD-RELEASE ( gpio -- )  GPIO.OE-OFF ;

\ blink.fth - Pico 2: flash an LED. LED is the GPIO pin: 28 here, with an LED
\ and a resistor (about 330 ohms) from GP28 to GND. The Pico 2's own LED is
\ GPIO 25; the Pico 2 W's is on its wireless chip, out of reach. On a base board
\ with an LED per GPIO (a Cytron Maker Pi Pico) any pin works. Change only the
\ number in LED.
\ Use:  10 BLINK  flashes it ten times.
\ Register names (SIO.GPIO_OUT_XOR and the rest) come from the firmware's register
\ table, so nothing needs loading first.

\ LED  the GPIO pin with the LED on it.
28 CONSTANT LED

\ LED-INIT ( -- )  make the LED pin a plain output: give the pin to SIO (the
\ CPU's own GPIO block), take its pad out of isolation (the RP2350 starts
\ pads isolated; $3000 is the register's clear-bits alias), enable the output.
: LED-INIT ( -- )
   5 IO_BANK0 LED 8 * + 4 + !                \ GPIOn_CTRL: FUNCSEL 5 = SIO
   $100 PADS_BANK0 LED 4 * + 4 + $3000 + !   \ GPIOn pad: clear ISO via the atomic clear alias
   1 LED LSHIFT SIO.GPIO_OE_SET ! ; 

\ WAIT ( n -- )  busy-wait roughly n milliseconds at 150 MHz (not calibrated).
: WAIT ( n -- ) 0 DO 20000 0 DO LOOP LOOP ;

\ BLINK ( n -- )  flash the LED n times: flip it (XOR), wait 250 ms, 2n times.
: BLINK ( n -- ) LED-INIT 2* 0 DO 1 LED LSHIFT SIO.GPIO_OUT_XOR ! 250 WAIT LOOP ;

\ 2BLINK ( -- -- )  flash the LED 2 times.
: 2BLINK ( -- -- ) 2 BLINK ;


\ LEDON ( -- -- )  turn LED n on.
: LEDON ( -- -- ) LED-INIT 1 LED LSHIFT SIO.GPIO_OUT_SET ! ;

\ LEDOFF ( -- -- )  turn LED n off.
: LEDOFF ( -- -- ) LED-INIT 1 LED LSHIFT SIO.GPIO_OUT_CLR ! ;

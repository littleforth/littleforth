\ pwm-fade.fth - Pico 2: fade an LED up and down with PWM.
\ Use:  3 FADE  three breaths;  BREATHE  breathes until reset.
\ LED is the GPIO pin: 28, as in blink.fth (on a Cytron Maker Pi Pico base
\ any GPIO has an LED).

\ INCLUDE pwm.fth
\ INCLUDE timer.fth

28 CONSTANT LED

\ FADE-SETUP ( -- )  PWM out of reset, LED at 1 kHz and 0 %, the timer for MS.
: FADE-SETUP ( -- )  PWM.RESET  TIMER0 TIMER.INIT  LED 1000 0 PWM.START ;

\ FADE-UP ( -- )  0 % to 100 % in 1 % steps, 15 ms each.
: FADE-UP ( -- )  101 0 DO  LED I PWM.DUTY  15 MS  LOOP ;

\ FADE-DOWN ( -- )  100 % back to 0 %.
: FADE-DOWN ( -- )  0 100 DO  LED I PWM.DUTY  15 MS  -1 +LOOP ;

\ FADE ( n -- )  n breaths, then off.
: FADE ( n -- )  FADE-SETUP  ?DUP IF 0 DO  FADE-UP FADE-DOWN  LOOP THEN  LED 0 PWM.DUTY ;

\ BREATHE ( -- )  breathe until the board is reset.
: BREATHE ( -- )  FADE-SETUP  BEGIN  FADE-UP FADE-DOWN  AGAIN ;

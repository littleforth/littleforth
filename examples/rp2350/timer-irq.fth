\ timer-irq.fth - Pico 2: a TIMER0 alarm interrupt handled in Forth.
\ The handler toggles the LED (LED, set in blink.fth) twice a second
\ and counts, while the console stays free.
\ Use:  START  then  HITS @ .  (repeat to see it grow)  then  STOP
\ Register names come from the firmware's register table. The IDE sends
\ blink.fth first (LED, LED-INIT); to paste by hand, paste it first.
\ INCLUDE blink.fth

\ HITS  counts interrupts.
VARIABLE HITS

\ REARM ( -- )  set alarm 0 to fire 500000 us (0.5 s) from now.
: REARM ( -- ) TIMER0.TIMERAWL @ 500000 + TIMER0.ALARM0 ! ;

\ TICK ( -- )  the interrupt handler: acknowledge alarm 0, count, toggle the LED,
\ set the next alarm.
: TICK ( -- ) 1 TIMER0.INTR !  1 HITS +!  1 LED LSHIFT SIO.GPIO_OUT_XOR !  REARM ;

\ START ( -- )  take TIMER0 out of reset, tick it at 1 us, set up the LED, attach
\ TICK to IRQ 0 (TIMER0_IRQ_0) and set the first alarm.
: START ( -- )
   1 23 LSHIFT RESETS.RESET $3000 + !                  \ clear TIMER0's reset bit ($3000: clear alias)
   BEGIN RESETS.RESET_DONE @ 1 23 LSHIFT AND UNTIL     \ wait until it is out of reset
   12 TICKS.TIMER0_CYCLES !  1 TICKS.TIMER0_CTRL !     \ 1 us ticks from the 12 MHz clk_ref
   LED-INIT  0 HITS !  1 TIMER0.INTE !  ['] TICK 0 IRQ!  REARM ;

\ STOP ( -- )  disable the alarm interrupt and detach the handler.
: STOP ( -- ) 0 TIMER0.INTE !  0 0 IRQ! ;

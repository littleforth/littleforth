\ gpio-irq.fth - GPIO interrupts (IO_IRQ_BANK0, IRQ 21), core 0.
\ 15 GPIO.IN-PULLUP  15 GPIO.FALL
\ VARIABLE HITS
\ : BUTTON 15 GPIO.IRQ? IF 15 GPIO.IRQ-CLEAR 1 HITS +! THEN ;
\ ' BUTTON GPIO.IRQ IRQ!         0 GPIO.IRQ IRQ! to remove it

\ INCLUDE gpio.fth

21 CONSTANT GPIO.IRQ
0 CONSTANT GPIO.LEVEL-LOW   1 CONSTANT GPIO.LEVEL-HIGH
2 CONSTANT GPIO.EDGE-LOW    3 CONSTANT GPIO.EDGE-HIGH

\ GPIO n's events are bits 4*(n mod 8) .. +3 of register n/8
: GPIO.IRQ-BIT ( gpio event -- mask offset )
   SWAP 8 /MOD >R  4 * +  1 SWAP LSHIFT  R> 4 * ;
: GPIO.IRQ-ALL ( gpio -- mask offset )
   8 /MOD 4 * >R  4 * $F SWAP LSHIFT  R> ;

: GPIO.IRQ-ON  ( gpio event -- )  GPIO.IRQ-BIT IO_BANK0.PROC0_INTE0 + $2000 + ! ;   \ SET alias
: GPIO.IRQ-OFF ( gpio event -- )  GPIO.IRQ-BIT IO_BANK0.PROC0_INTE0 + $3000 + ! ;   \ CLR alias
: GPIO.IRQ-CLEAR ( gpio -- )      GPIO.IRQ-ALL IO_BANK0.INTR0 + ! ;   \ latched edges
: GPIO.IRQ? ( gpio -- flag )      GPIO.IRQ-ALL IO_BANK0.INTR0 + @ AND 0<> ;

: GPIO.FALL ( gpio -- )  GPIO.EDGE-LOW  GPIO.IRQ-ON ;
: GPIO.RISE ( gpio -- )  GPIO.EDGE-HIGH GPIO.IRQ-ON ;
: GPIO.BOTH ( gpio -- )  DUP GPIO.FALL GPIO.RISE ;

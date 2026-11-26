\ irqhigh.fth - IRQ! on interrupts above 31 (Cortex-M33 test board, NIRQ 64).
\ Bug 7: IRQ! enabled 1 << n in the first NVIC register only, so interrupts
\ 32 and up were never enabled (the Pico 2's UART0 is IRQ 33).
\ INCLUDE trigger.fth
VARIABLE H40  VARIABLE H33
: T40 1 H40 +! ;  : T33 1 H33 +! ;
' T40 40 IRQ!  ' T33 33 IRQ!
40 TRIGGER  33 TRIGGER  40 TRIGGER
H40 @ . H33 @ .
0 40 IRQ!  40 TRIGGER  H40 @ .

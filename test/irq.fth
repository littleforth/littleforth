\ irq.fth - interrupt handlers in Forth (target only; compare irq.expect).
\ TRIGGER (trigger.fth) sets an IRQ pending in software.
\ INCLUDE trigger.fth
VARIABLE HITS
: HANDLER 1 HITS +! 7 8 9 DROP DROP DROP ;
' HANDLER 5 IRQ!
5 TRIGGER 5 TRIGGER 5 TRIGGER
HITS @ .
1 2 3 5 TRIGGER . . .
0 5 IRQ!
5 TRIGGER HITS @ .

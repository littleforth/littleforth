\ code-blink.fth - Pico 2: the LED blinked by machine code, written in ARM's own
\ syntax (as the ARM books, SEE and the Disassembly view write it). VS Code
\ assembles each CODE block and sends the bytes: nothing needs loading first.
\ tos is r6 (the top of the data stack) and psp r5 (the rest of it, full
\ descending); return with bx lr; r0-r3 and r12 are free, keep r4 and r7-r11.
\ Use:  5 FLASH  flashes the LED five times. Set a breakpoint on a line inside
\ a CODE block and the debugger stops there and steps line by line.
\ INCLUDE blink.fth

\ TOGGLE ( -- )  flip the LED: write its bit to SIO's XOR register.
CODE TOGGLE ( -- )
    ldr  r0, =SIO.GPIO_OUT_XOR   \ any value or register name: movw/movt
    movs r1, #1
    ldr  r2, =LED                \ a CONSTANT: its value read from the board
    lsls r1, r1, r2              \ 1 << LED
    str  r1, [r0]
    bx   lr
END-CODE

\ SPIN ( n -- )  count n (above 0) down to 0, about 50 million a second.
CODE SPIN ( n -- )
loop:
    subs r6, r6, #1
    bne  loop
    ldr  r6, [r5], #4            \ drop: the next item up becomes the top
    bx   lr
END-CODE

\ FLASH ( n -- )  flash the LED n times, about 4 a second.
: FLASH ( n -- )  LED-INIT 2* 0 DO TOGGLE 6000000 SPIN LOOP ;

\ asm-blink.fth - Pico 2: the LED blinked by machine code written here.
\ Each CODE word is a few Thumb-2 instructions; the comment on each line is
\ the same instruction as the ARM books (and SEE, and the debugger) write it.
\ Use:  5 FLASH  flashes the LED five times.  SEE TOGGLE  shows TOGGLE's code
\ as the board holds it, to compare with what you wrote.
\ INCLUDE ../../lib/thumb2/asm.fth
\ INCLUDE blink.fth

\ TOGGLE ( -- )  flip the LED: write its bit to SIO's XOR register.
CODE TOGGLE ( -- )
  r0 SIO.GPIO_OUT_XOR mov32,        \ movw r0, #lo16 ; movt r0, #hi16
  r1 1 LED LSHIFT mov32,            \ mov.w r1, #(1 << LED)
  r1 r0 0 str,                      \ str r1, [r0, #0]
  ret,                              \ bx lr
END-CODE

\ SPIN ( n -- )  count n (above 0) down to 0, about 50 million a second.
CODE SPIN ( n -- )
  BEGIN,                            \ 1:
    tos tos 1 subs,                 \    subs r6, r6, #1
  eq UNTIL,                         \    bne.w 1b
  tos popd,                         \ ldr r6, [r5], #4   (the next item up)
  ret,                              \ bx lr
END-CODE

\ FLASH ( n -- )  flash the LED n times, about 4 a second.
: FLASH ( n -- )  LED-INIT 2* 0 DO TOGGLE 6000000 SPIN LOOP ;

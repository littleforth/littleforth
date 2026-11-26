\ core.fth - shared by the RP2350 libraries.
\ Registers come from the table built into the firmware (UART1.UARTDR,
\ IO_BANK0 ...), so no register files are loaded. A word TYPE.WORD of a
\ peripheral with several instances takes the instance's base last, and
\ INSTANCE.WORD supplies it: UART1.EMIT is UART1 UART.EMIT.

: UNRESET ( mask -- )            \ release from reset and wait until ready
   DUP RESETS.RESET $3000 + !
   BEGIN DUP RESETS.RESET_DONE @ AND OVER = UNTIL DROP ;
: HOLD-RESET ( mask -- )  RESETS.RESET $2000 + ! ;

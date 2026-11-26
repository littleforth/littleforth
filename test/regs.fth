\ regs.fth - the register table (A12): INSTANCE.MEMBER and INSTANCE alone,
\ any case, any BASE; shared types; inside definitions; dictionary words first.
HEX
IO_BANK0.PROC0_INTE0 U. UART1.UARTDR U. uart0.uartfr U.
ADC U. ADC.CS U.
USB_DPRAM.EP1_OUT_CONTROL U. PPB.TRCPRGCTLR U.
: R1 UART1.UARTDR IO_BANK0 ; R1 U. U.
DECIMAL
UART1.NOPE
NOPE.UARTDR
: UART1.UARTDR 7 ; UART1.UARTDR .
\ INSTANCE.WORD finds TYPE.WORD (the instance's type, from the register table) and
\ calls it with the instance's base on the stack; registers still come first.
: UART.BASE ( base -- ) HEX U. DECIMAL ;
UART1.BASE UART0.BASE
: UART.TWICE ( n base -- 2n ) DROP 2* ;
: T2 21 UART1.TWICE ; T2 .
I2C1.BASE
: UART.UARTDR ( base -- ) DROP 99 . ;
UART0.UARTDR HEX U. DECIMAL
\ an instance word's lookup leaves memory above HERE alone (a program's string there)
$41 HERE C!  UART0.BASE  HERE C@ .
\ and leaves WORD's buffer alone (a program may keep WORD's result meanwhile)
: UART.NOP ( base -- ) DROP ;  BL WORD HELLO UART0.NOP COUNT TYPE

\ flash.fth - SAVE and EMPTY on the Pico 2: the save area (the last 128 KB of
\ flash) through the boot ROM's flash routines. They run with XIP off, so
\ nothing in flash may be read meanwhile: these words and the kernel are in RAM.
\ INCLUDE kernel.fth
\ INCLUDE ../../thumb2/call.fth
: ROM ( c1 c2 -- fn ) 8 LSHIFT OR 4 0 0 $16 H@ CALL ;   \ the boot ROM's lookup
CHAR I CHAR F ROM CONSTANT ROM-CONNECT
CHAR E CHAR X ROM CONSTANT ROM-XIP-EXIT
CHAR F CHAR C ROM CONSTANT ROM-FLUSH
CHAR C CHAR X ROM CONSTANT ROM-XIP-ENTER
CHAR R CHAR E ROM CONSTANT ROM-ERASE
CHAR R CHAR P ROM CONSTANT ROM-PROGRAM
: CALL0 ( fn -- ) >R 0 0 0 0 R> CALL DROP ;
: XIP-OFF ( -- ) ROM-CONNECT CALL0 ROM-XIP-EXIT CALL0 ;
: XIP-ON ( -- ) ROM-FLUSH CALL0 ROM-XIP-ENTER CALL0 ;
\ Interrupts are off meanwhile: a handler that failed with XIP off would leave
\ it off, and every later read of flash would fault. They are on after, even if
\ they were off before.
4096 CONSTANT FLASH-PAGE   \ what FLASH-ERASE erases: one 4 KB sector
: FLASH-ERASE ( a -- ) DINT XIP-OFF $10000000 - 4096 65536 $D8 ROM-ERASE CALL DROP XIP-ON EINT ;
: FLASH-WRITE ( src dst n -- ) DINT XIP-OFF >R $10000000 - SWAP R> 0 ROM-PROGRAM CALL DROP XIP-ON EINT ;
\ INCLUDE ../../save.fth

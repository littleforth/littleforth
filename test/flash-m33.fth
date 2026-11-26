\ flash-m33.fth - SAVE and EMPTY in Forth on the M33 test board: the save area
\ is RAM that QEMU keeps across a reset, written as flash would be (AND).
\ INCLUDE ../build/an505-kernel.fth
4096 CONSTANT FLASH-PAGE
: FLASH-ERASE ( a -- ) FLASH-PAGE -1 FILL ;
: FLASH-WRITE ( src dst n -- )
   0 DO  OVER I + @  OVER I + @ AND  OVER I + !  4 +LOOP  2DROP ;
\ INCLUDE ../lib/save.fth

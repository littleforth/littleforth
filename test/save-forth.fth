\ save-forth.fth - the Forth SAVE / REBOOT / EMPTY round trip on the M33 test
\ board (compare save-forth.expect); the image is read back by the kernel.
\ INCLUDE flash-m33.fth
EMPTY REBOOT
\ INCLUDE flash-m33.fth
: KEPT 111 ; VARIABLE KV 222 KV ! SAVE
: LOST 333 ;
REBOOT
KEPT . KV @ .
LOST
EMPTY REBOOT
KEPT
\ CALL (lib/thumb2/call.fth, as the Pico 2's flash driver uses it to reach
\ the boot ROM), on a word that is adds r0,r0,r1; bx lr
\ INCLUDE ../lib/thumb2/call.fth
: ADD01 [ -2 ALLOT $47701840 , ] ; -2 ALLOT
5 7 100 200 ' ADD01 CALL . DEPTH .
\ an image over several 4 KB pages: erased and written whole, read back
\ INCLUDE flash-m33.fth
CREATE BIG 9000 ALLOT  BIG 9000 + 4 - CONSTANT ENDCELL  $12345678 ENDCELL !  SAVE
REBOOT
ENDCELL @ HEX . DECIMAL
\ a kernel.fth from another build is refused: its 'HERE is elsewhere
CREATE ELSEWHERE 0 ,  : 'HERE ELSEWHERE ;
\ INCLUDE ../lib/save.fth

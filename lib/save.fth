\ save.fth - SAVE and EMPTY in Forth, for boards whose kernel leaves them out.
\ SAVE copies the dictionary into the save area, which the kernel reads back
\ at boot when its first cell is MAGIC. The header page is written last, so a
\ SAVE cut short leaves no valid image. The board's flash driver includes this
\ file after defining DICT0 SAVE-AREA SAVE-SIZE 'HERE 'LATEST STAMP BLOCKS (its kernel.fth)
\ and FLASH-PAGE ( -- n ), FLASH-ERASE ( a -- ), which erases FLASH-PAGE bytes
\ at a, and FLASH-WRITE ( src dst n -- ), whole 256-byte pages.
: KERNEL? ( -- )   \ kernel.fth must come from the firmware on the board
   'HERE @ HERE <> ABORT" kernel.fth is not for this firmware: rebuild it" ;
KERNEL?
: MAGIC ( -- x ) $464F5254 STAMP XOR ;   \ as the kernel's magic() (src/hw.c)
: SAVE ( -- )
   HERE DICT0 - 255 + -256 AND >R                  \ length, in whole pages
   R@ 256 + SAVE-SIZE > ABORT" save area full"
   R@ 256 + 0 DO SAVE-AREA I + FLASH-ERASE FLASH-PAGE +LOOP
   DICT0 SAVE-AREA 256 + R@ FLASH-WRITE
   HERE 256 -1 FILL                                \ the header, built at HERE
   MAGIC HERE !  HERE HERE CELL+ !  'LATEST @ HERE 8 + !  R> HERE 12 + !
   HERE SAVE-AREA 256 FLASH-WRITE ;
: START ( -- a )   \ where the dictionary starts: above a library block's RAM, as at boot
   BLOCKS IF BLOCKS @ MAGIC = IF BLOCKS CELL+ @ EXIT THEN THEN DICT0 ;
: EMPTY ( -- ) SAVE-AREA FLASH-ERASE  START 'HERE !  0 'LATEST ! ;

\ full-m33.fth - full.fth on the M33 test board, whose kernel has no EMPTY
\ (it is Forth there, lib/save.fth). EMPTY here only resets the dictionary to
\ the mark after its own definition, which is what full.fth needs of it.
\ INCLUDE ../build/an505-kernel.fth
CREATE MARK 0 , 0 ,
: EMPTY ( -- ) MARK @ 'HERE !  MARK CELL+ @ 'LATEST ! ;
HERE MARK !  'LATEST @ MARK CELL+ !
\ INCLUDE full.fth
\ full.fth's last case again, from the real start of the dictionary (its own
\ EMPTY above stops at the mark, so -40 ALLOT there is not below the start)
DICT0 'HERE !  0 'LATEST !  -40 ALLOT
: Z 6 ; Z .

\ errors.fth - output checks (compare errors.expect). Error codes print in
\ decimal whatever BASE is (bug 1), and an error leaves BASE decimal.
HEX
NOSUCHWORD
BASE @ .
1 2 3 DEPTH . : HALF 1 2 NOWORD ;
DEPTH .
HALF
: OK1 ." fine" ; OK1
-1 . 0 U. 255 .
\ A line longer than the 128-character buffer is refused whole with ?-18
\ (defect found by the independent check: it was cut silently).
.( xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) .( TAIL)
1 2 + .
\ Data stack overflow inside a compiled word: reported as ?-3 and the system
\ still works (defect found by the independent check: it corrupted the kernel).
: DD 0 DO I LOOP ; 70 DD
DEPTH . 1 2 + .

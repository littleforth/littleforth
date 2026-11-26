\ full.fth - the dictionary's end (A10). `,` `C,` ALLOT and compiling stop
\ with ?-8 at the end; HERE never passes it, so the kernel's variables after
\ the dictionary are untouched and the system carries on.
VARIABLE HX
: SAVEH HERE HX ! ;
: CHK HERE HX @ = . ;
SAVEH 8 ALLOT -8 ALLOT CHK
: F BEGIN 0 , AGAIN ; F
1 2 + .
: G BEGIN 1 C, AGAIN ; G
1 2 + .
SAVEH 1000000000 ALLOT
CHK
: X 1 2 3 ;
1 2 + .
EMPTY : Y 5 ; Y .
\ A14: compiling outside a definition, or by an IMMEDIATE word, stops at the
\ end too (found by the independent review: it overran on target), and
\ ALLOT stops at the start.
EMPTY : F2 BEGIN ['] DUP COMPILE, AGAIN ; F2
1 2 + .
EMPTY : NI 1 ; : F3 BEGIN ['] NI COMPILE, AGAIN ; F3
1 2 + .
EMPTY : F4 BEGIN 7 POSTPONE LITERAL AGAIN ; F4
1 2 + .
EMPTY : M BEGIN POSTPONE DUP AGAIN ; IMMEDIATE : X M ;
1 2 + .
EMPTY -40 ALLOT
: Z 6 ; Z .

\ regress.fth - regression cases beyond core.fr. One case per bug found,
\ plus words and edges core.fr does not reach.
\ Needs tester.fr first.
DECIMAL
\ words outside CORE that this kernel has
T{ TRUE -> -1 }T  T{ FALSE -> 0 }T
T{ 1 2 <> -> TRUE }T  T{ 2 2 <> -> FALSE }T
T{ 0 0<> -> FALSE }T  T{ 5 0<> -> TRUE }T
T{ 1 2 NIP -> 2 }T  T{ 1 2 TUCK -> 2 1 2 }T
\ number prefixes and character literals (Forth 2012 text interpreter).
\ The next line is 85 characters: input lines longer than 84 were cut (bug 2).
T{ $10 -> 16 }T  T{ #10 -> 10 }T  T{ %101 -> 5 }T  T{ 'A' -> 65 }T  T{ $-10 -> -16 }T
T{ -0 -> 0 }T
\ 2/ is an arithmetic shift (a known bug in the earlier kernel)
T{ -7 2/ -> -4 }T  T{ -1 2/ -> -1 }T
\ 16-bit access, little endian
CREATE HB 4 ALLOT
T{ $1234 HB H! HB H@ -> $1234 }T
T{ $12345678 HB ! HB H@ -> $5678 }T
\ +LOOP boundary crossing, both directions and across the signed wrap
VARIABLE N  VARIABLE STP
: PL ( limit start step -- iterations ) STP ! 0 N ! DO 1 N +! STP @ +LOOP N @ ;
T{ 10 0 1 PL -> 10 }T
T{ 10 0 3 PL -> 4 }T
T{ 0 10 -1 PL -> 11 }T
T{ 0 10 -3 PL -> 4 }T
T{ -1 -10 4 PL -> 3 }T
T{ $7FFFFFFF $7FFFFFF0 4 PL -> 4 }T
\ nested loops: J and LEAVE from the inner loop
: NJ 0 3 0 DO 2 0 DO J + LOOP LOOP ;
T{ NJ -> 6 }T
: NL 0 3 0 DO 3 0 DO I 1 = IF LEAVE THEN 1+ LOOP LOOP ;
T{ NL -> 3 }T
\ several children of one DOES> word
: K2 CREATE , DOES> @ 2* ;
3 K2 K3  5 K2 K5
T{ K3 K5 -> 6 10 }T
VARIABLE VV
T{ ' VV >BODY -> VV }T
\ POSTPONE of a non-immediate word, RECURSE
: PD POSTPONE DUP ; IMMEDIATE
: PT 5 PD ;
T{ PT -> 5 5 }T
: FACT DUP 1 > IF DUP 1- RECURSE * THEN ;
T{ 5 FACT -> 120 }T
\ double-cell arithmetic on values that need all 64 bits
T{ 0 1 2 UM/MOD -> 0 $80000000 }T
T{ 7 0 3 UM/MOD -> 1 2 }T
T{ $10000 $10000 M* -> 0 1 }T
T{ $10000 $10000 UM* -> 0 1 }T
T{ -1 -1 -1 FM/MOD -> 0 1 }T
\ S" in interpretation state
T{ S" ab" NIP -> 2 }T
\ every inline primitive compiled into a definition (bug 3: GCC folded CHAR+
\ into a jump to 1+, and the copied jump hung the target)
: IL1 10 CHAR+ 10 1+ 10 1- 10 CELL+ 3 CELLS 7 CHARS ;
T{ IL1 -> 11 11 9 14 12 7 }T
: IL2 1 2 SWAP OVER DROP DUP NIP 3 4 2DROP ROT ;
T{ 9 IL2 -> 2 1 9 }T
: IL3 6 3 + 6 3 - 6 3 * 6 3 AND 6 3 OR 6 3 XOR 6 NEGATE 6 INVERT ;
T{ IL3 -> 9 3 18 2 7 5 -6 -7 }T
: IL4 1 4 LSHIFT -16 2/ -16 28 RSHIFT -5 S>D ;
T{ IL4 -> 16 -8 15 -5 -1 }T
: IL5 0 0= 5 0< -5 0< 3 3 = 3 4 < 4 3 > -1 1 U< 3 4 <> 7 0<> ;
T{ IL5 -> TRUE FALSE TRUE TRUE TRUE TRUE FALSE TRUE TRUE }T
CREATE IB 8 ALLOT
: IL6 $11223344 IB ! IB @ IB C@ 7 IB C! IB C@ $ABCD IB H! IB H@ ;
T{ IL6 -> $11223344 $44 7 $ABCD }T

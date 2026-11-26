\ asm.fth - CODE words made with lib/thumb2/asm.fth, run on the M33
\ (target only; compare asm.expect). tools/asmcheck.py run qemu33.
\ INCLUDE ../lib/thumb2/asm.fth
CODE 3+ ( n -- n+3 )  tos tos 3 adds,  ret,  END-CODE
4 3+ .
CODE SQUARE ( n -- n*n )  tos tos tos muls,  ret,  END-CODE
-9 SQUARE .
CODE PLUS ( a b -- a+b )  r0 popd,  tos tos r0 adds,  ret,  END-CODE
2 40 PLUS .
CODE DUP2 ( a -- a a )  tos pushd,  ret,  END-CODE
5 DUP2 . .
\ BEGIN, WHILE, REPEAT,
CODE SUM ( n -- 1+2+..+n )  r0 0 movs,
  BEGIN,  tos 0 cmp,  ne WHILE,  r0 r0 tos adds,  tos tos 1 subs,  REPEAT,
  tos r0 mov,  ret,  END-CODE
10 SUM .  0 SUM .
\ IF, ELSE, THEN, nested
CODE SGN ( n -- -1|0|1 )  tos 0 cmp,
  gt IF,  tos 1 movs,  ELSE,  lt IF,  tos -1 mov32,  THEN,  THEN,  ret,  END-CODE
5 SGN .  -5 SGN .  0 SGN .
\ an IT block
CODE MAX2 ( a b -- max )  r0 popd,  tos r0 cmp,  lt it,  tos r0 mov,  ret,  END-CODE
3 9 MAX2 .  9 3 MAX2 .  -4 -7 MAX2 .
\ UNTIL, and a divide
CODE DIGITS ( u -- n )  r0 0 movs,  r1 10 movs,
  BEGIN,  r0 r0 1 adds,  tos tos r1 udiv,  tos 0 cmp,  eq UNTIL,
  tos r0 mov,  ret,  END-CODE
12345 DIGITS .  0 DIGITS .  4294967295 DIGITS .
\ calling Forth words: lr saved around the calls
: TWICE ( n -- 2n ) 2* ;
CODE QUAD ( n -- 4n )  { lr } push,  ' TWICE bl,  ' TWICE bl,  { pc } pop,  END-CODE
7 QUAD .
\ memory: a VARIABLE's address as a constant
VARIABLE V
CODE V+! ( n -- )  r0 V mov32,  r1 r0 0 ldr,  r1 r1 tos adds,  r1 r0 0 str,  tos popd,  ret,  END-CODE
5 V !  3 V+!  V @ .
\ bit fields, CLZ, 64-bit multiply
CODE NIBBLE ( x -- bits 4-7 )  tos tos 4 4 ubfx,  ret,  END-CODE
$AB NIBBLE .
CODE LEADING ( x -- zeros )  tos tos clz,  ret,  END-CODE
1 LEADING .  -1 LEADING .
CODE UM*HI ( a b -- high32 )  r0 popd,  r1 tos r0 tos umull,  ret,  END-CODE
$80000000 4 UM*HI .
\ r4 kept: pushed and popped around its use
CODE FIVE ( -- 5 )  { r4 } push,  r4 5 movs,  tos pushd,  tos r4 mov,  { r4 } pop,  ret,  END-CODE
FIVE .
\ words after CODE words compile as usual
: AFTER ( n -- n+6 )  3+ 3+ ;
1 AFTER .
DEPTH .

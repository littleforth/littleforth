\ asm.fth - a Thumb-2 assembler for the Cortex-M33 (Pico 2), in Forth.
\
\ Postfix, operands in ARM's order, a comma on each mnemonic:
\   ARM:    adds r6, r6, #3        ldr r6, [r5], #4       push {r4, lr}
\   Forth:  tos tos 3 adds,        tos psp 4 []+ ldr,     { r4 lr } push,
\ A number where a register could go is an immediate (no #). The narrow
\ 16-bit form is used when one exists, as GNU as does; tools/asmcheck.py
\ checks every form against arm-none-eabi-as.
\
\ CODE name ... END-CODE makes a word from machine code. It is called with BL:
\ the top of the data stack in tos (r6), the rest below psp (r5), full
\ descending; return with ret, (bx lr). Free to use: r0-r3, r12. Keep r4,
\ r7-r11 and sp as they were (push and pop them). Example:
\   CODE 3+ ( n -- n+3 )  tos tos 3 adds,  ret,  END-CODE
\
\ Addressing: rt rn x ldr, is [rn, x] (x a register or an offset); put []!
\ before it for [rn, #x]! (pre-indexed, rn updated) or []+ for [rn], #x.
\ Branches: Forth-style, cond IF, ... ELSE, ... THEN,  BEGIN, ... cond
\ UNTIL,  BEGIN, ... cond WHILE, ... REPEAT,  BEGIN, ... AGAIN,  and
\ ' WORD bl, to call a word. cond is eq ne cs cc mi pl vs vc hi ls ge lt
\ gt le (hs = cs, lo = cc); IF, branches over its part when cond is false.

\ ---- registers: tagged so that a number is never taken for one ----
: reg:  ( n "name" -- )  $7A510000 OR CONSTANT ;
0 reg: r0   1 reg: r1   2 reg: r2   3 reg: r3   4 reg: r4   5 reg: r5
6 reg: r6   7 reg: r7   8 reg: r8   9 reg: r9   10 reg: r10  11 reg: r11
12 reg: r12  13 reg: sp  14 reg: lr  15 reg: pc
6 reg: tos   5 reg: psp     \ the Forth registers: top of stack, data stack
: reg?  ( x -- f )  -16 AND $7A510000 = ;
: lo?   ( x -- f )  -8 AND $7A510000 = ;            \ r0-r7
: #r    ( reg -- n )  15 AND ;
: ?reg  ( x -- x )  DUP reg? 0= ABORT" asm: a register is needed here" ;

\ ---- condition codes ----
0 CONSTANT eq  1 CONSTANT ne  2 CONSTANT cs  3 CONSTANT cc  4 CONSTANT mi
5 CONSTANT pl  6 CONSTANT vs  7 CONSTANT vc  8 CONSTANT hi  9 CONSTANT ls
10 CONSTANT ge  11 CONSTANT lt  12 CONSTANT gt  13 CONSTANT le
2 CONSTANT hs  3 CONSTANT lo

\ ---- emitting; inside an IT block the 16-bit forms don't set the flags ----
VARIABLE itn                                  \ instructions left in an IT block
: h,    ( x -- )  HERE H! 2 ALLOT ;
: it-   ( -- )  itn @ IF -1 itn +! THEN ;
: i16,  ( x -- )  h, it- ;
: i32,  ( hw1 hw2 -- )  SWAP h, h, it- ;
: s-ok  ( s -- f )  0<> itn @ 0= = ;          \ may a 16-bit form be used?

\ ---- operands, kept in variables while an instruction is built ----
VARIABLE 'd  VARIABLE 'n  VARIABLE 'x  VARIABLE 's  VARIABLE 'm
: d#  'd @ #r ;  : n#  'n @ #r ;  : x#  'x @ #r ;
: xreg?  'x @ reg? ;
: ops3  ( rd rn x -- )  'x !  ?reg 'n !  ?reg 'd ! ;
: ops2  ( rd x -- )  'x !  ?reg 'd !  pc 'n ! ;   \ rn = 15: MOV/MVN
: dn=  'd @ 'n @ = ;
: lo3  'd @ lo? 'n @ lo? AND 'x @ lo? AND ;

\ ---- 12-bit modified immediates (ThumbExpandImm) ----
: rol  ( x n -- x' )  2DUP LSHIFT >R 32 SWAP - RSHIFT R> OR ;
: b0b0  ( b -- b<<16|b )  DUP 16 LSHIFT OR ;
: mimm  ( v -- imm12 true | false )
  DUP 256 U< IF TRUE EXIT THEN
  DUP $FF AND b0b0 OVER = IF $FF AND $100 OR TRUE EXIT THEN
  DUP 8 RSHIFT $FF AND b0b0 8 LSHIFT OVER = IF 8 RSHIFT $FF AND $200 OR TRUE EXIT THEN
  DUP $FF AND DUP 8 LSHIFT OR b0b0 OVER = IF $FF AND $300 OR TRUE EXIT THEN
  32 8 DO
    DUP I rol DUP 256 U< SWAP 127 > AND
    IF I rol $7F AND I 7 LSHIFT OR TRUE UNLOOP EXIT THEN
  LOOP DROP FALSE ;
: imm12>  ( imm12 -- i hw2 )  DUP $800 AND 1 RSHIFT  SWAP DUP $700 AND 4 LSHIFT  SWAP $FF AND OR ;

\ wide data processing, rd 'd rn 'n, register or immediate 'x, S 's
: wide  ( op -- )
  5 LSHIFT 's @ 4 LSHIFT OR n# OR
  xreg? IF $EA00 OR  d# 8 LSHIFT x# OR  i32, EXIT THEN
  'x @ mimm 0= ABORT" asm: the immediate can't be encoded (try mov32,)"
  imm12> d# 8 LSHIFT OR >R  OR $F000 OR  R> i32, ;

\ AND BIC ORR ORN EOR ADC SBC (rd rn x): narrow = 0x4000 op, rd = rn, all low
: dp:  ( wide-op narrow-op s "name" -- )  CREATE , , ,  DOES>
  >R ops3  R@ @ 's !
  xreg? lo3 AND dn= AND 's @ s-ok AND R@ CELL+ @ 0< 0= AND
  IF R> CELL+ @ 6 LSHIFT $4000 OR x# 3 LSHIFT OR d# OR i16, EXIT THEN
  R> CELL+ CELL+ @ wide ;
0 0 0 dp: and,   0 0 1 dp: ands,   1 14 0 dp: bic,  1 14 1 dp: bics,
2 12 0 dp: orr,  2 12 1 dp: orrs,  3 -1 0 dp: orn,  3 -1 1 dp: orns,
4 1 0 dp: eor,   4 1 1 dp: eors,   10 5 0 dp: adc,  10 5 1 dp: adcs,
11 6 0 dp: sbc,  11 6 1 dp: sbcs,

\ ADD SUB (rd rn x)
: addsub  ( rd rn x sub? s -- )
  's ! >R ops3  R>                                     ( sub? )
  xreg? 0= IF 'x @ 0< IF 'x @ NEGATE 'x ! 0= 1 AND THEN THEN  \ add -n = sub n
  xreg? IF
    'd @ lo? 'n @ lo? AND 'x @ lo? AND 's @ s-ok AND
    IF 9 LSHIFT $1800 OR x# 6 LSHIFT OR n# 3 LSHIFT OR d# OR i16, EXIT THEN
    DUP 0= 's @ 0= AND dn= AND
    IF DROP 'd @ 8 AND 4 LSHIFT $4400 OR x# 3 LSHIFT OR d# 7 AND OR i16, EXIT THEN
    IF 13 ELSE 8 THEN wide EXIT
  THEN
  's @ 0= 'n @ sp = AND 'x @ 3 AND 0= AND IF                \ sp-relative
    'd @ sp = 'x @ 512 < AND
    IF 7 LSHIFT $B000 OR 'x @ 2 RSHIFT OR i16, EXIT THEN
    DUP 0= 'd @ lo? AND 'x @ 1024 < AND
    IF DROP $A800 d# 8 LSHIFT OR 'x @ 2 RSHIFT OR i16, EXIT THEN
  THEN
  's @ s-ok 'd @ lo? AND 'n @ lo? AND IF
    dn= 'x @ 256 < AND
    IF 11 LSHIFT $3000 OR d# 8 LSHIFT OR 'x @ OR i16, EXIT THEN
    'x @ 8 < IF 9 LSHIFT $1C00 OR 'x @ 6 LSHIFT OR n# 3 LSHIFT OR d# OR i16, EXIT THEN
  THEN
  'x @ mimm IF DROP IF 13 ELSE 8 THEN wide EXIT THEN
  's @ 0= 'x @ 4096 U< AND IF                               \ addw / subw
    IF $F2A0 ELSE $F200 THEN n# OR 'x @ imm12> d# 8 LSHIFT OR >R OR R> i32, EXIT
  THEN  TRUE ABORT" asm: the immediate can't be encoded" ;
: add,   0 0 addsub ;   : adds,  0 1 addsub ;
: sub,   1 0 addsub ;   : subs,  1 1 addsub ;

\ RSB (rd rn x): rsbs rd, rn, #0 is narrow
: rsb3  ( rd rn x s -- )  's ! ops3
  xreg? 0= 'x @ 0= AND 'd @ lo? AND 'n @ lo? AND 's @ s-ok AND
  IF $4240 n# 3 LSHIFT OR d# OR i16, EXIT THEN  14 wide ;
: rsb,  0 rsb3 ;  : rsbs,  1 rsb3 ;

\ MOV MVN (rd x)
: mov,  ( rd x -- )  ops2  0 's !
  xreg? IF 'd @ 8 AND 4 LSHIFT $4600 OR x# 3 LSHIFT OR d# 7 AND OR i16, EXIT THEN
  'd @ lo? 'x @ 256 U< AND 0 s-ok AND IF $2000 d# 8 LSHIFT OR 'x @ OR i16, EXIT THEN
  'x @ mimm IF DROP 2 wide EXIT THEN
  'x @ 65536 U< 0= ABORT" asm: the immediate can't be encoded (try mov32,)"
  'x @ DUP 12 RSHIFT $F240 OR SWAP $FFF AND imm12> d# 8 LSHIFT OR >R OR R> i32, ;
: movs,  ( rd x -- )  ops2  1 's !
  xreg? IF 'd @ lo? 'x @ lo? AND 1 s-ok AND IF x# 3 LSHIFT d# OR i16, EXIT THEN 2 wide EXIT THEN
  'd @ lo? 'x @ 256 U< AND 1 s-ok AND IF $2000 d# 8 LSHIFT OR 'x @ OR i16, EXIT THEN
  2 wide ;
: mvn3  ( rd x s -- )  's ! ops2
  xreg? 'd @ lo? AND 'x @ lo? AND 's @ s-ok AND
  IF $43C0 x# 3 LSHIFT OR d# OR i16, EXIT THEN  3 wide ;
: mvn,  0 mvn3 ;  : mvns,  1 mvn3 ;
: movwt  ( rd imm16 base -- )  >R SWAP ?reg #r 8 LSHIFT >R
  DUP 12 RSHIFT SWAP $FFF AND imm12> R> OR >R OR R> SWAP R> OR SWAP i32, ;
: movw,  ( rd imm16 -- )  $F240 movwt ;
: movt,  ( rd imm16 -- )  $F2C0 movwt ;
\ any 32-bit value into rd, flags untouched (one or two instructions)
: mov32,  ( rd n -- )
  DUP mimm IF DROP mov, EXIT THEN
  DUP INVERT mimm IF DROP INVERT mvn, EXIT THEN
  OVER OVER $FFFF AND movw,  16 RSHIFT ?DUP IF movt, ELSE DROP THEN ;

\ CMP CMN TST TEQ (rn x): the flags only
: cmp,  ( rn x -- )  'x ! ?reg 'n !  pc 'd !  1 's !
  xreg? IF 'n @ lo? 'x @ lo? AND IF $4280 x# 3 LSHIFT OR n# OR i16, EXIT THEN
    $4500 'n @ 8 AND 4 LSHIFT OR x# 3 LSHIFT OR n# 7 AND OR i16, EXIT THEN
  'n @ lo? 'x @ 256 U< AND IF $2800 n# 8 LSHIFT OR 'x @ OR i16, EXIT THEN
  'x @ 0< IF 'x @ NEGATE 'x ! 8 ELSE 13 THEN wide ;
: test:  ( wide-op narrow "name" -- )  CREATE , ,  DOES> >R
  'x ! ?reg 'n !  pc 'd !  1 's !
  xreg? 'n @ lo? AND 'x @ lo? AND R@ @ AND
  IF R> @ x# 3 LSHIFT OR n# OR i16, EXIT THEN  R> CELL+ @ wide ;
8 $42C0 test: cmn,   0 $4200 test: tst,   4 0 test: teq,

\ LSL LSR ASR ROR (rd rm x), x a shift count or a register
: shift  ( rd rm x type s -- )  's ! >R ops3 R>      ( type )
  xreg? IF
    lo3 dn= AND 's @ s-ok AND
    IF DUP 3 = IF DROP 7 ELSE 2 + THEN 6 LSHIFT $4000 OR x# 3 LSHIFT OR d# OR i16, EXIT THEN
    5 LSHIFT $FA00 OR 's @ 4 LSHIFT OR n# OR  $F000 d# 8 LSHIFT OR x# OR i32, EXIT
  THEN
  'x @ 32 AND IF 'x @ 31 AND 'x ! THEN                   \ lsr/asr #32 is 0
  DUP 3 < 'd @ lo? AND 'n @ lo? AND 's @ s-ok AND
  IF 11 LSHIFT 'x @ 6 LSHIFT OR n# 3 LSHIFT OR d# OR i16, EXIT THEN
  4 LSHIFT  'x @ 2 RSHIFT 12 LSHIFT OR  'x @ 3 AND 6 LSHIFT OR  d# 8 LSHIFT OR n# OR
  $EA4F 's @ 4 LSHIFT OR SWAP i32, ;
: lsl,  0 0 shift ;  : lsls,  0 1 shift ;  : lsr,  1 0 shift ;  : lsrs,  1 1 shift ;
: asr,  2 0 shift ;  : asrs,  2 1 shift ;  : ror,  3 0 shift ;  : rors,  3 1 shift ;

\ ---- multiply, divide ----
: rrr  ( rd rn rm -- d n m )  ?reg #r ROT ?reg #r ROT ?reg #r ROT ;
: muls,  ( rd rn rm -- )  ops3  'd @ 'x @ = lo3 AND 1 s-ok AND 0=
  ABORT" asm: muls, takes r0-r7 with rd = rm"  $4340 n# 3 LSHIFT OR d# OR i16, ;
: mul,  ( rd rn rm -- )  rrr >R $FB00 OR $F000 ROT 8 LSHIFT OR R> OR i32, ;
: mla4  ( rd rn rm ra op -- )  >R ?reg #r 12 LSHIFT >R rrr
  R> OR ROT 8 LSHIFT OR SWAP $FB00 OR SWAP R> OR i32, ;
: mla,  ( rd rn rm ra -- )  0 mla4 ;
: mls,  ( rd rn rm ra -- )  $10 mla4 ;
: long:  ( base "name" -- )  CREATE ,  DOES> @ >R     ( lo hi rn rm )
  rrr SWAP R> OR >R  SWAP 8 LSHIFT OR  SWAP ?reg #r 12 LSHIFT OR  R> SWAP i32, ;
$FB80 long: smull,   $FBA0 long: umull,
: div:  ( base "name" -- )  CREATE ,  DOES> @ >R
  rrr $F0F0 OR ROT 8 LSHIFT OR SWAP R> OR SWAP i32, ;
$FB90 div: sdiv,   $FBB0 div: udiv,

\ ---- bit operations (rd rm) ----
: rdm  ( rd rm -- d m )  ?reg >R ?reg R> ;
: two:  ( hw2 narrow "name" -- )  CREATE , ,  DOES> >R  rdm
  OVER lo? OVER lo? AND R@ @ AND
  IF #r 3 LSHIFT SWAP #r OR R> @ OR i16, EXIT THEN
  #r DUP $FA90 OR SWAP R> CELL+ @ OR ROT #r 8 LSHIFT OR i32, ;
$F080 $BA00 two: rev,   $F090 $BA40 two: rev16,   $F0B0 $BAC0 two: revsh,
$F0A0 0 two: rbit,
: clz,  ( rd rm -- )  rdm #r DUP $FAB0 OR SWAP $F080 OR ROT #r 8 LSHIFT OR i32, ;
: ext:  ( narrow hw1 "name" -- )  CREATE , ,  DOES> >R  rdm  OVER lo? OVER lo? AND
  IF #r 3 LSHIFT SWAP #r OR R> CELL+ @ OR i16, EXIT THEN
  #r $F080 OR SWAP #r 8 LSHIFT OR R> @ SWAP i32, ;
$B2C0 $FA5F ext: uxtb,  $B280 $FA1F ext: uxth,  $B240 $FA4F ext: sxtb,  $B200 $FA0F ext: sxth,
\ bit fields: rd rn lsb width
: lsbw  ( rd lsb msb|w-1 -- hw2 )  OVER 3 AND 6 LSHIFT OR SWAP 2 RSHIFT 12 LSHIFT OR SWAP ?reg #r 8 LSHIFT OR ;
: ubfx,  ( rd rn lsb width -- )  1- >R >R ?reg #r $F3C0 OR SWAP R> R> lsbw i32, ;
: sbfx,  ( rd rn lsb width -- )  1- >R >R ?reg #r $F340 OR SWAP R> R> lsbw i32, ;
: bfi,   ( rd rn lsb width -- )  OVER + 1- >R >R ?reg #r $F360 OR SWAP R> R> lsbw i32, ;
: bfc,   ( rd lsb width -- )  OVER + 1- >R >R $F36F SWAP R> R> lsbw i32, ;

\ ---- loads and stores ----
: []!  ( -- )  1 'm ! ;                \ [rn, #x]!  pre-indexed, rn updated
: []+  ( -- )  2 'm ! ;                \ [rn], #x   post-indexed
\ a load or store: rt 'd, rn 'n, x 'x; its table 'f: wide hw1 (register and
\ 8-bit offset forms; +$80 the 12-bit one), narrow offset base, scale, narrow
\ register base
VARIABLE 'f
: mem:  ( nreg scale nimm wide "name" -- )  CREATE , , , ,  DOES>  'f !
  ops3  'm @  0 'm !
  ?DUP IF                                               \ pre or post: imm8
    xreg? ABORT" asm: []! and []+ take an offset, not a register"
    'x @ ABS 256 < 0= ABORT" asm: the offset must be -255 to 255"
    1 = IF $D00 ELSE $900 THEN  'x @ 0< 0= $200 AND OR  'x @ ABS OR
    d# 12 LSHIFT OR  'f @ @ n# OR SWAP i32, EXIT
  THEN
  xreg? IF
    lo3 IF 'f @ 3 CELLS + @ x# 6 LSHIFT OR n# 3 LSHIFT OR d# OR i16, EXIT THEN
    'f @ @ n# OR  d# 12 LSHIFT x# OR i32, EXIT
  THEN
  'f @ 2 CELLS + @ ?DUP IF                              \ a 16-bit offset form?
    'x @ OVER MOD 0= 'x @ 0< 0= AND 'd @ lo? AND 'n @ lo? AND
    IF 'x @ SWAP / DUP 32 <
      IF 6 LSHIFT 'f @ CELL+ @ OR n# 3 LSHIFT OR d# OR i16, EXIT THEN
    THEN DROP
  THEN
  'f @ CELL+ @ DUP $6000 = SWAP $6800 = OR 'n @ sp = AND 'd @ lo? AND
  'x @ 3 AND 0= AND 'x @ 1024 U< AND                    \ [sp, #imm]
  IF 'f @ CELL+ @ $3000 + d# 8 LSHIFT OR 'x @ 2 RSHIFT OR i16, EXIT THEN
  'f @ @ n# OR
  'x @ 4096 U< IF $80 OR d# 12 LSHIFT 'x @ OR i32, EXIT THEN
  'x @ NEGATE 256 U< 0= ABORT" asm: the offset must be -255 to 4095"
  d# 12 LSHIFT $C00 OR 'x @ NEGATE OR i32, ;
$5800 4 $6800 $F850 mem: ldr,     $5000 4 $6000 $F840 mem: str,
$5C00 1 $7800 $F810 mem: ldrb,    $5400 1 $7000 $F800 mem: strb,
$5A00 2 $8800 $F830 mem: ldrh,    $5200 2 $8000 $F820 mem: strh,
$5600 0 0 $F910 mem: ldrsb,       $5E00 0 0 $F930 mem: ldrsh,
\ two registers: rt rt2 rn offset (a multiple of 4, -1020 to 1020)
: dual  ( rt rt2 rn x load -- )  4 LSHIFT >R  'x ! ?reg 'n !
  ?reg #r 8 LSHIFT SWAP ?reg #r 12 LSHIFT OR  'x @ ABS 2 RSHIFT OR
  'x @ 0< 0= $80 AND  'm @ DUP 1 = IF DROP $120 ELSE 2 = IF $20 ELSE $100 THEN THEN OR
  $E840 OR R> OR n# OR SWAP i32,  0 'm ! ;
: ldrd,  1 dual ;  : strd,  0 dual ;
\ register lists: { r4 r5 lr } push,
: {  ( -- 0 )  0 ;
: }  ( 0 reg ... -- mask )  0 BEGIN OVER reg? WHILE SWAP #r 1 SWAP LSHIFT OR REPEAT NIP ;
: one?  ( mask -- n true | false )  16 0 DO DUP 1 I LSHIFT = IF DROP I TRUE UNLOOP EXIT THEN LOOP DROP FALSE ;
: push,  ( mask -- )
  DUP $BF00 AND 0= IF DUP $4000 AND 6 RSHIFT SWAP $FF AND OR $B400 OR i16, EXIT THEN
  DUP one? IF NIP $F84D SWAP 12 LSHIFT $D04 OR i32, EXIT THEN  $E92D SWAP i32, ;
: pop,  ( mask -- )
  DUP $7F00 AND 0= IF DUP $8000 AND 7 RSHIFT SWAP $FF AND OR $BC00 OR i16, EXIT THEN
  DUP one? IF NIP $F85D SWAP 12 LSHIFT $B04 OR i32, EXIT THEN  $E8BD SWAP i32, ;
: multi  ( rn mask hw1 -- )  ROT ?reg #r OR SWAP i32, ;
: ldm!,  ( rn mask -- )  SWAP ?reg 'n !  'n @ lo? OVER $FF00 AND 0= AND OVER 1 n# LSHIFT AND 0= AND
  IF n# 8 LSHIFT OR $C800 OR i16, EXIT THEN  'n @ SWAP $E8B0 multi ;
: stm!,  ( rn mask -- )  OVER lo? OVER $FF00 AND 0= AND
  IF SWAP #r 8 LSHIFT OR $C000 OR i16, EXIT THEN  $E8A0 multi ;
: ldm,    ( rn mask -- )  $E890 multi ;
: stm,    ( rn mask -- )  $E880 multi ;
: ldmdb!, ( rn mask -- )  $E930 multi ;
: stmdb!, ( rn mask -- )  $E920 multi ;
\ the data stack: push a register onto it, pop the top into one
: pushd,  ( reg -- )  psp -4 []! str, ;
: popd,   ( reg -- )  psp 4 []+ ldr, ;

\ ---- branches (B.W, BL, B<c>.W: the compiler's own forms) ----
VARIABLE 'o
: obit  ( n -- b )  'o @ SWAP RSHIFT 1 AND ;
: t4  ( dest site link -- hw1 hw2 )  >R  4 + - 'o !
  'o @ $FF000000 AND DUP 0= SWAP $FF000000 = OR 0= ABORT" asm: branch out of range"
  24 obit >R  $F000 R@ 10 LSHIFT OR  'o @ 12 RSHIFT $3FF AND OR
  23 obit R@ XOR 1 XOR 13 LSHIFT  22 obit R> XOR 1 XOR 11 LSHIFT OR
  'o @ 1 RSHIFT $7FF AND OR  R> IF $D000 ELSE $9000 THEN OR ;
: t3  ( dest site cond -- hw1 hw2 )  >R  4 + - 'o !
  'o @ $FFF00000 AND DUP 0= SWAP $FFF00000 = OR 0= ABORT" asm: branch out of range"
  $F000 20 obit 10 LSHIFT OR R> 6 LSHIFT OR 'o @ 12 RSHIFT $3F AND OR
  $8000 18 obit 13 LSHIFT OR 19 obit 11 LSHIFT OR 'o @ 1 RSHIFT $7FF AND OR ;
: hw!  ( hw1 hw2 site -- )  TUCK 2 + H! H! ;
: b,   ( dest -- )  -2 AND HERE 0 t4 i32, ;
: bl,  ( xt -- )  -2 AND HERE 1 t4 i32, ;         \ ' WORD bl, calls a Forth word
: bc,  ( dest cond -- )  >R -2 AND HERE R> t3 i32, ;   \ b<cond> to dest
: bx,  ( rm -- )  ?reg #r 3 LSHIFT $4700 OR i16, ;
: blx, ( rm -- )  ?reg #r 3 LSHIFT $4780 OR i16, ;
: ret, ( -- )  lr bx, ;
\ structured: an open branch is a B.W or B<c>.W resolved by THEN,
: AHEAD,  ( -- site )  HERE $F000 $9000 i32, ;
: IF,     ( cond -- site )  1 XOR 6 LSHIFT $F000 OR HERE SWAP $8000 i32, ;
: THEN,   ( site -- )  DUP 2 + H@ $1000 AND
  IF HERE OVER 0 t4 ELSE HERE OVER DUP H@ 6 RSHIFT 15 AND t3 THEN ROT hw! ;
: ELSE,   ( site -- site' )  AHEAD, SWAP THEN, ;
: BEGIN,  ( -- dest )  HERE ;
: UNTIL,  ( dest cond -- )  1 XOR bc, ;
: AGAIN,  ( dest -- )  b, ;
: WHILE,  ( dest cond -- site dest )  IF, SWAP ;
: REPEAT, ( site dest -- )  AGAIN, THEN, ;

\ ---- IT blocks: cond it, / itt, / ite, ... then the 1-4 instructions ----
VARIABLE 'it
: it:  ( pattern n "name" -- )  CREATE , ,  DOES> 'it !    ( cond )
  DUP 1 AND 'o !  1 3 'it @ @ - LSHIFT                    ( cond mask )
  'it @ @ ?DUP IF 0 DO
    'it @ CELL+ @ 'it @ @ 1- I - RSHIFT 1 AND 0= 1 AND 'o @ XOR 3 I - LSHIFT OR
  LOOP THEN
  SWAP 4 LSHIFT OR $BF00 OR h,  'it @ @ 1+ itn ! ;
0 0 it: it,     1 1 it: itt,    0 1 it: ite,
3 2 it: ittt,   2 2 it: itte,   1 2 it: itet,   0 2 it: itee,

\ ---- system ----
: nop,    $BF00 i16, ;   : yield,  $BF10 i16, ;   : wfe,  $BF20 i16, ;
: wfi,    $BF30 i16, ;   : sev,    $BF40 i16, ;
: cpsie,  $B662 i16, ;   : cpsid,  $B672 i16, ;    \ interrupts on / off
: bkpt,  ( n -- )  $BE00 OR i16, ;
: svc,   ( n -- )  $DF00 OR i16, ;
: dsb,  $F3BF $8F4F i32, ;   : dmb,  $F3BF $8F5F i32, ;   : isb,  $F3BF $8F6F i32, ;
\ special registers for mrs, / msr, (psp-sys: the CPU's process stack pointer)
0 CONSTANT apsr   3 CONSTANT xpsr   5 CONSTANT ipsr   6 CONSTANT epsr
8 CONSTANT msp    9 CONSTANT psp-sys   16 CONSTANT primask   17 CONSTANT basepri
19 CONSTANT faultmask   20 CONSTANT control
: mrs,  ( rd special -- )  SWAP ?reg #r 8 LSHIFT OR $8000 OR $F3EF SWAP i32, ;
: msr,  ( special rn -- )  ?reg #r $F380 OR SWAP $8800 OR i32, ;

\ ---- CODE name ... END-CODE ----
: CODE  ( "name" -- )  :  -2 ALLOT  POSTPONE [  0 itn ! ;   \ : without push {lr}
: END-CODE  ( -- )  POSTPONE ;  -2 ALLOT ;                   \ ; without pop {pc}

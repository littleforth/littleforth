\ call.fth - CALL ( a b c d fn -- r ) calls a C function (AAPCS): a to d in r0
\ to r3, its result from r0. Machine code, so no assembler is needed:
\ push {r4,lr}  mov ip,r6  ldr r3,[r5]  ldr r2,[r5,#4]  ldr r1,[r5,#8]
\ ldr r0,[r5,#12]  adds r5,#16  blx ip  mov r6,r0  pop {r4,pc}
: CALL [ -2 ALLOT $46B4B510 , $686A682B , $68E868A9 , $47E03510 , $BD104606 , ] ; -2 ALLOT

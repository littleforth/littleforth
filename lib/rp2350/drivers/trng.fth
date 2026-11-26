\ trng.fth - random numbers from the hardware TRNG.
\ TRNG.INIT   TRNG.RANDOM U.   6 TRNG.CHOOSE 1+ .
\ 192 raw ring-oscillator bits (datasheet 12.12) mixed through a hash.
\ Fine for seeds, IDs and games; not on its own for keys.

\ INCLUDE core.fth

VARIABLE TRNG.HASH   0 TRNG.HASH !
: TRNG.INIT ( -- )  1 25 LSHIFT UNRESET ;
: TRNG.MIX ( h -- h' )                      \ murmur3 fmix32
   DUP 16 RSHIFT XOR $85EBCA6B *  DUP 13 RSHIFT XOR $C2B2AE35 *  DUP 16 RSHIFT XOR ;
: TRNG.RANDOM ( -- u )
   25 TRNG.SAMPLE_CNT1 !                       \ 12.12.2: 20-25; at least 17 with VN bypassed
   $E TRNG.TRNG_DEBUG_CONTROL !                \ raw samples: VN, CRNGT, autocorrelation bypassed
   $F TRNG.RNG_ICR !  1 TRNG.RND_SOURCE_ENABLE !
   BEGIN TRNG.TRNG_VALID @ 1 AND UNTIL         \ 192 bits collected
   TRNG.HASH @  6 0 DO I CELLS TRNG.EHR_DATA0 + @ XOR TRNG.MIX LOOP   \ EHR_DATA5 last: clears them
   0 TRNG.RND_SOURCE_ENABLE !                  \ off when not in use
   DUP TRNG.HASH !  DUP 1 AND TRNG.TRNG_CONFIG ! ;   \ vary the chain: length 0 or 1
: TRNG.CHOOSE ( n -- u )  TRNG.RANDOM UM* NIP ;   \ 0..n-1

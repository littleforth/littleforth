\ trigger.fth - TRIGGER ( n -- ) sets IRQ n pending through NVIC ISPR, which
\ every Cortex-M has (STIR is not on ARMv6-M).
: TRIGGER ( n -- )  1 OVER 31 AND LSHIFT  SWAP 5 RSHIFT CELLS $E000E200 + ! ;

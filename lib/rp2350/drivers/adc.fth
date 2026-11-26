\ adc.fth - ADC: inputs 0..3 are GPIO 26..29, 4 the temperature sensor.
\ ADC.INIT  26 ADC.PIN  0 ADC.READ .   ADC.TEMP .   2048 ADC.MV .
\ ADC.INIT starts PLL_USB at 48 MHz for clk_adc, which the datasheet requires
\ (12.4.3), unless it is already running: 500k samples a second.

\ INCLUDE gpio.fth

: ADC.RESET ( -- )  1 UNRESET ;                   \ RESETS bit 0
: PLL-USB-48 ( -- )        \ 12 MHz x 120 = 1440 MHz VCO, / 6 / 5 = 48 MHz (as the SDK, 8.6.4)
   PLL_USB.CS @ $80000000 AND IF EXIT THEN        \ LOCK: already running
   1 15 LSHIFT DUP HOLD-RESET UNRESET             \ RESETS bit 15
   1 PLL_USB.CS !  120 PLL_USB.FBDIV_INT !
   $21 PLL_USB.PWR $3000 + !                      \ power and VCO on
   BEGIN PLL_USB.CS @ $80000000 AND UNTIL
   6 16 LSHIFT 5 12 LSHIFT OR PLL_USB.PRIM !
   8 PLL_USB.PWR $3000 + ! ;                      \ post dividers on
: ADC.INIT ( -- )
   PLL-USB-48
   0 CLOCKS.CLK_ADC_CTRL !                        \ stop before changing the source
   BEGIN CLOCKS.CLK_ADC_CTRL @ 1 28 LSHIFT AND 0= UNTIL   \ ENABLED clear
   1 16 LSHIFT CLOCKS.CLK_ADC_DIV !               \ divide by 1
   0 CLOCKS.CLK_ADC_CTRL !                        \ AUXSRC 0 = PLL_USB
   $800 CLOCKS.CLK_ADC_CTRL !                     \ + ENABLE
   ADC.RESET
   1 ADC.CS !                                     \ EN
   BEGIN ADC.CS @ $100 AND UNTIL ;                \ READY
: ADC.SELECT ( input -- )  12 LSHIFT  ADC.CS @ $FFFF0FFF AND OR  ADC.CS ! ;
: ADC.READ ( input -- u )                         \ one conversion, 0..4095
   ADC.SELECT  ADC.CS @ 4 OR ADC.CS !
   BEGIN ADC.CS @ $100 AND UNTIL
   ADC.RESULT @ $FFF AND ;
: ADC.MV ( raw -- mv )  3300 4096 */ ;           \ 3.3 V reference
: ADC.TEMP ( -- celsius )                         \ 27 - (V - 0.706) / 0.001721
   ADC.CS @ 2 OR ADC.CS !  4 ADC.READ ADC.MV 706 - 581 1000 */ 27 SWAP - ;
: ADC.PIN ( gpio -- )                             \ analog only: no function, digital off
   DUP GPIO.F-NULL GPIO.CTRL!
   DUP PAD.OD PAD.IE PAD.PUE OR PAD.PDE OR PAD.BITS
   PAD.ISO SWAP PAD.ADDR $3000 + ! ;

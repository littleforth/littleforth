# RP2350 drivers

Words are named `TYPE.WORD`. Peripherals with several instances (UART, SPI,
I2C, TIMER) take the instance's base last, and `INSTANCE.WORD` supplies it:
`$41 UART1.EMIT` is `$41 UART1 UART.EMIT`. Registers come from the table in
the firmware (`UART1.UARTDR`, `IO_BANK0`), so no register files are loaded.
Each file names what it needs in `\ INCLUDE` lines; usage is at the top.
Name this folder as a library in forth.json (`"libraries": ["lib/rp2350/drivers"]`) and `\ INCLUDE gpio.fth` finds the file from anywhere.

| File | Words |
|---|---|
| core.fth | `UNRESET` `HOLD-RESET` |
| gpio.fth | `GPIO.OUT` `.IN` `.IN-PULLUP` `.IN-PULLDOWN` `.READ` `.HIGH` `.LOW` `.TOGGLE` `.OD` `.OD-LOW` `.OD-RELEASE` `.FUNC` `.DRIVE` |
| gpio-irq.fth | `GPIO.FALL` `.RISE` `.BOTH` `.IRQ-ON` `.IRQ-OFF` `.IRQ-CLEAR` `.IRQ?` `GPIO.IRQ` |
| timer.fth | `TIMER0.INIT` `US` `MS` `MICROS`; alarms `TIMERn.HANDLER!` `.ALARM-IN` `.ALARM-AT` `.ALARM-EVERY` `.ALARM-OFF` `.ALARM-CANCEL` `.ALARM?` `.FIRED?` `.CLEAR` |
| adc.fth | `ADC.INIT` `.READ` `.PIN` `.TEMP` `.MV` |
| pwm.fth | `PWM.RESET` `.START` `.START-PC` `.DUTY` `.FREQ` `.ON` `.OFF` `.PAIR` |
| watchdog.fth | `WATCHDOG.START` `.KICK` `.STOP` `.FORCE` `.LEFT` `.WHY` |
| powman.fth | `POWMAN.KEEP` `.KEPT` `.WAKE` `.REQUEST` `.NOW` `.SLEEP` (experimental) |
| trng.fth | `TRNG.INIT` `.RANDOM` `.CHOOSE` |
| spi.fth | `SPIn.INIT` `.PINS` `.FORMAT` `.CS` `.SELECT` `.DESELECT` `.XFER` `.SEND` `.RECV` `.WRITE` `.READ` `.EXCHANGE` |
| i2c.fth | `I2Cn.INIT` `.PINS` `.WRITE` `.READ` `.WRITE-NOSTOP` `.REG!` `.REG@` `.PROBE` `.SCAN` `.ERROR` |
| flash.fth | `SAVE` `EMPTY` (with `../../save.fth`), `ROM` ( c1 c2 -- fn ) a boot ROM function, `CALL` ( a b c d fn -- r ) a C function (`../../thumb2/call.fth`) |
| kernel.fth | the kernel's addresses (`DICT0` `SAVE-AREA` `SAVE-SIZE` `'HERE` `'LATEST`), made by `tools/kernel_fth.py`; do not edit |
| uart.fth | `UART1.INIT` `.PINS` `.FORMAT` `.EMIT` `.TYPE` `.FLUSH` `.KEY?` `.KEY` `.KEY-WAIT` `.BUFFER` `.UNBUFFER` |

Every instance also has `.RESET` and, for UART, SPI and I2C, `.IRQ` (its IRQ
number); a timer alarm's IRQ is `alarm TIMERn.IRQ`.
All the files take about 19 KB of dictionary. Every register write is checked
on the host against a simulated memory (`make check`, gate E4), and the
procedures against the RP2350 datasheet (RP-008373-DS-3, 2026-11-18). Run on
the Pico 2: GPIO, GPIO and timer interrupts, ADC, TRNG, PWM. Not yet: UART,
I2C, SPI, the watchdog, POWMAN, SAVE. The two I2Cs keep separate state, so a
handler may use one while the other is busy.

From the datasheet:
- clk_adc must be 48 MHz (12.4.3): `ADC.INIT` starts PLL_USB for it.
- On A2 chips (RP2350-E9) a pulled-down input with its input buffer on can
  stick near 2.2 V: `GPIO.IN-PULLDOWN` leaves the buffer off and `GPIO.READ`
  turns it on only to read. A pull-up, or an external pull-down of 8.2 kΩ or
  less, is unaffected.
- UART rates below about 143 baud can't be set from the 150 MHz clock.

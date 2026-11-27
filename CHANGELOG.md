# Changes

## 0.5.3 (beta)

Links point to the repository's new name, littleforth/littleFORTH.

## 0.5.2 (beta)

The extension's store page and description now match the README.

## 0.5.1 (beta)

The first public release: the RP2350, on the Raspberry Pi Pico 2 and Pico 2 W.

Kernel:
- Native Forth: definitions compiled to Thumb-2 on the chip, under 8 KB of
  flash, a 64 KB dictionary in RAM. Passes the Forth 2012 CORE tests.
- The RP2350's registers by name, from a table in the firmware.
- Interrupt handlers in Forth (`IRQ!`); faults reported and recovered.
- `SAVE` and `EMPTY`: the dictionary kept in flash across resets.
- Drivers in Forth (GPIO and GPIO interrupts, timers, ADC, PWM, UART, SPI,
  I2C, watchdog, TRNG, power manager) and a Thumb-2 assembler.

VS Code extension:
- Console, send line and file, `\ INCLUDE`, hover help, completion, Go to
  Definition, and the Board, Stacks and Words views.
- Stack lens, hot reload, live values.
- Inspect, Memory, board picture, scope, notebooks.
- Debugger with the stack beside each word, and a profiler (Debug Probe and
  OpenOCD).
- The kernel built to WebAssembly: works with no board.
- Flashes the firmware it carries, by BOOTSEL drive or through the probe.

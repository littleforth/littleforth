# littleFORTH

A small, native Forth for microcontrollers, with live, interactive development
and debugging in VS Code. Type a line in the Forth console and it runs on the chip.

**Beta:** RP2350, on the Raspberry Pi Pico 2 and Pico 2 W. More chips to follow.

Every word you define is compiled to machine code on the chip as you type it.
This extension is how you talk to it, and how you see what it is doing.

## Features

- **Console** on the board: type a line, it runs. The stack shows in the prompt.
- **Stack lens**: the stack after each line of source, shown as you type;
  stack mistakes flagged before you send.
- **Hot reload**: save the file, and only the words that changed are sent.
- **Live values**: registers and variables show their value on the board,
  beside the line that names them.
- **Inspect**: any word's source, its code read back and decompiled, its size.
- **Memory**: a map of the whole chip, then any range as Forth records,
  labelled cells or bytes. Pointers are links.
- **Board picture**: each pin's function and state, live; click to toggle.
- **Scope**: plot variables and registers over time.
- **Notebooks**: `.fthnb` cells of Forth, run on the board, output inline.
- **Debugger**: breakpoints and stepping word by word, with the stack beside
  each word; step back.
- **Profiler**: where the time goes, shaded over the source.
- **No board needed**: the kernel also runs inside VS Code (WebAssembly).
  Install, open a file, type Forth. Plug a board in and the console moves to it.
- Every register of the chip by name (`UART0.UARTDR`), with nothing to load.
- The firmware is included: **Flash Firmware** puts it on the board.

## What you need

- A Raspberry Pi Pico 2 or Pico 2 W.
- A Raspberry Pi Debug Probe: the console is on UART0 (GP0/GP1), and the
  probe's SWD port gives the debugger and the profiler. A USB-serial adapter
  on GP0/GP1 also works, for the console only.
- For the debugger and profiler: OpenOCD (the *Raspberry Pi Pico* extension
  installs one; the extension finds it).

## Start

[Getting started](https://github.com/littleforth/littleforth/blob/main/docs/getting-started.md):
wiring, flashing, and a blinking LED in a few minutes. The examples and the
driver libraries (GPIO, timers, ADC, PWM, UART, SPI, I2C...) are in the
[repository](https://github.com/littleforth/littleforth).

- [The extension, feature by feature](https://github.com/littleforth/littleforth/blob/main/docs/extension.md)
- [The words the kernel knows](https://github.com/littleforth/littleforth/blob/main/docs/words.md)
- [Issues and ideas](https://github.com/littleforth/littleforth/issues)

## Licence

MIT. Free, and made in spare time:
[buying me a coffee](https://ko-fi.com/littleforth) keeps it going.

# Getting started

The inevitable "Hello World" of embedded development, a blinky LED on a Raspberry Pi Pico 2 or Pico 2 W.

## What you need

- A **Raspberry Pi Pico 2** or **Pico 2 W**.
- A **Raspberry Pi Debug Probe**. The console is the chip's UART0 on GP0/GP1;
  the Pico's own USB port is used only for power and flashing. The probe's other port
  (SWD) gives the debugger and the profiler, and flashes without BOOTSEL. A
  plain USB-serial adapter on GP0/GP1 also works, for the console only.
- **VS Code** 1.80 or later.
- **OpenOCD** (optional): For the debugger, the profiler and flashing through the probe.
  The extension uses the copy that Raspberry Pi's *Raspberry Pi Pico* VS Code
  extension installs (in `~/.pico-sdk/openocd`), else one on your PATH.
- A 330R resistor, LED, jumper wires and a breadboard.
- USB cables for the Pico and debugger.

## 1. Install the extension

In VS Code's Extensions view, search for **littleFORTH** and install it. Or take
the `.vsix` from a [Release](https://github.com/littleforth/littleforth/releases)
and use `...` > *Install from VSIX...*.

No board yet? Run **Forth: Work Without a Board** from the Command Palette. The
kernel runs inside VS Code (built to WebAssembly), so you can type Forth straight
away. When a board is plugged in, the same console moves to it.

## 2. Get the examples and libraries

Clone this repository, or download it as a ZIP from GitHub, and open the folder
in VS Code. Its `forth.json` tells the extension the board and where the driver
libraries are:

```json
{
  "board": "Pico 2",
  "libraries": ["lib/rp2350/drivers"]
}
```

Use the same file in a project of your own, with `libraries` pointing at your
copy of `lib/rp2350/drivers`.

## 3. Wire the Debug Probe

The probe's **U** port (UART) to the Pico:

| Debug Probe UART | Pico 2 / Pico 2 W |
|---|---|
| TX (orange) | GP1 (pin 2) |
| RX (yellow) | GP0 (pin 1) |
| GND (black) | GND (pin 3) |

The probe's **D** port (SWD) to the Pico's 3-pin debug header (SWCLK, GND,
SWDIO). Then plug the probe and the Pico into your PC.

## 4. Flash the firmware

Click the Forth item on the status bar, or run **Forth: Flash Firmware**:

- With the Pico in BOOTSEL mode (hold **BOOTSEL** while plugging it into USB;
  a drive called `RP2350` appears), the extension copies `pico2.uf2` onto it.
- Without BOOTSEL, it writes the firmware through the probe's SWD port, using
  OpenOCD.

Or by hand: copy `pico2.uf2` from a Release onto the `RP2350` drive.

The same firmware runs on the Pico 2 and the Pico 2 W.

## 5. Connect and type

The extension finds the probe by its USB IDs and connects (the status bar
shows the board's state; click it to connect or disconnect). The **Forth**
panel in the Activity Bar holds the Board, Stacks and Words views, and the
console opens with the banner and a prompt.

Type in the console:

```
1 2 + .
```

It prints `3`. The stack after each line shows in the prompt and in the Stacks
view. An error prints `?-` and the Forth 2012 throw code, and clears the stack.

## 6. Blink an LED

Open `examples/rp2350/blink.fth`. Its `LED` is GP28: wire an LED and a resistor
(about 330 ohms) from GP28 to GND, or change the number. The Pico 2's own LED is
GPIO 25; the Pico 2 W's is on its wireless chip, out of reach.

- **Send File** (Ctrl+Shift+Enter) sends the file, after the files its
  `\ INCLUDE` lines name.
- **Send Line or Selection** (Shift+Enter) sends one line.

Then type `10 BLINK` in the console. Stop a running word with **Stop** (Ctrl+.).

Edit the file and save it: hot reload sends only the words that changed, and
the words that use them.

## 7. Keep your words

The dictionary is in RAM. **Forth: Save Words to Flash** (or `SAVE` once
`flash.fth` is loaded) copies it to flash, and it comes back at every boot.
`EMPTY REBOOT` removes it.

A saved image belongs to the kernel build it was saved from: after flashing new
firmware, the old image is ignored, so send and save your words again.

## Next

- [extension.md](extension.md): every feature of the extension.
- [words.md](words.md): the words the kernel knows.
- [lib/rp2350/drivers/README.md](../lib/rp2350/drivers/README.md): the drivers
  (GPIO, timers, ADC, PWM, UART, SPI, I2C, watchdog...).
- The other examples in `examples/rp2350/`: timer interrupts, PWM, a GPIO
  cookbook, and words written in assembler.

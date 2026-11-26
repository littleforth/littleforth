# The VS Code extension

The extension is the way to work with littleFORTH: a console on the board, an
editor that knows your words, and tools that show what the chip is doing while
it runs. Start with [getting-started.md](getting-started.md).

Everything is in one place: the **Forth** panel in the Activity Bar (Board,
Stacks and Words), the console, one status bar item, and the commands below.

## Console and editor

- **Console.** Type a line and it runs on the board. The prompt shows the
  stack, `( 3 4 ) ›`. **Stop** (Ctrl+.) stops a running word.
- **Send.** *Send Line or Selection* (Shift+Enter), *Send File*
  (Ctrl+Shift+Enter). `\ INCLUDE file.fth` lines are followed: the files they
  name are sent first, once. A line that fails is marked in the editor and
  listed in Problems.
- **Language.** Highlighting, hover help with each word's stack effect,
  completion, Go to Definition (F12) across your files and libraries, and
  warnings for words the board would not know or that are used before they
  are defined.
- **Board found for you.** The extension finds the Debug Probe by its USB IDs;
  `forth.json` or the `forth.port` setting can name the port instead. If no
  littleFORTH answers, it offers to flash the firmware.

## Seeing the stack

- **Stack lens.** After each line of source, faint text shows the stack after
  it, `( 3 4 )`, worked out from the stack comments as you type. A definition
  whose code does not match its stack comment is flagged before you send it.
- **Stacks view.** The data and return stacks on the board, after every line.

## Live on the board

- **Hot reload.** Save a file you have sent: only the words that changed are
  sent again, with the words that use them.
- **Live values.** Every register and VARIABLE named in a file shows its
  current value on the board at the end of the line, updating while the board
  is idle.
- **Board picture.** *Show the Board*: a drawing of the Pico 2 with each pin's
  function and state, live. Click a pin to toggle it or see its registers.
- **Scope.** *Open the Scope*, or *Plot Word at Cursor*: plot variables,
  registers or bit fields over time (an ADC reading, a pin, a counter).

## Looking inside

- **Inspect.** *Inspect Word at Cursor* (Ctrl+Alt+I), or click a word in the
  Words view: its source, its code read back from the board and decompiled,
  its size and the memory it occupies. A register opens with its value and
  fields.
- **Memory.** *Show in Memory*: a map of the whole chip (flash, RAM, the
  stacks, the dictionary used and free, the peripherals), then any range as
  Forth records, labelled cells, bytes or disassembled code. Pointers are
  links; the address box takes Forth (`HITS`, `' BLINK`, `HERE 64 -`). Cells
  can be edited in place. The dictionary budget shows where the space went.
- **Words view.** Every word on the board and in your libraries.

## Notebooks

*New Notebook* makes a `.fthnb` file: cells of Forth that run on the board, with
their output and what each cell left on the stack shown under it. For learning,
testing and write-ups.

## Debugging and profiling

These need the Debug Probe's SWD port and OpenOCD (see
[getting-started.md](getting-started.md)).

- **Debug the Board.** Breakpoints in your Forth source; step word by word,
  with the stack shown beside each word as it runs, and step back over what
  was recorded. Variables and registers in the Variables view.
- **Profile.** Samples the CPU while your program runs, and shades the source
  by where the time went. The board keeps running.

## No board

*Work Without a Board* runs the kernel inside VS Code (built to WebAssembly).
Everything that does not need real hardware works: the console, sending, the
stack, inspect. Plug a board in and the console moves to it.

## Commands

| Command | What it does |
|---|---|
| Connect / Disconnect | open or close the console on the board |
| Choose Serial Port | pick the port when there is more than one |
| Board Menu | the status bar item's menu |
| Send File, Send Line or Selection | send source to the board |
| Stop | stop the running word |
| Flash Firmware | write the firmware: by BOOTSEL drive, or through the probe |
| Save Words to Flash | `SAVE`: keep the dictionary across resets |
| Reset the Board | restart the chip |
| Show Console | bring the console forward |
| Inspect Word, Inspect Word at Cursor | open a word in the inspector |
| Show in Memory | open the Memory view at a word or address |
| Show the Board | the board picture |
| Open the Scope, Plot Word at Cursor | the scope |
| New Notebook | a new `.fthnb` notebook |
| Debug the Board | start the debugger |
| Profile…, Clear Profile | the profiler |
| Work Without a Board | the WebAssembly kernel |

## forth.json

Put it in the workspace folder. Every field is optional.

| Field | What |
|---|---|
| `board` | the board, as the Board view names it (`"Pico 2"`): picks its register names |
| `libraries` | folders searched for `\ INCLUDE` files and words, relative to `forth.json` |
| `port` | the serial port (`"COM3"`); default: found by the probe's USB IDs |
| `baud` | default 115200 |
| `main` | the file *Send File* sends when no Forth file is open |
| `gdb` | the debugger's GDB server, `host:port` (default `localhost:3333`, OpenOCD, started for you) |

## Settings

| Setting | Default | What |
|---|---|---|
| `forth.port` | | serial port, when `forth.json` gives none |
| `forth.board` | | the board whose register names are known with no board connected and no `forth.json` |
| `forth.unknownWords` | on | warn about words the board would not know |
| `forth.stackLens` | on | the stack lens |
| `forth.hotReload` | on | hot reload |
| `forth.liveValues` | on | live values |
| `forth.gdbServer` | `localhost:3333` | the GDB server, when `forth.json` gives none |
| `forth.startOpenocd` | on | start OpenOCD when attaching, if nothing listens on the GDB port |
| `forth.openocd` | | your own command line for the GDB server |

/* an505.c - QEMU mps2-an505 test board (Cortex-M33): the mps2 board with
 * the CMSDK UART0 at 0x40200000 and the save area in SSRAM1. Runs the same
 * tests on M33 code that the Pico 2 build compiles to. */
#define UART      0x40200000u
#define SAVE_AREA 0x10300000u
#include "cmsdk.h"

/* cmsdk.h - QEMU test boards (mps2.c, an505.c): CMSDK UART0 console, polled.
 * No echo: input comes from the test runner. Each board file sets UART and
 * SAVE_AREA, then includes this. */
#include "forth.h"

#ifndef UART
#define UART 0x40004000u
#endif
#ifndef SAVE_AREA
#define SAVE_AREA 0x00300000u
#endif
#define R(o) (*(volatile uint32_t *)(UART + (o)))

void board_init(void) { R(8) = 3; }             /* CTRL: TX and RX enable */
int board_irq(unsigned n) { (void)n; return 0; } /* every IRQ goes to Forth */
int con_key(void)
{
    while (!(R(4) & 2)) ;                        /* STATE: RX full */
    return R(0) & 0xFF;
}
void con_emit(int c)
{
    if (c == '\n') con_emit('\r');
    while (R(4) & 1) ;                           /* STATE: TX full */
    R(0) = (uint8_t)c;
}

/* SAVE stand-in: a RAM region QEMU keeps across a system reset */
uint32_t *board_flash_area(void) { return (uint32_t *)SAVE_AREA; }
void board_flash_erase(uint32_t *p) { for (int i = 0; i < 1024; i++) p[i] = 0xFFFFFFFFu; }
void board_flash_write(uint32_t *d, const uint32_t *s, ucell n) { while (n) { *d++ &= *s++; n -= 4; } }
/* soft reset: a system reset in QEMU drops serial input, which the tests need.
   Startup still copies .data, clears .bss and restores the saved image. */
extern uint32_t _estack;
void reset(void) __attribute__((noreturn));
void board_reboot(void)
{
    __asm volatile("msr msp, %0" : : "r"(&_estack));
    reset();
}

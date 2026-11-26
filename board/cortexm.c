/* cortexm.c - shared Cortex-M startup: vector table, .data/.bss, then the
 * kernel. The board file supplies board_init() and, if it uses interrupts,
 * NIRQ and irq_entry (see mps2.c). */
#include "forth.h"

extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
void board_init(void);

void reset(void) __attribute__((noreturn));
void reset(void)
{
#ifdef __ARM_ARCH_8M_MAIN__
    __asm volatile("msr msplim, %0" : : "r"((uint32_t)&_ebss));   /* see fault() in hw.c */
#endif
    uint32_t *s = &_sidata, *d = &_sdata;
    while (d < &_edata) *d++ = *s++;
    for (d = &_sbss; d < &_ebss; ) *d++ = 0;
    board_init();
    kernel_init();
#if !defined(ECHO) || ECHO
    for (const char *b = FORTH_NAME; *b; b++) emit(*b);   /* banner on interactive boards */
    cr();
#endif
    quit();
}
void fault(void);                              /* hw.c */

#ifndef NIRQ
#define NIRQ 0
#endif
void irq_entry(void) __attribute__((weak, alias("fault_irq")));
void fault_irq(void) { for (;;) ; }

__attribute__((section(".vectors"), used))
const void *const vectors[16 + NIRQ] = {
    &_estack, reset, fault, fault, fault, fault, fault, 0, 0, 0, 0,
    fault, fault, 0, fault, fault,
#if NIRQ
    [16 ... 16 + NIRQ - 1] = irq_entry,
#endif
};

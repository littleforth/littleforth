/* pico2.c - Raspberry Pi Pico 2 (RP2350, Cortex-M33, secure) board layer.
 *
 * Boot: the boot ROM finds the IMAGE_DEF block below in the first 4 KB of
 * flash, takes SP and the reset vector from the start of the image, and runs
 * stub() from flash (XIP). The stub copies the whole kernel into SRAM and runs
 * it there: flash at 0x10000000 is out of BL range of SRAM, so kernel and
 * dictionary must both be in SRAM. The vector table is built in RAM.
 * Clocks: 12 MHz crystal, PLL_SYS 1500 MHz / 5 / 2 = 150 MHz to clk_sys,
 * clk_peri = clk_sys, clk_ref = crystal undivided, 12 MHz (the Pico SDK's
 * defaults).
 * Console: UART0, GP0 TX, GP1 RX, 115200 8N1, receive by interrupt (IRQ 33).
 * SAVE area: the last 128 KB of the 4 MB flash, written by lib/rp2350/drivers/flash.fth.
 * Every address, bit and value here is checked against RP2350.svd by
 * tools/svdcheck_pico2.py.
 */
#include "forth.h"

#define R(a)    (*(volatile uint32_t *)(a))
#define CLR(a)  R((a) + 0x3000)                  /* atomic bit-clear alias */
#define RESETS  0x40020000u
#define CLOCKS  0x40010000u
#define XOSC    0x40048000u
#define PLL     0x40050000u
#define IOB     0x40028000u
#define PADS    0x40038000u
#define UART    0x40070000u
#define UART_IRQ 33
#define FLASH   0x10000000u
#define SAVE_AREA (FLASH + 4 * 1024 * 1024 - 128 * 1024)

extern uint32_t _ram_lma, _ram_start, _ram_end, _sbss, _ebss, _estack;
void kmain(void) __attribute__((noreturn));

/* ---- runs from flash ---- */
__attribute__((section(".boot_text"), noreturn)) void stub(void)
{
    __asm volatile("msr msplim, %0" : : "r"((uint32_t)&_ebss));   /* stack limit: see fault() in hw.c */
    uint32_t *s = &_ram_lma, *d = &_ram_start;
    while (d < &_ram_end) *d++ = *s++;
    for (d = &_sbss; d < &_ebss; ) *d++ = 0;
    kmain();
}
__attribute__((section(".boot_vec"), used)) const void *const boot_vec[2] = { &_estack, stub };
/* IMAGE_DEF: start marker; IMAGE_TYPE item = EXE | SECURE | ARM | RP2350;
   LAST item, 1 word; link to self; end marker (pico-sdk embedded_start_block) */
__attribute__((section(".boot_block"), used)) const uint32_t boot_block[5] =
    { 0xFFFFDED3, 0x10210142, 0x000001FF, 0x00000000, 0xAB123579 };

/* ---- runs from SRAM ---- */
void irq_entry(void);
void fault(void);                              /* hw.c */
/* 16 + 52 entries; VTOR needs 512-byte alignment, given by placing it at the
   start of SRAM (section .vtab in pico2.ld) */
#define NVEC (16 + NIRQ)
static void (*vtab[NVEC])(void) __attribute__((section(".vtab")));
static volatile uint8_t ring[128], head, tail;   /* the console's receive buffer, filled by the UART interrupt */

static void clocks(void)
{
    CLR(CLOCKS + 0x3C) = 1;                      /* clk_sys from clk_ref while we work */
    while (!(R(CLOCKS + 0x44) & 1)) ;
    R(XOSC + 0x0C) = 282;                        /* STARTUP: ~6 ms at 12 MHz, as the SDK */
    R(XOSC + 0x00) = 0xAA0 | 0xFAB << 12;        /* FREQ_RANGE 1_15MHZ, ENABLE */
    while (!(R(XOSC + 0x04) & 1u << 31)) ;       /* STATUS.STABLE */
    R(CLOCKS + 0x30) = 2;                        /* clk_ref = xosc */
    while (!(R(CLOCKS + 0x38) & 1u << 2)) ;
    R(CLOCKS + 0x34) = 1u << 16;                 /* CLK_REF_DIV = 1: the boot ROM leaves 4 */
    CLR(RESETS) = 1u << 14;                      /* PLL_SYS out of reset */
    while (!(R(RESETS + 8) & 1u << 14)) ;
    R(PLL + 0x08) = 125;                         /* FBDIV: 12 MHz x 125 = 1500 MHz */
    CLR(PLL + 0x04) = 1u << 0 | 1u << 5;         /* PWR: power up PD and VCOPD */
    while (!(R(PLL) & 1u << 31)) ;               /* CS.LOCK */
    R(PLL + 0x0C) = 5u << 16 | 2u << 12;         /* PRIM: /5 /2 = 150 MHz */
    CLR(PLL + 0x04) = 1u << 3;                   /* PWR: power up POSTDIVPD */
    R(CLOCKS + 0x3C) = 0;                        /* AUXSRC = pll_sys, SRC still clk_ref */
    R(CLOCKS + 0x3C) = 1;                        /* SRC = aux */
    while (!(R(CLOCKS + 0x44) & 1u << 1)) ;
    R(CLOCKS + 0x48) = 1u << 11;                 /* clk_peri = clk_sys, ENABLE */
}
void kmain(void)
{
    for (int i = 1; i < NVEC; i++) vtab[i] = i < 16 ? fault : irq_entry;
    R(0xE000ED08) = (uint32_t)vtab;              /* VTOR */
    clocks();
    uint32_t m = 1u << 6 | 1u << 9 | 1u << 26;   /* IO_BANK0, PADS_BANK0, UART0 */
    CLR(RESETS) = m;
    while ((R(RESETS + 8) & m) != m) ;
    CLR(PADS + 4) = 1u << 7;                     /* GP0 (TX): output enabled, OD clear */
    R(PADS + 8) |= 1u << 6;                      /* GP1 (RX): input enable */
    R(IOB + 0x04) = 2;                           /* GP0 FUNCSEL uart0_tx */
    R(IOB + 0x0C) = 2;                           /* GP1 FUNCSEL uart0_rx */
    CLR(PADS + 4) = 1u << 8;                     /* GP0, GP1: remove isolation */
    CLR(PADS + 8) = 1u << 8;
    R(UART + 0x24) = 81;                         /* 150 MHz / (16 x 115200) = 81 24/64 */
    R(UART + 0x28) = 24;
    R(UART + 0x2C) = 3u << 5 | 1u << 4;          /* LCR_H: 8 bits, FIFOs on */
    R(UART + 0x38) = 1u << 4 | 1u << 6;          /* IMSC: RX and RX timeout */
    R(UART + 0x30) = 1u << 0 | 1u << 8 | 1u << 9;   /* CR: UARTEN TXE RXE */
    R(0xE000E100 + UART_IRQ / 32 * 4) = 1u << (UART_IRQ % 32);   /* NVIC ISER */
    kernel_init();
    for (const char *b = FORTH_NAME; *b; b++) emit(*b);
    cr();
    quit();
}

int board_irq(unsigned n)
{
    if (n != UART_IRQ) return 0;
    while (!(R(UART + 0x18) & 1u << 4)) {        /* FR.RXFE clear: data waiting */
        uint8_t c = R(UART);
        if ((uint8_t)(head + 1) % sizeof ring != tail) { ring[head] = c; head = (head + 1) % sizeof ring; }
    }
    R(UART + 0x44) = 1u << 6;                    /* ICR: receive timeout */
    return 1;
}
int con_key(void)
{
    /* WFI with interrupts masked still wakes on a pending interrupt */
    for (;;) {
        __asm volatile("cpsid i");
        if (head != tail) break;
        __asm volatile("wfi");
        __asm volatile("cpsie i");
    }
    __asm volatile("cpsie i");
    int c = ring[tail];
    tail = (tail + 1) % sizeof ring;
    return c;
}
void con_emit(int c)
{
    if (c == '\n') con_emit('\r');
    while (R(UART + 0x18) & 1u << 5) ;           /* FR.TXFF */
    R(UART) = (uint8_t)c;
}

/* SAVE and EMPTY are Forth (lib/save.fth, lib/rp2350/drivers/flash.fth); the
   kernel only reads a saved image back at boot */
uint32_t *board_flash_area(void) { return (uint32_t *)SAVE_AREA; }
void board_reboot(void)
{
    R(0xE000ED0C) = 0x05FA0004;                  /* AIRCR SYSRESETREQ */
    for (;;) ;
}

/* hw.c - SAVE EMPTY REBOOT, interrupt handlers in Forth, EINT DINT.
 *
 * SAVE copies the whole RAM dictionary to the board's flash area; boot copies
 * it back (image_restore, called from kernel_init). Code keeps running from
 * RAM at the same addresses, so nothing is relocated or patched in flash.
 * The magic word is written last: an interrupted SAVE leaves no valid image.
 * It is the kernel build's STAMP (Makefile), so a rebuilt kernel ignores an
 * image saved by a different build.
 */
#include "forth.h"
#include "cg.h"

uint32_t *board_flash_area(void);              /* FLASH_AREA_SIZE bytes, page aligned */
void board_reboot(void) __attribute__((noreturn));
#define HDR 256                                /* header page: magic, here, latest, length */
#ifndef FLASH_AREA_SIZE
#define FLASH_AREA_SIZE 16384
#endif
static uint32_t magic(void) { return MAGIC; }   /* forth.h */
void image_restore(void)
{
    uint32_t *f = board_flash_area();
    if (f[0] != magic()) return;
    S->here = f[1]; S->latest = f[2];
    for (ucell i = 0; i < f[3]; i += 4) C32(dict_start() + i) = f[HDR / 4 + i / 4];
}
void w_reboot(void) { board_reboot(); }

#ifndef FORTH_SAVE
void board_flash_erase(uint32_t *page);        /* one FLASH_PAGE */
void board_flash_write(uint32_t *dst, const uint32_t *src, ucell bytes);   /* whole 256 B pages */
#ifndef FLASH_PAGE
#define FLASH_PAGE 4096
#endif

void w_save(void)
{
    uint32_t *f = board_flash_area(), h[HDR / 4];
    ucell len = (S->here - dict_start() + 255) & ~255u;
    if (len + HDR > FLASH_AREA_SIZE) throw_(-8);
    for (ucell p = 0; p < len + HDR; p += FLASH_PAGE) board_flash_erase(f + p / 4);
    board_flash_write(f + HDR / 4, P(dict_start()), len);
    for (int i = 0; i < HDR / 4; i++) h[i] = 0xFFFFFFFFu;
    h[0] = magic(); h[1] = S->here; h[2] = S->latest; h[3] = len;
    board_flash_write(f, h, HDR);              /* header last: a cut SAVE is not valid */
}
void w_empty(void)  { board_flash_erase(board_flash_area()); S->here = dict_start(); S->latest = 0; }
#endif

/* ---- interrupts: one shim for every vector ---- */
#if NIRQ
static cell irq_xt[NIRQ];
#ifndef NO_FAULT_REPORT
uint32_t irq_now;                              /* IPSR of the interrupt being handled, for fault() */
#define IRQ_IN(n) uint32_t was = irq_now; irq_now = (n)   /* an interrupt that preempts another puts it back */
#define IRQ_OUT() (irq_now = was)
#else
#define IRQ_IN(n)
#define IRQ_OUT()
#endif
int board_irq(unsigned n);                     /* board's own handlers first */
void irq_entry(void)
{
    unsigned n;
    __asm volatile("mrs %0, ipsr" : "=r"(n));
    IRQ_IN(n);
    n -= 16;
    if (!board_irq(n) && irq_xt[n]) {
        /* run the handler below a gap, so the interrupted word's stack is safe
           even mid-update, and restore TOS and the stack pointer afterwards */
        cell t = tos, *p = psp;
        psp -= 8;
        cg_run(irq_xt[n]);
        tos = t; psp = p;
    }
    IRQ_OUT();
}
void w_irqstore(void)
{
    unsigned n = pop(); cell xt = pop();
    if (n >= NIRQ) throw_(-24);
    irq_xt[n] = xt;
    /* NVIC ISER / ICER: one 32-bit register per 32 interrupts */
    *(volatile uint32_t *)((xt ? 0xE000E100 : 0xE000E180) + n / 32 * 4) = 1u << (n % 32);
}
void w_eint(void) { __asm volatile("cpsie i"); }
void w_dint(void) { __asm volatile("cpsid i"); }
#else
void w_irqstore(void) { psp++; tos = *psp++; }
void w_eint(void) { }
void w_dint(void) { }
#endif

/* ---- faults, and THROW inside an interrupt handler ----
 * crash keeps the state when the last fault happened, for the debugger and
 * the extension: the stacked r0-r3 r12 lr pc xpsr, CFSR, r5 (psp), r6 (tos),
 * then the 8 cells at r5 if r5 points into the data stack. The board then reports the error (-5 return stack
 * overflow, else -9) and goes back to the interpreter.
 * Handler mode is left only by an exception return, so the return frame is
 * rewritten. With no other exception active: a new frame at the top of the
 * main stack whose PC is throw_. Otherwise (a fault in an interrupt handler,
 * or a stack overflow while the fault itself was being stacked): the same
 * frame with PC escape, which does the same again one level out. THROW in an
 * interrupt handler calls escape too. Interrupts at one priority (the
 * default) are always recovered; with priorities set by the user, a fault in a
 * handler that has preempted another still active is not (the outer one stays
 * active and escape's return fails). No stack is used before the move, so a fault at the
 * stack limit (MSPLIM, the end of .bss on the M33) is handled too. */
#if defined(__arm__) && defined(NO_FAULT_REPORT)     /* a board without the fault report: faults stop it */
void fault(void) { for (;;) ; }
#elif defined(__ARM_ARCH_6M__)
/* ARMv6-M (the Thumb-1 code generator's boards): the same block and the same way out, with
 * Thumb-1 instructions. There is no CFSR (0 is kept in its place) and no
 * stack limit, so no ?-5. Every fault stacks a whole frame, so the stacked
 * xPSR says whether a handler or Thread mode was interrupted. */
uint32_t crash[19];
__asm__(
    "  .syntax unified\n  .text\n  .global fault\n  .thumb_func\n"
    "fault:\n"
    "  mrs r0, msp\n  ldr r1, =crash\n"
    "  ldm r0!, {r2, r3, r4, r7}\n  stm r1!, {r2, r3, r4, r7}\n"
    "  ldm r0!, {r2, r3, r4, r7}\n  stm r1!, {r2, r3, r4, r7}\n"
    "  subs r0, #32\n  movs r2, #0\n  stm r1!, {r2, r5, r6}\n"      /* no CFSR; r5, r6 */
    "  ldr r2, =dstack\n  subs r2, r5, r2\n  lsrs r3, r2, #9\n  bne 5f\n"   /* r5 in the data stack */
    "  lsls r3, r5, #30\n  bne 5f\n"                                   /* and aligned */
    "  ldm r5!, {r2, r3, r4, r7}\n  stm r1!, {r2, r3, r4, r7}\n"
    "  ldm r5!, {r2, r3, r4, r7}\n  stm r1!, {r2, r3, r4, r7}\n"
    "5: movs r3, #8\n  mvns r3, r3\n"                                  /* -9 */
    "  ldr r2, [r0, #28]\n  lsls r2, r2, #23\n  lsrs r2, r2, #23\n  bne 2f\n"   /* stacked IPSR */
    "4: ldr r1, =throw_\n  ldr r0, =_estack - 32\n  mov sp, r0\n"      /* Thread: a new frame */
    "  ldr r4, =0xFFFFFFF9\n  mov lr, r4\n"
    "3: movs r4, #1\n  bics r1, r4\n  lsls r4, r4, #24\n  orrs r2, r4\n"
    "  str r3, [r0]\n  str r1, [r0, #24]\n  str r2, [r0, #28]\n  bx lr\n"
    "2: ldr r1, =escape\n  b 3b\n"                                     /* a handler: back into it at escape */
    "  .global escape\n  .thumb_func\n"
    "escape:\n"
    "  mov r3, r0\n  movs r2, #0\n  b 4b\n"
    "  .ltorg\n");
#elif defined(__arm__)
uint32_t crash[19];
__asm__(
    "  .text\n  .global fault\n  .thumb_func\n"
    "fault:\n"
    "  mrs r0, msp\n  ldr r1, =crash\n"
    "  ldm r0, {r2-r4, r7-r11}\n  stm r1!, {r2-r4, r7-r11}\n"
    "  ldr r2, =0xE000ED28\n  ldr r3, [r2]\n  str r3, [r2]\n"   /* CFSR, cleared */
    "  stm r1!, {r3, r5, r6}\n"
    "  ldr r2, =dstack\n  subs r2, r5, r2\n  cmp r2, #512\n  bhs 5f\n  tst r5, #3\n  bne 5f\n"   /* r5 in the data stack, aligned */
    "  ldm r5, {r2, r4, r7-r12}\n  stm r1, {r2, r4, r7-r12}\n"
    "5:"
    "  tst r3, #0x100000\n  ite eq\n  mvneq r3, #8\n  mvnne r3, #4\n"   /* UFSR.STKOF: -5, else -9 */
    "  mov r2, #0x01000000\n"                         /* xPSR: Thumb */
    "  ldr r1, =0xE000ED04\n  ldr r1, [r1]\n  tst r1, #0x800\n  beq 2f\n"   /* ICSR.RETTOBASE: no other exception active */
    "4: ldr r1, =throw_\n"
    "  ldr r0, =_estack - 32\n  mov sp, r0\n"
    "3: bic r1, r1, #1\n  str r3, [r0]\n  strd r1, r2, [r0, #24]\n  bx lr\n"
    "2: ldr r1, =irq_now\n  ldr r1, [r1]\n  orr r2, r2, r1\n  ldr r1, =escape\n  b 3b\n"   /* back to the handler: its IPSR (the frame may not have been stacked) */
    "  .global escape\n  .thumb_func\n"
    "escape:\n"
    "  mov r3, r0\n  mov r2, #0x01000000\n  mvn lr, #6\n  b 4b\n"
    "  .ltorg\n");
#endif

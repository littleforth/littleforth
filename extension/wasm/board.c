/* board.c - the WebAssembly board: the kernel's host build (token code) for the
 * extension's "no board" console. Forth memory is the array M; the console is two
 * functions the page gives (js_key blocks until a key is there, in a worker).
 * Built by build.sh with the kernel's own sources, unchanged. The kernel's
 * __builtin_setjmp/longjmp are mapped (-D) onto wsetjmp/wlongjmp: wlongjmp asks
 * JavaScript to throw, which unwinds the WebAssembly stack, and JavaScript calls
 * forth_quit again: the same as the kernel's jump back into quit.
 */
#include "forth.h"

__attribute__((import_module("env"), import_name("js_key"))) int js_key(void);
__attribute__((import_module("env"), import_name("js_emit"))) void js_emit(int c);
__attribute__((import_module("env"), import_name("js_unwind"))) void js_unwind(void);

uint8_t M[MSIZE];
cell tos, *psp;

int wsetjmp(void *jb) { (void)jb; return 0; }
void wlongjmp(void *jb, int v) { (void)jb; (void)v; js_unwind(); __builtin_unreachable(); }

int con_key(void) { return js_key(); }
void con_emit(int c) { js_emit(c); }

void *memcpy(void *d, const void *s, unsigned long n) { uint8_t *a = d; const uint8_t *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, unsigned long n) { uint8_t *a = d; while (n--) *a++ = (uint8_t)c; return d; }
void *memmove(void *d, const void *s, unsigned long n) {
    uint8_t *a = d; const uint8_t *b = s;
    if (a < b) while (n--) *a++ = *b++; else { a += n; b += n; while (n--) *--a = *--b; }
    return d;
}

/* flash stand-in for SAVE: survives REBOOT, not the page */
static uint32_t flash[16384 / 4];
uint32_t *board_flash_area(void) { return flash; }
void board_flash_erase(uint32_t *p) { for (int i = 0; i < 1024; i++) p[i] = 0xFFFFFFFFu; }
void board_flash_write(uint32_t *d, const uint32_t *s, ucell n) { while (n) { *d++ &= *s++; n -= 4; } }
void board_reboot(void) { kernel_init(); S->echo = 0; quit(); }

const uint8_t *regtable;

__attribute__((export_name("forth_start"))) void forth_start(void)
{
    for (int i = 0; i < 4; i++) board_flash_erase(flash + 1024 * i);
    kernel_init();
    S->echo = 0;
    quit();
}
__attribute__((export_name("forth_quit"))) void forth_quit(void) { quit(); }

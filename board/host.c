/* host.c - the host board: Forth memory is the array M, console is stdio.
 * Input ends the program at end of file. No echo: input comes from a pipe.
 */
#include <stdio.h>
#include <stdlib.h>
#include "forth.h"

uint8_t M[MSIZE];
cell tos, *psp;

int con_key(void)
{
    int c = getchar();
    if (c == EOF) { fflush(stdout); exit(0); }
    return c;
}
void con_emit(int c)
{
    putchar(c);
    if (c == '\n') fflush(stdout);
}
/* flash stand-in for SAVE: survives REBOOT, not the process */
static uint32_t flash[16384 / 4];
uint32_t *board_flash_area(void) { return flash; }
void board_flash_erase(uint32_t *p) { for (int i = 0; i < 1024; i++) p[i] = 0xFFFFFFFFu; }
void board_flash_write(uint32_t *d, const uint32_t *s, ucell n) { while (n) { *d++ &= *s++; n -= 4; } }
void board_reboot(void) { kernel_init(); S->echo = 0; quit(); }

/* the register table (A12): the file named by FORTH_REGS, if set */
const uint8_t *regtable;
static void load_regs(void)
{
    const char *f = getenv("FORTH_REGS");
    FILE *fp = f ? fopen(f, "rb") : NULL;
    if (!fp) return;
    static uint8_t buf[1 << 17];
    if (fread(buf, 1, sizeof buf, fp) > 4) regtable = buf;
    fclose(fp);
}

int main(void)
{
    load_regs();
    board_flash_erase(flash); board_flash_erase(flash + 1024);
    board_flash_erase(flash + 2048); board_flash_erase(flash + 3072);
    kernel_init();
    S->echo = 0;
    quit();
}

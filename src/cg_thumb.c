/* cg_thumb.c - target code generator: Thumb-2 machine code.
 *
 * Registers: TOS r6, data stack pointer r5 (full descending), return stack sp.
 * A colon definition is  push {lr} ... pop {pc}; words are called with BL.
 * Builtins flagged inline in wordlist.h are copied instead of called.
 * Every encoding here was checked against arm-none-eabi-as.
 * Code addresses: data address + CODE_ALIAS is where code runs (a chip that
 * runs RAM code through a code-bus alias); xts carry the Thumb bit.
 */
#include "forth.h"
#include "cg.h"

#define EX(a) ((a) + CODE_ALIAS)                /* execution address */

void room(void);                                /* interp.c: ?-8 near the dictionary's end */
static void h(uint16_t x) { room(); *(uint16_t *)P(S->here) = x; S->here += 2; }
static void h2(uint16_t a, uint16_t b) { h(a); h(b); }
static uint16_t rd(ucell a) { return *(uint16_t *)P(a); }
static void wr(ucell a, uint16_t x) { *(uint16_t *)P(a) = x; }

#define PUSH_TOS() h2(0xF845, 0x6D04)           /* str r6,[r5,#-4]!  */
#define POP_TOS()  h2(0xF855, 0x6B04)           /* ldr r6,[r5],#4    */

/* BL (link) or B.W at site, to execution address dest */
static void put_t4(ucell site, ucell dest, int link)
{
    cell off = (cell)(dest - EX(site) - 4);
    ucell s = (off >> 24) & 1, j1 = (~(off >> 23) & 1) ^ s, j2 = (~(off >> 22) & 1) ^ s;
    wr(site, 0xF000 | s << 10 | ((off >> 12) & 0x3FF));
    wr(site + 2, (link ? 0xD000 : 0x9000) | j1 << 13 | j2 << 11 | ((off >> 1) & 0x7FF));
}
/* B<cond>.W at site, cond kept from the halfword already there */
static void put_t3(ucell site, ucell dest)
{
    cell off = (cell)(dest - EX(site) - 4);
    ucell cond = (rd(site) >> 6) & 0xF;
    wr(site, 0xF000 | ((off >> 20) & 1) << 10 | cond << 6 | ((off >> 12) & 0x3F));
    wr(site + 2, 0x8000 | ((off >> 18) & 1) << 13 | ((off >> 19) & 1) << 11 | ((off >> 1) & 0x7FF));
}

void cg_init(void)  { }
void cg_enter(void) { h(0xB500); }              /* push {lr} */
void cg_exit(void)  { h(0xBD00); }              /* pop {pc}  */

/* copy a leaf builtin's body up to its bx lr; 0 if it is not copyable */
static int inline_copy(cell xt)
{
    const uint16_t *p = P(xt & ~1u);
    int n = 0;
    while (n < 12) {
        uint16_t x = p[n];
        if (x == 0x4770) break;                 /* bx lr */
        n += (x >> 11) >= 0x1D ? 2 : 1;         /* 32-bit instruction */
    }
    if (n >= 12) return 0;
    for (int i = 0; i < n; i++) h(p[i]);
    return 1;
}
void cg_call(cell xt)
{
    int i = bi_index(xt);
    if (i >= 0 && (bi_flagsof(i) & BF_INLINE) && inline_copy(xt)) return;
    room();
    ucell s = S->here; S->here += 4;
    put_t4(s, (ucell)xt & ~1u, 1);
}
static void movw(int top, ucell u)              /* movw / movt r6,#u */
{
    h2((top ? 0xF2C0 : 0xF240) | ((u >> 1) & 0x400) | ((u >> 12) & 0xF),
       ((u << 4) & 0x7000) | 0x0600 | (u & 0xFF));
}
void cg_lit(cell n)
{
    PUSH_TOS();
    if ((ucell)n < 256) { h(0x2600 | n); return; }          /* movs r6,#n */
    if ((ucell)~n < 256) { h2(0xF06F, 0x0600 | ~n); return; } /* mvn r6,#~n */
    movw(0, n);
    if ((ucell)n >> 16) movw(1, (ucell)n >> 16);
}
ucell cg_lit_site(void)
{
    PUSH_TOS();
    ucell s = S->here;
    movw(0, 0); movw(1, 0);
    return s;
}
void cg_lit_patch(ucell s, cell n)
{
    ucell keep = S->here;
    S->here = s;
    movw(0, n); movw(1, (ucell)n >> 16);
    S->here = keep;
}
ucell cg_br(int cond)
{
    if (cond) { h(0x2E00); POP_TOS(); }         /* cmp r6,#0; pop */
    ucell s = S->here;
    h2(0xF000, cond ? 0x8000 : 0x9000);         /* beq.w / b.w, resolved later */
    return s;
}
void cg_resolve(ucell s, ucell d)
{
    if (rd(s + 2) & 0x1000) put_t4(s, EX(d), 0); else put_t3(s, EX(d));
}
/* LEAVE chain: an open b.w keeps (site - next)/2 in its first halfword */
ucell cg_chain(ucell s)            { uint16_t d = rd(s); return d ? s - 2u * d : 0; }
void  cg_set_chain(ucell s, ucell n) { wr(s, n ? (uint16_t)((s - n) / 2) : 0); }

/* fixed sequences, as halfwords */
static const uint16_t T_DO[] = {                /* mov r0,r6; pop r1; pop tos; push {r0,r1} */
    0x4630, 0xF855, 0x1B04, 0xF855, 0x6B04, 0xB403 };
static const uint16_t T_LOOP[] = {              /* index+1, compare limit, bne.w */
    0x9800, 0x3001, 0x9901, 0x9000, 0x4288, 0xF000 | 1 << 6, 0x8000 };
static const uint16_t T_PLOOP[] = {             /* overflow of (i-l)^MSB + n, bvc.w */
    0x9800, 0x9901, 0x1A42, 0xF082, 0x4200, 0x1980, 0x9000, 0x1992, 0xF855, 0x6B04,
    0xF000 | 7 << 6, 0x8000 };
static const uint16_t T_CREATE[] = {            /* push tos; ldr r6,[pc,#4]; bx lr; nop; nop */
    0xF845, 0x6D04, 0x4E01, 0x4770, 0xBF00, 0xBF00 };
static void tpl(const uint16_t *t, int n) { while (n--) h(*t++); }

void cg_do(void)     { tpl(T_DO, 6); }
void cg_unloop(void) { h(0xB002); }             /* add sp,#8 */
void cg_loop(ucell d, int plus)
{
    if (plus) tpl(T_PLOOP, 12); else tpl(T_LOOP, 7);
    put_t3(S->here - 4, EX(d));
    cg_unloop();
}
void cg_i(void)      { PUSH_TOS(); h(0x9E00); }  /* ldr r6,[sp]   */
void cg_j(void)      { PUSH_TOS(); h(0x9E02); }  /* ldr r6,[sp,#8] */
void cg_tor(void)    { h(0xB440); POP_TOS(); }   /* push {r6}     */
void cg_rfrom(void)  { PUSH_TOS(); h(0xBC40); }  /* pop {r6}      */
void cg_rfetch(void) { PUSH_TOS(); h(0x9E00); }

/* CREATE: push tos; ldr r6,[pc,#4]; bx lr; nop; nop; .word body (16 bytes).
   DOES> overwrites bx lr; nop with b.w dest. */
void cg_create(void)
{
    ucell x = S->here;
    tpl(T_CREATE, 6);
    C32(S->here) = x + 16; S->here += 4;
}
void  cg_does(ucell xt, ucell d) { put_t4((xt & ~1u) - CODE_ALIAS + 6, EX(d), 0); }
ucell cg_body(ucell xt)          { return C32((xt & ~1u) - CODE_ALIAS + 12); }
void  cg_run(cell xt)            { ((void (*)(void))(uintptr_t)xt)(); }

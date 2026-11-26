/* words.c - stack, arithmetic, comparison and memory words.
 * Each is a void function working on tos/psp. Words flagged L in wordlist.h
 * must stay branch-free leaf code ending in a single return: the target code
 * generator copies them inline (checked by tools/inlinecheck.sh).
 */
#include "forth.h"

#define NOS psp[0]

void w_dup(void)    { *--psp = tos; }
void w_drop(void)   { tos = *psp++; }
void w_swap(void)   { cell t = NOS; NOS = tos; tos = t; }
void w_over(void)   { cell t = NOS; *--psp = tos; tos = t; }
void w_rot(void)    { cell t = psp[1]; psp[1] = NOS; NOS = tos; tos = t; }
void w_qdup(void)   { if (tos) *--psp = tos; }
void w_nip(void)    { psp++; }
void w_tuck(void)   { cell t = NOS; NOS = tos; *--psp = t; }
void w_twodup(void) { cell t = NOS; psp -= 2; psp[1] = tos; psp[0] = t; }
void w_twodrop(void){ tos = psp[1]; psp += 2; }
void w_twoswap(void){ cell a = psp[2], b = psp[1]; psp[2] = NOS; psp[1] = tos; NOS = a; tos = b; }
void w_twoover(void){ cell a = psp[2], b = psp[1]; psp -= 2; psp[1] = tos; psp[0] = a; tos = b; }
void w_depth(void)  { cell d = DS_TOP - psp; push(d); }

void w_plus(void)   { tos += *psp++; }
void w_minus(void)  { tos = *psp++ - tos; }
void w_star(void)   { tos *= *psp++; }
void w_negate(void) { tos = -tos; }
void w_abs(void)    { if (tos < 0) tos = -tos; }
void w_min(void)    { cell n = *psp++; if (n < tos) tos = n; }
void w_max(void)    { cell n = *psp++; if (n > tos) tos = n; }
void w_oneplus(void){ tos++; }
void w_oneminus(void){ tos--; }
void w_twostar(void){ tos <<= 1; }
void w_twoslash(void){ tos >>= 1; }
void w_lshift(void) { tos = (ucell)*psp++ << tos; }
void w_rshift(void) { tos = (ucell)*psp++ >> tos; }
void w_and(void)    { tos &= *psp++; }
void w_or(void)     { tos |= *psp++; }
void w_xor(void)    { tos ^= *psp++; }
void w_invert(void) { tos = ~tos; }
void w_stod(void)   { *--psp = tos; tos >>= 31; }

void w_zeq(void)    { tos = -(tos == 0); }
void w_zlt(void)    { tos >>= 31; }
void w_zne(void)    { tos = -(tos != 0); }
void w_eq(void)     { tos = -(*psp++ == tos); }
void w_ne(void)     { tos = -(*psp++ != tos); }
void w_lt(void)     { tos = -(*psp++ < tos); }
void w_gt(void)     { tos = -(*psp++ > tos); }
void w_ult(void)    { tos = -((ucell)*psp++ < (ucell)tos); }

/* ---- double-cell arithmetic. No libgcc on the target, so 64/32 division
   is done here by shift and subtract. ---- */
ucell udivmod(udcell *n, ucell d)             /* *n /= d, returns remainder */
{
#ifdef HOST
    ucell r = (ucell)(*n % d); *n /= d; return r;
#else
    udcell x = *n; ucell r = 0;              /* quotient builds in x's low bits */
    for (int i = 0; i < 64; i++) {
        ucell top = r >> 31;
        r = (r << 1) | (ucell)(x >> 63); x <<= 1;
        if (top || r >= d) { r -= d; x |= 1; }
    }
    *n = x; return r;
#endif
}

/* symmetric division of a double by a single: ( d n -- rem quot ) */
static void smrem(dcell d, cell n)
{
    if (n == 0) throw_(-10);
    udcell ud = d < 0 ? -(udcell)d : (udcell)d;
    ucell r = udivmod(&ud, n < 0 ? -(ucell)n : (ucell)n);
    dcell q = (d < 0) != (n < 0) ? -(dcell)ud : (dcell)ud;
    push(d < 0 ? -(cell)r : (cell)r);
    push((cell)q);
}
void w_smrem(void)  { cell n = pop(); smrem((dcell)dpop(), n); }
void w_fmmod(void)
{
    cell n = pop(); dcell d = (dcell)dpop();
    smrem(d, n);
    if (NOS && ((NOS < 0) != (n < 0))) { NOS += n; tos--; }
}
void w_ummod(void)
{
    ucell u = pop(); udcell d = dpop();
    if (u == 0) throw_(-10);
    ucell r = udivmod(&d, u);
    push(r); push((cell)d);
}
void w_mstar(void)  { cell n = pop(); dpush((udcell)((dcell)pop() * n)); }
void w_umstar(void) { ucell n = pop(); dpush((udcell)(ucell)pop() * n); }
void w_slashmod(void) { cell n = pop(); smrem(pop(), n); }
void w_slash(void)  { w_slashmod(); w_nip(); }
void w_mod(void)    { w_slashmod(); w_drop(); }
void w_starslashmod(void) { cell n3 = pop(), n2 = pop(); smrem((dcell)pop() * n2, n3); }
void w_starslash(void) { w_starslashmod(); w_nip(); }

/* ---- memory ---- */
void w_fetch(void)  { tos = C32(tos); }
void w_store(void)  { C32(tos) = NOS; tos = psp[1]; psp += 2; }
void w_cfetch(void) { tos = C8(tos); }
void w_cstore(void) { C8(tos) = (uint8_t)NOS; tos = psp[1]; psp += 2; }
void w_hfetch(void) { tos = *(uint16_t *)P(tos); }
void w_hstore(void) { *(uint16_t *)P(tos) = (uint16_t)NOS; tos = psp[1]; psp += 2; }
void w_plusstore(void) { C32(tos) += NOS; tos = psp[1]; psp += 2; }
void w_twofetch(void)  { ucell a = tos; tos = C32(a + 4); push(C32(a)); }
void w_twostore(void)  { ucell a = pop(); C32(a) = pop(); C32(a + 4) = pop(); }
void w_cells(void)  { tos <<= 2; }
void w_cellplus(void) { tos += 4; }
void w_chars(void)  { }
void w_charplus(void) { tos++; }
void w_aligned(void){ tos = (tos + 3) & ~3; }
void w_count(void)  { ucell a = tos; tos = a + 1; push(C8(a)); }
void w_fill(void)
{
    int c = pop(); cell n = pop(); uint8_t *p = P(pop());
    while (n-- > 0) *p++ = (uint8_t)c;
}
void w_move(void)
{
    cell n = pop(); uint8_t *d = P(pop()), *s = P(pop());
    if (d < s) while (n-- > 0) *d++ = *s++;
    else { d += n; s += n; while (n-- > 0) *--d = *--s; }
}
void w_bl(void)     { push(' '); }
void w_true(void)   { push(-1); }
void w_false(void)  { push(0); }
